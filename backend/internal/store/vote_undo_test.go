package store_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"feedback-hub/backend/internal/store"
	"feedback-hub/backend/internal/testutil"
)

func approvedFeature(t *testing.T, db *store.Store, id string) {
	t.Helper()
	submit(t, db, id, "feature", "campus")
	if _, err := db.Update(t.Context(), id, store.Patch{Moderation: str("approved")}); err != nil {
		t.Fatal(err)
	}
}

func voteStorage(t *testing.T, db *store.Store, wantRows, wantLifetime int) {
	t.Helper()
	var rows, lifetime int
	if err := db.Pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM votes),votes FROM intake_totals WHERE id=true`).Scan(&rows, &lifetime); err != nil {
		t.Fatal(err)
	}
	if rows != wantRows || lifetime != wantLifetime {
		t.Fatalf("vote rows=%d lifetime=%d, want %d/%d", rows, lifetime, wantRows, wantLifetime)
	}
}

func expireVoteCooldown(t *testing.T, db *store.Store, id string, network []byte) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `UPDATE vote_cooldowns SET expires_at=now()-interval '1 second' WHERE report_id=$1 AND network=$2`, id, network); err != nil {
		t.Fatal(err)
	}
}

func TestDatabaseVoteUndoIdempotencyAndCooldown(t *testing.T) {
	db := testutil.Database(t)
	ctx := t.Context()
	approvedFeature(t, db, id1)
	approvedFeature(t, db, id2)
	for _, v := range []struct{ id, visitor, network string }{{id1, "owner", "shared-ip"}, {id1, "other", "other-ip"}, {id2, "owner", "shared-ip"}} {
		if _, err := db.Vote(ctx, v.id, []byte(v.visitor), []byte(v.network)); err != nil {
			t.Fatal(err)
		}
	}
	var expiry time.Time
	if err := db.Pool.QueryRow(ctx, `SELECT expires_at FROM vote_cooldowns WHERE report_id=$1 AND network=$2`, id1, []byte("shared-ip")).Scan(&expiry); err != nil {
		t.Fatal(err)
	}
	if n, err := db.UndoVote(ctx, id1, []byte("never-voted")); err != nil || n != 2 {
		t.Fatalf("undo without a vote: %d %v", n, err)
	}
	for range 3 {
		if n, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil || n != 1 {
			t.Fatalf("idempotent undo: %d %v", n, err)
		}
	}
	voteStorage(t, db, 3, 3)
	var after time.Time
	if err := db.Pool.QueryRow(ctx, `SELECT expires_at FROM vote_cooldowns WHERE report_id=$1 AND network=$2`, id1, []byte("shared-ip")).Scan(&after); err != nil || !after.Equal(expiry) {
		t.Fatalf("undo changed cooldown: %v", err)
	}
	for _, visitor := range []string{"other-new-visitor", "reset-cookie"} {
		if _, err := db.Vote(ctx, id1, []byte(visitor), []byte("shared-ip")); !errors.Is(err, store.ErrCooldown) {
			t.Fatalf("undo bypassed cooldown for %s: %v", visitor, err)
		}
	}
	list, _, err := db.List(ctx, store.Filter{Limit: 30, Sort: "votes"}, true, []byte("owner"))
	if err != nil || len(list) != 2 {
		t.Fatalf("public list after undo: %v", err)
	}
	for _, r := range list {
		if r.Votes != 1 || r.Voted != (r.ID == id2) {
			t.Fatalf("undo affected another vote or report: %+v", r.Feature)
		}
	}
	// Own re-votes are immediate and reuse their row/slot without extending the
	// original network cooldown, which still protects other/reset-cookie visitors.
	for range 3 {
		if n, err := db.Vote(ctx, id1, []byte("owner"), []byte("shared-ip")); err != nil || n != 2 {
			t.Fatalf("immediate own re-vote: %d %v", n, err)
		}
		if n, err := db.Vote(ctx, id1, []byte("owner"), []byte("shared-ip")); err != nil || n != 2 {
			t.Fatalf("active POST retry during cooldown: %d %v", n, err)
		}
		if n, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil || n != 1 {
			t.Fatalf("undo during cooldown: %d %v", n, err)
		}
		voteStorage(t, db, 3, 3)
		if _, err := db.Vote(ctx, id1, []byte("reset-cookie"), []byte("shared-ip")); !errors.Is(err, store.ErrCooldown) {
			t.Fatalf("own re-vote lost network cooldown: %v", err)
		}
	}
	if err := db.Pool.QueryRow(ctx, `SELECT expires_at FROM vote_cooldowns WHERE report_id=$1 AND network=$2`, id1, []byte("shared-ip")).Scan(&after); err != nil || !after.Equal(expiry) {
		t.Fatalf("own re-vote changed original cooldown: %v", err)
	}
	// Moving networks while re-voting cannot allocate additional cooldown history.
	if n, err := db.Vote(ctx, id1, []byte("owner"), []byte("new-ip")); err != nil || n != 2 {
		t.Fatalf("re-vote from another network: %d %v", n, err)
	}
	if _, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil {
		t.Fatal(err)
	}
	var newCooldown bool
	if err := db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vote_cooldowns WHERE report_id=$1 AND network=$2)`, id1, []byte("new-ip")).Scan(&newCooldown); err != nil || newCooldown {
		t.Fatalf("own re-vote created cooldown history: %v", err)
	}
	expireVoteCooldown(t, db, id1, []byte("shared-ip"))
	if err := db.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	if n, err := db.Vote(ctx, id1, []byte("owner"), []byte("shared-ip")); err != nil || n != 2 {
		t.Fatalf("own re-vote after cooldown cleanup: %d %v", n, err)
	}
	if _, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil {
		t.Fatal(err)
	}
	voteStorage(t, db, 3, 3)
	if n, err := db.UndoVote(ctx, id1, []byte("other")); err != nil || n != 0 {
		t.Fatalf("last undo: %d %v", n, err)
	}
	list, _, err = db.List(ctx, store.Filter{Limit: 30, Sort: "votes"}, true, []byte("owner"))
	if err != nil || len(list) != 2 || list[0].ID != id2 || list[1].Votes != 0 || list[1].Voted {
		t.Fatalf("inactive votes affect sorting/counts: %+v %v", list, err)
	}
	r, err := db.Get(ctx, id1)
	if err != nil || r.Votes != 0 {
		t.Fatalf("admin count includes inactive votes: %d %v", r.Votes, err)
	}
}

func TestDatabaseVoteUndoConcurrency(t *testing.T) {
	db := testutil.Database(t)
	ctx := t.Context()
	approvedFeature(t, db, id1)
	if _, err := db.Vote(ctx, id1, []byte("other"), []byte("other-ip")); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := range 20 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				if i%2 == 0 {
					n, err := db.Vote(ctx, id1, []byte("owner"), []byte("ip"))
					if err != nil || n != 2 {
						t.Errorf("concurrent POST: %d %v", n, err)
					}
				} else if n, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil || n != 1 {
					t.Errorf("concurrent DELETE: %d %v", n, err)
				}
			}()
		}
		close(start)
		wg.Wait()
		list, _, err := db.List(ctx, store.Filter{Limit: 30}, true, []byte("owner"))
		if err != nil || len(list) != 1 {
			t.Fatalf("list after race: %v", err)
		}
		want := 1
		if list[0].Voted {
			want++
		}
		if list[0].Votes != want {
			t.Fatalf("inconsistent final vote state: %+v", list[0].Feature)
		}
		voteStorage(t, db, 2, 2)
		if n, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil || n != 1 {
			t.Fatalf("final idempotent undo: %d %v", n, err)
		}
		if n, err := db.Vote(ctx, id1, []byte("owner"), []byte("ip")); err != nil || n != 2 {
			t.Fatalf("own re-vote after race: %d %v", n, err)
		}
		if _, err := db.Vote(ctx, id1, []byte("reset-cookie"), []byte("ip")); !errors.Is(err, store.ErrCooldown) {
			t.Fatalf("race lost network cooldown for a reset cookie: %v", err)
		}
	}
}

func TestDatabaseVoteUndoLifetimeBudget(t *testing.T) {
	db := testutil.Database(t)
	ctx := t.Context()
	approvedFeature(t, db, id1)
	approvedFeature(t, db, id2)
	if _, err := db.Vote(ctx, id1, []byte("owner"), []byte("ip")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE intake_totals SET votes=$1 WHERE id=true`, store.MaxTotalVotes-1); err != nil {
		t.Fatal(err)
	}
	var accepted atomic.Int32
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			id := id1
			if i%2 != 0 {
				id = id2
			}
			tag := []byte(fmt.Sprint("new-", i))
			if _, err := db.Vote(ctx, id, tag, tag); err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, store.ErrBudget) {
				t.Error(err)
			}
		}()
	}
	close(start)
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("last lifetime slot admitted %d", accepted.Load())
	}
	voteStorage(t, db, 2, store.MaxTotalVotes)
	if _, err := db.UndoVote(ctx, id1, []byte("owner")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.UndoVote(ctx, id1, []byte("never-voted")); err != nil {
		t.Fatal(err)
	}
	// A new store instance must preserve both the spent slot and inactive row.
	reopened, err := store.Open(ctx, db.Pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Pool.Close()
	if _, err := reopened.Vote(ctx, id1, []byte("owner"), []byte("ip")); err != nil {
		t.Fatalf("existing pair cannot re-vote at capacity: %v", err)
	}
	if _, err := reopened.Vote(ctx, id1, []byte("overflow"), []byte("overflow")); !errors.Is(err, store.ErrBudget) {
		t.Fatalf("undo refunded a lifetime slot: %v", err)
	}
	voteStorage(t, db, 2, store.MaxTotalVotes)
	var cooldowns int
	if err := db.Pool.QueryRow(ctx, `SELECT count(*) FROM vote_cooldowns`).Scan(&cooldowns); err != nil || cooldowns != 2 {
		t.Fatalf("budget failures leaked cooldown rows: %d %v", cooldowns, err)
	}
}

func TestDatabaseVoteUndoMigrationPreservesExistingVotes(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	approvedFeature(t, db, id1)
	if _, err := db.Vote(ctx, id1, []byte("existing"), []byte("ip")); err != nil {
		t.Fatal(err)
	}
	// Recreate the pre-undo schema with a real previously-budgeted vote.
	if _, err := db.Pool.Exec(ctx, `ALTER TABLE votes DROP COLUMN active; DELETE FROM schema_migrations WHERE version='004_vote_undo.sql'`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := db.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	list, _, err := db.List(ctx, store.Filter{Limit: 30}, true, []byte("existing"))
	if err != nil || len(list) != 1 || !list[0].Voted || list[0].Votes != 1 {
		t.Fatalf("migration changed existing vote: %+v %v", list, err)
	}
	voteStorage(t, db, 1, 1)
}
