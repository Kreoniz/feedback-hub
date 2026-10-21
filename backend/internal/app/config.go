package app

import (
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	ListenAddr, Origin, DatabaseURL, StaticDir string
	PasswordHash, Secret                       []byte
	Development                                bool
	TrustedProxies                             []netip.Addr
}

func ReadValue(name string) (string, error) {
	if path := os.Getenv(name + "_FILE"); path != "" {
		f, err := os.Open(path)
		if err != nil {
			return "", fmt.Errorf("cannot open %s_FILE", name)
		}
		defer f.Close()
		b, err := io.ReadAll(io.LimitReader(f, 8193))
		if err != nil || len(b) > 8192 {
			return "", fmt.Errorf("cannot read %s_FILE", name)
		}
		return strings.TrimSuffix(strings.TrimSuffix(string(b), "\n"), "\r"), nil
	}
	return os.Getenv(name), nil
}
func DatabaseURL() (string, error) {
	v, err := ReadValue("DATABASE_URL")
	if err != nil {
		return "", err
	}
	if v == "" {
		return "", errors.New("DATABASE_URL or DATABASE_URL_FILE is required")
	}
	return v, nil
}
func LoadConfig() (Config, error) {
	c := Config{ListenAddr: os.Getenv("LISTEN_ADDR"), Origin: os.Getenv("APP_ORIGIN"), StaticDir: os.Getenv("STATIC_DIR")}
	if c.ListenAddr == "" {
		c.ListenAddr = ":8080"
	}
	if c.StaticDir == "" {
		c.StaticDir = "/app/web"
	}
	var err error
	if v := os.Getenv("DEVELOPMENT"); v != "" {
		c.Development, err = strconv.ParseBool(v)
		if err != nil {
			return c, errors.New("DEVELOPMENT must be a boolean")
		}
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Opaque != "" || u.Scheme != "https" && !(c.Development && u.Scheme == "http") {
		return c, errors.New("APP_ORIGIN must be an exact HTTPS origin (HTTP only in development)")
	}
	c.DatabaseURL, err = DatabaseURL()
	if err != nil {
		return c, err
	}
	hash, err := ReadValue("ADMIN_PASSWORD_HASH")
	if err != nil {
		return c, err
	}
	c.PasswordHash = []byte(hash)
	cost, err := bcrypt.Cost(c.PasswordHash)
	if err != nil || cost < 12 || cost > 16 {
		return c, errors.New("ADMIN_PASSWORD_HASH must be bcrypt with cost 12 through 16")
	}
	secret, err := ReadValue("APP_SECRET")
	if err != nil {
		return c, err
	}
	c.Secret, err = hex.DecodeString(secret)
	if err != nil || len(c.Secret) != 32 {
		return c, errors.New("APP_SECRET must contain exactly 64 hex characters")
	}
	if v := os.Getenv("TRUSTED_PROXIES"); v != "" {
		for _, part := range strings.Split(v, ",") {
			part = strings.TrimSpace(part)
			a, err := netip.ParseAddr(part)
			if err != nil {
				p, e := netip.ParsePrefix(part)
				if e != nil || p.Bits() != p.Addr().BitLen() {
					return c, errors.New("TRUSTED_PROXIES accepts exact addresses or /32 and /128 host prefixes only")
				}
				a = p.Addr()
			}
			c.TrustedProxies = append(c.TrustedProxies, a.Unmap())
		}
	}
	return c, nil
}
