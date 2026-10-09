package main

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/fsnotify/fsnotify"
)

func TestCanonicalParentsAndWatchPaths(t *testing.T) {
	v := unitViewer(t)
	for _, n := range []string{"README.md", "assets/missing.png", "docs/missing/sub/file.md"} {
		if p := v.canonicalFileParent(n); p == "" {
			t.Fatal(n)
		}
	}
	dirs := v.watchPaths([]string{"docs", "missing", "z.txt"}, "README.md")
	if strings.Join(dirs, ",") != "/workspace,/workspace/assets,/workspace/docs" {
		t.Fatal(dirs)
	}
	if got := v.watchPaths(nil, "missing.md"); len(got) != 1 {
		t.Fatal(got)
	}
	host.readFile = func(string) ([]byte, error) { return nil, errBoundary }
	v.watchPaths(nil, "README.md")
	host.eval = func(string) (string, error) { return "", errBoundary }
	if p := v.canonicalFileParent("x"); p != "" {
		t.Fatal(p)
	}
	host.eval = func(string) (string, error) { return "/outside", nil }
	if p := v.canonicalFileParent("x"); p != "" {
		t.Fatal(p)
	}
	host.eval = func(s string) (string, error) { return s, nil }
	host.rel = func(string, string) (string, error) { return "", errBoundary }
	if p := v.canonicalFileParent("x"); p != "" {
		t.Fatal(p)
	}
	v.watchPaths([]string{"docs"}, "x")
	host.rel = filepath.Rel
	host.lstat = func(string) (fs.FileInfo, error) { return nil, errBoundary }
	if p := v.canonicalFileParent("x"); p != "" {
		t.Fatal(p)
	}
	host.lstat = func(string) (fs.FileInfo, error) {
		info, e := fs.Stat(fstest.MapFS{"x": {}}, "x")
		return modeInfo{FileInfo: info, mode: fs.ModeSymlink}, e
	}
	host.readlink = func(string) (string, error) { return "", errBoundary }
	if p := v.canonicalFileParent("x"); p != "" {
		t.Fatal(p)
	}
	for _, link := range []string{"/workspace/other", "other"} {
		host.readlink = func(string) (string, error) { return link, nil }
		if p := v.canonicalFileParent("x"); p != "" {
			t.Fatal("loop should stop", p)
		}
	}
}

type streamResponse struct {
	header  http.Header
	writes  int
	errAt   int
	onWrite func(int)
	flushes int
	code    int
}

func (w *streamResponse) Header() http.Header {
	if w.header == nil {
		w.header = http.Header{}
	}
	return w.header
}
func (w *streamResponse) WriteHeader(c int) { w.code = c }
func (w *streamResponse) Write(b []byte) (int, error) {
	w.writes++
	if w.onWrite != nil {
		w.onWrite(w.writes)
	}
	if w.errAt == w.writes {
		return 0, errBoundary
	}
	return len(b), nil
}
func (w *streamResponse) Flush() { w.flushes++ }
func fakeSubscription(t *testing.T) (chan fsnotify.Event, chan error, *watchSubscription) {
	t.Helper()
	events := make(chan fsnotify.Event, 8)
	errs := make(chan error, 8)
	paths := []string{}
	sub := &watchSubscription{events: events, errors: errs, add: func(s string) error { paths = append(paths, s); return nil }, close: func() error { return nil }, list: func() []string { return paths }}
	host.subscription = func() (*watchSubscription, error) { return sub, nil }
	host.sameFile = func(a, b fs.FileInfo) bool { return a.Name() == b.Name() }
	return events, errs, sub
}
func TestWatchFactoryAndRefusals(t *testing.T) {
	v := unitViewer(t)
	host.rawWatcher = func() (*fsnotify.Watcher, error) { return nil, errBoundary }
	if _, e := makeSubscription(); e == nil {
		t.Fatal(e)
	}
	host.rawWatcher = func() (*fsnotify.Watcher, error) {
		return &fsnotify.Watcher{Events: make(chan fsnotify.Event), Errors: make(chan error)}, nil
	}
	if _, e := makeSubscription(); e != nil {
		t.Fatal(e)
	}
	for _, route := range []string{"api/events?dirs=bad", "api/events?dirs=" + strings.Repeat("a", 32769), "api/events?dirs=[]&path=/absolute"} {
		unitResponse(t, v, "GET", route, 400)
	}
	tooMany := "[" + strings.Repeat(`"",`, 256) + `""]`
	unitResponse(t, v, "GET", "api/events?dirs="+url.QueryEscape(tooMany), 400)
	w := &failingResponse{}
	v.events(w, unitRequest(v, "GET", "api/events?dirs=[]"))
	host.subscription = func() (*watchSubscription, error) { return nil, errBoundary }
	unitResponse(t, v, "GET", "api/events?dirs=[]", 503)
	_, _, sub := fakeSubscription(t)
	sub.add = func(string) error { return errBoundary }
	sub.close = func() error { return errBoundary }
	unitResponse(t, v, "GET", "api/events?dirs=[]", 503)
	host.stat = func(string) (fs.FileInfo, error) { return nil, errBoundary }
	unitResponse(t, v, "GET", "api/events?dirs=[]", 503)
}
func TestWatchStreamCancellationFailuresAndKeepalive(t *testing.T) {
	v := unitViewer(t)
	for _, mode := range []string{"cancel", "events-closed", "errors-closed", "error", "initial-write", "change-write", "keepalive", "keepalive-write", "reconcile-error", "same-paths", "replace-close"} {
		t.Run(mode, func(t *testing.T) {
			saved := host
			t.Cleanup(func() { host = saved })
			events, errs, sub := fakeSubscription(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r := unitRequest(v, "GET", "api/events?dirs=[]").WithContext(ctx)
			w := &streamResponse{}
			switch mode {
			case "cancel":
				cancel()
			case "events-closed":
				close(events)
			case "errors-closed":
				close(errs)
			case "error":
				errs <- errBoundary
				sub.close = func() error { return errBoundary }
			case "initial-write":
				w.errAt = 1
			case "keepalive", "keepalive-write":
				host.ticker = func(time.Duration) *time.Ticker { return time.NewTicker(time.Millisecond) }
				w.onWrite = func(n int) {
					if n == 2 {
						cancel()
					}
				}
				if mode == "keepalive-write" {
					w.errAt = 2
				}
			default:
				events <- fsnotify.Event{Name: "README.md", Op: fsnotify.Write}
				w.onWrite = func(n int) {
					if n == 2 {
						cancel()
					}
				}
				if mode == "change-write" {
					w.errAt = 2
				}
				if mode == "reconcile-error" {
					count := 0
					original := host.stat
					host.stat = func(s string) (fs.FileInfo, error) {
						count++
						if count > 1 {
							return nil, errBoundary
						}
						return original(s)
					}
				}
				if mode == "replace-close" {
					host.sameFile = func(fs.FileInfo, fs.FileInfo) bool { return false }
					sub.close = func() error { return errBoundary }
				}
			}
			v.events(w, r)
			if mode == "same-paths" && w.flushes < 2 {
				t.Fatal("no change")
			}
		})
	}
	v.watchError(&streamResponse{errAt: 1}, &streamResponse{}, errBoundary)
}

type modeInfo struct {
	fs.FileInfo
	mode fs.FileMode
}

func (i modeInfo) Mode() fs.FileMode { return i.mode }
func TestWatchPathBoundsAndDisappearingDirectory(t *testing.T) {
	files := fakeHost(t)
	storage, e := host.openRoot("/workspace")
	if e != nil {
		t.Fatal(e)
	}
	v := &viewer{root: "/workspace", files: storage}
	dirs := []string{}
	for i := 0; i < 300; i++ {
		name := fmt.Sprintf("dir-%03d", i)
		files[name] = &fstest.MapFile{Mode: fs.ModeDir | 0700}
		dirs = append(dirs, name)
	}
	if got := v.watchPaths(dirs, ""); len(got) != maxWatchPaths {
		t.Fatal(len(got))
	}
	host.eval = func(p string) (string, error) { return p, nil }
	host.stat = func(string) (fs.FileInfo, error) { return fs.Stat(fstest.MapFS{"x": {Mode: fs.ModeDir}}, "x") }
	v.watchPaths(nil, "../../../outside/file")
	host.stat = func(string) (fs.FileInfo, error) { return nil, os.ErrNotExist }
	events, _, sub := fakeSubscription(t)
	close(events)
	v.events(&streamResponse{}, unitRequest(v, "GET", "api/events?dirs=[]"))
	sub.list = func() []string { return nil }
}
func TestWatchListChangedResubscribes(t *testing.T) {
	v := unitViewer(t)
	events, _, sub := fakeSubscription(t)
	sub.list = func() []string { return nil }
	events <- fsnotify.Event{Name: "README.md"}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w := &streamResponse{onWrite: func(n int) {
		if n == 2 {
			cancel()
		}
	}}
	v.events(w, unitRequest(v, "GET", "api/events?dirs=[]").WithContext(ctx))
}
