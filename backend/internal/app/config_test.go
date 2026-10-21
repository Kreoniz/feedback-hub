package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestConfigFilesPrecedenceAndValidation(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password-is-long"), 12)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"DATABASE_URL_FILE", "ADMIN_PASSWORD_HASH_FILE", "APP_SECRET_FILE", "TRUSTED_PROXIES", "LISTEN_ADDR", "STATIC_DIR", "DEVELOPMENT"} {
		t.Setenv(name, "")
	}
	t.Setenv("APP_ORIGIN", "https://feedback.example")
	t.Setenv("DATABASE_URL", "postgres://example/test")
	t.Setenv("ADMIN_PASSWORD_HASH", string(hash))
	t.Setenv("APP_SECRET", strings.Repeat("01", 32))
	file := filepath.Join(t.TempDir(), "secret")
	if err = os.WriteFile(file, []byte(strings.Repeat("ab", 32)+"\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_SECRET_FILE", file)
	t.Setenv("APP_SECRET", "invalid fallback")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Secret[0] != 0xab || cfg.ListenAddr != ":8080" || cfg.StaticDir != "/app/web" {
		t.Fatal("config file precedence/defaults wrong")
	}
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/24")
	if _, err = LoadConfig(); err == nil {
		t.Fatal("broad proxy subnet accepted")
	}
	t.Setenv("TRUSTED_PROXIES", "10.0.0.2/32,::1/128")
	if _, err = LoadConfig(); err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"https://feedback.example/", "https://user:pass@feedback.example", "https://feedback.example?q=x", "http://feedback.example", "https://feedback.example#x"} {
		t.Setenv("APP_ORIGIN", origin)
		if _, err = LoadConfig(); err == nil {
			t.Errorf("invalid origin accepted: %s", origin)
		}
	}
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("DEVELOPMENT", "true")
	if _, err = LoadConfig(); err != nil {
		t.Fatal("development HTTP rejected")
	}
}
