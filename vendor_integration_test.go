//go:build integration

package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestPatchedVendorSurface(t *testing.T) {
	_, address := fixture(t)
	status, data := request(t, address+"vendor/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs")
	if status != 200 || !strings.Contains(string(data), `"0.18.3"`) || strings.Contains(string(data), `"0.16.45"`) {
		t.Fatalf("patched KaTeX status=%d fixed=%v old=%v", status, strings.Contains(string(data), `"0.18.3"`), strings.Contains(string(data), `"0.16.45"`))
	}
	for _, name := range []string{"mermaid.esm.mjs", "mermaid.min.js", "mermaid.js", "chunks/mermaid.esm.min/katex-unknown.mjs", "chunks/mermaid.esm/katex-C5OPUE3Q.mjs", "chunks/mermaid.esm.min/../../mermaid.esm.min.mjs"} {
		status, _ := request(t, address+"vendor/"+name)
		if status == http.StatusOK {
			t.Errorf("accepted alternate vendor %s", name)
		}
	}
	for _, name := range []string{"mermaid.esm.min.mjs", "chunks/mermaid.esm.min/chunk-2AEHWXPW.mjs"} {
		status, _ := request(t, address+"vendor/"+name)
		if status != http.StatusOK {
			t.Errorf("supported vendor %s: %d", name, status)
		}
	}
	status, _ = request(t, strings.Replace(address, "/v/", "/invalid/", 1)+"vendor/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs")
	if status == http.StatusOK {
		t.Fatal("vendor was unauthenticated")
	}
}
