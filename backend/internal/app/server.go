package app

import (
	"context"
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"feedback-hub/backend/internal/store"
)

type App struct {
	cfg                                        Config
	db                                         *store.Store
	now                                        func() time.Time
	limits                                     *limiter
	adminLimits                                *limiter
	slots, adminSlots, healthSlots, loginSlots chan struct{}
	log                                        *slog.Logger
}

func New(cfg Config, db *store.Store, logger *slog.Logger) *App {
	adminLimits := newLimiter()
	adminLimits.max = 1000
	return &App{cfg: cfg, db: db, now: time.Now, limits: newLimiter(), adminLimits: adminLimits, slots: make(chan struct{}, 6), adminSlots: make(chan struct{}, 4), healthSlots: make(chan struct{}, 2), loginSlots: make(chan struct{}, 2), log: logger}
}
func (a *App) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	m.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if a.db == nil || a.db.Pool.Ping(r.Context()) != nil {
			fail(w, 503, "Сервис временно недоступен")
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	m.HandleFunc("GET /api/projects", a.projects)
	m.HandleFunc("GET /api/form", a.form)
	m.HandleFunc("GET /api/features", a.features)
	m.HandleFunc("POST /api/reports", a.submit)
	m.HandleFunc("POST /api/features/{id}/vote", a.vote)
	m.HandleFunc("POST /api/admin/login", a.login)
	m.HandleFunc("GET /api/admin/session", a.session)
	m.HandleFunc("POST /api/admin/logout", a.authorize(a.logout))
	m.HandleFunc("GET /api/admin/reports", a.authorize(a.adminList))
	m.HandleFunc("GET /api/admin/reports/{id}", a.authorize(a.adminGet))
	m.HandleFunc("PATCH /api/admin/reports/{id}", a.authorize(a.adminPatch))
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/admin/") && r.URL.Path != "/api/admin/login" && r.URL.Path != "/api/admin/session" {
			_, err := a.sessionToken(r)
			if err != nil {
				fail(w, 401, "Войдите в панель управления")
				return
			}
		}
		fail(w, 404, "Не найдено")
	})
	m.HandleFunc("/", a.static)
	return a.middleware(m)
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	payload, err := json.Marshal(v)
	if err != nil {
		status = http.StatusInternalServerError
		payload = []byte(`{"error":"Внутренняя ошибка"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	// A disconnected client cannot be retried; never log the payload or transport details.
	if _, err = w.Write(append(payload, '\n')); err != nil {
		return
	}
}
func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func (a *App) serverError(w http.ResponseWriter) {
	a.log.Error("request database operation failed")
	fail(w, 503, "Сервис временно недоступен. Попробуйте позже")
}
func (a *App) resultError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		fail(w, 404, "Не найдено")
	case errors.Is(err, store.ErrInvalid):
		fail(w, 400, "Недопустимое изменение")
	case errors.Is(err, store.ErrBudget):
		w.Header().Set("Retry-After", "3600")
		fail(w, 429, "Приём временно приостановлен. Попробуйте позже")
	case errors.Is(err, store.ErrCooldown):
		w.Header().Set("Retry-After", itoa(store.VoteCooldownSeconds))
		fail(w, 429, "С этой сети недавно голосовали за эту идею. Подождите минуту и повторите")
	default:
		a.serverError(w)
	}
}
func (a *App) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		if !a.cfg.Development {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/health/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		defer func() {
			if recover() != nil {
				a.log.Error("request panic recovered")
				fail(w, 500, "Внутренняя ошибка")
			}
		}()
		origin, err := url.Parse(a.cfg.Origin)
		if r.URL.Path != "/health/live" && r.URL.Path != "/health/ready" && (err != nil || !strings.EqualFold(r.Host, origin.Host)) {
			fail(w, 403, "Неверный адрес сайта")
			return
		}
		if len(r.URL.RawQuery) > 4096 || len(r.URL.Path) > 2048 {
			fail(w, 414, "Слишком длинный адрес")
			return
		}
		mutating := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
		if mutating {
			// Exact configured origin; never derive the target from Host or forwarded headers.
			if len(r.Header.Values("Origin")) != 1 || r.Header.Get("Origin") != a.cfg.Origin || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				fail(w, 403, "Запрос разрешён только с этого сайта")
				return
			}
		}
		// Bound bcrypt, SQL waiters and handler work; reserve liveness independently.
		if r.URL.Path != "/health/live" {
			slots := a.slots
			if strings.HasPrefix(r.URL.Path, "/api/admin/") {
				slots = a.adminSlots
			}
			if r.URL.Path == "/health/ready" {
				slots = a.healthSlots
			}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			default:
				w.Header().Set("Retry-After", "1")
				fail(w, 503, "Сервис занят. Попробуйте позже")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
			defer cancel()
			r = r.WithContext(ctx)
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			ip, ok := a.clientIP(r)
			if !ok {
				fail(w, 400, "Неверный адрес запроса")
				return
			}
			key := hex.EncodeToString(a.digest("rate", ip))
			limits := a.limits
			if strings.HasPrefix(r.URL.Path, "/api/admin/") {
				limits = a.adminLimits
			}
			if !limits.allow("all:"+key, 120, time.Minute, a.now()) {
				a.rateError(w, 60)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *App) rateError(w http.ResponseWriter, seconds int) {
	w.Header().Set("Retry-After", itoa(seconds))
	fail(w, 429, "Слишком много запросов. Попробуйте позже")
}
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	b := make([]byte, 0, 10)
	for n > 0 {
		b = append(b, byte('0'+n%10))
		n /= 10
	}
	for l, r := 0, len(b)-1; l < r; l, r = l+1, r-1 {
		b[l], b[r] = b[r], b[l]
	}
	return string(b)
}
func (a *App) allow(r *http.Request, purpose string, capacity int, period time.Duration) bool {
	ip, ok := a.clientIP(r)
	limits := a.limits
	if strings.HasPrefix(r.URL.Path, "/api/admin/") {
		limits = a.adminLimits
	}
	return ok && limits.allow(purpose+":"+hex.EncodeToString(a.digest("rate", ip)), capacity, period, a.now())
}
func (a *App) sessionToken(r *http.Request) (string, error) {
	c, err := r.Cookie(a.cookieName("session"))
	if err != nil || len(c.Value) != 43 {
		return "", store.ErrNotFound
	}
	return a.db.Session(r.Context(), a.sessionHash(c.Value))
}
func (a *App) authorize(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		csrf, err := a.sessionToken(r)
		if errors.Is(err, store.ErrNotFound) {
			fail(w, 401, "Войдите в панель управления")
			return
		}
		if err != nil {
			a.serverError(w)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && (len(r.Header.Values("X-CSRF-Token")) != 1 || !hmac.Equal([]byte(csrf), []byte(r.Header.Get("X-CSRF-Token")))) {
			fail(w, 403, "Обновите страницу и повторите запрос")
			return
		}
		fn(w, r)
	}
}

// Binding to the configured password hash invalidates all bearer tokens after a
// password/hash change, even when the stable application signing key is retained.
func (a *App) sessionHash(token string) []byte {
	return a.digest("session:"+string(a.cfg.PasswordHash), token)
}
