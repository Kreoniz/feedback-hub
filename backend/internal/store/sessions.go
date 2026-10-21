package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateSession(ctx context.Context, hash []byte, csrf string, expiry time.Time, oldHash []byte) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(tx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(482334914)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sessions WHERE expires_at<=now() OR token_hash=$1`, oldHash); err != nil {
		return err
	}
	// At most eight active owner sessions, evicting oldest only after successful authentication.
	if _, err = tx.Exec(ctx, `DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC OFFSET 7)`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO sessions(token_hash,csrf,expires_at) VALUES($1,$2,$3)`, hash, csrf, expiry); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Session(ctx context.Context, hash []byte) (string, error) {
	var csrf string
	err := s.Pool.QueryRow(ctx, `UPDATE sessions SET last_seen=now() WHERE token_hash=$1 AND expires_at>now() AND last_seen>now()-interval '30 minutes' RETURNING csrf`, hash).Scan(&csrf)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return csrf, err
}
func (s *Store) DeleteSession(ctx context.Context, hash []byte) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1`, hash)
	return err
}
