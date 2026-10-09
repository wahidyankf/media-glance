package media

import (
	"bytes"
	"fmt"
	"html"
	"net/url"
	"path"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

type mediaRenderer struct {
	document string
	assets   []string
}

func localTarget(document, destination string) (string, string) {
	u, err := url.Parse(destination)
	if err != nil {
		return "", ""
	}
	if u.Scheme != "" {
		if u.Scheme == "https" || u.Scheme == "http" || u.Scheme == "mailto" {
			return destination, ""
		}
		return "", ""
	}
	if u.Host != "" {
		return "", ""
	}
	if u.Path == "" {
		return "#" + u.Fragment, ""
	}
	var target string
	if strings.HasPrefix(u.Path, "/") {
		target = path.Clean(strings.TrimPrefix(u.Path, "/"))
	} else {
		target = path.Clean(path.Join(path.Dir(document), u.Path))
	}
	if target == ".." || strings.HasPrefix(target, "../") {
		return "", ""
	}
	return target, target
}

func (m *mediaRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(ast.KindLink, m.link)
	reg.Register(ast.KindImage, m.image)
	reg.Register(ast.KindFencedCodeBlock, m.fence)
	reg.Register(ast.KindRawHTML, m.rawHTML)
	reg.Register(ast.KindHTMLBlock, m.rawHTML)
}

func (m *mediaRenderer) link(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		_, err := w.WriteString("</a>")
		return ast.WalkContinue, err
	}
	n, ok := node.(*ast.Link)
	if !ok {
		return ast.WalkStop, fmt.Errorf("unexpected link node")
	}
	destination, target := localTarget(m.document, string(n.Destination))
	href := destination
	attr := ""
	if target != "" {
		u, err := url.Parse(string(n.Destination))
		if err != nil {
			return ast.WalkStop, err
		}
		href = "?file=" + url.QueryEscape(target)
		if u.Fragment != "" {
			href += "#" + url.PathEscape(u.Fragment)
		}
		attr = " data-file=\"" + html.EscapeString(target) + "\""
	}
	_, err := w.WriteString("<a href=\"" + html.EscapeString(href) + "\"" + attr + "> ")
	return ast.WalkContinue, err
}

func (m *mediaRenderer) image(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n, ok := node.(*ast.Image)
	if !ok {
		return ast.WalkStop, fmt.Errorf("unexpected image node")
	}
	destination, target := localTarget(m.document, string(n.Destination))
	if target != "" {
		m.assets = append(m.assets, target)
		destination = "api/raw?path=" + url.QueryEscape(target)
	}
	var alt bytes.Buffer
	if err := ast.Walk(n, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
		if text, ok := child.(*ast.Text); ok && entering {
			alt.Write(text.Value(source))
		}
		return ast.WalkContinue, nil
	}); err != nil {
		return ast.WalkStop, err
	}
	_, err := w.WriteString("<img src=\"" + html.EscapeString(destination) + "\" alt=\"" + html.EscapeString(alt.String()) + "\" loading=\"lazy\">")
	return ast.WalkSkipChildren, err
}

func (m *mediaRenderer) fence(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	n, ok := node.(*ast.FencedCodeBlock)
	if !ok {
		return ast.WalkStop, fmt.Errorf("unexpected fence node")
	}
	var content bytes.Buffer
	for i := 0; i < n.Lines().Len(); i++ {
		line := n.Lines().At(i)
		content.Write(line.Value(source))
	}
	language := string(n.Language(source))
	opening := "<pre><code class=\"language-" + html.EscapeString(language) + "\">"
	closing := "</code></pre>"
	if language == "mermaid" {
		opening = "<div class=\"mermaid\" data-diagram=\"" + html.EscapeString(content.String()) + "\"><pre>"
		closing = "</pre></div>"
	}
	_, err := w.WriteString(opening + html.EscapeString(content.String()) + closing)
	return ast.WalkSkipChildren, err
}

func (m *mediaRenderer) rawHTML(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	var content bytes.Buffer
	if raw, ok := node.(*ast.RawHTML); ok {
		for i := 0; i < raw.Segments.Len(); i++ {
			segment := raw.Segments.At(i)
			content.Write(segment.Value(source))
		}
	}
	if block, ok := node.(*ast.HTMLBlock); ok {
		for i := 0; i < block.Lines().Len(); i++ {
			segment := block.Lines().At(i)
			content.Write(segment.Value(source))
		}
		if block.HasClosure() {
			content.Write(block.ClosureLine.Value(source))
		}
	}
	_, err := w.WriteString(html.EscapeString(content.String()))
	return ast.WalkSkipChildren, err
}

// RenderMarkdown renders inert document HTML and returns referenced workspace assets.
func RenderMarkdown(source []byte, document string) (string, []string, error) {
	media := &mediaRenderer{document: document}
	markdown := goldmark.New(goldmark.WithExtensions(extension.Table, extension.Strikethrough, extension.TaskList), goldmark.WithParserOptions(parser.WithAutoHeadingID()), goldmark.WithRendererOptions(renderer.WithNodeRenderers(util.Prioritized(media, 100))))
	var output bytes.Buffer
	if err := markdown.Convert(source, &output); err != nil {
		return "", nil, err
	}
	return output.String(), media.assets, nil
}
