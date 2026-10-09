//go:build integration

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRegistryListBetweenStageAndPublish(t *testing.T) {
	v, _ := fixture(t)
	state := t.TempDir()
	temporary, err := stageRecord(state, v.record)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Remove(temporary); err != nil && !os.IsNotExist(err) {
			t.Error(err)
		}
	})
	// Interleave listing while the complete, closed file is not yet published.
	servers, err := listServers(context.Background(), state)
	if err != nil {
		t.Fatal(err)
	}
	if len(servers) != 0 {
		t.Fatalf("staged registry was visible before publication: %v", servers)
	}
	info, err := os.Stat(temporary)
	if err != nil {
		t.Fatalf("listing pruned staged record: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("staged mode=%v", info.Mode())
	}
	if err := publishRecord(state, v.record, temporary); err != nil {
		t.Fatal(err)
	}
	servers, err = listServers(context.Background(), state)
	if err != nil || len(servers) != 1 || servers[0].Instance != v.record.Instance {
		t.Fatalf("published list=%v err=%v", servers, err)
	}
	if _, err := os.Stat(filepath.Join(state, v.record.Instance+".json")); err != nil {
		t.Fatal(err)
	}
	stopped := make(chan struct{})
	v.stop = func() { close(stopped) }
	if err := stopServer(context.Background(), state, v.record.Instance); err != nil {
		t.Fatal(err)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("authenticated published stop was not delivered")
	}
}
