package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"feedback-hub/backend/internal/app"
	"feedback-hub/backend/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	if err := run(); err != nil {
		slog.Error(err.Error())
		os.Exit(1)
	}
}
func run() error {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if len(os.Args) > 2 {
		return errors.New("usage: feedback-hub [serve|migrate|hash-password]")
	}
	if command == "hash-password" {
		return hashPassword(os.Stdin, os.Stdout)
	}
	if command != "serve" && command != "migrate" {
		return errors.New("usage: feedback-hub [serve|migrate|hash-password]")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var cfg app.Config
	var err error
	if command == "migrate" {
		cfg.DatabaseURL, err = app.DatabaseURL()
	} else {
		cfg, err = app.LoadConfig()
	}
	if err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := store.Open(startup, cfg.DatabaseURL)
	if err != nil {
		return errors.New("database initialization failed")
	}
	defer db.Pool.Close()
	if err = db.Migrate(startup); err != nil {
		return errors.New("database migration failed")
	}
	if command == "migrate" {
		slog.Info("database migrations complete")
		return nil
	}
	application := app.New(cfg, db, slog.Default())
	server := &http.Server{Addr: cfg.ListenAddr, Handler: application.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10, ErrorLog: quietHTTPLog()}
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return errors.New("cannot listen on LISTEN_ADDR")
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	slog.Info("feedback hub listening")
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			if !errors.Is(err, http.ErrServerClosed) {
				return errors.New("HTTP server stopped unexpectedly")
			}
			return nil
		case <-ticker.C:
			cleanup, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := db.Cleanup(cleanup)
			cancel()
			if err != nil {
				slog.Warn("expired state cleanup failed")
			}
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err = server.Shutdown(shutdown); err != nil {
				if closeErr := server.Close(); closeErr != nil {
					slog.Warn("HTTP forced close failed")
				}
				return errors.New("HTTP graceful shutdown deadline exceeded")
			}
			return nil
		}
	}
}
func hashPassword(in *os.File, out io.Writer) error {
	info, err := in.Stat()
	if err != nil {
		return errors.New("cannot read password input")
	}
	if info.Mode()&os.ModeCharDevice != 0 {
		return errors.New("read password from a protected file or pipe, not an echoed terminal")
	}
	b, err := io.ReadAll(io.LimitReader(in, 75))
	if err != nil {
		return errors.New("cannot read password input")
	}
	password := strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r")
	if len(password) < 12 || len(password) > 72 {
		return errors.New("password must contain 12 through 72 bytes")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return errors.New("cannot hash password")
	}
	if _, err = fmt.Fprintln(out, string(hash)); err != nil {
		return errors.New("cannot write password hash")
	}
	return nil
}
