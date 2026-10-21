package app

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"feedback-hub/backend/internal/store"
)

func testApp(t *testing.T) *App {
	t.Helper()
	return New(Config{Origin: "https://feedback.example", Secret: bytes.Repeat([]byte{9}, 32)}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
}
func TestSignedVisitorAndFormProof(t *testing.T) {
	a := testApp(t)
	now := time.Unix(1800000000, 0)
	a.now = func() time.Time { return now }
	id := randomToken()
	proof := a.formToken(id)
	if a.validForm(id, proof) {
		t.Fatal("instant form accepted")
	}
	now = now.Add(2 * time.Second)
	if !a.validForm(id, proof) {
		t.Fatal("two-second form rejected")
	}
	if a.validForm(randomToken(), proof) || a.validForm(id, proof+"a") {
		t.Fatal("proof not bound to signature and visitor")
	}
	now = now.Add(2 * time.Hour)
	if a.validForm(id, proof) {
		t.Fatal("expired proof accepted")
	}
	w := httptest.NewRecorder()
	a.setCookie(w, "visitor", a.sign("visitor", id+"~"+itoa(int(now.Add(time.Hour).Unix()))), 3600)
	c := w.Result().Cookies()[0]
	if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || !strings.HasPrefix(c.Name, "__Host-") || c.Domain != "" || c.Path != "/" {
		t.Fatalf("weak cookie attributes: %+v", c)
	}
	r := httptest.NewRequest("GET", "/api/form", nil)
	r.AddCookie(c)
	if got, ok := a.visitor(r); !ok || got != id {
		t.Fatal("valid cookie rejected")
	}
	c.Value += "x"
	r = httptest.NewRequest("GET", "/api/form", nil)
	r.AddCookie(c)
	if _, ok := a.visitor(r); ok {
		t.Fatal("tampered cookie accepted")
	}
	// A different signing key cannot use cookies or proofs from the previous key.
	other := testApp(t)
	other.cfg.Secret = bytes.Repeat([]byte{3}, 32)
	now = time.Unix(1800000002, 0)
	other.now = a.now
	if !a.validForm(id, proof) {
		t.Fatal("baseline proof unexpectedly expired")
	}
	if other.validForm(id, proof) {
		t.Fatal("different signing key accepted")
	}
}
func TestProxyExactSingleHop(t *testing.T) {
	a := testApp(t)
	a.cfg.TrustedProxies = []netip.Addr{netip.MustParseAddr("192.0.2.10")}
	tests := []struct {
		peer, xff, want string
		ok              bool
	}{{"192.0.2.11:123", "8.8.8.8", "192.0.2.11", true}, {"192.0.2.10:123", "198.51.100.25", "198.51.100.25", true}, {"192.0.2.10:123", "1.1.1.1, 198.51.100.25", "", false}, {"192.0.2.10:123", "", "", false}, {"[::ffff:192.0.2.10]:123", "2001:db8::1", "2001:db8::1", true}, {"garbage", "8.8.8.8", "", false}}
	for _, tt := range tests {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = tt.peer
		if tt.xff != "" {
			r.Header.Set("X-Forwarded-For", tt.xff)
		}
		got, ok := a.clientIP(r)
		if ok != tt.ok || got != tt.want {
			t.Errorf("peer=%s xff=%s got %q %v", tt.peer, tt.xff, got, ok)
		}
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.10:123"
	r.Header.Add("X-Forwarded-For", "1.1.1.1")
	r.Header.Add("X-Forwarded-For", "2.2.2.2")
	if _, ok := a.clientIP(r); ok {
		t.Fatal("multiple forwarded headers accepted")
	}
}
func TestBoundedLimiter(t *testing.T) {
	l := newLimiter()
	l.max = 2
	now := time.Unix(100, 0)
	if !l.allow("a", 1, time.Minute, now) || l.allow("a", 1, time.Minute, now) {
		t.Fatal("rate capacity violated")
	}
	if !l.allow("b", 1, time.Minute, now) || l.allow("c", 1, time.Minute, now) || len(l.entries) != 2 {
		t.Fatal("limiter exceeds bounded memory")
	}
	if !l.allow("c", 1, time.Minute, now.Add(time.Hour)) || len(l.entries) > 2 {
		t.Fatal("expired entries not reclaimed")
	}
}
func TestStrictJSON(t *testing.T) {
	for _, body := range []string{`{"password":"a","password":"b"}`, `{"extra":1}`, `{} {}`, `null`, `[]`, `{"password":`, "{\"password\":\"\xff\"}", `{"password":"` + strings.Repeat("x", maxBody) + `"}`} {
		var dst struct {
			Password string `json:"password"`
		}
		r := httptest.NewRequest("POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if decode(httptest.NewRecorder(), r, &dst) == nil {
			t.Errorf("accepted invalid JSON prefix %q", body[:min(40, len(body))])
		}
	}
	var dst struct {
		Password string `json:"password"`
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader(`{"password":"ok"}`))
	r.Header.Set("Content-Type", "text/plain")
	if decode(httptest.NewRecorder(), r, &dst) == nil {
		t.Fatal("simple content type accepted")
	}
}
func TestContextMinimization(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd", "http://localhost/test", "http://127.0.0.1/test", "http://10.0.0.1/test", "http://[::1]/", "http://router.local/", "https://internal/", "https://host.internal/"} {
		if _, err := sanitizeContext(store.Context{PageURL: raw}); err == nil {
			t.Errorf("accepted sensitive URL %s", raw)
		}
	}
	c, err := sanitizeContext(store.Context{PageURL: "https://user:password@example.com/reset/secret?token=x#private", Browser: "Mozilla/5 Chrome/140 private device", AppVersion: "1.2.3-beta"}, "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if c.PageURL != "https://example.com/" || c.Browser != "Chrome" {
		t.Fatalf("context leaked: %+v", c)
	}
	c, err = sanitizeContext(store.Context{PageURL: "https://example.com/compare?student=secret#name"}, "https://example.com")
	if err != nil || c.PageURL != "https://example.com/compare" {
		t.Fatalf("safe path not preserved: %+v %v", c, err)
	}
	if _, err = sanitizeContext(store.Context{AppVersion: "email@example.com"}); err == nil {
		t.Fatal("unbounded version accepted")
	}
}
func TestOriginAndHoneypot(t *testing.T) {
	a := testApp(t)
	h := a.Handler()
	for _, origin := range []string{"", "null", "https://feedback.example.evil", "https://campus.kreoniz.ru", "https://feedback.example:444", "http://feedback.example"} {
		r := httptest.NewRequest("POST", "/api/reports", strings.NewReader(`{}`))
		r.Host = "feedback.example"
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Errorf("origin %q status %d", origin, w.Code)
		}
	}

	duplicateOrigin := httptest.NewRequest("POST", "https://feedback.example/api/reports", strings.NewReader(`{}`))
	duplicateOrigin.Header.Add("Origin", a.cfg.Origin)
	duplicateOrigin.Header.Add("Origin", "https://evil.example")
	duplicateResponse := httptest.NewRecorder()
	h.ServeHTTP(duplicateResponse, duplicateOrigin)
	if duplicateResponse.Code != 403 {
		t.Fatal("multiple Origin headers accepted")
	}
	a.now = func() time.Time { return time.Unix(1800000000, 0) }
	visitor := randomToken()
	token := a.formToken(visitor)
	a.now = func() time.Time { return time.Unix(1800000003, 0) }
	body, _ := json.Marshal(map[string]string{"form_token": token, "website": "bot"})
	r := httptest.NewRequest("POST", "/api/reports", bytes.NewReader(body))
	r.Host = "feedback.example"
	r.Header.Set("Origin", a.cfg.Origin)
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(&http.Cookie{Name: a.cookieName("visitor"), Value: a.sign("visitor", visitor+"~1800001000")})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 201 || !strings.Contains(w.Body.String(), `"duplicate":false`) {
		t.Fatalf("honeypot touched nil DB or failed: %d %s", w.Code, w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("security/cache headers missing")
	}
}
func TestStaticNoTraversalOrSensitiveFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>app</h1>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape.js")); err != nil {
		t.Fatal(err)
	}
	a := testApp(t)
	a.cfg.StaticDir = dir
	for _, p := range []string{"/", "/new", "/admin"} {
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, httptest.NewRequest("GET", "https://feedback.example"+p, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), "<h1>app") {
			t.Errorf("SPA %s: %d", p, w.Code)
		}
	}
	for _, p := range []string{"/.env", "/missing.js", "/escape.js", "/api/nope", "/health/nope"} {
		w := httptest.NewRecorder()
		a.Handler().ServeHTTP(w, httptest.NewRequest("GET", "https://feedback.example"+p, nil))
		if w.Code == 200 || strings.Contains(w.Body.String(), "secret") {
			t.Errorf("unsafe static path %s: %d %s", p, w.Code, w.Body)
		}
	}
}
func TestFilterBounds(t *testing.T) {
	for _, q := range []string{"limit=101", "offset=10001", "sort=priority", "project=unknown", "limit=1&limit=2", "q=" + strings.Repeat("x", 201), "unexpected=true"} {
		if _, err := parseFilter(httptest.NewRequest("GET", "/api/features?"+q, nil), true); err == nil {
			t.Errorf("filter accepted %s", q)
		}
	}
}

func TestAdmissionReservesAdminAndHealth(t *testing.T) {
	a := testApp(t)
	for range cap(a.slots) {
		a.slots <- struct{}{}
	}
	a.limits.max = 1
	a.limits.entries["occupied"] = bucket{updated: time.Now()}
	h := a.Handler()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "https://feedback.example/api/projects", nil))
	if w.Code != 503 {
		t.Fatal("public overload was not rejected")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "https://feedback.example/api/admin/session", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"authenticated":false`) {
		t.Fatalf("public overload exhausted admin admission: %d %s", w.Code, w.Body)
	}
	for range cap(a.adminSlots) {
		a.adminSlots <- struct{}{}
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/health/live", nil))
	if w.Code != 200 {
		t.Fatal("overload exhausted liveness")
	}
}
