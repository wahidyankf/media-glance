//go:build integration

package main

import (
	"bufio"
	"context"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestInRootSymlinkTargetsStayLive(t *testing.T) {
	v, address := fixture(t)
	for _, dir := range []string{"docs", "source", "links", "assets"} {
		if err := os.Mkdir(filepath.Join(v.root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	document := filepath.Join(v.root, "source/plan.md")
	content := []byte("# Plan\n\n![Image](../links/image.svg)")
	if err := os.WriteFile(document, content, 0600); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(v.root, "assets/live.svg")
	if err := os.WriteFile(image, []byte("<svg/>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../source/plan.md", filepath.Join(v.root, "docs/current.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../assets/live.svg", filepath.Join(v.root, "links/image.svg")); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	query := url.Values{"dirs": {`["","docs"]`}, "path": {"docs/current.md"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"api/events?"+query.Encode(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			t.Error(err)
		}
	}()
	reader := bufio.NewScanner(response.Body)
	for index, change := range []func() error{
		func() error { return os.WriteFile(document, append(content, []byte("\nUpdated")...), 0600) },
		func() error { return os.WriteFile(image, []byte("<svg>updated</svg>"), 0600) },
		func() error { return os.Rename(document, filepath.Join(v.root, "source/previous.md")) },
		func() error { return os.WriteFile(document, content, 0600) },
		func() error { return os.WriteFile(document, append(content, []byte("\nNext write")...), 0600) },
	} {
		if err := change(); err != nil {
			t.Fatal(err)
		}
		received := false
		for reader.Scan() {
			if reader.Text() == "event: change" {
				received = true
				break
			}
		}
		if !received {
			t.Fatalf("symlink change %d not observed: %v", index, reader.Err())
		}
	}
}
