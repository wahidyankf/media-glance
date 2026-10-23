package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRootedWorkspaceOpensDirectoriesBeneathRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "example.py"), []byte("print('ok')"), 0600); err != nil {
		t.Fatal(err)
	}
	workspace, err := openWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := workspace.Close(); err != nil {
			t.Error(err)
		}
	}()
	directory, err := workspace.OpenDir(".")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := directory.ReadDir(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "example.py" {
		t.Fatalf("directory entries=%v", entries)
	}
	if err := directory.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.OpenDir("missing"); err == nil {
		t.Fatal("missing directory opened")
	}
}

func TestViewerOpenDirectoryUsesRootedRelativePath(t *testing.T) {
	v := unitViewer(t)
	directory, err := v.openDirectory(v.root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := directory.ReadDir(1); err != nil {
		t.Fatal(err)
	}
	if err := directory.Close(); err != nil {
		t.Fatal(err)
	}
	host.rel = func(string, string) (string, error) { return "", errBoundary }
	if _, err := v.openDirectory(v.root); err == nil {
		t.Fatal("relative path failure was ignored")
	}
}
