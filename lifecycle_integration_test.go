//go:build integration

package main

import (
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestServeProcessHelper(t *testing.T) {
	if os.Getenv("MEDIA_VIEWER_TEST_HELPER") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			if err := run(os.Args[i+1:], os.Stdin, os.Stdout); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
	t.Fatal("helper command missing")
}

type processFixture struct {
	cmd   *exec.Cmd
	input io.WriteCloser
	ready readyRecord
	done  <-chan error
	state string
}

func startProcess(t *testing.T, root, state string, owner int) *processFixture {
	t.Helper()
	return startProcessWithInitial(t, root, state, owner, "")
}

func startProcessWithInitial(t *testing.T, root, state string, owner int, initial string) *processFixture {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=^TestServeProcessHelper$", "--", "serve", "--root", root, "--state-dir", state, "--owner-pid", strconv.Itoa(owner), "--initial-file", initial)
	command.Env = append(os.Environ(), "MEDIA_VIEWER_TEST_HELPER=1")
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	readyChannel := make(chan readyRecord, 1)
	errors := make(chan error, 1)
	go func() {
		var record readyRecord
		if err := json.NewDecoder(output).Decode(&record); err != nil {
			errors <- err
			return
		}
		readyChannel <- record
	}()
	process := &processFixture{cmd: command, input: input, done: done, state: state}
	t.Cleanup(func() {
		if err := input.Close(); err != nil {
			t.Logf("fixture input already closed: %v", err)
		}
		if err := command.Process.Kill(); err != nil && err != os.ErrProcessDone {
			t.Logf("fixture already stopped: %v", err)
		}
	})
	select {
	case process.ready = <-readyChannel:
	case err := <-errors:
		t.Fatal(err)
	case <-time.After(5 * time.Second):
		t.Fatal("server readiness timed out")
	}
	if process.ready.Type != "ready" || process.ready.Version != 1 || !validIdentity(process.ready.Instance) {
		t.Fatalf("invalid ready: %+v", process.ready)
	}
	return process
}

func stoppedProcess(t *testing.T, process *processFixture) {
	t.Helper()
	select {
	case err := <-process.done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server shutdown timed out")
	}
	if _, err := os.Stat(filepath.Join(process.state, process.ready.Instance+".json")); !os.IsNotExist(err) {
		t.Fatalf("registry cleanup: %v", err)
	}
}

func TestProcessEOFStopAndIndependentSessions(t *testing.T) {
	root := t.TempDir()
	state := t.TempDir()
	first := startProcess(t, root, state, os.Getpid())
	second := startProcess(t, root, state, os.Getpid())
	if first.ready.Port == second.ready.Port {
		t.Fatal("sessions shared port")
	}
	if err := first.input.Close(); err != nil {
		t.Fatal(err)
	}
	stoppedProcess(t, first)
	if status, _ := request(t, second.ready.URL+"api/info"); status != 200 {
		t.Fatal("closing first stopped second")
	}
	if _, err := io.WriteString(second.input, "stop\n"); err != nil {
		t.Fatal(err)
	}
	stoppedProcess(t, second)
	third := startProcess(t, root, state, os.Getpid())
	if err := run([]string{"stop", "--state-dir", state, "--instance", third.ready.Instance}, io.NopCloser(strings.NewReader("")), io.Discard); err != nil {
		t.Fatal(err)
	}
	stoppedProcess(t, third)
}

func TestOwnerSuspensionAndDeath(t *testing.T) {
	owner := exec.Command("sleep", "60")
	if err := owner.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Process.Kill(); err != nil && err != os.ErrProcessDone {
			t.Logf("owner already stopped: %v", err)
		}
	})
	process := startProcess(t, t.TempDir(), t.TempDir(), owner.Process.Pid)
	if err := owner.Process.Signal(syscall.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(1200 * time.Millisecond)
	defer timer.Stop()
	<-timer.C
	if status, _ := request(t, process.ready.URL+"api/info"); status != 200 {
		t.Fatal("suspended living owner lost server")
	}
	if err := owner.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := owner.Wait(); err == nil {
		t.Fatal("killed owner exited successfully")
	}
	stoppedProcess(t, process)
}
