package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"feedback-hub/backend/internal/store"
)

const maxBody = 65536

func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	if len(r.Header.Values("Content-Type")) != 1 {
		return errors.New("single JSON content type required")
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return errors.New("JSON required")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	b, err := io.ReadAll(r.Body)
	if err != nil || !utf8.Valid(b) {
		return errors.New("invalid body")
	}
	if len(bytes.TrimSpace(b)) == 0 || bytes.TrimSpace(b)[0] != '{' {
		return errors.New("object required")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	if err = checkJSON(d, 0); err != nil {
		return err
	}
	if _, err = d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	return d.Decode(dst)
}
func checkJSON(d *json.Decoder, depth int) error {
	if depth > 6 {
		return errors.New("JSON too deep")
	}
	t, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			k, err := d.Token()
			if err != nil {
				return err
			}
			s, ok := k.(string)
			if !ok || seen[s] {
				return errors.New("duplicate JSON field")
			}
			seen[s] = true
			if err = checkJSON(d, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for d.More() {
			if err = checkJSON(d, depth+1); err != nil {
				return err
			}
		}
	default:
		return errors.New("invalid JSON")
	}
	_, err = d.Token()
	return err
}
func textOK(s string, max int, required bool) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > max || required && strings.TrimSpace(s) == "" {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' && r != '\t' && r != '\r' {
			return false
		}
	}
	return true
}
func normalize(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }

var versionPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+\-]{0,39}$`)
var safePaths = map[string]bool{"/": true, "/new": true, "/admin": true, "/schedule": true, "/compare": true, "/settings": true, "/docs": true, "/components": true}

func sanitizeContext(c store.Context, allowedOrigins ...string) (store.Context, error) {
	if !textOK(c.PageURL, 2048, false) || !textOK(c.Browser, 200, false) || !textOK(c.AppVersion, 40, false) {
		return store.Context{}, errors.New("invalid context")
	}
	if c.PageURL != "" {
		u, err := url.Parse(c.PageURL)
		if err != nil || u.Scheme != "https" && u.Scheme != "http" || u.Host == "" || u.Opaque != "" {
			return store.Context{}, errors.New("invalid context URL")
		}
		host := strings.ToLower(u.Hostname())
		allowed := false
		for _, origin := range allowedOrigins {
			if strings.EqualFold(u.Scheme+"://"+u.Host, origin) {
				allowed = true
				break
			}
		}
		if !allowed {
			return store.Context{}, errors.New("context origin not allowlisted")
		}
		if host == "localhost" || !strings.Contains(host, ".") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".internal") {
			return store.Context{}, errors.New("private context URL")
		}
		if ip, err := netip.ParseAddr(host); err == nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()) {
			return store.Context{}, errors.New("private context URL")
		}
		encodedPath := u.RawPath != ""
		u.User = nil
		u.RawQuery = ""
		u.ForceQuery = false
		u.Fragment = ""
		u.RawFragment = ""
		u.RawPath = ""
		// Unknown paths may embed account IDs, access tokens, emails or document names.
		clean := path.Clean(u.Path)
		if encodedPath || clean != u.Path || !safePaths[clean] {
			clean = "/"
		}
		u.Path = clean
		c.PageURL = u.String()
	}
	switch b := strings.ToLower(c.Browser); {
	case b == "":
		c.Browser = ""
	case strings.Contains(b, "edg"):
		c.Browser = "Edge"
	case strings.Contains(b, "firefox"):
		c.Browser = "Firefox"
	case strings.Contains(b, "chrome") || strings.Contains(b, "chromium"):
		c.Browser = "Chrome"
	case strings.Contains(b, "safari"):
		c.Browser = "Safari"
	default:
		c.Browser = "Other"
	}
	if c.AppVersion != "" && !versionPattern.MatchString(c.AppVersion) {
		return store.Context{}, errors.New("invalid app version")
	}
	return c, nil
}
func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if a == v {
			return true
		}
	}
	return false
}
func parseFilter(r *http.Request, public bool) (store.Filter, error) {
	f := store.Filter{Limit: 30, Sort: "new"}
	q := r.URL.Query()
	allowed := map[string]bool{"project": true, "q": true, "status": true, "sort": true, "limit": true, "offset": true}
	if !public {
		for _, k := range []string{"type", "moderation", "priority", "information"} {
			allowed[k] = true
		}
	}
	for k, vals := range q {
		if !allowed[k] || len(vals) != 1 {
			return f, errors.New("invalid filter")
		}
	}
	f.Project = q.Get("project")
	f.Q = strings.TrimSpace(q.Get("q"))
	f.Status = q.Get("status")
	f.Type = q.Get("type")
	f.Moderation = q.Get("moderation")
	f.Priority = q.Get("priority")
	f.Information = q.Get("information")
	if f.Project != "" && store.ProjectNames[f.Project] == "" || !textOK(f.Q, 200, false) || !oneOf(f.Status, "", "new", "planned", "in_progress", "done", "closed") || !oneOf(f.Type, "", "feature", "bug") || !oneOf(f.Moderation, "", "pending", "approved", "rejected", "spam") || !oneOf(f.Priority, "", "untriaged", "low", "normal", "high", "critical") || !oneOf(f.Information, "", "sparse", "useful", "detailed") {
		return f, errors.New("invalid filter")
	}
	if v := q.Get("sort"); v != "" {
		f.Sort = v
	}
	if public && !oneOf(f.Sort, "new", "votes") || !public && !oneOf(f.Sort, "new", "old", "priority") {
		return f, errors.New("invalid sort")
	}
	for _, key := range []string{"limit", "offset"} {
		if v := q.Get(key); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || key == "limit" && (n < 1 || n > 100) || key == "offset" && (n < 0 || n > 10000) {
				return f, errors.New("invalid pagination")
			}
			if key == "limit" {
				f.Limit = n
			} else {
				f.Offset = n
			}
		}
	}
	return f, nil
}
