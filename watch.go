package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxWatchPaths = 256

func (v *viewer) canonicalFileParent(name string) string {
	target := filepath.Join(v.root, name)
	for depth := 0; depth < 40; depth++ {
		parent := filepath.Dir(target)
		canonical, err := host.eval(parent)
		missingParent := err != nil
		if err != nil {
			// Keep the nearest surviving target ancestor watched while a target
			// directory is renamed or recreated and the file alias is dangling.
			for parent != filepath.Dir(parent) {
				parent = filepath.Dir(parent)
				canonical, err = host.eval(parent)
				if err == nil {
					break
				}
			}
			if err != nil {
				return ""
			}
		}
		rel, err := host.rel(v.root, canonical)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return ""
		}
		if missingParent {
			return canonical
		}
		target = filepath.Join(canonical, filepath.Base(target))
		info, err := host.lstat(target)
		if os.IsNotExist(err) {
			return canonical
		}
		if err != nil {
			return ""
		}
		if info.Mode()&os.ModeSymlink == 0 {
			return canonical
		}
		link, err := host.readlink(target)
		if err != nil {
			return ""
		}
		if filepath.IsAbs(link) {
			target = filepath.Clean(link)
		} else {
			target = filepath.Clean(filepath.Join(canonical, link))
		}
	}
	return ""
}

func (v *viewer) watchPaths(dirs []string, selected string) []string {
	set := map[string]bool{v.root: true}
	add := func(name string) {
		candidate := filepath.Join(v.root, name)
		for {
			rel, err := host.rel(v.root, candidate)
			if err != nil {
				return
			}
			canonical, info, err := v.resolve(rel)
			if err == nil && info.IsDir() {
				set[canonical] = true
			}
			if candidate == v.root {
				return
			}
			parent := filepath.Dir(candidate)
			if parent == candidate {
				return
			}
			candidate = parent
		}
	}
	addFileParents := func(name string) {
		add(filepath.Dir(name))
		if canonical := v.canonicalFileParent(name); canonical != "" {
			if rel, err := host.rel(v.root, canonical); err == nil {
				add(rel)
			}
		}
	}
	for _, dir := range dirs {
		if _, info, err := v.resolve(dir); err == nil && info.IsDir() {
			add(dir)
		}
	}
	if selected != "" {
		addFileParents(selected)
		if path, info, err := v.resolve(selected); err == nil && info.Mode().IsRegular() && info.Size() <= previewLimit {
			if source, err := v.readContent(path); err == nil {
				_, assets, err := host.markdown(source, selected)
				if err == nil {
					for _, asset := range assets {
						addFileParents(asset)
					}
				}
			}
		}
	}
	result := make([]string, 0, len(set))
	for dir := range set {
		result = append(result, dir)
	}
	sort.Strings(result)
	if len(result) > maxWatchPaths {
		result = result[:maxWatchPaths]
	}
	return result
}

func (v *viewer) events(w http.ResponseWriter, r *http.Request) {
	var dirs []string
	encoded := r.URL.Query().Get("dirs")
	if len(encoded) > 32768 || json.Unmarshal([]byte(encoded), &dirs) != nil || len(dirs) > maxWatchPaths {
		http.Error(w, "invalid watch directories", http.StatusBadRequest)
		return
	}
	selected := r.URL.Query().Get("path")
	if selected != "" {
		for _, part := range filepath.SplitList(selected) {
			if filepath.IsAbs(part) {
				http.Error(w, "invalid selected path", http.StatusBadRequest)
				return
			}
		}
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unavailable", http.StatusInternalServerError)
		return
	}
	var watcher *watchSubscription
	defer func() {
		if watcher != nil {
			if err := watcher.close(); err != nil {
				fmt.Fprintln(os.Stderr, "watcher close:", err)
			}
		}
	}()
	identities := map[string]os.FileInfo{}
	reconcile := func() error {
		wanted := map[string]os.FileInfo{}
		for _, dir := range v.watchPaths(dirs, selected) {
			info, err := host.stat(dir)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return fmt.Errorf("stat watch directory: %w", err)
			}
			wanted[dir] = info
		}
		changed := watcher == nil || len(identities) != len(wanted)
		for dir, info := range wanted {
			previous, ok := identities[dir]
			if !ok || !host.sameFile(previous, info) {
				changed = true
			}
		}
		if watcher != nil && len(watcher.list()) != len(wanted) {
			changed = true
		}
		if !changed {
			return nil
		}

		// On kqueue a renamed directory can leave implicit child-file watches
		// attached to its old inode. Replace the entire watcher on directory
		// changes so recreated paths cannot reuse those hidden descriptors.
		// Subscribe the replacement before closing the old watcher to cover
		// changes during the handover; the following invalidation reads disk.
		replacement, err := newSubscription()
		if err != nil {
			return fmt.Errorf("create watcher: %w", err)
		}
		for dir := range wanted {
			if err := replacement.add(dir); err != nil {
				if closeErr := replacement.close(); closeErr != nil {
					fmt.Fprintln(os.Stderr, "replacement watcher close:", closeErr)
				}
				return fmt.Errorf("subscribe watch directory: %w", err)
			}
		}
		previous := watcher
		watcher = replacement
		identities = wanted
		if previous != nil {
			if err := previous.close(); err != nil {
				return fmt.Errorf("replace watcher: %w", err)
			}
		}
		return nil
	}
	if err := reconcile(); err != nil {
		fmt.Fprintln(os.Stderr, "watch setup:", err)
		http.Error(w, "watcher unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	if _, err := fmt.Fprint(w, "retry: 1000\n\n: connected\n\n"); err != nil {
		return
	}
	flusher.Flush()
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	keepalive := host.ticker(15 * time.Second)
	defer keepalive.Stop()
	var pending <-chan time.Time
	version := 0
	for {
		select {
		case <-r.Context().Done():
			return
		case _, ok := <-watcher.events:
			if !ok {
				return
			}
			if !timer.Stop() && pending != nil {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(200 * time.Millisecond)
			pending = timer.C
		case err, ok := <-watcher.errors:
			if !ok {
				return
			}
			v.watchError(w, flusher, err)
			return
		case <-pending:
			pending = nil
			if err := reconcile(); err != nil {
				v.watchError(w, flusher, err)
				return
			}
			version++
			if _, err := fmt.Fprintf(w, "event: change\ndata: {\"version\":%d}\n\n", version); err != nil {
				return
			}
			flusher.Flush()
		case <-keepalive.C:
			if _, err := fmt.Fprint(w, ": alive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (v *viewer) watchError(w http.ResponseWriter, flusher http.Flusher, err error) {
	fmt.Fprintln(os.Stderr, "watch events:", err)
	const payload = `{"message":"Live update watcher failed; reconnecting"}`
	if _, writeErr := fmt.Fprintf(w, "event: watch-error\ndata: %s\n\n", payload); writeErr != nil {
		fmt.Fprintln(os.Stderr, "watch error response:", writeErr)
		return
	}
	flusher.Flush()
}
