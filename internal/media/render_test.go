package media

import (
	"bufio"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"io"
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
