package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"feedback-hub/backend/internal/store"
	"feedback-hub/backend/internal/testutil"
)

const voteFeatureID = "00000000-0000-4000-8000-000000000001"

func TestVoteMutationGuards(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		for _, tt := range []struct {
			name   string
			change func(*App, *http.Request)
			status int
		}{
			{"missing-origin", func(a *App, r *http.Request) { r.Header.Del("Origin") }, 403},
			{"null-origin", func(a *App, r *http.Request) { r.Header.Set("Origin", "null") }, 403},
			{"suffix-origin", func(a *App, r *http.Request) { r.Header.Set("Origin", a.cfg.Origin+".evil") }, 403},
			{"sibling-origin", func(a *App, r *http.Request) { r.Header.Set("Origin", "https://campus.kreoniz.ru") }, 403},
			{"duplicate-origin", func(a *App, r *http.Request) { r.Header.Add("Origin", a.cfg.Origin) }, 403},
			{"cross-site", func(a *App, r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }, 403},
			{"wrong-host", func(a *App, r *http.Request) { r.Host = "evil.example" }, 403},
			{"missing-cookie", func(a *App, r *http.Request) { r.Header.Del("Cookie") }, 400},
			{"tampered-cookie", func(a *App, r *http.Request) { r.Header.Set("Cookie", a.cookieName("visitor")+"=forged") }, 400},
			{"expired-cookie", func(a *App, r *http.Request) {
				r.Header.Del("Cookie")
				r.AddCookie(&http.Cookie{Name: a.cookieName("visitor"), Value: a.sign("visitor", randomToken()+"~1")})
			}, 400},
			{"truncated-json", func(a *App, r *http.Request) { r.Body = http.NoBody }, 400},
			{"non-json", func(a *App, r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, 400},
			{"unknown-field", func(a *App, r *http.Request) { r.Body = io.NopCloser(strings.NewReader(`{"visitor":"someone-else"}`)) }, 400},
			{"invalid-id", func(a *App, r *http.Request) { r.URL.Path = "/api/features/invalid/vote" }, 404},
		} {
			t.Run(method+"/"+tt.name, func(t *testing.T) {
				a := testApp(t)
				r := httptest.NewRequest(method, a.cfg.Origin+"/api/features/"+voteFeatureID+"/vote", strings.NewReader(`{}`))
				r.Header.Set("Origin", a.cfg.Origin)
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(&http.Cookie{Name: a.cookieName("visitor"), Value: a.sign("visitor", randomToken()+"~"+itoa(int(time.Now().Add(time.Hour).Unix())))})
				tt.change(a, r)
				w := httptest.NewRecorder()
				a.Handler().ServeHTTP(w, r)
				if w.Code != tt.status || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("status=%d, want %d: %s", w.Code, tt.status, w.Body)
				}
			})
		}
	}
}

func TestVoteDirectionsShareRateLimit(t *testing.T) {
	a := testApp(t)
	now := time.Now()
	a.now = func() time.Time { return now }
	h := a.Handler()
	for i := range 31 {
		method := http.MethodPost
		if i%2 != 0 {
			method = http.MethodDelete
		}
		r := httptest.NewRequest(method, a.cfg.Origin+"/api/features/invalid/vote", strings.NewReader(`{}`))
		r.Header.Set("Origin", a.cfg.Origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 404
		if i == 30 {
			want = 429
			if w.Header().Get("Retry-After") != "60" {
				t.Fatal("missing vote rate-limit retry-after")
			}
		}
		if w.Code != want {
			t.Fatalf("request %d: %d, want %d", i+1, w.Code, want)
		}
	}
}

func TestHTTPDatabaseVoteUndo(t *testing.T) {
	db := testutil.Database(t)
	a := testApp(t)
	a.db = db
	h := a.Handler()
	request := func(method, path string, cookies []*http.Cookie) *httptest.ResponseRecorder {
		var body io.Reader = strings.NewReader(`{}`)
		if method == http.MethodDelete {
			body = nil
		}
		r := httptest.NewRequest(method, a.cfg.Origin+path, body)
		r.RemoteAddr = "198.51.100.19:1000"
		r.Header.Set("Origin", a.cfg.Origin)
		if body != nil {
			r.Header.Set("Content-Type", "application/json")
		}
		for _, c := range cookies {
			r.AddCookie(c)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	assertVote := func(w *httptest.ResponseRecorder, count int, voted bool) {
		t.Helper()
		var result struct {
			Votes int  `json:"votes"`
			Voted bool `json:"voted"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Votes != count || result.Voted != voted {
			t.Fatalf("vote result: %d %s, want votes=%d voted=%v", w.Code, w.Body, count, voted)
		}
	}
	ctx := t.Context()
	if _, err := db.Submit(ctx, store.Submission{ID: voteFeatureID, Project: "campus", Type: "feature", Title: "Public feature", Description: "Public text", Fingerprint: []byte("feature")}); err != nil {
		t.Fatal(err)
	}
	first := request("GET", "/api/form", nil)
	second := request("GET", "/api/form", nil)
	if first.Code != 200 || second.Code != 200 {
		t.Fatal("visitor cookies unavailable")
	}
	owner, stranger := first.Result().Cookies(), second.Result().Cookies()
	path := "/api/features/" + voteFeatureID + "/vote"
	if w := request("DELETE", path, owner); w.Code != 404 {
		t.Fatalf("pending undo: %d", w.Code)
	}
	approved := "approved"
	if _, err := db.Update(ctx, voteFeatureID, store.Patch{Moderation: &approved}); err != nil {
		t.Fatal(err)
	}
	assertVote(request("DELETE", path, owner), 0, false)
	assertVote(request("POST", path, owner), 1, true)
	assertVote(request("DELETE", path, stranger), 1, false)
	assertVote(request("POST", path, owner), 1, true)
	assertVote(request("DELETE", path, owner), 0, false)
	assertVote(request("DELETE", path, owner), 0, false)
	assertVote(request("POST", path, owner), 1, true)
	assertVote(request("DELETE", path, owner), 0, false)
	if w := request("POST", path, stranger); w.Code != 429 || w.Header().Get("Retry-After") != "60" {
		t.Fatalf("undo bypassed another visitor's cooldown: %d %s", w.Code, w.Body)
	}
	// Preserve another visitor's vote through HTTP POST/DELETE races.
	if _, err := db.Vote(ctx, voteFeatureID, []byte("other-voter"), []byte("other-ip")); err != nil {
		t.Fatal(err)
	}
	type response struct {
		method string
		w      *httptest.ResponseRecorder
	}
	results := make(chan response, 2)
	start := make(chan struct{})
	for _, method := range []string{"POST", "DELETE"} {
		go func() {
			<-start
			results <- response{method, request(method, path, owner)}
		}()
	}
	close(start)
	for range 2 {
		r := <-results
		want := 1
		if r.method == "POST" {
			want = 2
		}
		assertVote(r.w, want, r.method == "POST")
	}
	assertVote(request("DELETE", path, owner), 1, false)
	board := request("GET", "/api/features", owner)
	var list struct {
		Items []store.Feature `json:"items"`
	}
	if board.Code != 200 || json.Unmarshal(board.Body.Bytes(), &list) != nil || len(list.Items) != 1 || list.Items[0].Voted || list.Items[0].Votes != 1 {
		t.Fatalf("board after undo: %d %s", board.Code, board.Body)
	}
	if bytes.Contains(board.Body.Bytes(), []byte("active")) || bytes.Contains(board.Body.Bytes(), []byte("visitor")) {
		t.Fatal("vote storage metadata exposed publicly")
	}
	// Reload keeps voted=false, and own reactivation succeeds immediately.
	assertVote(request("POST", path, owner), 2, true)
	rejected := "rejected"
	if _, err := db.Update(ctx, voteFeatureID, store.Patch{Moderation: &rejected}); err != nil {
		t.Fatal(err)
	}
	if w := request("DELETE", path, owner); w.Code != 404 {
		t.Fatalf("hidden undo: %d", w.Code)
	}
	if r, err := db.Get(ctx, voteFeatureID); err != nil || r.Votes != 2 {
		t.Fatalf("hidden undo changed stored votes: %d %v", r.Votes, err)
	}
}
