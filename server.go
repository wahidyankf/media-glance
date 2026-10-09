package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"github.com/wahidyankf/media-glance/internal/media"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

//go:embed web/*
var frontend embed.FS

type viewer struct {
	root   string
	files  workspaceFiles
	record registryRecord
	stop   func()
}

func (v *viewer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self'; frame-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	base := fmt.Sprintf("127.0.0.1:%d", v.record.Port)
	if r.Host != base {
		http.Error(w, "invalid host", http.StatusForbidden)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+base {
		http.Error(w, "invalid origin", http.StatusForbidden)
		return
	}
	prefix := "/v/" + v.record.Token + "/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		http.NotFound(w, r)
		return
	}
	route := strings.TrimPrefix(r.URL.Path, prefix)
	if route == "api/stop" {
		if r.Method != http.MethodPost {
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, struct {
			Instance string `json:"instance"`
		}{v.record.Instance})
		// Let the control response reach the client before shutting connections.
		host.after(30*time.Millisecond, v.stop)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	switch route {
	case "api/info":
		writeJSON(w, v.record.readyRecord)
	case "api/tree":
		v.tree(w, r)
	case "api/file":
		v.file(w, r)
	case "api/raw":
		v.raw(w, r)
	case "api/events":
		v.events(w, r)
	case "", "index.html":
		serveEmbedded(w, r, "web/index.html")
	case "app.js", "media.js", "start.js", "style.css":
		serveEmbedded(w, r, "web/"+route)
	default:
		if strings.HasPrefix(route, "vendor/") {
			v.vendor(w, r, strings.TrimPrefix(route, "vendor/"))
			return
		}
		http.NotFound(w, r)
	}
}

func writeJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		fmt.Fprintln(os.Stderr, "response write:", err)
	}
}

func serveEmbedded(w http.ResponseWriter, r *http.Request, name string) {
	data, err := frontend.ReadFile(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(name)))
	if _, err := w.Write(data); err != nil {
		fmt.Fprintln(os.Stderr, "frontend write:", err)
	}
}

func (v *viewer) vendor(w http.ResponseWriter, r *http.Request, name string) {
	const katexChunk = "chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs"

	// Expose only the minified ESM graph. Other upstream builds embed old KaTeX.
	if name != "mermaid.esm.min.mjs" {
		const chunks = "chunks/mermaid.esm.min/"
		if !strings.HasPrefix(name, chunks) {
			http.NotFound(w, r)
			return
		}
		chunk := strings.TrimPrefix(name, chunks)
		if chunk != filepath.Base(chunk) || !strings.HasSuffix(chunk, ".mjs") || (strings.HasPrefix(chunk, "katex-") && name != katexChunk) {
			http.NotFound(w, r)
			return
		}
	}
	w.Header().Set("Content-Type", "text/javascript")
	serveEmbedded(w, r, "web/vendor/"+name)
}

type treeEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size,omitempty"`
}

func excluded(name string) bool {
	return name == ".git" || name == "node_modules" || name == ".cache" || name == "worktrees"
}

func (v *viewer) tree(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("path")
	path, info, err := v.resolve(name)
	if err != nil || !info.IsDir() {
		http.Error(w, "directory is unavailable", http.StatusNotFound)
		return
	}
	entries, err := v.readDirectory(path)
	if err != nil {
		http.Error(w, "cannot read directory", http.StatusForbidden)
		return
	}
	result := []treeEntry{}
	for _, entry := range entries {
		if excluded(entry.Name()) {
			continue
		}
		rel := filepath.ToSlash(filepath.Join(name, entry.Name()))
		_, fi, err := v.resolve(rel)
		if err != nil {
			continue
		}
		kind := "file"
		if fi.IsDir() {
			kind = "directory"
		}
		result = append(result, treeEntry{entry.Name(), rel, kind, fi.Size()})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Kind != result[j].Kind {
			return result[i].Kind == "directory"
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	writeJSON(w, struct {
		Path    string      `json:"path"`
		Entries []treeEntry `json:"entries"`
	}{name, result})
}

type fileResult struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Kind string `json:"kind"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
	HTML string `json:"html,omitempty"`
	Text string `json:"text,omitempty"`
}

func (v *viewer) file(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("path")
	path, info, err := v.resolve(name)
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "file is unavailable", http.StatusNotFound)
		return
	}
	file, err := v.open(path)
	if err != nil {
		http.Error(w, "cannot read file", http.StatusForbidden)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "file close:", err)
		}
	}()
	limit := int64(previewLimit)
	if info.Size() > limit {
		limit = 8192
	}
	content, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		http.Error(w, "cannot read file", http.StatusInternalServerError)
		return
	}
	result := fileResult{Path: name, Name: filepath.Base(name), Kind: media.PreviewKind(name, content, info.Size()), Size: info.Size(), URL: "api/raw?path=" + url.QueryEscape(name)}
	switch result.Kind {
	case "markdown":
		html, _, err := host.markdown(content, name)
		if err != nil {
			http.Error(w, "cannot render document", http.StatusInternalServerError)
			return
		}
		result.HTML = html
	case "text":
		result.Text = string(content)
	}
	writeJSON(w, result)
}

func (v *viewer) raw(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'")
	name := r.URL.Query().Get("path")
	path, info, err := v.resolve(name)
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "file is unavailable", http.StatusNotFound)
		return
	}
	file, err := v.open(path)
	if err != nil {
		http.Error(w, "cannot read file", http.StatusForbidden)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "raw close:", err)
		}
	}()
	typeName := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if typeName == "" {
		typeName = "application/octet-stream"
	}
	if strings.HasPrefix(typeName, "text/html") || strings.HasPrefix(typeName, "application/xhtml") {
		typeName = "text/plain; charset=utf-8"
	}
	w.Header().Set("Content-Type", typeName)
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filepath.Base(name)}))
	}
	http.ServeContent(w, r, filepath.Base(name), info.ModTime(), file)
}
