package media

import (
	"bytes"
	"fmt"
	"html"
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/alecthomas/chroma/v2"
	chromaHTML "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
)

const SyntaxHighlightLimit = 128 * 1024

var syntaxFormatter = chromaHTML.New(
	chromaHTML.WithClasses(true),
	chromaHTML.WithModeClasses(true),
	chromaHTML.PreventSurroundingPre(true),
	chromaHTML.WithCSSComments(false),
)

// HighlightFile returns class-based HTML when Chroma recognizes the filename.
func HighlightFile(name string, source []byte) (string, bool) {
	if len(source) > SyntaxHighlightLimit {
		return "", false
	}
	return highlightHTML(name, "", source)
}

func highlightHTML(name, language string, source []byte) (string, bool) {
	return highlightHTMLWith(name, language, source, chroma.Tokenise, syntaxFormatter.Format)
}

func highlightHTMLWith(
	name, language string,
	source []byte,
	tokenise func(chroma.Lexer, *chroma.TokeniseOptions, string) ([]chroma.Token, error),
	format func(io.Writer, *chroma.Style, chroma.Iterator) error,
) (string, bool) {
	if len(source) > SyntaxHighlightLimit || !utf8.Valid(source) {
		return "", false
	}
	var lexer chroma.Lexer
	if strings.TrimSpace(language) != "" {
		lexer = lexers.Get(strings.TrimSpace(language))
	} else {
		if extension := filepath.Ext(name); extension != "" {
			name = strings.TrimSuffix(name, extension) + strings.ToLower(extension)
		}
		lexer = lexers.Match(name)
	}
	if lexer == nil || lexer.Config().Name == "fallback" {
		return "", false
	}
	tokens, err := tokenise(lexer, &chroma.TokeniseOptions{State: "root", EnsureLF: false}, string(source))
	if err != nil {
		return "", false
	}
	var original strings.Builder
	for _, token := range tokens {
		original.WriteString(token.Value)
	}
	if original.String() != string(source) {
		return "", false
	}
	style := styles.GetForMode("github", chroma.Light)
	var highlighted bytes.Buffer
	if err := format(&highlighted, style, chroma.Literator(tokens...)); err != nil {
		return "", false
	}
	formatted := strings.ReplaceAll(highlighted.String(), "\r", "&#13;")
	return fmt.Sprintf(
		`<pre class="chroma %s"><code class="language-%s">%s</code></pre>`,
		style.Mode().String(), html.EscapeString(lexer.Config().Name), formatted,
	), true
}

// SyntaxCSS returns the bundled Chroma token rules for both viewer themes.
func SyntaxCSS() ([]byte, error) {
	return syntaxCSS(syntaxFormatter.WriteCSS)
}

func syntaxCSS(writeCSS func(io.Writer, *chroma.Style) error) ([]byte, error) {
	var output bytes.Buffer
	for _, mode := range []chroma.Mode{chroma.Light, chroma.Dark} {
		style := styles.GetForMode("github", mode)
		if err := writeCSS(&output, style); err != nil {
			return nil, err
		}
	}
	css := strings.ReplaceAll(output.String(), ".chroma.light", `:root[data-theme="light"] .chroma`)
	css = strings.ReplaceAll(css, ".chroma.dark", `:root[data-theme="dark"] .chroma`)
	return []byte(css), nil
}
