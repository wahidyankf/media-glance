//go:build integration

package main

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalFileRetargetBeforeOpenStaysWithinRoot(t *testing.T) {
	v, _ := fixture(t)
	name := filepath.Join(v.root, "file.md")
	if e := os.WriteFile(name, []byte("safe workspace content"), 0600); e != nil {
		t.Fatal(e)
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if e := os.WriteFile(outside, []byte("outside secret fixture"), 0600); e != nil {
		t.Fatal(e)
	}
	canonical, _, e := v.resolve("file.md")
	if e != nil {
		t.Fatal(e)
	}
	if e := os.Rename(name, name+".old"); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(outside, name); e != nil {
		t.Fatal(e)
	}
	file, e := v.open(canonical)
	if e == nil {
		data, readErr := io.ReadAll(file)
		closeErr := file.Close()
		t.Fatalf("escaped rooted open: data=%q read=%v close=%v", data, readErr, closeErr)
	}
}
func TestCanonicalDirectoryRetargetBeforeReadStaysWithinRoot(t *testing.T) {
	v, _ := fixture(t)
	directory := filepath.Join(v.root, "docs")
	if e := os.Mkdir(directory, 0700); e != nil {
		t.Fatal(e)
	}
	outside := t.TempDir()
	if e := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0600); e != nil {
		t.Fatal(e)
	}
	canonical, _, e := v.resolve("docs")
	if e != nil {
		t.Fatal(e)
	}
	if e := os.Rename(directory, directory+".old"); e != nil {
		t.Fatal(e)
	}
	if e := os.Symlink(outside, directory); e != nil {
		t.Fatal(e)
	}
	if entries, e := v.readDirectory(canonical); e == nil {
		t.Fatalf("escaped rooted directory: %v", entries)
	}
}
