package media

import "testing"

func TestPreviewKind(t *testing.T) {
	for _, tt := range []struct {
		name    string
		content []byte
		size    int64
		want    string
	}{
		{"plan.md", []byte("# Plan"), 6, "markdown"},
		{"code.html", []byte("<script>evil()</script>"), 21, "text"},
		{"asset.svg", []byte("<svg/>"), 6, "image"},
		{"book.pdf", nil, 10, "pdf"},
		{"clip.mp4", nil, 10, "video"},
		{"voice.mp3", nil, 10, "audio"},
		{"unknown", []byte("plain text"), 10, "text"},
		{"unknown", []byte{0, 1, 2}, 3, "download"},
		{"large.md", []byte("# Plan"), 2*1024*1024 + 1, "download"},
	} {
		t.Run(tt.name+tt.want, func(t *testing.T) {
			if got := PreviewKind(tt.name, tt.content, tt.size); got != tt.want {
				t.Fatalf("kind=%s want=%s", got, tt.want)
			}
		})
	}
}
