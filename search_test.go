package main

import (
	"context"
	"fmt"
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestRankSearchOrdersMatchKindsAndFoldsCase(t *testing.T) {
	cases := []struct {
		name, path, query string
		wantRank, first   int
	}{
		{"Foo.go", "src/Foo.go", "foo.go", 0, 0},
		{"Foo.go.bak", "src/Foo.go.bak", "foo.go", 1, 0},
		{"xfoo.go", "src/xfoo.go", "foo.go", 2, 1},
		{"other.txt", "foo.go/other.txt", "foo.go", 3, 0},
		{"f_o_o.txt", "src/f_o_o.txt", "foo", 4, 4},
		{"longfoo.txt", "src/longfoo.txt", "foo", 2, 4},
		{"other.txt", "x/dir/foo/other.txt", "foo", 3, 6},
	}
	for _, test := range cases {
		t.Run(test.path, func(t *testing.T) {
			result, ok := rankSearch(test.name, test.path, foldSearchText(test.query))
			if !ok || result.rank != test.wantRank || result.first != test.first {
				t.Fatalf("rank=%d first=%d matched=%t, want rank %d first %d", result.rank, result.first, ok, test.wantRank, test.first)
			}
		})
	}
	gap, first, ok := subsequenceScore([]rune("abxcde"), []rune("ace"))
	if !ok || gap != 3 || first != 0 {
		t.Fatalf("subsequence score=(%d,%d,%t)", gap, first, ok)
	}
}

func TestSearchCandidateRetentionStaysAtLimitAndKeepsBest(t *testing.T) {
	results := []rankedSearchEntry{}
	truncated := false
	for index := 99; index >= 0; index-- {
		candidate := rankedSearchEntry{entry: searchEntry{Name: fmt.Sprintf("file-%03d.go", index), Path: fmt.Sprintf("file-%03d.go", index)}, rank: 0}
		results, truncated = retainSearchResult(results, candidate, searchMaxResults)
		if len(results) > searchMaxResults {
			t.Fatalf("retained %d candidates", len(results))
		}
	}
	if !truncated || len(results) != searchMaxResults {
		t.Fatalf("retained %d candidates, truncated=%t", len(results), truncated)
	}
	if results[0].entry.Path != "file-000.go" || results[len(results)-1].entry.Path != "file-049.go" {
		t.Fatalf("retained unexpected range %q..%q", results[0].entry.Path, results[len(results)-1].entry.Path)
	}
}

func TestSearchResultComparisonUsesEveryScoreField(t *testing.T) {
	cases := []struct {
		name string
		a, b rankedSearchEntry
		less bool
	}{
		{"rank", rankedSearchEntry{rank: 0}, rankedSearchEntry{rank: 1}, true},
		{"gap", rankedSearchEntry{rank: 1, gap: 1}, rankedSearchEntry{rank: 1, gap: 2}, true},
		{"first", rankedSearchEntry{rank: 1, gap: 2, first: 1}, rankedSearchEntry{rank: 1, gap: 2, first: 2}, true},
		{"path length", rankedSearchEntry{entry: searchEntry{Path: "a"}}, rankedSearchEntry{entry: searchEntry{Path: "long"}}, true},
		{"lexical", rankedSearchEntry{entry: searchEntry{Path: "a"}}, rankedSearchEntry{entry: searchEntry{Path: "b"}}, true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := searchResultLess(test.a, test.b); got != test.less {
				t.Fatalf("less=%t, want %t", got, test.less)
			}
		})
	}
}

func TestSearchRunePositionAndEmptySubsequence(t *testing.T) {
	if got := runePosition("éclair", "air"); got != 3 {
		t.Fatalf("rune position=%d, want 3", got)
	}
	if got := runePosition("abc", "z"); got != 0 {
		t.Fatalf("missing rune position=%d, want 0", got)
	}
	if gap, first, matched := subsequenceScore([]rune("abc"), nil); gap != 0 || first != 0 || !matched {
		t.Fatalf("empty query score=(%d,%d,%t)", gap, first, matched)
	}
}

func TestSearchReturnsTopFiftyAndMarksTruncation(t *testing.T) {
	v := unitViewer(t)
	workspace, ok := v.files.(*memoryWorkspace)
	if !ok {
		t.Fatal("viewer workspace has unexpected type")
	}
	files := workspace.files
	files["many"] = &fstest.MapFile{Mode: fs.ModeDir | 0700}
	for index := 0; index < 51; index++ {
		files[fmt.Sprintf("many/needle-%02d.go", index)] = &fstest.MapFile{Data: []byte("package many\n")}
	}
	entries, incomplete := v.searchWorkspace(context.Background(), "needle", defaultSearchLimits, time.Now)
	if len(entries) != searchMaxResults || !incomplete {
		t.Fatalf("entries=%d incomplete=%t", len(entries), incomplete)
	}
	if entries[0].Path != "many/needle-00.go" || entries[len(entries)-1].Path != "many/needle-49.go" {
		t.Fatalf("unexpected retained results: first=%q last=%q", entries[0].Path, entries[len(entries)-1].Path)
	}
}

func TestSearchMarksEntryAndDepthLimitsIncomplete(t *testing.T) {
	v := unitViewer(t)
	limits := defaultSearchLimits
	limits.entries = 2
	limits.batch = 1
	entries, incomplete := v.searchWorkspace(context.Background(), "README", limits, time.Now)
	if !incomplete || len(entries) > searchMaxResults {
		t.Fatalf("entry limit entries=%v incomplete=%t", entries, incomplete)
	}
	v, _ = smallSearchViewer(t)
	limits = defaultSearchLimits
	limits.entries = 2
	limits.batch = 1
	entries, incomplete = v.searchWorkspace(context.Background(), "a", limits, time.Now)
	if incomplete || len(entries) != 1 || entries[0].Path != "a.txt" {
		t.Fatalf("exact entry limit entries=%v incomplete=%t", entries, incomplete)
	}
	v = unitViewer(t)
	limits = defaultSearchLimits
	limits.depth = 0
	entries, incomplete = v.searchWorkspace(context.Background(), "README", limits, time.Now)
	if !incomplete || len(entries) != 1 || entries[0].Path != "README.md" {
		t.Fatalf("depth limit entries=%v incomplete=%t", entries, incomplete)
	}
}

func TestSearchRejectsInvalidLimitsAndMarksDirectoryFailuresIncomplete(t *testing.T) {
	v := unitViewer(t)
	empty, incomplete := v.searchWorkspace(context.Background(), "", defaultSearchLimits, time.Now)
	if len(empty) != 0 || incomplete {
		t.Fatalf("empty query entries=%v incomplete=%t", empty, incomplete)
	}
	entries, incomplete := v.searchWorkspace(context.Background(), "README", searchLimits{}, time.Now)
	if len(entries) != 0 || !incomplete {
		t.Fatalf("invalid limits entries=%v incomplete=%t", entries, incomplete)
	}

	workspace, ok := v.files.(*memoryWorkspace)
	if !ok {
		t.Fatal("viewer workspace has unexpected type")
	}
	workspace.openDir = func(string) (fs.ReadDirFile, error) { return nil, errBoundary }
	entries, incomplete = v.searchWorkspace(context.Background(), "README", defaultSearchLimits, time.Now)
	if len(entries) != 0 || !incomplete {
		t.Fatalf("directory open failure entries=%v incomplete=%t", entries, incomplete)
	}
}

func TestSearchMarksAlreadyCancelledContextIncomplete(t *testing.T) {
	v := unitViewer(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	entries, incomplete := v.searchWorkspace(ctx, "README", defaultSearchLimits, time.Now)
	if len(entries) != 0 || !incomplete {
		t.Fatalf("cancelled query entries=%v incomplete=%t", entries, incomplete)
	}
}

func TestSearchMarksCloseAndEmptyBatchFailuresIncomplete(t *testing.T) {
	for _, test := range []string{"close failure", "empty batch"} {
		t.Run(test, func(t *testing.T) {
			v := unitViewer(t)
			workspace, ok := v.files.(*memoryWorkspace)
			if !ok {
				t.Fatal("viewer workspace has unexpected type")
			}
			info, err := host.stat("/workspace")
			if err != nil {
				t.Fatal(err)
			}
			workspace.openDir = func(string) (fs.ReadDirFile, error) {
				if test == "empty batch" {
					return &emptyBatchDir{info: info}, nil
				}
				return &memoryReadDir{info: info, onClose: func() error { return errBoundary }}, nil
			}
			entries, incomplete := v.searchWorkspace(context.Background(), "README", defaultSearchLimits, time.Now)
			if !incomplete || len(entries) != 0 {
				t.Fatalf("entries=%v incomplete=%t", entries, incomplete)
			}
		})
	}
}

type emptyBatchDir struct{ info fs.FileInfo }

func (d *emptyBatchDir) ReadDir(int) ([]os.DirEntry, error) { return nil, nil }
func (d *emptyBatchDir) Read([]byte) (int, error)           { return 0, fs.ErrInvalid }
func (d *emptyBatchDir) Stat() (fs.FileInfo, error)         { return d.info, nil }
func (d *emptyBatchDir) Close() error                       { return nil }

func smallSearchViewer(t *testing.T) (*viewer, fstest.MapFS) {
	t.Helper()
	v := unitViewer(t)
	files := fstest.MapFS{
		".":     {Mode: fs.ModeDir | 0700},
		"a.txt": {Data: []byte("a")},
		"b.txt": {Data: []byte("b")},
	}
	key := func(name string) string {
		name = strings.TrimPrefix(filepath.Clean(name), "/workspace")
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			return "."
		}
		return name
	}
	host.eval = func(name string) (string, error) {
		if _, err := fs.Stat(files, key(name)); err != nil {
			return "", err
		}
		return filepath.Clean(name), nil
	}
	host.stat = func(name string) (fs.FileInfo, error) { return fs.Stat(files, key(name)) }
	host.readDir = func(name string) ([]os.DirEntry, error) { return fs.ReadDir(files, key(name)) }
	workspace, ok := v.files.(*memoryWorkspace)
	if !ok {
		t.Fatal("viewer workspace has unexpected type")
	}
	workspace.files = files
	workspace.key = key
	return v, files
}

func TestSearchHandlesCancellationTimeAndReadErrorsAndClosesStreams(t *testing.T) {
	for _, test := range []string{"cancel", "deadline", "read failure"} {
		t.Run(test, func(t *testing.T) {
			v := unitViewer(t)
			workspace, ok := v.files.(*memoryWorkspace)
			if !ok {
				t.Fatal("viewer workspace has unexpected type")
			}
			entries, err := host.readDir("/workspace")
			if err != nil {
				t.Fatal(err)
			}
			info, err := host.stat("/workspace")
			if err != nil {
				t.Fatal(err)
			}
			closed := false
			var cancel context.CancelFunc
			ctx := context.Background()
			if test == "cancel" {
				ctx, cancel = context.WithCancel(ctx)
				defer cancel()
			}
			readErr := error(nil)
			if test == "read failure" {
				readErr = errBoundary
			}
			workspace.openDir = func(string) (fs.ReadDirFile, error) {
				directory := &memoryReadDir{entries: entries, info: info, readErr: readErr}
				directory.onClose = func() error { closed = true; return nil }
				if cancel != nil {
					directory.onRead = cancel
				}
				return directory, nil
			}
			now := time.Now
			if test == "deadline" {
				base := time.Now()
				calls := 0
				now = func() time.Time {
					calls++
					if calls >= 3 {
						return base.Add(searchTimeLimit)
					}
					return base
				}
			}
			results, incomplete := v.searchWorkspace(ctx, "README", defaultSearchLimits, now)
			if !incomplete || !closed {
				t.Fatalf("results=%v incomplete=%t streamClosed=%t", results, incomplete, closed)
			}
		})
	}
}

func TestSearchExcludesSidebarDirectoriesAndUnicodeQueryLimitUsesRunes(t *testing.T) {
	v := unitViewer(t)
	workspace, ok := v.files.(*memoryWorkspace)
	if !ok {
		t.Fatal("viewer workspace has unexpected type")
	}
	files := workspace.files
	files[".git/secret.go"] = &fstest.MapFile{Data: []byte("secret")}
	files["node_modules/secret.go"] = &fstest.MapFile{Data: []byte("secret")}
	entries, incomplete := v.searchWorkspace(context.Background(), "secret", defaultSearchLimits, time.Now)
	if len(entries) != 0 || incomplete {
		t.Fatalf("excluded results=%v incomplete=%t", entries, incomplete)
	}
	request := unitRequest(v, "GET", "api/search?q="+strings.Repeat("é", 256))
	response := httptest.NewRecorder()
	v.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("256 rune query returned %d", response.Code)
	}
}

func TestSearchTraversalUsesBoundedReadBatches(t *testing.T) {
	v := unitViewer(t)
	workspace, ok := v.files.(*memoryWorkspace)
	if !ok {
		t.Fatal("viewer workspace has unexpected type")
	}
	entries, err := host.readDir("/workspace")
	if err != nil {
		t.Fatal(err)
	}
	info, err := host.stat("/workspace")
	if err != nil {
		t.Fatal(err)
	}
	readSizes := []int{}
	workspace.openDir = func(string) (fs.ReadDirFile, error) {
		return &readSizeTrackingDir{memoryReadDir: &memoryReadDir{entries: entries, info: info}, sizes: &readSizes}, nil
	}
	_, _ = v.searchWorkspace(context.Background(), "README", defaultSearchLimits, time.Now)
	if len(readSizes) == 0 {
		t.Fatal("directory was not read")
	}
	for _, size := range readSizes {
		if size <= 0 || size > searchBatchSize {
			t.Fatalf("unbounded directory read size %d", size)
		}
	}
}

type readSizeTrackingDir struct {
	*memoryReadDir
	sizes *[]int
}

func (d *readSizeTrackingDir) ReadDir(n int) ([]os.DirEntry, error) {
	*d.sizes = append(*d.sizes, n)
	return d.memoryReadDir.ReadDir(n)
}
