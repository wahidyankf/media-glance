package media

import (
	"bufio"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"html"
	"io"
	"regexp"
	"strings"
	"testing"
)

func TestLocalTarget(t *testing.T) {
	for _, tt := range []struct{ value, want string }{
		{"../assets/a b.png", "assets/a b.png"}, {"/README.md", "README.md"}, {"https://example.org/a", "https://example.org/a"}, {"javascript:alert(1)", ""}, {"../../escape", ""}, {"//evil.invalid/a", ""}, {"#hello", "#hello"},
	} {
		t.Run(tt.value, func(t *testing.T) {
			got, _ := localTarget("plans/plan.md", tt.value)
			if got != tt.want {
				t.Fatalf("%q != %q", got, tt.want)
			}
		})
	}
}

func TestRenderMarkdown(t *testing.T) {
	source := []byte("# Hello world\n\n[Next](../next.md#section) ![Asset](../img.svg)\n\n```mermaid\ngraph TD; A-->B\n```\n\n<script>alert('bad')</script>\n\n| A | B |\n|---|---|\n| 1 | 2 |")
	result, assets, err := RenderMarkdown(source, "docs/plan.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`id="hello-world"`, `data-file="next.md"`, `api/raw?path=img.svg`, `class="mermaid"`, `&lt;script&gt;`, `<table>`} {
		if !strings.Contains(result, want) {
			t.Errorf("missing %q in %s", want, result)
		}
	}
	if strings.Contains(result, "<script>") {
		t.Fatal("raw script was executable")
	}
	if len(assets) != 1 || assets[0] != "img.svg" {
		t.Fatalf("assets=%v", assets)
	}
}

func TestRenderMarkdownHighlightsCodeFencesWithoutChangingText(t *testing.T) {
	source := []byte("```go\n\tif value := \"<tag>\"; value != \"\" {\n\t\tprintln(value)\n\t}\n```\n")
	result, _, err := RenderMarkdown(source, "example.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, `<span class="`) {
		t.Fatalf("fenced Go code is not highlighted: %s", result)
	}
	if strings.Contains(result, "<tag>") || !strings.Contains(result, "&lt;tag&gt;") {
		t.Fatalf("fenced source was not escaped: %s", result)
	}
	code := regexp.MustCompile(`(?s)<code\b[^>]*>(.*?)</code>`).FindStringSubmatch(result)
	if len(code) != 2 {
		t.Fatalf("highlighted code element missing: %s", result)
	}
	visible := regexp.MustCompile(`<[^>]*>`).ReplaceAllString(code[1], "")
	if got := html.UnescapeString(visible); got != "\tif value := \"<tag>\"; value != \"\" {\n\t\tprintln(value)\n\t}\n" {
		t.Errorf("highlighted code changed source text: got %q", got)
	}
}

func TestRenderMarkdownKeepsUnknownCodeFencePlainAndMermaidSpecial(t *testing.T) {
	source := []byte("```unknown-lang\n\t<safe>\n```\n\n```mermaid\ngraph TD; A-->B\n```\n")
	result, _, err := RenderMarkdown(source, "example.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "&lt;safe&gt;") || strings.Contains(result, "<safe>") {
		t.Fatalf("unknown fence must fall back to escaped plaintext: %s", result)
	}
	if !strings.Contains(result, `<div class="mermaid"`) || !strings.Contains(result, `data-diagram="graph TD; A--&gt;B`) {
		t.Fatalf("Mermaid fence no longer uses its special renderer: %s", result)
	}
}

func TestRenderMarkdownEscapesCRLFInPlainCodeFences(t *testing.T) {
	source := []byte("```unknown-lang\r\nfirst\r\n\tsecond\r\n```\r\n")
	result, _, err := RenderMarkdown(source, "example.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result, "&#13;") {
		t.Fatalf("plain code fence contains literal carriage returns: %q", result)
	}
	code := regexp.MustCompile(`(?s)<code\b[^>]*>(.*?)</code>`).FindStringSubmatch(result)
	if len(code) != 2 {
		t.Fatalf("code element missing: %s", result)
	}
	visible := regexp.MustCompile(`<[^>]*>`).ReplaceAllString(code[1], "")
	if got := html.UnescapeString(visible); got != "first\r\n\tsecond\r\n" {
		t.Fatalf("plain fence text=%q, want original CRLF source", got)
	}
}

func TestRenderMarkdownCapsTotalHighlightedFenceBytes(t *testing.T) {
	code := strings.Repeat("x ", 35*1024) + "\n"
	source := []byte("```go\n" + code + "```\n\n```go\n" + code + "```\n")
	result, _, err := RenderMarkdown(source, "example.md")
	if err != nil {
		t.Fatal(err)
	}
	if count := strings.Count(result, `<pre class="chroma`); count != 1 {
		t.Fatalf("highlighted %d fences, want one under the aggregate limit", count)
	}
}

func TestRendererNodeValidationAndInertInlineHTML(t *testing.T) {
	m := &mediaRenderer{document: "docs/a.md"}
	writer := bufio.NewWriter(io.Discard)
	for _, render := range []renderer.NodeRendererFunc{m.link, m.image, m.fence} {
		if status, e := render(writer, nil, ast.NewParagraph(), true); status != ast.WalkStop || e == nil {
			t.Fatalf("unexpected node: status=%v err=%v", status, e)
		}
	}
	for _, render := range []renderer.NodeRendererFunc{m.fence, m.rawHTML, m.image} {
		if _, e := render(writer, nil, ast.NewParagraph(), false); e != nil {
			t.Fatal(e)
		}
	}
	if a, b := localTarget("docs/a.md", "%"); a != "" || b != "" {
		t.Fatal(a, b)
	}
	source := []byte("inline <b>text</b>\n\n<script>\nalert(1)\n</script>\n")
	output, _, e := RenderMarkdown(source, "a.md")
	if e != nil || strings.Contains(output, "<script>") || !strings.Contains(output, "&lt;b&gt;") {
		t.Fatal(output, e)
	}
	raw := ast.NewRawHTML()
	raw.Segments.Append(text.NewSegment(0, 3))
	if _, e := m.rawHTML(writer, []byte("<b>"), raw, true); e != nil {
		t.Fatal(e)
	}
	block := ast.NewHTMLBlock(ast.HTMLBlockType1)
	block.Lines().Append(text.NewSegment(0, 3))
	block.ClosureLine = text.NewSegment(3, 7)
	if _, e := m.rawHTML(writer, []byte("<b></b>"), block, true); e != nil {
		t.Fatal(e)
	}
}
