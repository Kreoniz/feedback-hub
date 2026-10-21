package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestBackupTargetMatchesEffectivePGXSelection(t *testing.T) {
	for _, tt := range []struct{ dsn, expected string }{
		{"postgres://feedback@db:5432/feedback?sslmode=disable", "feedback"},
		{"postgres://feedback:secret@db:5432/old?dbname=restored&sslmode=disable", "restored"},
		{"postgres://feedback@db/old?database=restored&sslmode=disable", "restored"},
		{"postgres://feedback@db:5432//feedback", ""},
		{"postgres://feedback@db:5432/feedback#", ""},
		{"postgres://feedback@other/feedback", ""},
		{"postgres://feedback@db:5433/feedback", ""},
		{"postgres://other@db/feedback", ""},
		{"postgres://feedback@db/feedback?host=other", ""},
		{"postgres://feedback@db/feedback?dbname=bad.name", ""},
	} {
		t.Run(tt.dsn, func(t *testing.T) {
			name, err := backupTarget(tt.dsn)
			if tt.expected == "" {
				if err == nil {
					t.Fatal("unsupported backup target accepted")
				}
				return
			}
			if err != nil || name != tt.expected {
				t.Fatalf("target=%q err=%v", name, err)
			}
		})
	}
}

func TestPasswordCLIStdinAndBounds(t *testing.T) {
	for _, tt := range []struct {
		password string
		ok       bool
	}{{"short", false}, {strings.Repeat("x", 73), false}, {strings.Repeat("x", 100), false}, {"long-password-from-stdin\n", true}} {
		p := filepath.Join(t.TempDir(), "password")
		if err := os.WriteFile(p, []byte(tt.password), 0600); err != nil {
			t.Fatal(err)
		}
		f, err := os.Open(p)
		if err != nil {
			t.Fatal(err)
		}
		var out bytes.Buffer
		err = hashPassword(f, &out)
		if closeErr := f.Close(); closeErr != nil {
			t.Fatal(closeErr)
		}
		if !tt.ok {
			if err == nil || out.Len() != 0 {
				t.Fatal("invalid password accepted or exposed")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		hash := strings.TrimSpace(out.String())
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(strings.TrimSuffix(tt.password, "\n"))) != nil {
			t.Fatal("invalid generated password hash")
		}
		cost, err := bcrypt.Cost([]byte(hash))
		if err != nil || cost != 12 {
			t.Fatal("unexpected hash cost")
		}
	}
}
