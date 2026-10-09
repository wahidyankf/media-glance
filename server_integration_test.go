//go:build integration

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) (*viewer, string) {
	t.Helper()
	return fixtureWithKeepAlives(t, true)
}

func fixtureWithKeepAlives(t *testing.T, keepAlive bool) (*viewer, string) {
	t.Helper()
	root := t.TempDir()
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	root = canonical
	var listener net.Listener
	var port int
	if keepAlive {
		listener, port, err = listenPort()
	} else {
		// Resource probes do not publish a registry record and can use an
		// ephemeral port, isolated from editor/browser sessions on the pool.
		listener, err = net.Listen("tcp4", "127.0.0.1:0")
		if err == nil {
			address, ok := listener.Addr().(*net.TCPAddr)
			if !ok {
				if closeErr := listener.Close(); closeErr != nil {
					t.Fatal(closeErr)
				}
				t.Fatal("unexpected TCP listener address")
			}
			port = address.Port
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	record, err := newRecord(root, port, os.Getpid(), "")
	if err != nil {
		t.Fatal(err)
	}
	storage, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := storage.Close(); err != nil {
			t.Error(err)
		}
	})
	v := &viewer{root: root, files: storage, record: record, stop: func() {}}
	server := &http.Server{Handler: v}
	server.SetKeepAlivesEnabled(keepAlive)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() {
		if err := server.Close(); err != nil {
			t.Error(err)
		}
		if err := <-done; err != http.ErrServerClosed {
			t.Error(err)
		}
	})
	return v, record.URL
}

func request(t *testing.T, address string) (int, []byte) {
	t.Helper()
	response, err := http.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, data
}

func TestMediaModuleIsServedAsExecutableJavaScript(t *testing.T) {
	_, address := fixture(t)
	response, err := http.Get(address + "media.js")
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Content-Type"), "javascript") || !strings.Contains(string(data), "export function mediaViewers") {
		t.Fatalf("media module status=%d type=%s", response.StatusCode, response.Header.Get("Content-Type"))
	}
	if status, _ := request(t, address+"README.md"); status != http.StatusNotFound {
		t.Fatalf("unexpected embedded frontend route status=%d", status)
	}
}

func TestInitialFileReadinessURLSelectsContainedFile(t *testing.T) {
	for _, test := range []struct {
		name, initial, selected  string
		readme, outside, symlink bool
	}{
		{name: "nested spaces hash and unicode", initial: "plans/deep/focused #2 é.md", selected: "plans/deep/focused #2 é.md", readme: true},
		{name: "empty falls back to readme", selected: "README.md", readme: true},
		{name: "unsaved falls back to readme", initial: "missing.md", selected: "README.md", readme: true},
		{name: "outside file falls back to readme", initial: "outside.md", selected: "README.md", readme: true, outside: true},
		{name: "outside symlink falls back to readme", initial: "linked.md", selected: "README.md", readme: true, symlink: true},
		{name: "no readme opens chooser"},
		{name: "outside file without readme opens chooser", initial: "outside.md", outside: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if test.readme {
				if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# README fallback"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			initial := ""
			if test.initial != "" {
				initial = filepath.Join(root, test.initial)
			}
			if test.outside || test.symlink {
				outside := filepath.Join(t.TempDir(), "outside.md")
				if err := os.WriteFile(outside, []byte("# outside private content"), 0600); err != nil {
					t.Fatal(err)
				}
				if test.symlink {
					if err := os.Symlink(outside, initial); err != nil {
						t.Fatal(err)
					}
				} else {
					initial = outside
				}
			} else if test.selected != "" && test.selected != "README.md" {
				if err := os.MkdirAll(filepath.Dir(initial), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(initial, []byte("# focused file contents"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			process := startProcessWithInitial(t, root, t.TempDir(), os.Getpid(), initial)
			address, err := url.Parse(process.ready.URL)
			if err != nil {
				t.Fatal(err)
			}
			if address.Query().Get("file") != test.selected || address.Fragment != "" {
				t.Fatalf("readiness URL did not select %q", test.selected)
			}
			address.RawQuery = ""
			if test.selected != "" {
				status, data := request(t, address.String()+"api/file?path="+url.QueryEscape(test.selected))
				var file struct{ Path, HTML string }
				if err := json.Unmarshal(data, &file); err != nil {
					t.Fatal(err)
				}
				if status != http.StatusOK || file.Path != test.selected || !strings.Contains(file.HTML, "fallback") && !strings.Contains(file.HTML, "focused file contents") {
					t.Fatalf("selected file response status=%d path=%q", status, file.Path)
				}
			}
			if test.symlink {
				if status, _ := request(t, address.String()+"api/file?path=linked.md"); status != http.StatusNotFound {
					t.Fatalf("outside symlink accepted status=%d", status)
				}
			}
			if _, err := io.WriteString(process.input, "stop\n"); err != nil {
				t.Fatal(err)
			}
			stoppedProcess(t, process)
		})
	}
}

func TestHTTPFilesAndProtection(t *testing.T) {
	v, address := fixture(t)
	for name, data := range map[string]string{"README.md": "# Plan\n\n![Asset](image.svg)", "image.svg": "<svg/>", "source.html": "<script>bad()</script>", "binary.bin": "\x00\x01"} {
		if err := os.WriteFile(filepath.Join(v.root, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(v.root, ".git"), 0700); err != nil {
		t.Fatal(err)
	}
	if status, data := request(t, address+"api/tree?path="); status != 200 || strings.Contains(string(data), `".git"`) {
		t.Fatalf("tree %d %s", status, data)
	}
	for name, kind := range map[string]string{"README.md": "markdown", "image.svg": "image", "source.html": "text", "binary.bin": "download"} {
		status, data := request(t, address+"api/file?path="+url.QueryEscape(name))
		if status != 200 || !strings.Contains(string(data), `"kind":"`+kind+`"`) {
			t.Errorf("%s: %d %s", name, status, data)
		}
	}
	status, data := request(t, address+"api/raw?path=source.html")
	if status != 200 || string(data) != "<script>bad()</script>" {
		t.Fatalf("raw %d %s", status, data)
	}
	for _, path := range []string{"../secret", "/etc/passwd", "x\x00y"} {
		status, _ := request(t, address+"api/file?path="+url.QueryEscape(path))
		if status != 404 {
			t.Errorf("unsafe %q status=%d", path, status)
		}
	}
	for _, change := range []string{"host", "origin", "token"} {
		req, err := http.NewRequest(http.MethodGet, address+"api/info", nil)
		if err != nil {
			t.Fatal(err)
		}
		switch change {
		case "host":
			req.Host = "evil.invalid"
		case "origin":
			req.Header.Set("Origin", "https://evil.invalid")
		case "token":
			req.URL.Path = "/v/wrong/api/info"
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if err := resp.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode == 200 {
			t.Errorf("accepted invalid %s", change)
		}
	}
	response, err := http.Get(address + "api/raw?path=source.html")
	if err != nil {
		t.Fatal(err)
	}
	if response.Header.Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Error(response.Header)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodGet, address+"api/raw?path=README.md", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Range", "bytes=0-4")
	response, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusPartialContent {
		t.Errorf("Range status=%d", response.StatusCode)
	}
	if err := response.Body.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRegistryLiveStaleAndUnverifiedStop(t *testing.T) {
	v, address := fixture(t)
	state := t.TempDir()
	if err := writeRecord(state, v.record); err != nil {
		t.Fatal(err)
	}
	servers, err := listServers(context.Background(), state)
	if err != nil || len(servers) != 1 || servers[0].URL != address {
		t.Fatalf("list=%v err=%v", servers, err)
	}
	stale, err := newRecord(v.root, v.record.Port, os.Getpid(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := writeRecord(state, stale); err != nil {
		t.Fatal(err)
	}
	if err := stopServer(context.Background(), state, stale.Instance); err == nil {
		t.Fatal("closed wrong identity")
	}
	servers, err = listServers(context.Background(), state)
	if err != nil || len(servers) != 1 {
		t.Fatalf("prune=%v err=%v", servers, err)
	}
	if _, err := os.Stat(filepath.Join(state, stale.Instance+".json")); !os.IsNotExist(err) {
		t.Fatalf("stale remains: %v", err)
	}
	info, err := os.Stat(filepath.Join(state, v.record.Instance+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("registry mode=%v", info.Mode())
	}
}

func TestExternalAtomicChangesSSE(t *testing.T) {
	v, address := fixture(t)
	if err := os.Mkdir(filepath.Join(v.root, "docs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(v.root, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	document := filepath.Join(v.root, "docs/plan.md")
	if err := os.WriteFile(document, []byte("![Image](../assets/a.svg)"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.root, "assets/a.svg"), []byte("<svg/>"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	query := url.Values{"dirs": {`["","docs"]`}, "path": {"docs/plan.md"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"api/events?"+query.Encode(), nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Error(err)
		}
	}()
	reader := bufio.NewScanner(resp.Body)
	await := func() {
		t.Helper()
		for reader.Scan() {
			if reader.Text() == "event: change" {
				return
			}
		}
		t.Fatalf("SSE ended: %v", reader.Err())
	}
	for index, change := range []func() error{
		func() error {
			return os.WriteFile(filepath.Join(v.root, "assets/a.svg"), []byte("<svg>changed</svg>"), 0600)
		},
		func() error {
			temp := filepath.Join(v.root, "docs/.replacement")
			if err := os.WriteFile(temp, []byte("# Updated"), 0600); err != nil {
				return err
			}
			return os.Rename(temp, document)
		},
		func() error { return os.Rename(filepath.Join(v.root, "docs"), filepath.Join(v.root, "previous")) },
		func() error {
			if err := os.Mkdir(filepath.Join(v.root, "docs"), 0700); err != nil {
				return err
			}
			return os.WriteFile(document, []byte("# Restored"), 0600)
		},
		func() error { return os.WriteFile(document, []byte("# After replacement"), 0600) },
		func() error {
			// Replace the directory within one debounce window: the desired
			// watch paths are unchanged, but their inodes and children differ.
			if err := os.Rename(filepath.Join(v.root, "docs"), filepath.Join(v.root, "previous-again")); err != nil {
				return err
			}
			if err := os.Mkdir(filepath.Join(v.root, "docs"), 0700); err != nil {
				return err
			}
			return os.WriteFile(document, []byte("# Replaced again"), 0600)
		},
		func() error { return os.WriteFile(document, []byte("# After immediate replacement"), 0600) },
		func() error { return os.Remove(document) },
	} {
		if err := change(); err != nil {
			t.Fatal(err)
		}
		t.Logf("awaiting change %d", index)
		await()
	}
}

func TestPortsOccupiedAndFull(t *testing.T) {
	var held []net.Listener
	for port := 57300; port <= 57399; port++ {
		listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			held = append(held, listener)
		} else if !isPortOccupied(err) {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, listener := range held {
			if err := listener.Close(); err != nil {
				t.Error(err)
			}
		}
	}()
	if listener, _, err := listenPort(); err == nil {
		if err := listener.Close(); err != nil {
			t.Error(err)
		}
		t.Fatal("full range unexpectedly allocated")
	}
	if len(held) < 2 {
		t.Skip("range almost fully occupied by other applications")
	}
	if err := held[len(held)-1].Close(); err != nil {
		t.Fatal(err)
	}
	held = held[:len(held)-1]
	listener, port, err := listenPort()
	if err != nil {
		t.Fatal(err)
	}
	if port < 57300 || port > 57399 {
		t.Fatal(port)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestProtocolJSON(t *testing.T) {
	v, _ := fixture(t)
	state := t.TempDir()
	if err := writeRecord(state, v.record); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	if err := run([]string{"list", "--state-dir", state}, io.NopCloser(strings.NewReader("")), &output); err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Type    string        `json:"type"`
		Version int           `json:"version"`
		Servers []readyRecord `json:"servers"`
	}
	if err := json.Unmarshal([]byte(output.String()), &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Type != "list" || reply.Version != 1 || len(reply.Servers) != 1 {
		t.Fatalf("reply=%+v", reply)
	}
}
