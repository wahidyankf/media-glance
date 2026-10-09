package main

import (
	"fmt"
	"github.com/wahidyankf/media-glance/internal/media"
	"io/fs"
	"path/filepath"
	"strings"
)

func resolvePath(root, name string) (string, fs.FileInfo, error) {
	if strings.ContainsRune(name, 0) || filepath.IsAbs(name) {
		return "", nil, fmt.Errorf("invalid workspace path")
	}
	for _, part := range strings.Split(filepath.ToSlash(name), "/") {
		if part == ".." {
			return "", nil, fmt.Errorf("parent traversal is forbidden")
		}
	}
	path, err := host.eval(filepath.Join(root, name))
	if err != nil {
		return "", nil, err
	}
	rel, err := host.rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", nil, fmt.Errorf("path escapes workspace")
	}
	info, err := host.stat(path)
	if err != nil {
		return "", nil, err
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return "", nil, fmt.Errorf("special files cannot be viewed")
	}
	return path, info, nil
}

const previewLimit = media.PreviewLimit
