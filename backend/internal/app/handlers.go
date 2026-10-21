package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"feedback-hub/backend/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type project struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
}

var projectURLs = map[string]string{"campus": "https://campus.kreoniz.ru", "unlikely-ui": "", "other": ""}

func (a *App) contextOrigins() []string {
	origins := []string{a.cfg.Origin}
	for _, origin := range projectURLs {
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func projectFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Opaque != "" {
		return ""
	}
	for slug, origin := range projectURLs {
		if origin != "" && strings.EqualFold(u.Scheme+"://"+u.Host, origin) {
			return slug
		}
	}
	return ""
}

func (a *App) projects(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"projects": []project{{"campus", store.ProjectNames["campus"], "Сравнение расписаний и общие окна", projectURLs["campus"]}, {"unlikely-ui", store.ProjectNames["unlikely-ui"], "Библиотека интерфейсных компонентов", projectURLs["unlikely-ui"]}, {"other", store.ProjectNames["other"], "Другой проект или общая обратная связь", ""}}})
}
func (a *App) form(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "form", 20, time.Minute) {
		a.rateError(w, 60)
		return
	}
	visitor, ok := a.visitor(r)
	if !ok {
		visitor = randomToken()
		signed := a.sign("visitor", visitor+"~"+itoa(int(a.now().Add(365*24*time.Hour).Unix())))
		a.setCookie(w, "visitor", signed, 365*24*60*60)
	}
	writeJSON(w, 200, map[string]string{"token": a.formToken(visitor)})
}
func (a *App) features(w http.ResponseWriter, r *http.Request) {
	f, err := parseFilter(r, true)
	if err != nil {
		fail(w, 400, "Неверные параметры списка")
		return
	}
	visitor, _ := a.visitor(r)
	v := []byte{}
	if visitor != "" {
		v = a.digest("visitor", visitor)
	}
	reports, total, err := a.db.List(r.Context(), f, true, v)
	if err != nil {
		a.serverError(w)
		return
	}
	features := make([]store.Feature, 0, len(reports))
	for _, r := range reports {
		features = append(features, r.Feature)
	}
	writeJSON(w, 200, map[string]any{"items": features, "total": total})
}
func (a *App) submit(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "submit", 6, time.Hour) {
		a.rateError(w, 600)
		return
	}
	var input struct {
		Project     string        `json:"project"`
		Type        string        `json:"type"`
		Title       string        `json:"title"`
		Description string        `json:"description"`
		Details     string        `json:"details"`
		Context     store.Context `json:"context"`
		Website     string        `json:"website"`
		FormToken   string        `json:"form_token"`
	}
	if decode(w, r, &input) != nil {
		fail(w, 400, "Проверьте формат сообщения")
		return
	}
	visitor, ok := a.visitor(r)
	if !ok || !a.validForm(visitor, input.FormToken) {
		fail(w, 400, "Срок действия формы истёк или форма ещё не готова. Обновите форму и повторите отправку")
		return
	}
	receipt := uuid()
	if input.Website != "" {
		writeJSON(w, 201, map[string]any{"id": receipt, "duplicate": false})
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Details = strings.TrimSpace(input.Details)
	if input.Project == "" {
		input.Project = projectFromURL(input.Context.PageURL)
		if input.Project == "" {
			input.Project = projectFromURL(r.Referer())
		}
	}
	if store.ProjectNames[input.Project] == "" || !oneOf(input.Type, "feature", "bug") || !textOK(input.Title, 160, input.Type == "feature") || !textOK(input.Description, 5000, true) || !textOK(input.Details, 8000, false) {
		fail(w, 400, "Проверьте проект, тип и длину сообщения")
		return
	}
	c, err := sanitizeContext(input.Context, a.contextOrigins()...)
	if err != nil {
		fail(w, 400, "Проверьте технический контекст или отправьте без него")
		return
	}
	// JSON encoding keeps field boundaries unambiguous, unlike concatenating content.
	canonical, _ := json.Marshal([]string{input.Project, input.Type, normalize(input.Title), normalize(input.Description), normalize(input.Details)})
	// Cross-visitor dedupe makes quota consumption a private-content oracle.
	// Deduplicate this visitor's retries only; the owner links other duplicates.
	_, err = a.db.Submit(r.Context(), store.Submission{ID: uuid(), Project: input.Project, Type: input.Type, Title: input.Title, Description: input.Description, Details: input.Details, Context: c, Fingerprint: a.digest("dedupe-visitor", visitor+"\x00"+string(canonical))})
	if err != nil {
		a.resultError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"id": receipt, "duplicate": false})
}
func (a *App) vote(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "vote", 30, time.Minute) {
		a.rateError(w, 60)
		return
	}
	var input struct{}
	if decode(w, r, &input) != nil {
		fail(w, 400, "Неверный формат голоса")
		return
	}
	id := r.PathValue("id")
	if !validUUID(id) {
		fail(w, 404, "Не найдено")
		return
	}
	visitor, ok := a.visitor(r)
	if !ok {
		fail(w, 400, "Обновите страницу перед голосованием")
		return
	}
	ip, ok := a.clientIP(r)
	if !ok {
		fail(w, 400, "Неверный адрес запроса")
		return
	}
	n, err := a.db.Vote(r.Context(), id, a.digest("visitor", visitor), a.digest("vote-network", ip))
	if err != nil {
		a.resultError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"votes": n, "voted": true})
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "login", 5, 15*time.Minute) || !a.adminLimits.allow("login-global", 30, 15*time.Minute, a.now()) {
		a.rateError(w, 180)
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if decode(w, r, &input) != nil || len(input.Password) < 1 || len(input.Password) > 72 {
		fail(w, 400, "Проверьте формат пароля")
		return
	}
	select {
	case a.loginSlots <- struct{}{}:
		defer func() { <-a.loginSlots }()
	default:
		a.rateError(w, 5)
		return
	}
	if bcrypt.CompareHashAndPassword(a.cfg.PasswordHash, []byte(input.Password)) != nil {
		fail(w, 401, "Неверный пароль")
		return
	}
	token, csrf := randomToken(), randomToken()
	old := []byte{}
	if c, err := r.Cookie(a.cookieName("session")); err == nil {
		old = a.sessionHash(c.Value)
	}
	if err := a.db.CreateSession(r.Context(), a.sessionHash(token), csrf, a.now().Add(12*time.Hour), old); err != nil {
		a.serverError(w)
		return
	}
	a.setCookie(w, "session", token, 12*60*60)
	writeJSON(w, 200, map[string]any{"authenticated": true, "csrf_token": csrf})
}
func (a *App) session(w http.ResponseWriter, r *http.Request) {
	csrf, err := a.sessionToken(r)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, 200, map[string]bool{"authenticated": false})
		return
	}
	if err != nil {
		a.serverError(w)
		return
	}
	writeJSON(w, 200, map[string]any{"authenticated": true, "csrf_token": csrf})
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	var input struct{}
	if decode(w, r, &input) != nil {
		fail(w, 400, "Неверный формат запроса")
		return
	}
	c, err := r.Cookie(a.cookieName("session"))
	if err != nil {
		fail(w, 401, "Войдите в панель управления")
		return
	}
	if err = a.db.DeleteSession(r.Context(), a.sessionHash(c.Value)); err != nil {
		a.serverError(w)
		return
	}
	a.setCookie(w, "session", "", -1)
	w.WriteHeader(204)
}
func (a *App) adminList(w http.ResponseWriter, r *http.Request) {
	f, err := parseFilter(r, false)
	if err != nil {
		fail(w, 400, "Неверные параметры списка")
		return
	}
	reports, total, err := a.db.List(r.Context(), f, false, []byte{})
	if err != nil {
		a.serverError(w)
		return
	}
	writeJSON(w, 200, map[string]any{"items": reports, "total": total})
}
func (a *App) adminGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validUUID(id) {
		fail(w, 404, "Не найдено")
		return
	}
	report, err := a.db.Get(r.Context(), id)
	if err != nil {
		a.resultError(w, err)
		return
	}
	writeJSON(w, 200, report)
}
func (a *App) adminPatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validUUID(id) {
		fail(w, 404, "Не найдено")
		return
	}
	var raw map[string]json.RawMessage
	if decode(w, r, &raw) != nil || len(raw) == 0 {
		fail(w, 400, "Неверное изменение")
		return
	}
	var p store.Patch
	for k, v := range raw {
		if k == "duplicate_of" {
			p.DuplicateSet = true
			if string(v) == "null" {
				continue
			}
			var s string
			if json.Unmarshal(v, &s) != nil || !validUUID(s) {
				fail(w, 400, "Неверная ссылка на дубликат")
				return
			}
			p.DuplicateOf = &s
			continue
		}
		var value string
		if string(v) == "null" || json.Unmarshal(v, &value) != nil {
			fail(w, 400, "Неверное изменение")
			return
		}
		valid := false
		switch k {
		case "status":
			valid = oneOf(value, "new", "planned", "in_progress", "done", "closed")
			p.Status = &value
		case "priority":
			valid = oneOf(value, "untriaged", "low", "normal", "high", "critical")
			p.Priority = &value
		case "information":
			valid = oneOf(value, "sparse", "useful", "detailed")
			p.Information = &value
		case "moderation":
			valid = oneOf(value, "pending", "approved", "rejected", "spam")
			p.Moderation = &value
		case "admin_note":
			valid = textOK(value, 8000, false)
			p.AdminNote = &value
		}
		if !valid {
			fail(w, 400, "Неверное поле или значение")
			return
		}
	}
	report, err := a.db.Update(r.Context(), id, p)
	if err != nil {
		a.resultError(w, err)
		return
	}
	writeJSON(w, 200, report)
}
