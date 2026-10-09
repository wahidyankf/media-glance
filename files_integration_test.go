//go:build integration

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestContainment(t *testing.T) {
	root := t.TempDir()
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	root = canonical
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "plan.md"), []byte("plan"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "plan.md"), filepath.Join(root, "inside")); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"plan.md", "inside", ""} {
		if _, _, err := resolvePath(root, name); err != nil {
			t.Errorf("allowed %q: %v", name, err)
		}
	}
	for _, name := range []string{"../secret", "escape/secret", outside, "a\x00b", "nested/../../plan.md"} {
		if _, _, err := resolvePath(root, name); err == nil {
			t.Errorf("allowed forbidden %q", name)
		}
	}
}
