package media

import (
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// PreviewLimit bounds text and Markdown contents loaded into memory.
const PreviewLimit = 2 * 1024 * 1024

// PreviewKind selects a safe browser presentation for an ordinary file.
func PreviewKind(name string, content []byte, size int64) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp":
		return "image"
	case ".pdf":
		return "pdf"
	case ".mp3", ".wav", ".ogg", ".m4a", ".flac":
		return "audio"
	case ".mp4", ".webm", ".mov", ".m4v":
		return "video"
	}
	if size > PreviewLimit || strings.ContainsRune(string(content), 0) || !utf8.Valid(content) {
		return "download"
	}
	if ext == ".md" || ext == ".markdown" {
		return "markdown"
	}
	return "text"
}
