package main

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	searchMaxEntries = 50_000
	searchMaxDepth   = 64
	searchMaxResults = 50
	searchBatchSize  = 256
	searchMaxRunes   = 256
	searchTimeLimit  = 2 * time.Second
)

type searchEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type searchLimits struct {
	entries int
	depth   int
	results int
	batch   int
	time    time.Duration
}

var defaultSearchLimits = searchLimits{
	entries: searchMaxEntries,
	depth:   searchMaxDepth,
	results: searchMaxResults,
	batch:   searchBatchSize,
	time:    searchTimeLimit,
}

type searchDirectory struct {
	canonical string
	display   string
	depth     int
}

type rankedSearchEntry struct {
	entry searchEntry
	rank  int
	gap   int
	first int
}

func (v *viewer) search(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if utf8.RuneCountInString(query) > searchMaxRunes {
		http.Error(w, "query is too long", http.StatusBadRequest)
		return
	}
	entries := []searchEntry{}
	incomplete := false
	if query != "" {
		entries, incomplete = v.searchWorkspace(r.Context(), query, defaultSearchLimits, time.Now)
	}
	writeJSON(w, struct {
		Entries    []searchEntry `json:"entries"`
		Incomplete bool          `json:"incomplete"`
	}{entries, incomplete})
}

func (v *viewer) searchWorkspace(ctx context.Context, query string, limits searchLimits, now func() time.Time) ([]searchEntry, bool) {
	results := []rankedSearchEntry{}
	if query == "" {
		return []searchEntry{}, false
	}
	if limits.entries <= 0 || limits.depth < 0 || limits.results <= 0 || limits.batch <= 0 || limits.time <= 0 {
		return []searchEntry{}, true
	}
	started := now()
	queryFolded := foldSearchText(query)
	stack := []searchDirectory{{canonical: v.root, depth: 0}}
	visited := map[string]bool{filepath.Clean(v.root): true}
	visitedEntries := 0
	incomplete := false
	stop := false

	for len(stack) > 0 && !stop {
		if ctx.Err() != nil || now().Sub(started) >= limits.time {
			incomplete = true
			break
		}
		last := len(stack) - 1
		directory := stack[last]
		stack = stack[:last]
		stream, err := v.openDirectory(directory.canonical)
		if err != nil {
			incomplete = true
			continue
		}

		for {
			if ctx.Err() != nil || now().Sub(started) >= limits.time {
				incomplete = true
				stop = true
				break
			}
			remaining := limits.entries - visitedEntries
			batchSize := min(limits.batch, remaining)
			entries, readErr := stream.ReadDir(batchSize)
			if readErr != nil && readErr != io.EOF {
				incomplete = true
			}
			for _, entry := range entries {
				if ctx.Err() != nil || now().Sub(started) >= limits.time {
					incomplete = true
					stop = true
					break
				}
				visitedEntries++
				if excluded(entry.Name()) {
					continue
				}
				relative := filepath.ToSlash(filepath.Join(directory.display, entry.Name()))
				canonical, info, resolveErr := v.resolve(relative)
				if resolveErr != nil {
					continue
				}
				if info.IsDir() {
					if directory.depth >= limits.depth {
						incomplete = true
						continue
					}
					canonical = filepath.Clean(canonical)
					if visited[canonical] {
						continue
					}
					visited[canonical] = true
					stack = append(stack, searchDirectory{
						canonical: canonical,
						display:   relative,
						depth:     directory.depth + 1,
					})
					continue
				}
				if !info.Mode().IsRegular() {
					continue
				}
				if ranked, ok := rankSearch(entry.Name(), relative, queryFolded); ok {
					var dropped bool
					results, dropped = retainSearchResult(results, ranked, limits.results)
					incomplete = incomplete || dropped
				}
			}
			if readErr != nil {
				break
			}
			if len(entries) == 0 {
				incomplete = true
				break
			}
			if visitedEntries >= limits.entries {
				remaining, probeErr := stream.ReadDir(1)
				if len(remaining) > 0 || (probeErr != nil && probeErr != io.EOF) || len(stack) > 0 {
					incomplete = true
				}
				stop = true
				break
			}
		}
		if err := stream.Close(); err != nil {
			incomplete = true
		}
	}

	entries := make([]searchEntry, len(results))
	for i, result := range results {
		entries[i] = result.entry
	}
	return entries, incomplete
}

func rankSearch(name, path, query string) (rankedSearchEntry, bool) {
	base := foldSearchText(name)
	pathFolded := foldSearchText(path)
	var rank int
	gap, first := 0, 0
	switch {
	case base == query:
		rank = 0
	case strings.HasPrefix(base, query):
		rank = 1
	case strings.Contains(base, query):
		rank = 2
		first = runePosition(base, query)
	case strings.Contains(pathFolded, query):
		rank = 3
		first = runePosition(pathFolded, query)
	default:
		var matched bool
		gap, first, matched = subsequenceScore([]rune(pathFolded), []rune(query))
		if !matched {
			return rankedSearchEntry{}, false
		}
		rank = 4
	}
	return rankedSearchEntry{entry: searchEntry{Name: name, Path: path}, rank: rank, gap: gap, first: first}, true
}

func retainSearchResult(results []rankedSearchEntry, candidate rankedSearchEntry, limit int) ([]rankedSearchEntry, bool) {
	index := sort.Search(len(results), func(index int) bool { return searchResultLess(candidate, results[index]) })
	if len(results) < limit {
		results = append(results, rankedSearchEntry{})
		copy(results[index+1:], results[index:])
		results[index] = candidate
		return results, false
	}
	if index >= limit {
		return results, true
	}
	results = append(results, rankedSearchEntry{})
	copy(results[index+1:], results[index:limit])
	results[index] = candidate
	return results[:limit], true
}

func searchResultLess(a, b rankedSearchEntry) bool {
	if a.rank != b.rank {
		return a.rank < b.rank
	}
	if a.gap != b.gap {
		return a.gap < b.gap
	}
	if a.first != b.first {
		return a.first < b.first
	}
	if len(a.entry.Path) != len(b.entry.Path) {
		return len(a.entry.Path) < len(b.entry.Path)
	}
	return a.entry.Path < b.entry.Path
}

func runePosition(haystack, needle string) int {
	index := strings.Index(haystack, needle)
	if index < 0 {
		return 0
	}
	return utf8.RuneCountInString(haystack[:index])
}

func foldSearchText(value string) string {
	return strings.Map(unicode.ToLower, value)
}

func subsequenceScore(value, query []rune) (int, int, bool) {
	if len(query) == 0 {
		return 0, 0, true
	}
	queryIndex, first, previous, gap := 0, -1, -1, 0
	for index, character := range value {
		if character != query[queryIndex] {
			continue
		}
		if first < 0 {
			first = index
		} else {
			gap += index - previous - 1
		}
		previous = index
		queryIndex++
		if queryIndex == len(query) {
			return gap, first, true
		}
	}
	return 0, 0, false
}
