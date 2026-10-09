package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type memoryListener struct {
	done       chan struct{}
	once       sync.Once
	err        error
	closeErr   error
	accepted   chan struct{}
	acceptOnce sync.Once
}

func (l *memoryListener) Accept() (net.Conn, error) {
	if l.accepted != nil {
		l.acceptOnce.Do(func() { close(l.accepted) })
	}
	if l.err != nil {
		return nil, l.err
	}
	<-l.done
	return nil, net.ErrClosed
}
func (l *memoryListener) Close() error { l.once.Do(func() { close(l.done) }); return l.closeErr }
func (*memoryListener) Addr() net.Addr { return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 57300} }
func prepareServe(t *testing.T) {
	t.Helper()
	fakeHost(t)
	host.kill = func(int, syscall.Signal) error { return nil }
	host.listen = func(string, string) (net.Listener, error) { return &memoryListener{done: make(chan struct{})}, nil }
	host.notify = func(c context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
		return context.WithCancel(c)
	}
	host.request = func(req *http.Request, _ time.Duration) (*http.Response, error) {
		record, e := newRecord("/workspace", 57300, 1, "")
		if e != nil {
			t.Fatal(e)
		}
		var b bytes.Buffer
		if e := writeReady(&b, record.readyRecord); e != nil {
			t.Fatal(e)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(&b)}, nil
	}
}
func writeReady(w io.Writer, r readyRecord) error { return json.NewEncoder(w).Encode(r) }
func TestCLIValidationAndVersion(t *testing.T) {
	fakeHost(t)
	input := io.NopCloser(strings.NewReader(""))
	var b bytes.Buffer
	if e := run([]string{"version", "--json"}, input, &b); e != nil || !strings.Contains(b.String(), `"protocol":1`) || !strings.Contains(b.String(), `"version":"v0.1.2"`) {
		t.Fatalf("%s %v", b.String(), e)
	}
	for _, args := range [][]string{nil, {"version"}, {"version", "other"}, {"list", "--bad"}, {"list"}, {"list", "--state-dir", "/state", "positional"}, {"stop", "--state-dir", "/state"}, {"what", "--state-dir", "/state"}, {"serve", "--state-dir", "/state"}, {"serve", "--state-dir", "/state", "--root", "/missing", "--owner-pid", "1"}, {"serve", "--state-dir", "/state", "--root", "/workspace/z.txt", "--owner-pid", "1"}, {"serve", "--state-dir", "/state", "--root", "/workspace", "--owner-pid", "1", "--initial-file", "relative"}} {
		if e := run(args, input, io.Discard); e == nil {
			t.Fatalf("accepted %v", args)
		}
	}
	if e := run([]string{"version", "--json"}, input, errorWriter{}); e == nil {
		t.Fatal("output failure")
	}
	host.readDir = func(string) ([]os.DirEntry, error) { return nil, os.ErrNotExist }
	if e := run([]string{"list", "--state-dir", "/state"}, input, io.Discard); e != nil {
		t.Fatal(e)
	}
	host.readDir = func(string) ([]os.DirEntry, error) { return nil, errBoundary }
	if e := run([]string{"list", "--state-dir", "/state"}, input, io.Discard); e == nil {
		t.Fatal("list failure")
	}
	id := "01234567-0123-0123-0123-012345678901"
	if e := run([]string{"stop", "--state-dir", "/state", "--instance", id}, input, io.Discard); e == nil {
		t.Fatal("stop missing")
	}
	host.eval = func(s string) (string, error) { return s, nil }
	host.stat = func(string) (fs.FileInfo, error) { return nil, errBoundary }
	if e := run([]string{"serve", "--state-dir", "/state", "--root", "/workspace", "--owner-pid", "1"}, input, io.Discard); e == nil {
		t.Fatal("stat")
	}
	host.exit = func(code int) {
		if code != 1 {
			t.Fatal(code)
		}
	}
	saved := os.Args
	os.Args = []string{"media-glance"}
	t.Cleanup(func() { os.Args = saved })
	main()
}
func TestListenPortAllocation(t *testing.T) {
	fakeHost(t)
	calls := 0
	host.listen = func(_, address string) (net.Listener, error) {
		calls++
		if calls == 1 {
			return nil, syscall.EADDRINUSE
		}
		if address != "127.0.0.1:57301" {
			t.Fatal(address)
		}
		return &memoryListener{done: make(chan struct{})}, nil
	}
	l, p, e := listenPort()
	if e != nil || p != 57301 {
		t.Fatal(p, e)
	}
	if e := l.Close(); e != nil {
		t.Fatal(e)
	}
	host.listen = func(string, string) (net.Listener, error) { return nil, errBoundary }
	if _, _, e := listenPort(); e == nil {
		t.Fatal("bind failure")
	}
	host.listen = func(string, string) (net.Listener, error) { return nil, syscall.EADDRINUSE }
	if _, _, e := listenPort(); e == nil {
		t.Fatal("exhaustion")
	}
}
func TestServeMemoryBoundaries(t *testing.T) {
	prepareServe(t)
	if e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("stop\n")), io.Discard); e != nil {
		t.Fatal(e)
	}
	if e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("ignored\n")), io.Discard); e != nil {
		t.Fatal(e)
	}
	host.request = func(*http.Request, time.Duration) (*http.Response, error) { return nil, errBoundary }
	if e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("")), io.Discard); e == nil {
		t.Fatal("probe")
	}
	host.kill = func(int, syscall.Signal) error { return errBoundary }
	if e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("")), io.Discard); e == nil {
		t.Fatal("owner")
	}
	host.kill = func(int, syscall.Signal) error { return nil }
	host.listen = func(string, string) (net.Listener, error) { return nil, errBoundary }
	if e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("")), io.Discard); e == nil {
		t.Fatal("listener")
	}
}
func TestOwnershipPipeErrors(t *testing.T) {
	fakeHost(t)
	file := os.Stdin
	host.dup = func(int) (int, error) { return 0, errBoundary }
	if _, e := interruptibleInput(file); e == nil {
		t.Fatal("dup")
	}
	host.dup = func(int) (int, error) { return 1, nil }
	host.closeExec = func(int) {}
	host.nonblock = func(int, bool) error { return errBoundary }
	host.closeFD = func(int) error { return nil }
	if _, e := interruptibleInput(file); e == nil {
		t.Fatal("nonblock")
	}
	host.closeFD = func(int) error { return errBoundary }
	if _, e := interruptibleInput(file); e == nil {
		t.Fatal("descriptor close")
	}
	host.nonblock = func(int, bool) error { return nil }
	host.newFile = func(uintptr, string) io.ReadCloser { return &readStream{Reader: bytes.NewReader(nil)} }
	host.closeFile = func(*os.File) error { return errBoundary }
	if _, e := interruptibleInput(file); e == nil {
		t.Fatal("inherited close")
	}
	host.newFile = func(uintptr, string) io.ReadCloser {
		return &readStream{Reader: bytes.NewReader(nil), closeErr: errBoundary}
	}
	if _, e := interruptibleInput(file); e == nil {
		t.Fatal("replacement close")
	}
	host.closeFile = func(*os.File) error { return nil }
	if _, e := interruptibleInput(file); e != nil {
		t.Fatal(e)
	}
}

func TestCLIFocusedFileSelection(t *testing.T) {
	for _, initial := range []string{"", "/workspace/docs/a.md", "/outside/missing"} {
		t.Run(initial, func(t *testing.T) {
			prepareServe(t)
			host.kill = func(int, syscall.Signal) error { return errBoundary }
			args := []string{"serve", "--state-dir", "/state", "--root", "/workspace", "--owner-pid", "1"}
			if initial != "" {
				args = append(args, "--initial-file", initial)
			}
			if e := run(args, io.NopCloser(strings.NewReader("")), io.Discard); !errors.Is(e, errBoundary) {
				t.Fatal(e)
			}
		})
	}
	prepareServe(t)
	host.rel = func(string, string) (string, error) { return "", errBoundary }
	if e := run([]string{"serve", "--state-dir", "/state", "--root", "/workspace", "--owner-pid", "1", "--initial-file", "/workspace/docs/a.md"}, io.NopCloser(strings.NewReader("")), io.Discard); e == nil {
		t.Fatal("relative path")
	}
}
func TestServeFailureAndOwnerDeath(t *testing.T) {
	for _, mode := range []string{"input-error", "input-close", "random", "registry", "output", "serve-error", "owner-death", "cleanup-error", "interrupt-error"} {
		t.Run(mode, func(t *testing.T) {
			prepareServe(t)
			input := io.ReadCloser(io.NopCloser(strings.NewReader("")))
			output := io.Writer(io.Discard)
			expect := false
			var accepted <-chan struct{}
			switch mode {
			case "input-error":
				input = &readStream{Reader: bytes.NewReader(nil), errorRead: errBoundary}
			case "input-close":
				input = &readStream{Reader: bytes.NewReader(nil), closeErr: errBoundary}
			case "random":
				host.random = func([]byte) (int, error) { return 0, errBoundary }
				expect = true
			case "registry":
				host.mkdir = func(string, fs.FileMode) error { return errBoundary }
				input = &readStream{Reader: bytes.NewReader(nil), closeErr: errBoundary}
				expect = true
			case "output":
				output = errorWriter{}
				expect = true
			case "serve-error":
				// Keep the owner alive until Accept actually returns its error.
				// Immediate EOF could otherwise close http.Server before Serve
				// starts, correctly producing ErrServerClosed without any Accept.
				reader, writer := io.Pipe()
				defer func() {
					if e := writer.Close(); e != nil {
						t.Error(e)
					}
				}()
				input = reader
				attempted := make(chan struct{})
				accepted = attempted
				host.listen = func(string, string) (net.Listener, error) {
					return &memoryListener{done: make(chan struct{}), err: errBoundary, accepted: attempted}, nil
				}
				expect = true
			case "owner-death":
				reader, writer := io.Pipe()
				defer func() {
					if e := writer.Close(); e != nil {
						t.Error(e)
					}
				}()
				input = reader
				calls := 0
				host.kill = func(int, syscall.Signal) error {
					calls++
					if calls > 1 {
						return syscall.ESRCH
					}
					return nil
				}
				host.ticker = func(time.Duration) *time.Ticker { return time.NewTicker(time.Millisecond) }
			case "cleanup-error":
				host.remove = func(name string) error {
					if strings.HasSuffix(name, ".json") {
						return errBoundary
					}
					return nil
				}
			case "interrupt-error":
				host.dup = func(int) (int, error) { return 0, errBoundary }
				input = os.Stdin
				expect = true
			}
			e := serve(context.Background(), "/workspace", "/state", "", 1, input, output)
			if expect != (e != nil) {
				t.Fatalf("%s: %v", mode, e)
			}
			if mode == "serve-error" {
				select {
				case <-accepted:
				default:
					t.Fatal("listener never attempted Accept")
				}
				if !errors.Is(e, errBoundary) {
					t.Fatalf("Accept error was not returned: %v", e)
				}
			}
		})
	}
}

type memoryServer struct {
	done     chan struct{}
	once     sync.Once
	closeErr error
}

func (s *memoryServer) Serve(net.Listener) error { <-s.done; return http.ErrServerClosed }
func (s *memoryServer) Close() error             { s.once.Do(func() { close(s.done) }); return s.closeErr }
func TestServeCloseFailuresReportedAndWaited(t *testing.T) {
	for _, startup := range []bool{false, true} {
		t.Run(fmt.Sprint(startup), func(t *testing.T) {
			prepareServe(t)
			host.server = func(http.Handler) serverLifecycle {
				return &memoryServer{done: make(chan struct{}), closeErr: errBoundary}
			}
			if startup {
				host.request = func(*http.Request, time.Duration) (*http.Response, error) { return nil, errBoundary }
			}
			e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("")), io.Discard)
			if startup != (e != nil) {
				t.Fatal(e)
			}
		})
	}
}

func TestListenerCleanupFailure(t *testing.T) {
	prepareServe(t)
	host.listen = func(string, string) (net.Listener, error) {
		return &memoryListener{done: make(chan struct{}), closeErr: errBoundary}, nil
	}
	host.random = func([]byte) (int, error) { return 0, errBoundary }
	if e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("")), io.Discard); e == nil {
		t.Fatal("random error lost")
	}
}
