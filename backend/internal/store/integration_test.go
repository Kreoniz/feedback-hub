package store_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"feedback-hub/backend/internal/store"
	"feedback-hub/backend/internal/testutil"
)

const id1 = "00000000-0000-4000-8000-000000000001"
const id2 = "00000000-0000-4000-8000-000000000002"
const id3 = "00000000-0000-4000-8000-000000000003"

func submit(t *testing.T, db *store.Store, id, typ, project string) {
	t.Helper()
	hash := sha256.Sum256([]byte(id))
	_, err := db.Submit(context.Background(), store.Submission{ID: id, Project: project, Type: typ, Title: "title", Description: "private description", Fingerprint: hash[:]})
	if err != nil {
		t.Fatal(err)
	}
}
func str(s string) *string { return &s }
func TestDatabasePrivateSearchScope(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	submit(t, db, id1, "feature", "campus")
	if _, err := db.Update(ctx, id1, store.Patch{Moderation: str("approved"), AdminNote: str("PRIVATE_NOTE_ONLY")}); err != nil {
		t.Fatal(err)
	}
	for _, public := range []bool{false, true} {
		_, total, err := db.List(ctx, store.Filter{Q: "private_note_only", Limit: 30}, public, []byte{})
		if err != nil {
			t.Fatal(err)
		}
		expected := 1
		if public {
			expected = 0
		}
		if total != expected {
			t.Fatalf("private note search public=%v total=%d", public, total)
		}
	}
}
func TestDatabaseDedupeAllowsRecurrences(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	hash := sha256.Sum256([]byte("recurring-private-bug"))
	report := store.Submission{ID: id1, Project: "campus", Type: "bug", Description: "Снова не открывается", Fingerprint: hash[:]}
	if duplicate, err := db.Submit(ctx, report); err != nil || duplicate {
		t.Fatalf("first report: duplicate=%v err=%v", duplicate, err)
	}
	report.ID = id2
	if duplicate, err := db.Submit(ctx, report); err != nil || !duplicate {
		t.Fatalf("immediate retry: duplicate=%v err=%v", duplicate, err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE reports SET created_at=now()-interval '25 hours' WHERE id=$1`, id1); err != nil {
		t.Fatal(err)
	}
	if duplicate, err := db.Submit(ctx, report); err != nil || duplicate {
		t.Fatalf("next-day recurrence: duplicate=%v err=%v", duplicate, err)
	}
	if _, err := db.Update(ctx, id2, store.Patch{Status: str("done")}); err != nil {
		t.Fatal(err)
	}
	report.ID = id3
	if duplicate, err := db.Submit(ctx, report); err != nil || duplicate {
		t.Fatalf("regression after resolution: duplicate=%v err=%v", duplicate, err)
	}
	_, total, err := db.List(ctx, store.Filter{Limit: 30}, false, []byte{})
	if err != nil || total != 3 {
		t.Fatalf("recurrence history lost: count=%d err=%v", total, err)
	}
}
func TestDatabaseAtomicDedupeAndVotes(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	hash := sha256.Sum256([]byte("same-content"))
	var created atomic.Int32
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			dup, err := db.Submit(ctx, store.Submission{ID: fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1), Project: "campus", Type: "feature", Title: "race", Description: "same", Fingerprint: hash[:]})
			if err != nil {
				t.Error(err)
			}
			if !dup {
				created.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if created.Load() != 1 {
		t.Fatalf("concurrent dedupe created %d reports", created.Load())
	}
	list, n, err := db.List(ctx, store.Filter{Limit: 30, Sort: "new"}, false, []byte{})
	if err != nil || n != 1 {
		t.Fatalf("list total %d %v", n, err)
	}
	id := list[0].ID
	if _, err = db.Vote(ctx, id, []byte("visitor"), []byte("ip")); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("pending vote accepted: %v", err)
	}
	if _, err = db.Update(ctx, id, store.Patch{Moderation: str("approved")}); err != nil {
		t.Fatal(err)
	}
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := db.Vote(ctx, id, []byte("visitor"), []byte("ip"))
			if err != nil || n != 1 {
				t.Errorf("vote count %d, %v", n, err)
			}
		}()
	}
	wg.Wait()
	if _, err = db.Vote(ctx, id, []byte("reset-cookie"), []byte("ip")); !errors.Is(err, store.ErrCooldown) {
		t.Fatalf("cookie reset bypassed cooldown: %v", err)
	}
	// Cooldown rejection must leave no vote behind.
	r, err := db.Get(ctx, id)
	if err != nil || r.Votes != 1 {
		t.Fatalf("vote after rollback: %d %v", r.Votes, err)
	}
	if _, err = db.Pool.Exec(ctx, `UPDATE vote_cooldowns SET expires_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if n, err := db.Vote(ctx, id, []byte("new-visitor"), []byte("ip")); err != nil || n != 2 {
		t.Fatalf("expired cooldown: %d %v", n, err)
	}
	public, total, err := db.List(ctx, store.Filter{Limit: 30, Sort: "votes"}, true, []byte("visitor"))
	if err != nil || total != 1 || !public[0].Voted || public[0].Votes != 2 {
		t.Fatalf("public list result %+v total=%d err=%v", public, total, err)
	}
	empty, total, err := db.List(ctx, store.Filter{Limit: 30, Offset: 100, Sort: "new"}, true, []byte{})
	if err != nil || total != 1 || len(empty) != 0 {
		t.Fatal("empty page total lost")
	}
	if _, err = db.Update(ctx, id, store.Patch{Moderation: str("rejected")}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Vote(ctx, id, []byte("visitor"), []byte("ip")); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("previous voter could vote on hidden report")
	}
}
func TestDatabaseModerationPrivacyAndGraph(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	submit(t, db, id1, "feature", "campus")
	submit(t, db, id2, "feature", "campus")
	submit(t, db, id3, "bug", "campus")
	if _, err := db.Update(ctx, id3, store.Patch{Moderation: str("approved")}); !errors.Is(err, store.ErrInvalid) {
		t.Fatal("bug approval accepted")
	}
	for _, id := range []string{id1, id2} {
		if _, err := db.Update(ctx, id, store.Patch{Moderation: str("approved")}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Update(ctx, id1, store.Patch{DuplicateSet: true, DuplicateOf: str(id3)}); !errors.Is(err, store.ErrInvalid) {
		t.Fatal("cross-type duplicate accepted")
	}
	if _, err := db.Update(ctx, id1, store.Patch{DuplicateSet: true, DuplicateOf: str(id1)}); !errors.Is(err, store.ErrInvalid) {
		t.Fatal("self duplicate accepted")
	}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for _, pair := range [][2]string{{id1, id2}, {id2, id1}} {
		wg.Add(1)
		go func(pair [2]string) {
			defer wg.Done()
			_, err := db.Update(ctx, pair[0], store.Patch{DuplicateSet: true, DuplicateOf: str(pair[1])})
			if err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, store.ErrInvalid) {
				t.Error(err)
			}
		}(pair)
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("reciprocal graph writes accepted %d", accepted.Load())
	}
	public, n, err := db.List(ctx, store.Filter{Limit: 30, Sort: "new"}, true, []byte{})
	if err != nil || n != 1 || len(public) != 1 {
		t.Fatalf("duplicate or bug public: %d %v", n, err)
	}
	// Information score cannot implicitly alter priority in either direction.
	if _, err = db.Update(ctx, id3, store.Patch{Priority: str("critical"), Information: str("sparse")}); err != nil {
		t.Fatal(err)
	}
	r, err := db.Update(ctx, id3, store.Patch{Information: str("detailed")})
	if err != nil || r.Priority != "critical" {
		t.Fatal("information changed priority")
	}
	// Direct SQL also cannot approve a bug.
	if _, err = db.Pool.Exec(ctx, `UPDATE reports SET moderation='approved' WHERE id=$1`, id3); err == nil {
		t.Fatal("database permits bug approval")
	}
	// Sessions are opaque, expired/revoked tokens fail, and storage stays bounded.
	for i := range 12 {
		if err := db.CreateSession(ctx, []byte(fmt.Sprint(i)), "csrf", time.Now().Add(time.Hour), []byte{}); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.Pool.QueryRow(ctx, `SELECT count(*) FROM sessions`).Scan(&count); err != nil || count != 8 {
		t.Fatalf("sessions not bounded %d %v", count, err)
	}
	if err := db.DeleteSession(ctx, []byte("11")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Session(ctx, []byte("11")); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("revoked session accepted")
	}
	if err := db.CreateSession(ctx, []byte("expired"), "csrf", time.Now().Add(-time.Second), []byte{}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Session(ctx, []byte("expired")); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("expired session accepted")
	}

	if err := db.CreateSession(ctx, []byte("idle"), "csrf", time.Now().Add(time.Hour), []byte{}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE sessions SET last_seen=now()-interval '31 minutes' WHERE token_hash=$1`, []byte("idle")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Session(ctx, []byte("idle")); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("idle-expired session accepted")
	}
	if err := db.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestDatabaseIntakeBudgetsAtomicAndPersistent(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	submit(t, db, id1, "feature", "campus")
	hash := sha256.Sum256([]byte(id1))
	for range 3 {
		dup, err := db.Submit(ctx, store.Submission{ID: id2, Project: "campus", Type: "feature", Title: "title", Description: "private description", Fingerprint: hash[:]})
		if err != nil || !dup {
			t.Fatalf("retry %v %v", dup, err)
		}
	}
	var total int
	if err := db.Pool.QueryRow(ctx, `SELECT reports FROM intake_totals WHERE id=true`).Scan(&total); err != nil || total != 1 {
		t.Fatal("duplicates consumed budget")
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_days SET accepted=$1 WHERE project='campus'`, store.MaxProjectDailyReports); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Submit(ctx, store.Submission{ID: id2, Project: "campus", Type: "feature", Title: "title", Description: "private description", Fingerprint: hash[:]}); !errors.Is(err, store.ErrBudget) {
		t.Fatal("duplicate bypasses capacity, exposing content existence")
	}
	otherHash := sha256.Sum256([]byte(id2))
	if _, err := db.Submit(ctx, store.Submission{ID: id2, Project: "campus", Type: "feature", Title: "title", Description: "another", Fingerprint: otherHash[:]}); !errors.Is(err, store.ErrBudget) {
		t.Fatal("project daily cap bypassed")
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_days SET accepted=1 WHERE project='campus'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_days SET accepted=$1 WHERE project='*'`, store.MaxDailyReports); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Submit(ctx, store.Submission{ID: id2, Project: "other", Type: "feature", Title: "title", Description: "another", Fingerprint: otherHash[:]}); !errors.Is(err, store.ErrBudget) {
		t.Fatal("global daily cap bypassed")
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_days SET accepted=1 WHERE project='*'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_totals SET reports=$1 WHERE id=true`, store.MaxTotalReports-1); err != nil {
		t.Fatal(err)
	}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("00000000-0000-4000-8000-%012d", i+20)
			hash := sha256.Sum256([]byte(id))
			_, err := db.Submit(ctx, store.Submission{ID: id, Project: "other", Type: "feature", Title: "title", Description: "another", Fingerprint: hash[:]})
			if err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, store.ErrBudget) {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("final budget slot admitted %d", accepted.Load())
	}
	reopened, err := store.Open(ctx, db.Pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Pool.Close()
	if _, err = reopened.Submit(ctx, store.Submission{ID: id3, Project: "other", Type: "bug", Description: "fresh", Fingerprint: otherHash[:]}); !errors.Is(err, store.ErrBudget) {
		t.Fatal("restart reset persisted cap")
	}
}
func TestDatabaseVoteModerationRaceAndDeadline(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	submit(t, db, id1, "feature", "campus")
	submit(t, db, id2, "feature", "other")
	if _, err := db.Update(ctx, id1, store.Patch{DuplicateSet: true, DuplicateOf: str(id2)}); !errors.Is(err, store.ErrInvalid) {
		t.Fatal("cross-project duplicate accepted")
	}
	for i := range 6 {
		if _, err := db.Update(ctx, id1, store.Patch{Moderation: str("approved")}); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, err := db.Vote(ctx, id1, []byte(fmt.Sprint("visitor", i)), []byte(fmt.Sprint("network", i)))
			if err != nil && !errors.Is(err, store.ErrNotFound) {
				t.Error(err)
			}
		}()
		go func() {
			defer wg.Done()
			if _, err := db.Update(ctx, id1, store.Patch{Moderation: str("rejected")}); err != nil {
				t.Error(err)
			}
		}()
		wg.Wait()
		if _, err := db.Vote(ctx, id1, []byte("late"), []byte("late")); !errors.Is(err, store.ErrNotFound) {
			t.Fatal("vote admitted after hide completed")
		}
	}
	deadline, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := db.Pool.Exec(deadline, `SELECT pg_sleep(5)`); err == nil || time.Since(start) > time.Second {
		t.Fatal("database ignored context deadline")
	}
	if err := db.Pool.Ping(ctx); err != nil {
		t.Fatal("pool unusable after cancelled query")
	}
	if _, err := db.Update(ctx, id1, store.Patch{Moderation: str("approved")}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Vote(ctx, id1, []byte("existing"), []byte("existing")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_totals SET votes=$1 WHERE id=true`, store.MaxTotalVotes); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Vote(ctx, id1, []byte("existing"), []byte("existing")); err != nil {
		t.Fatal("budget rejected idempotent existing vote")
	}
	if _, err := db.Vote(ctx, id1, []byte("new"), []byte("new")); !errors.Is(err, store.ErrBudget) {
		t.Fatal("vote lifetime cap bypassed")
	}
	var leaked bool
	if err := db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vote_cooldowns WHERE network=$1)`, []byte("new")).Scan(&leaked); err != nil || leaked {
		t.Fatal("rejected vote left cooldown state")
	}
}
