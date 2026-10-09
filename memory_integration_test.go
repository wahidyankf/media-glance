//go:build integration

package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"strings"
	"testing"
	"time"
)

// This exercises retained resources rather than RSS: Go may retain free heap
// pages after a request, but closed streams must release their watches and FDs.
func TestRepeatedRequestsAndStreamChurnReleaseResources(t *testing.T) {
	// An unregistered ephemeral listener isolates this fixture from editor/browser sessions.
	// The requests and SSE streams under test still own their sockets normally.
	v, address := fixtureWithKeepAlives(t, false)
	for _, dir := range []string{"docs", "assets"} {
		if err := os.Mkdir(filepath.Join(v.root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	const small = "# Synthetic plan\n\n![asset](../assets/image.svg)\n\n```mermaid\ngraph TD\nA --> B\n```\n"
	wide := small
	for index := 0; index < 12; index++ {
		dir := fmt.Sprintf("extra-%02d", index)
		if err := os.Mkdir(filepath.Join(v.root, dir), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(v.root, dir, "image.svg"), []byte("<svg/>"), 0600); err != nil {
			t.Fatal(err)
		}
		wide += fmt.Sprintf("\n![extra](../%s/image.svg)\n", dir)
	}
	document := filepath.Join(v.root, "docs/plan.md")
	if err := os.WriteFile(document, []byte(small), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(v.root, "assets/image.svg"), []byte("<svg/>"), 0600); err != nil {
		t.Fatal(err)
	}
	// A large plain-text preview makes retaining one response per cycle exceed
	// the heap budget; tiny diagram fixtures alone would hide that regression.
	if err := os.WriteFile(filepath.Join(v.root, "large.txt"), []byte(strings.Repeat("synthetic text\n", 20*1024)), 0600); err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DisableKeepAlives: true}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	t.Cleanup(transport.CloseIdleConnections)
	read := func(route string) {
		t.Helper()
		response, err := client.Get(address + route)
		if err != nil {
			t.Fatal(err)
		}
		_, readErr := io.Copy(io.Discard, response.Body)
		closeErr := response.Body.Close()
		if readErr != nil || closeErr != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("request %s: status=%d read=%v close=%v", route, response.StatusCode, readErr, closeErr)
		}
	}
	cycle := func() {
		t.Helper()
		for _, route := range []string{"api/tree?path=docs", "api/file?path=docs%2Fplan.md", "api/file?path=large.txt", "api/raw?path=assets%2Fimage.svg", "media.js"} {
			read(route)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		query := url.Values{"dirs": {`["","docs"]`}, "path": {"docs/plan.md"}}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"api/events?"+query.Encode(), nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := response.Body.Close(); err != nil {
				t.Error(err)
			}
		}()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("stream status=%d", response.StatusCode)
		}
		scanner := bufio.NewScanner(response.Body)
		for _, content := range []string{wide, small} {
			if err := os.WriteFile(document, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			received := false
			for scanner.Scan() {
				if scanner.Text() == "event: change" {
					received = true
					break
				}
			}
			if !received {
				t.Fatalf("watch expansion/shrink did not invalidate: %v", scanner.Err())
			}
			read("api/file?path=docs%2Fplan.md")
		}
	}
	// Warm the renderer, MIME registry, HTTP pools, and runtime before measuring.
	cycle()
	baseline := awaitMemoryResources(t, memoryResources{}, false)
	for batch := 1; batch <= 3; batch++ {
		for index := 0; index < 8; index++ {
			cycle()
		}
		settled := awaitMemoryResources(t, baseline, true)
		t.Logf("batch=%d heap=%d objects=%d goroutines=%d fsnotify=%d fds=%d; baseline heap=%d objects=%d goroutines=%d fsnotify=%d fds=%d",
			batch, settled.heap, settled.objects, settled.goroutines, settled.watchers, settled.fds,
			baseline.heap, baseline.objects, baseline.goroutines, baseline.watchers, baseline.fds)
		// A bounded allocator margin excludes runtime bookkeeping, while catching
		// per-request retained bodies or per-stream watcher graphs in this fixture.
		if settled.heap > baseline.heap+2*1024*1024 {
			t.Fatalf("retained heap grew more than 2 MiB after batch %d", batch)
		}
	}
}

type memoryResources struct {
	heap, objects uint64
	goroutines    int
	watchers      int
	fds           int
}

func memorySnapshot(t *testing.T) memoryResources {
	t.Helper()
	var stacks bytes.Buffer
	profile := pprof.Lookup("goroutine")
	if profile == nil {
		t.Fatal("goroutine profile is unavailable")
	}
	if err := profile.WriteTo(&stacks, 2); err != nil {
		t.Fatal(err)
	}
	watchers := 0
	for _, stack := range strings.Split(stacks.String(), "\n\n") {
		if strings.Contains(stack, "github.com/fsnotify/fsnotify.") {
			watchers++
		}
	}
	directory := "/proc/self/fd"
	if runtime.GOOS == "darwin" {
		directory = "/dev/fd"
	}
	// Count names without statting descriptors that another goroutine may
	// close between enumeration and metadata lookup (notably on macOS).
	folder, err := os.Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	fds, readErr := folder.Readdirnames(-1)
	closeErr := folder.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		t.Fatal(err)
	}
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return memoryResources{stats.HeapAlloc, stats.HeapObjects, runtime.NumGoroutine(), watchers, len(fds)}
}

func awaitMemoryResources(t *testing.T, baseline memoryResources, enforce bool) memoryResources {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var last memoryResources
	for {
		runtime.GC()
		last = memorySnapshot(t)
		if (!enforce && last.watchers == 0) || (enforce && last.watchers <= baseline.watchers && last.fds <= baseline.fds && last.goroutines <= baseline.goroutines+1) {
			return last
		}
		if time.Now().After(deadline) {
			var stacks bytes.Buffer
			if err := pprof.Lookup("goroutine").WriteTo(&stacks, 2); err != nil {
				t.Fatal(err)
			}
			t.Fatalf("closed streams retained resources: last=%+v baseline=%+v\n%s", last, baseline, stacks.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
}
