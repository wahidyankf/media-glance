package main

import (
	"errors"
	"io"
	"io/fs"
	"os"
)

// workspaceFiles is the capability held for the server's lifetime. Reads stay
// beneath its opened directory even when a symlink changes after validation.
type workspaceFiles interface {
	Open(string) (io.ReadSeekCloser, error)
	Stat(string) (fs.FileInfo, error)
	ReadDir(string) ([]os.DirEntry, error)
	Close() error
}
type nativeRoot interface {
	Open(string) (*os.File, error)
	Stat(string) (fs.FileInfo, error)
	Close() error
}
type rootedWorkspace struct{ root nativeRoot }

func (r *rootedWorkspace) Open(name string) (io.ReadSeekCloser, error) { return r.root.Open(name) }
func (r *rootedWorkspace) Stat(name string) (fs.FileInfo, error)       { return r.root.Stat(name) }
func (r *rootedWorkspace) Close() error                                { return r.root.Close() }
func (r *rootedWorkspace) ReadDir(name string) ([]os.DirEntry, error) {
	directory, e := r.root.Open(name)
	if e != nil {
		return nil, e
	}
	entries, readErr := readNativeDirectory(directory, -1)
	closeErr := host.closeFile(directory)
	return entries, errors.Join(readErr, closeErr)
}

var rawOpenRoot = os.OpenRoot
var readNativeDirectory = (*os.File).ReadDir

func openWorkspace(name string) (workspaceFiles, error) {
	root, e := rawOpenRoot(name)
	if e != nil {
		return nil, e
	}
	return &rootedWorkspace{root: root}, nil
}
func (v *viewer) resolve(name string) (string, fs.FileInfo, error) {
	path, _, e := resolvePath(v.root, name)
	if e != nil {
		return "", nil, e
	}
	relative, e := host.rel(v.root, path)
	if e != nil {
		return "", nil, e
	}
	info, e := v.files.Stat(relative)
	if e != nil {
		return "", nil, e
	}
	return path, info, nil
}
func (v *viewer) open(path string) (io.ReadSeekCloser, error) {
	relative, e := host.rel(v.root, path)
	if e != nil {
		return nil, e
	}
	return v.files.Open(relative)
}
func (v *viewer) readDirectory(path string) ([]os.DirEntry, error) {
	relative, e := host.rel(v.root, path)
	if e != nil {
		return nil, e
	}
	return v.files.ReadDir(relative)
}
func (v *viewer) readContent(path string) ([]byte, error) {
	file, e := v.open(path)
	if e != nil {
		return nil, e
	}
	content, readErr := io.ReadAll(io.LimitReader(file, previewLimit))
	closeErr := file.Close()
	return content, errors.Join(readErr, closeErr)
}
