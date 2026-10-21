package app

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"
)

func randomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("secure randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("secure randomness unavailable")
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func validUUID(s string) bool {
	if len(s) != 36 || s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	b, err := hex.DecodeString(strings.ReplaceAll(s, "-", ""))
	return err == nil && len(b) == 16
}
func (a *App) digest(purpose, value string) []byte {
	h := hmac.New(sha256.New, a.cfg.Secret)
	h.Write([]byte(purpose + "\x00" + value))
	return h.Sum(nil)
}
func (a *App) sign(purpose, payload string) string {
	return payload + "." + base64.RawURLEncoding.EncodeToString(a.digest(purpose, payload))
}
func (a *App) verify(purpose, token string) (string, bool) {
	p, s, ok := strings.Cut(token, ".")
	if !ok || len(token) > 512 {
		return "", false
	}
	sig, e := base64.RawURLEncoding.DecodeString(s)
	return p, e == nil && hmac.Equal(sig, a.digest(purpose, p))
}
func (a *App) cookieName(kind string) string {
	if a.cfg.Development {
		return "fh_" + kind
	}
	return "__Host-fh_" + kind
}
func (a *App) setCookie(w http.ResponseWriter, kind, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: a.cookieName(kind), Value: value, Path: "/", MaxAge: age, HttpOnly: true, Secure: !a.cfg.Development, SameSite: http.SameSiteStrictMode})
}
func (a *App) visitor(r *http.Request) (string, bool) {
	c, err := r.Cookie(a.cookieName("visitor"))
	if err != nil {
		return "", false
	}
	p, ok := a.verify("visitor", c.Value)
	if !ok {
		return "", false
	}
	id, t, ok := strings.Cut(p, "~")
	if !ok || len(id) != 43 {
		return "", false
	}
	expiry, err := strconv.ParseInt(t, 10, 64)
	return id, err == nil && a.now().Unix() < expiry
}
func (a *App) formToken(visitor string) string {
	return a.sign("form", visitor+"~"+strconv.FormatInt(a.now().UnixMilli(), 10))
}
func (a *App) validForm(visitor, token string) bool {
	p, ok := a.verify("form", token)
	if !ok {
		return false
	}
	v, t, ok := strings.Cut(p, "~")
	if !ok || v != visitor {
		return false
	}
	issued, err := strconv.ParseInt(t, 10, 64)
	if err != nil {
		return false
	}
	age := a.now().Sub(time.UnixMilli(issued))
	return age >= 2*time.Second && age <= 2*time.Hour
}
func (a *App) clientIP(r *http.Request) (string, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return "", false
	}
	peer = peer.Unmap()
	trusted := false
	for _, p := range a.cfg.TrustedProxies {
		if peer == p {
			trusted = true
			break
		}
	}
	if trusted {
		vals := r.Header.Values("X-Forwarded-For")
		if len(vals) != 1 {
			return "", false
		}
		// Caddy overwrites with exactly one address. Never choose a leftmost attacker-supplied hop.
		ip, err := netip.ParseAddr(strings.TrimSpace(vals[0]))
		if err != nil {
			return "", false
		}
		return ip.Unmap().String(), true
	}
	return peer.String(), true
}

type bucket struct {
	tokens  float64
	updated time.Time
}
type limiter struct {
	mu      sync.Mutex
	entries map[string]bucket
	max     int
}

func newLimiter() *limiter { return &limiter{entries: make(map[string]bucket), max: 10000} }

// Each key is an HMAC, not a raw network address. Fail closed at capacity.
func (l *limiter) allow(key string, capacity int, period time.Duration, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, exists := l.entries[key]
	if !exists {
		if len(l.entries) >= l.max {
			for k, v := range l.entries {
				if now.Sub(v.updated) >= time.Hour {
					delete(l.entries, k)
				}
			}
		}
		if len(l.entries) >= l.max {
			return false
		}
		b = bucket{tokens: float64(capacity), updated: now}
	}
	elapsed := now.Sub(b.updated).Seconds()
	if elapsed < 0 {
		elapsed = 0
	}
	b.tokens += elapsed * float64(capacity) / period.Seconds()
	if b.tokens > float64(capacity) {
		b.tokens = float64(capacity)
	}
	b.updated = now
	ok := b.tokens >= 1
	if ok {
		b.tokens--
	}
	l.entries[key] = b
	return ok
}
