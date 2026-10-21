package app

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func (a *App) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, 405, "Метод не поддерживается")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/health") {
		fail(w, 404, "Не найдено")
		return
	}
	clean := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	for _, part := range strings.Split(clean, "/") {
		if strings.HasPrefix(part, ".") || part == "" && clean != "" {
			fail(w, 404, "Не найдено")
			return
		}
	}
	// OpenRoot prevents symlink escape from STATIC_DIR and path traversal.
	root, err := os.OpenRoot(a.cfg.StaticDir)
	if err != nil {
		fail(w, 503, "Интерфейс временно недоступен")
		return
	}
	defer root.Close()
	if clean == "" {
		clean = "index.html"
	}
	f, err := root.Open(clean)
	if err != nil {
		// SPA fallback only for known page routes; missing assets never return HTML.
		if clean != "new" && clean != "admin" {
			fail(w, 404, "Не найдено")
			return
		}
		clean = "index.html"
		f, err = root.Open(clean)
	}
	if err != nil {
		if os.IsNotExist(err) || errorsIsPermission(err) {
			fail(w, 404, "Не найдено")
		} else {
			fail(w, 503, "Интерфейс временно недоступен")
		}
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		fail(w, 404, "Не найдено")
		return
	}
	if filepath.Ext(clean) == ".html" {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}
func errorsIsPermission(err error) bool { return os.IsPermission(err) || err == fs.ErrPermission }
