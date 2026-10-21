// Package testutil provisions isolated schemas in the explicitly configured test database.
package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"
	"time"

	"feedback-hub/backend/internal/store"
	"github.com/jackc/pgx/v5"
)

func Database(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL_TEST")
	if dsn == "" {
		t.Skip("DATABASE_URL_TEST not set; PostgreSQL integration skipped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal("cannot connect to explicitly configured test database")
	}
	var b [10]byte
	if _, err = rand.Read(b[:]); err != nil {
		t.Fatal(err)
	}
	schema := "test_" + hex.EncodeToString(b[:])
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatal("cannot create isolated test schema")
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, `DROP SCHEMA `+schema+` CASCADE`); err != nil {
			t.Error("test schema cleanup failed")
		}
		if err := admin.Close(cleanup); err != nil {
			t.Error("test admin connection close failed")
		}
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal("test database URL must be URL format")
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := store.Open(ctx, u.String())
	if err != nil {
		t.Fatal("cannot open isolated test schema")
	}
	t.Cleanup(db.Pool.Close)
	if err = db.Migrate(ctx); err != nil {
		t.Fatalf("migration: %v", err)
	}
	if err = db.Migrate(ctx); err != nil {
		t.Fatalf("idempotent migration: %v", err)
	}
	return db
}
