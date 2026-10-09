package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

type fakeNativeRoot struct {
	openErr, closeErr, statErr error
	info                       fs.FileInfo
	seen                       string
}

func (r *fakeNativeRoot) Open(name string) (*os.File, error) {
	r.seen = name
	return os.Stdin, r.openErr
}
func (r *fakeNativeRoot) Stat(name string) (fs.FileInfo, error) {
	r.seen = name
	return r.info, r.statErr
}
func (r *fakeNativeRoot) Close() error { return r.closeErr }
func TestRootedWorkspaceAdapter(t *testing.T) {
	fakeHost(t)
	savedRoot, savedDir := rawOpenRoot, readNativeDirectory
	t.Cleanup(func() { rawOpenRoot = savedRoot; readNativeDirectory = savedDir })
	rawOpenRoot = func(string) (*os.Root, error) { return nil, errBoundary }
	if _, e := openWorkspace("/workspace"); !errors.Is(e, errBoundary) {
		t.Fatal(e)
	}
	rawOpenRoot = func(string) (*os.Root, error) { return nil, nil }
	if _, e := openWorkspace("/workspace"); e != nil {
		t.Fatal(e)
	}
	info, e := fs.Stat(fstest.MapFS{"file": {Data: []byte("safe")}}, "file")
	if e != nil {
		t.Fatal(e)
	}
	native := &fakeNativeRoot{info: info}
	root := &rootedWorkspace{root: native}
	if _, e := root.Open("file"); e != nil || native.seen != "file" {
		t.Fatal(native.seen, e)
	}
	if _, e := root.Stat("file"); e != nil {
		t.Fatal(e)
	}
	if e := root.Close(); e != nil {
		t.Fatal(e)
	}
	native.openErr = errBoundary
	if _, e := root.ReadDir("dir"); e == nil {
		t.Fatal("open directory")
	}
	native.openErr = nil
	readNativeDirectory = func(*os.File, int) ([]os.DirEntry, error) { return nil, nil }
	host.closeFile = func(*os.File) error { return nil }
	if _, e := root.ReadDir("dir"); e != nil {
		t.Fatal(e)
	}
	readNativeDirectory = func(*os.File, int) ([]os.DirEntry, error) { return nil, errBoundary }
	if _, e := root.ReadDir("dir"); e == nil {
		t.Fatal("read directory")
	}
	readNativeDirectory = func(*os.File, int) ([]os.DirEntry, error) { return nil, nil }
	host.closeFile = func(*os.File) error { return errBoundary }
	if _, e := root.ReadDir("dir"); e == nil {
		t.Fatal("close directory")
	}
}
func TestRootedResolutionAndReadFailures(t *testing.T) {
	v := unitViewer(t)
	savedRel := host.rel
	calls := 0
	host.rel = func(a, b string) (string, error) {
		calls++
		if calls == 2 {
			return "", errBoundary
		}
		return savedRel(a, b)
	}
	if _, _, e := v.resolve("README.md"); e == nil {
		t.Fatal("relative failure")
	}
	host.rel = savedRel
	originalStat := host.stat
	count := 0
	host.stat = func(p string) (fs.FileInfo, error) {
		count++
		if count == 2 {
			return nil, errBoundary
		}
		return originalStat(p)
	}
	if _, _, e := v.resolve("README.md"); e == nil {
		t.Fatal("rooted stat")
	}
	host.stat = originalStat
	if _, e := v.readContent("/workspace/README.md"); e != nil {
		t.Fatal(e)
	}
	host.open = func(string) (io.ReadSeekCloser, error) { return nil, errBoundary }
	if _, e := v.readContent("/workspace/README.md"); e == nil {
		t.Fatal("open content")
	}
	host.open = func(string) (io.ReadSeekCloser, error) {
		return &readStream{Reader: bytes.NewReader(nil), errorRead: errBoundary, closeErr: errBoundary}, nil
	}
	if _, e := v.readContent("/workspace/README.md"); e == nil {
		t.Fatal("read/close content")
	}
}
func TestWorkspaceOwnershipFailures(t *testing.T) {
	for name, closing := range map[string]bool{"root open failure": false, "root close failure": true} {
		t.Run(name, func(t *testing.T) {
			prepareServe(t)
			original := host.openRoot
			if closing {
				host.openRoot = func(name string) (workspaceFiles, error) {
					files, e := original(name)
					if e != nil {
						return nil, e
					}
					m, ok := files.(*memoryWorkspace)
					if !ok {
						t.Fatal("unexpected fake")
					}
					m.closeErr = errBoundary
					return m, nil
				}
			} else {
				host.openRoot = func(string) (workspaceFiles, error) { return nil, errBoundary }
			}
			e := serve(context.Background(), "/workspace", "/state", "", 1, io.NopCloser(strings.NewReader("")), io.Discard)
			if !closing && (e == nil) {
				t.Fatal("startup root failure")
			}
		})
	}
}
func TestCanonicalReadRelativeFailures(t *testing.T) {
	v := unitViewer(t)
	host.rel = func(string, string) (string, error) { return "", errBoundary }
	if _, e := v.open("/workspace/README.md"); e == nil {
		t.Fatal("open relative failure")
	}
	if _, e := v.readDirectory("/workspace"); e == nil {
		t.Fatal("directory relative failure")
	}
}
