package main

import (
	"context"
	"crypto/rand"
	"github.com/fsnotify/fsnotify"
	"github.com/wahidyankf/media-glance/internal/media"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

// Platform operations live at the boundary so decisions and failure paths can
// be verified without acquiring a process, socket, or filesystem resource.
var host = struct {
	openRoot     func(string) (workspaceFiles, error)
	markdown     func([]byte, string) (string, []string, error)
	server       func(http.Handler) serverLifecycle
	sameFile     func(fs.FileInfo, fs.FileInfo) bool
	rawWatcher   func() (*fsnotify.Watcher, error)
	subscription func() (*watchSubscription, error)
	eval         func(string) (string, error)
	rel          func(string, string) (string, error)
	stat         func(string) (fs.FileInfo, error)
	lstat        func(string) (fs.FileInfo, error)
	readFile     func(string) ([]byte, error)
	readDir      func(string) ([]os.DirEntry, error)
	readlink     func(string) (string, error)
	mkdir        func(string, fs.FileMode) error
	chmod        func(string, fs.FileMode) error
	remove       func(string) error
	link         func(string, string) error
	open         func(string) (io.ReadSeekCloser, error)
	temp         func(string, string) (temporaryFile, error)
	random       func([]byte) (int, error)
	now          func() time.Time
	pid          func() int
	kill         func(int, syscall.Signal) error
	listen       func(string, string) (net.Listener, error)
	request      func(*http.Request, time.Duration) (*http.Response, error)
	exit         func(int)
	notify       func(context.Context, ...os.Signal) (context.Context, context.CancelFunc)
	ticker       func(time.Duration) *time.Ticker
	dup          func(int) (int, error)
	nonblock     func(int, bool) error
	closeFD      func(int) error
	closeExec    func(int)
	closeFile    func(*os.File) error
	newFile      func(uintptr, string) io.ReadCloser
	after        func(time.Duration, func()) *time.Timer
}{
	openRoot: openWorkspace, markdown: media.RenderMarkdown, server: func(handler http.Handler) serverLifecycle {
		return &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024}
	},
	sameFile: os.SameFile, rawWatcher: fsnotify.NewWatcher,
	eval: filepath.EvalSymlinks, rel: filepath.Rel, stat: os.Stat, lstat: os.Lstat,
	readFile: os.ReadFile, readDir: os.ReadDir, readlink: os.Readlink,
	mkdir: os.MkdirAll, chmod: os.Chmod, remove: os.Remove, link: os.Link,
	open:   func(name string) (io.ReadSeekCloser, error) { return rawOpen(name) },
	temp:   func(dir, pattern string) (temporaryFile, error) { return rawTemp(dir, pattern) },
	random: rand.Read, now: time.Now, pid: os.Getpid, kill: syscall.Kill, listen: net.Listen,
	request: func(request *http.Request, timeout time.Duration) (*http.Response, error) {
		client := &http.Client{Timeout: timeout, CheckRedirect: rejectRedirect, Transport: clientTransport}
		return client.Do(request)
	}, exit: os.Exit, after: time.AfterFunc, notify: signal.NotifyContext, ticker: time.NewTicker,
	dup: syscall.Dup, nonblock: syscall.SetNonblock, closeFD: syscall.Close, closeExec: syscall.CloseOnExec, closeFile: (*os.File).Close,
	newFile: func(fd uintptr, name string) io.ReadCloser { return os.NewFile(fd, name) },
}

type temporaryFile interface {
	io.WriteCloser
	Name() string
}

func rejectRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

// watchSubscription exposes only the operations owned by an SSE request.
type watchSubscription struct {
	events <-chan fsnotify.Event
	errors <-chan error
	add    func(string) error
	close  func() error
	list   func() []string
}

func makeSubscription() (*watchSubscription, error) {
	w, e := host.rawWatcher()
	if e != nil {
		return nil, e
	}
	return &watchSubscription{events: w.Events, errors: w.Errors, add: w.Add, close: w.Close, list: w.WatchList}, nil
}
func newSubscription() (*watchSubscription, error) { return host.subscription() }

func init() { host.subscription = makeSubscription }

var rawOpen = os.Open
var rawTemp = os.CreateTemp
var clientTransport http.RoundTripper = http.DefaultTransport

type serverLifecycle interface {
	Serve(net.Listener) error
	Close() error
}
