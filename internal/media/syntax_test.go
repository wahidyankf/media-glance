package media

import (
	"errors"
	"html"
	"io"
	"regexp"
	"strings"
	"testing"

	"github.com/alecthomas/chroma/v2"
)

var errSyntaxCSSWrite = errors.New("syntax css writer failed")

func TestHighlightFileRecognizesCommonLanguagesAndPreservesCRLF(t *testing.T) {
	for name, source := range map[string]string{
		"example.py": "def greet(name):\n\treturn name\n",
		"EXAMPLE.PY": "def greet(name):\n\treturn name\n",
		"example.go": "package example\r\nfunc main() {}\r\n",
		"EXAMPLE.GO": "package example\nfunc main() {}\n",
		"example.js": "const value = 1;\n",
		"Dockerfile": "FROM alpine:3.20\n",
	} {
		t.Run(name, func(t *testing.T) {
			got, ok := HighlightFile(name, []byte(source))
			if !ok || !strings.Contains(got, `<span class="`) {
				t.Fatalf("source was not highlighted: %s", got)
			}
			code := regexp.MustCompile(`(?s)<code\b[^>]*>(.*?)</code>`).FindStringSubmatch(got)
			if len(code) != 2 {
				t.Fatalf("code element missing: %s", got)
			}
			visible := regexp.MustCompile(`<[^>]*>`).ReplaceAllString(code[1], "")
			if actual := html.UnescapeString(visible); actual != source {
				t.Fatalf("source changed: got %q, want %q", actual, source)
			}
		})
	}
}

func TestHighlightFileEscapesCRLFForBrowserTextPreservation(t *testing.T) {
	source := []byte("package example\r\nfunc main() {}\r\n")
	highlighted, ok := HighlightFile("example.go", source)
	if !ok {
		t.Fatal("Go source with a final CRLF was not highlighted")
	}
	if !strings.Contains(highlighted, "&#13;") {
		t.Fatalf("highlighted HTML contains literal carriage returns: %q", highlighted)
	}
	code := regexp.MustCompile(`(?s)<code\b[^>]*>(.*?)</code>`).FindStringSubmatch(highlighted)
	if len(code) != 2 {
		t.Fatalf("code element missing: %s", highlighted)
	}
	visible := regexp.MustCompile(`<[^>]*>`).ReplaceAllString(code[1], "")
	if actual := html.UnescapeString(visible); actual != string(source) {
		t.Fatalf("decoded highlighted text=%q, want exact source %q", actual, source)
	}
}

func TestHighlightFileFallsBackForUnknownAndOversizedFiles(t *testing.T) {
	if got, ok := HighlightFile("example.unknown-language", []byte("<plain>\n")); ok || got != "" {
		t.Fatalf("unknown language highlight=%q ok=%t", got, ok)
	}
	source := []byte(strings.Repeat("x", SyntaxHighlightLimit+1))
	if got, ok := HighlightFile("large.py", source); ok || got != "" {
		t.Fatalf("oversized language highlight length=%d ok=%t", len(got), ok)
	}
	if got, ok := HighlightFile("invalid.py", []byte{0xff}); ok || got != "" {
		t.Fatalf("invalid UTF-8 highlight=%q ok=%t", got, ok)
	}
}

func TestHighlightHTMLFallsBackWhenLexerPipelineErrorsOrChangesText(t *testing.T) {
	source := []byte("print('exact')")
	if got, ok := highlightHTMLWith("example.py", "", source,
		func(chroma.Lexer, *chroma.TokeniseOptions, string) ([]chroma.Token, error) {
			return nil, errSyntaxCSSWrite
		}, syntaxFormatter.Format); ok || got != "" {
		t.Fatalf("tokenizer error highlight=%q ok=%t", got, ok)
	}
	if got, ok := highlightHTMLWith("example.py", "", source,
		func(chroma.Lexer, *chroma.TokeniseOptions, string) ([]chroma.Token, error) {
			return []chroma.Token{{Type: chroma.Text, Value: "modified"}}, nil
		}, syntaxFormatter.Format); ok || got != "" {
		t.Fatalf("modified source highlight=%q ok=%t", got, ok)
	}
	if got, ok := highlightHTMLWith("example.py", "", source, chroma.Tokenise,
		func(io.Writer, *chroma.Style, chroma.Iterator) error { return errSyntaxCSSWrite }); ok || got != "" {
		t.Fatalf("formatter error highlight=%q ok=%t", got, ok)
	}
}

func TestSyntaxCSSContainsBothGithubModes(t *testing.T) {
	css, err := SyntaxCSS()
	if err != nil {
		t.Fatal(err)
	}
	for _, selector := range []string{`:root[data-theme="light"] .chroma`, `:root[data-theme="dark"] .chroma`} {
		if !strings.Contains(string(css), selector) {
			t.Errorf("missing theme selector %q", selector)
		}
	}
}

func TestSyntaxCSSWriteFailureIsReturned(t *testing.T) {
	_, err := syntaxCSS(func(io.Writer, *chroma.Style) error { return errSyntaxCSSWrite })
	if !errors.Is(err, errSyntaxCSSWrite) {
		t.Fatalf("stylesheet write error=%v", err)
	}
}
