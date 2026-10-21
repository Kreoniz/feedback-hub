package app

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"feedback-hub/backend/internal/store"
	"feedback-hub/backend/internal/testutil"
	"golang.org/x/crypto/bcrypt"
)

func TestHTTPDatabaseSecurityInvariants(t *testing.T) {
	db := testutil.Database(t)
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password-long-enough"), 12)
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	a := New(Config{Origin: "https://feedback.example", Secret: bytes.Repeat([]byte{1}, 32), PasswordHash: hash}, db, slog.New(slog.NewTextHandler(&logs, nil)))
	now := time.Now()
	a.now = func() time.Time { return now }
	h := a.Handler()
	request := func(method, path string, body any, cookies []*http.Cookie, csrf string) *httptest.ResponseRecorder {
		t.Helper()
		var data []byte
		if body != nil {
			var err error
			data, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		r := httptest.NewRequest(method, "https://feedback.example"+path, bytes.NewReader(data))
		r.RemoteAddr = "198.51.100.15:1000"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", a.cfg.Origin)
		if csrf != "" {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		for _, c := range cookies {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	object := func(w *httptest.ResponseRecorder) map[string]any {
		t.Helper()
		var v map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
			t.Fatalf("invalid JSON %d: %s", w.Code, w.Body)
		}
		return v
	}
	requireStatus := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("expected %d, got %d: %s", status, w.Code, w.Body)
		}
	}
	requireStatus(request("GET", "/health/ready", nil, nil, ""), 200)
	form := request("GET", "/api/form", nil, nil, "")
	requireStatus(form, 200)
	token := object(form)["token"].(string)
	visitor := form.Result().Cookies()
	report := map[string]any{"project": "campus", "type": "bug", "description": "sensitive crash details", "details": "private debugging context", "context": map[string]any{"page_url": "https://campus.kreoniz.ru/compare?student=hidden#private", "browser": "Chrome/140 private device", "app_version": "1.0"}, "form_token": token}
	requireStatus(request("POST", "/api/reports", report, visitor, ""), 400)
	now = now.Add(3 * time.Second)
	created := request("POST", "/api/reports", report, visitor, "")
	requireStatus(created, 201)
	receipt1 := object(created)["id"].(string)
	second := request("GET", "/api/form", nil, nil, "")
	requireStatus(second, 200)
	visitor2 := second.Result().Cookies()
	token2 := object(second)["token"].(string)
	now = now.Add(3 * time.Second)
	report["form_token"] = token2
	dup := request("POST", "/api/reports", report, visitor2, "")
	requireStatus(dup, 201)
	if object(dup)["duplicate"] != false || object(dup)["id"] == receipt1 {
		t.Fatal("dedupe receipt leaks original ID")
	}
	board := request("GET", "/api/features", nil, visitor, "")
	requireStatus(board, 200)
	if strings.Contains(board.Body.String(), "sensitive") || object(board)["total"] != float64(0) {
		t.Fatal("bug leaked onto board")
	}
	requireStatus(request("GET", "/api/admin/reports", nil, nil, ""), 401)
	requireStatus(request("GET", "/api/admin/reports/"+receipt1, nil, nil, ""), 401)
	requireStatus(request("POST", "/api/admin/login", map[string]string{"password": "wrong"}, nil, ""), 401)
	logged := request("POST", "/api/admin/login", map[string]string{"password": "test-password-long-enough"}, nil, "")
	requireStatus(logged, 200)
	session := logged.Result().Cookies()
	csrf := object(logged)["csrf_token"].(string)
	// Cookie contains only an opaque token; database stores its HMAC rather than bearer token.
	if len(session) != 1 || len(session[0].Value) != 43 || !session[0].HttpOnly || !session[0].Secure {
		t.Fatal("invalid session cookie")
	}
	var rawMatch bool
	if err := db.Pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=$1)`, []byte(session[0].Value)).Scan(&rawMatch); err != nil || rawMatch {
		t.Fatal("raw session bearer token stored")
	}
	sessionGet := request("GET", "/api/admin/session", nil, session, "")
	requireStatus(sessionGet, 200)
	if object(sessionGet)["csrf_token"] != csrf || sessionGet.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("session introspection broken")
	}
	reports := request("GET", "/api/admin/reports?type=bug&q=sensitive", nil, session, "")
	requireStatus(reports, 200)
	var list struct {
		Items []store.Report `json:"items"`
		Total int            `json:"total"`
	}
	if err = json.Unmarshal(reports.Body.Bytes(), &list); err != nil || list.Total != 1 {
		t.Fatal("admin report missing")
	}
	bug := list.Items[0]
	if bug.ID == receipt1 || bug.ID == object(dup)["id"] || bug.Context.PageURL != "https://campus.kreoniz.ru/compare" || bug.Context.Browser != "Chrome" {
		t.Fatalf("receipt or minimized context invalid: %+v", bug)
	}
	requireStatus(request("PATCH", "/api/admin/reports/"+bug.ID, map[string]string{"moderation": "approved"}, session, csrf), 400)
	requireStatus(request("PATCH", "/api/admin/reports/"+bug.ID, map[string]string{"priority": "critical"}, session, ""), 403)
	requireStatus(request("PATCH", "/api/admin/reports/"+bug.ID, map[string]string{"priority": "critical"}, session, "forged"), 403)
	requireStatus(request("PATCH", "/api/admin/reports/"+bug.ID, map[string]string{"priority": "critical", "information": "sparse"}, session, csrf), 200)
	// Source inference uses exact allowlisted origins and explicit project always wins.
	feature := map[string]any{"type": "feature", "title": "Public feature", "description": "Public text", "form_token": token2, "context": map[string]string{"page_url": "https://campus.kreoniz.ru/schedule?student=private"}}
	requireStatus(request("POST", "/api/reports", feature, visitor2, ""), 201)
	features := request("GET", "/api/admin/reports?type=feature", nil, session, "")
	requireStatus(features, 200)
	if err = json.Unmarshal(features.Body.Bytes(), &list); err != nil || len(list.Items) != 1 {
		t.Fatal("feature missing")
	}
	fid := list.Items[0].ID
	requireStatus(request("POST", "/api/features/"+fid+"/vote", map[string]any{}, visitor, ""), 404)
	requireStatus(request("PATCH", "/api/admin/reports/"+fid, map[string]string{"moderation": "approved", "admin_note": "never public"}, session, csrf), 200)
	board = request("GET", "/api/features?project=campus", nil, visitor, "")
	requireStatus(board, 200)
	for _, forbidden := range []string{"private", "never public", "context", "moderation", "details", "priority", "information", "duplicate_of", "admin_note"} {
		if strings.Contains(board.Body.String(), forbidden) {
			t.Fatalf("public DTO leaked %q: %s", forbidden, board.Body)
		}
	}
	requireStatus(request("POST", "/api/features/"+fid+"/vote", map[string]any{}, nil, ""), 400)
	voted := request("POST", "/api/features/"+fid+"/vote", map[string]any{}, visitor, "")
	requireStatus(voted, 200)
	if object(voted)["votes"] != float64(1) {
		t.Fatal("vote missing")
	}
	requireStatus(request("POST", "/api/features/"+fid+"/vote", map[string]any{}, visitor, ""), 200)
	cooldown := request("POST", "/api/features/"+fid+"/vote", map[string]any{}, visitor2, "")
	requireStatus(cooldown, 429)
	if cooldown.Header().Get("Retry-After") == "" {
		t.Fatal("cooldown missing retry-after")
	}
	// Reject null patch values, unknown keys, self links and report-ID probing through receipts.
	for _, p := range []map[string]any{{"priority": nil}, {"unexpected": "value"}, {"duplicate_of": fid}} {
		requireStatus(request("PATCH", "/api/admin/reports/"+fid, p, session, csrf), 400)
	}
	requireStatus(request("GET", "/api/admin/reports/"+receipt1, nil, session, ""), 404)

	// Reauthentication rotates both token and CSRF, invalidating the previous bearer.
	oldSession, oldCSRF := session, csrf
	rotated := request("POST", "/api/admin/login", map[string]string{"password": "test-password-long-enough"}, session, "")
	requireStatus(rotated, 200)
	session = rotated.Result().Cookies()
	csrf = object(rotated)["csrf_token"].(string)
	requireStatus(request("GET", "/api/admin/reports", nil, oldSession, ""), 401)
	requireStatus(request("PATCH", "/api/admin/reports/"+fid, map[string]string{"status": "planned"}, session, oldCSRF), 403)
	originalHash := a.cfg.PasswordHash
	a.cfg.PasswordHash = []byte("different-configured-password-hash")
	if object(request("GET", "/api/admin/session", nil, session, ""))["authenticated"] != false {
		t.Fatal("password hash change did not invalidate sessions")
	}
	a.cfg.PasswordHash = originalHash
	logout := request("POST", "/api/admin/logout", map[string]any{}, session, csrf)
	requireStatus(logout, 204)
	requireStatus(request("GET", "/api/admin/reports", nil, session, ""), 401)
	if object(request("GET", "/api/admin/session", nil, session, ""))["authenticated"] != false {
		t.Fatal("logged-out session still authorized")
	}
	// No body, URL, IP, token, password or student fragment in application logs.
	for _, s := range []string{"198.51.100.15", "sensitive", "hidden", "test-password", "private", "csrf", session[0].Value} {
		if strings.Contains(logs.String(), s) {
			t.Fatalf("sensitive value in logs: %q", s)
		}
	}
}
func TestCanonicalHostAndNoForwardedOriginTrust(t *testing.T) {
	a := testApp(t)
	h := a.Handler()
	for _, path := range []string{"/api/projects", "/new", "/admin"} {
		r := httptest.NewRequest("GET", "https://evil.example"+path, nil)
		r.Header.Set("X-Forwarded-Host", "feedback.example")
		r.Header.Set("Forwarded", "host=feedback.example;proto=https")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("Host spoof accepted: %s %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/health/live", nil))
	if w.Code != 200 {
		t.Fatal("internal health Host rejected")
	}
}
func TestProjectSourceInference(t *testing.T) {
	for _, tt := range []struct{ url, want string }{{"https://campus.kreoniz.ru/compare?private=x", "campus"}, {"https://campus.kreoniz.ru.evil/", ""}, {"http://campus.kreoniz.ru/", ""}, {"https://user@campus.kreoniz.ru/", ""}, {"javascript://campus.kreoniz.ru", ""}} {
		if got := projectFromURL(tt.url); got != tt.want {
			t.Fatalf("source inference %q: %q", tt.url, got)
		}
	}
}
