//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestCopiedProductionBinaryServesOfflineAssets(t *testing.T) {
	outside := t.TempDir()
	binary := filepath.Join(outside, "media-glance")
	buildContext, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	build := exec.CommandContext(buildContext, "go", "build", "-trimpath", "-o", binary, ".")
	if output, e := build.CombinedOutput(); e != nil {
		t.Fatalf("build isolated binary: %v\n%s", e, output)
	}
	root := filepath.Join(outside, "workspace")
	if e := os.Mkdir(root, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Offline\n![asset](image.svg)\n```mermaid\ngraph TD\nA[\"$$x$$\"] --> B\n```\n"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(root, "image.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0600); e != nil {
		t.Fatal(e)
	}
	state := filepath.Join(outside, "state")
	command := exec.Command(binary, "serve", "--root", root, "--state-dir", state, "--owner-pid", strconv.Itoa(os.Getpid()))
	command.Dir = outside
	// No developer tool can be found by the copied server process.
	command.Env = append(os.Environ(), "PATH="+filepath.Join(outside, "empty-path"))
	input, e := command.StdinPipe()
	if e != nil {
		t.Fatal(e)
	}
	output, e := command.StdoutPipe()
	if e != nil {
		t.Fatal(e)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if e := command.Start(); e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait(); close(done) }()
	t.Cleanup(func() {
		if e := input.Close(); e != nil {
			t.Logf("input already closed: %v", e)
		}
		if e := command.Process.Kill(); e != nil && e != os.ErrProcessDone {
			t.Error(e)
		}
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("copied process cleanup timeout")
		}
	})
	ready := make(chan readyRecord, 1)
	decodeError := make(chan error, 1)
	go func() {
		var record readyRecord
		if e := json.NewDecoder(output).Decode(&record); e != nil {
			decodeError <- e
			return
		}
		ready <- record
	}()
	var record readyRecord
	select {
	case record = <-ready:
	case e := <-decodeError:
		t.Fatal(e)
	case <-time.After(10 * time.Second):
		t.Fatal("copied binary readiness timeout")
	}
	address := strings.Split(record.URL, "?")[0]
	for _, check := range []struct{ route, want string }{
		{"api/file?path=README.md", `class=\"mermaid`},
		{"vendor/mermaid.esm.min.mjs", "import"},
		{"vendor/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs", "0.18.3"},
		{"api/raw?path=image.svg", "<svg"},
	} {
		status, data := request(t, address+check.route)
		if status != 200 || !strings.Contains(string(data), check.want) {
			t.Fatalf("offline %s status=%d missing %q", check.route, status, check.want)
		}
	}
	if _, e := io.WriteString(input, "stop\n"); e != nil {
		t.Fatal(e)
	}
	select {
	case e := <-done:
		if e != nil {
			t.Fatalf("copied binary stop: %v %s", e, stderr.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("copied binary shutdown timeout")
	}
	entries, e := os.ReadDir(state)
	if e != nil || len(entries) != 0 {
		t.Fatalf("registry cleanup entries=%v err=%v", entries, e)
	}
}
