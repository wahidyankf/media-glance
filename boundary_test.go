package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

var errBoundary = errors.New("injected boundary failure")

func fakeHost(t *testing.T) fstest.MapFS {
	t.Helper()
	saved := host
	t.Cleanup(func() { host = saved })
	files := fstest.MapFS{
		".":         {Mode: fs.ModeDir | 0700},
		"README.md": {Data: []byte("# Title\n![asset](assets/x.png)\n")},
		"docs":      {Mode: fs.ModeDir | 0700}, "docs/a.md": {Data: []byte("hello")},
		"assets": {Mode: fs.ModeDir | 0700}, "assets/x.png": {Data: []byte("png")},
		"z.txt": {Data: []byte("text")}, "x.html": {Data: []byte("<script>unsafe</script>")},
		"unknown": {Data: []byte{0, 1}}, "big.txt": {Data: bytes.Repeat([]byte("a"), previewLimit+1)},
		".git": {Mode: fs.ModeDir | 0700}, "node_modules": {Mode: fs.ModeDir | 0700},
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
		if _, e := fs.Stat(files, key(name)); e != nil {
			return "", e
		}
		return filepath.Clean(name), nil
	}
	host.stat = func(name string) (fs.FileInfo, error) { return fs.Stat(files, key(name)) }
	host.lstat = host.stat
	host.readFile = func(name string) ([]byte, error) { return fs.ReadFile(files, key(name)) }
	host.readDir = func(name string) ([]os.DirEntry, error) { return fs.ReadDir(files, key(name)) }
	host.open = func(name string) (io.ReadSeekCloser, error) {
		data, e := host.readFile(name)
		if e != nil {
			return nil, e
		}
		return &readStream{Reader: bytes.NewReader(data)}, nil
	}
	host.mkdir = func(string, fs.FileMode) error { return nil }
	host.chmod = func(string, fs.FileMode) error { return nil }
	host.remove = func(string) error { return nil }
	host.link = func(string, string) error { return nil }
	host.temp = func(string, string) (temporaryFile, error) { return &tempStream{name: "/state/temp"}, nil }
	host.random = func(b []byte) (int, error) {
		for i := range b {
			b[i] = byte(i)
		}
		return len(b), nil
	}
	host.now = func() time.Time { return time.Unix(123, 0) }
	host.pid = func() int { return 2 }
	host.openRoot = func(string) (workspaceFiles, error) { return &memoryWorkspace{key: key, files: files}, nil }
	return files
}

type readStream struct {
	*bytes.Reader
	closeErr, errorRead error
}

func (r *readStream) Read(b []byte) (int, error) {
	if r.errorRead != nil {
		return 0, r.errorRead
	}
	return r.Reader.Read(b)
}
func (r *readStream) Close() error { return r.closeErr }

type tempStream struct {
	bytes.Buffer
	name               string
	writeErr, closeErr error
}

func (r *tempStream) Name() string { return r.name }
func (r *tempStream) Write(b []byte) (int, error) {
	if r.writeErr != nil {
		return 0, r.writeErr
	}
	return r.Buffer.Write(b)
}
func (r *tempStream) Close() error { return r.closeErr }

type errorWriter struct{}

func (errorWriter) Write([]byte) (int, error) { return 0, errBoundary }
func unitViewer(t *testing.T) *viewer {
	t.Helper()
	fakeHost(t)
	record, e := newRecord("/workspace", 57300, 1, "")
	if e != nil {
		t.Fatal(e)
	}
	storage, e := host.openRoot("/workspace")
	if e != nil {
		t.Fatal(e)
	}
	return &viewer{root: "/workspace", files: storage, record: record, stop: func() {}}
}
func unitRequest(v *viewer, method, route string) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:57300/v/"+v.record.Token+"/"+route, nil)
	return r
}
func unitResponse(t *testing.T, v *viewer, method, route string, status int) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	v.ServeHTTP(w, unitRequest(v, method, route))
	if w.Code != status {
		t.Fatalf("%s: status=%d body=%s", route, w.Code, w.Body.String())
	}
	return w
}
func TestResolveDecisionErrors(t *testing.T) {
	fakeHost(t)
	for _, name := range []string{"../x", "/abs", "bad\x00", "absent"} {
		if _, _, e := resolvePath("/workspace", name); e == nil {
			t.Errorf("accepted %q", name)
		}
	}
	if _, _, e := resolvePath("/workspace", "README.md"); e != nil {
		t.Fatal(e)
	}
	host.eval = func(string) (string, error) { return "/outside", nil }
	if _, _, e := resolvePath("/workspace", "alias"); e == nil {
		t.Fatal("escaped")
	}
	host.rel = func(string, string) (string, error) { return "", errBoundary }
	if _, _, e := resolvePath("/workspace", "alias"); e == nil {
		t.Fatal("relative failure")
	}
	host.rel = filepath.Rel
	host.eval = func(string) (string, error) { return "/workspace/x", nil }
	host.stat = func(string) (fs.FileInfo, error) { return nil, errBoundary }
	if _, _, e := resolvePath("/workspace", "x"); e == nil {
		t.Fatal("stat failure")
	}
	host.stat = func(string) (fs.FileInfo, error) { return fs.Stat(fstest.MapFS{"x": {Mode: fs.ModeNamedPipe}}, "x") }
	if _, _, e := resolvePath("/workspace", "x"); e == nil {
		t.Fatal("special file")
	}
}
func TestHTTPRoutingAndPreview(t *testing.T) {
	v := unitViewer(t)
	for _, route := range []string{"", "index.html", "app.js", "media.js", "start.js", "style.css", "api/info", "api/tree", "api/tree?path=docs", "api/file?path=README.md", "api/file?path=z.txt", "api/file?path=assets/x.png", "api/file?path=unknown", "api/file?path=big.txt", "api/raw?path=x.html", "api/raw?path=unknown&download=1", "vendor/mermaid.esm.min.mjs", "vendor/chunks/mermaid.esm.min/katex-C5OPUE3Q.mjs"} {
		unitResponse(t, v, "GET", route, 200)
	}
	unitResponse(t, v, "HEAD", "api/raw?path=z.txt", 200)
	for _, route := range []string{"bad", "api/file?path=docs", "api/file?path=absent", "api/raw?path=docs", "api/raw?path=absent", "api/tree?path=z.txt", "vendor/no.js", "vendor/chunks/mermaid.esm.min/../a.mjs", "vendor/chunks/mermaid.esm.min/katex-unknown.mjs", "vendor/chunks/mermaid.esm.min/a.js", "vendor/chunks/mermaid.esm.min/no.mjs"} {
		unitResponse(t, v, "GET", route, 404)
	}
	unitResponse(t, v, "POST", "api/info", 405)
	unitResponse(t, v, "GET", "api/stop", 405)
	host.after = func(_ time.Duration, f func()) *time.Timer { f(); return nil }
	stopped := false
	v.stop = func() { stopped = true }
	unitResponse(t, v, "POST", "api/stop", 200)
	if !stopped {
		t.Fatal("stop not scheduled")
	}
	r := unitRequest(v, "GET", "api/info")
	r.Host = "evil"
	w := httptest.NewRecorder()
	v.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	r = unitRequest(v, "GET", "api/info")
	r.Header.Set("Origin", "http://evil")
	w = httptest.NewRecorder()
	v.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	r = unitRequest(v, "GET", "api/info")
	r.Header.Set("Origin", "http://127.0.0.1:57300")
	w = httptest.NewRecorder()
	v.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	r = unitRequest(v, "GET", "api/info")
	r.URL.Path = "/v/incorrect/api/info"
	w = httptest.NewRecorder()
	v.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestBundledFavicon(t *testing.T) {
	v := unitViewer(t)
	w := unitResponse(t, v, "GET", "favicon.svg", 200)
	if w.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatal("favicon MIME:", w.Header().Get("Content-Type"))
	}
	svg := w.Body.String()
	if !strings.Contains(svg, `viewBox="0 0 32 32"`) || !strings.Contains(svg, `#2f6a9f`) || strings.Contains(svg, "<script") || strings.Contains(svg, "href=") {
		t.Fatal("favicon must be a self-contained eye SVG")
	}
	index := unitResponse(t, v, "GET", "index.html", 200).Body.String()
	if !strings.Contains(index, `rel="icon" type="image/svg+xml" href="favicon.svg"`) {
		t.Fatal("viewer does not declare authenticated relative favicon")
	}
}
func TestHTTPBoundaryFailures(t *testing.T) {
	v := unitViewer(t)
	host.readDir = func(string) ([]os.DirEntry, error) { return nil, errBoundary }
	unitResponse(t, v, "GET", "api/tree", 403)
	host.open = func(string) (io.ReadSeekCloser, error) { return nil, errBoundary }
	unitResponse(t, v, "GET", "api/file?path=z.txt", 403)
	unitResponse(t, v, "GET", "api/raw?path=z.txt", 403)
	host.open = func(string) (io.ReadSeekCloser, error) {
		return &readStream{Reader: bytes.NewReader(nil), errorRead: errBoundary, closeErr: errBoundary}, nil
	}
	unitResponse(t, v, "GET", "api/file?path=z.txt", 500)
	writeJSON(&failingResponse{}, map[string]int{"x": 1})
	serveEmbedded(&failingResponse{}, unitRequest(v, "GET", ""), "web/index.html")
	serveEmbedded(httptest.NewRecorder(), unitRequest(v, "GET", ""), "missing")
}

type failingResponse struct{}

func (*failingResponse) Header() http.Header       { return http.Header{} }
func (*failingResponse) WriteHeader(int)           {}
func (*failingResponse) Write([]byte) (int, error) { return 0, errBoundary }
func TestRegistryIdentityAndCreation(t *testing.T) {
	fakeHost(t)
	r, e := newRecord("/workspace", 57300, 1, "docs/file #.md")
	if e != nil || !validRecord(r) || !strings.Contains(r.URL, "?file=") {
		t.Fatalf("%+v %v", r, e)
	}
	for _, value := range []string{"", "bad", strings.Repeat("a", 36), "01234567-0123-0123-0123-01234567890G"} {
		if validIdentity(value) {
			t.Fatal(value)
		}
	}
	for _, change := range []func(*registryRecord){func(r *registryRecord) { r.Version = 2 }, func(r *registryRecord) { r.Token = strings.Repeat("x", 64) }, func(r *registryRecord) { r.URL = "%" }, func(r *registryRecord) { r.URL = "https://evil" }, func(r *registryRecord) { r.OwnerPID = 0 }} {
		bad := r
		change(&bad)
		if validRecord(bad) {
			t.Fatal("invalid record accepted")
		}
	}
	host.random = func([]byte) (int, error) { return 0, errBoundary }
	if _, e := newRecord("/workspace", 57300, 1, ""); e == nil {
		t.Fatal("identity randomness")
	}
	calls := 0
	host.random = func(b []byte) (int, error) {
		calls++
		if calls == 2 {
			return 0, errBoundary
		}
		return len(b), nil
	}
	if _, e := newRecord("/workspace", 57300, 1, ""); e == nil {
		t.Fatal("token randomness")
	}
}
func TestRegistryPublicationFailures(t *testing.T) {
	fakeHost(t)
	r, e := newRecord("/workspace", 57300, 1, "")
	if e != nil {
		t.Fatal(e)
	}
	if e := writeRecord("/state", r); e != nil {
		t.Fatal(e)
	}
	saved := host
	host.mkdir = func(string, fs.FileMode) error { return errBoundary }
	if _, e := stageRecord("/state", r); e == nil {
		t.Fatal("mkdir")
	}
	host = saved
	host.chmod = func(string, fs.FileMode) error { return errBoundary }
	if _, e := stageRecord("/state", r); e == nil {
		t.Fatal("chmod")
	}
	host = saved
	host.temp = func(string, string) (temporaryFile, error) { return nil, errBoundary }
	if _, e := stageRecord("/state", r); e == nil {
		t.Fatal("temp")
	}
	host = saved
	for _, file := range []*tempStream{{writeErr: errBoundary}, {closeErr: errBoundary}} {
		host.temp = func(string, string) (temporaryFile, error) { return file, nil }
		if _, e := stageRecord("/state", r); e == nil {
			t.Fatal("write/close")
		}
	}
	host = saved
	host.link = func(string, string) error { return errBoundary }
	if e := publishRecord("/state", r, "/temp"); e == nil {
		t.Fatal("link")
	}
	host = saved
	host.remove = func(string) error { return errBoundary }
	if e := publishRecord("/state", r, "/temp"); e == nil {
		t.Fatal("remove temp")
	}
	if e := removeRecord("/state", r.Instance); e == nil {
		t.Fatal("remove")
	}
	host.remove = func(string) error { return os.ErrNotExist }
	if e := removeRecord("/state", r.Instance); e != nil {
		t.Fatal(e)
	}
}
func TestRegistryReadProbeAndStop(t *testing.T) {
	files := fakeHost(t)
	r, e := newRecord("/workspace", 57300, 1, "")
	if e != nil {
		t.Fatal(e)
	}
	data, e := json.Marshal(r)
	if e != nil {
		t.Fatal(e)
	}
	files["state/"+r.Instance+".json"] = &fstest.MapFile{Data: data}
	host.lstat = func(string) (fs.FileInfo, error) { return fs.Stat(files, "state/"+r.Instance+".json") }
	host.readFile = func(string) ([]byte, error) { return data, nil }
	if _, _, e := readRecord("/state", r.Instance); e != nil {
		t.Fatal(e)
	}
	host.request = func(req *http.Request, _ time.Duration) (*http.Response, error) {
		d := data
		if strings.HasSuffix(req.URL.Path, "api/info") {
			d, e = json.Marshal(r.readyRecord)
			if e != nil {
				t.Fatal(e)
			}
		}
		return &http.Response{StatusCode: 200, Body: &readStream{Reader: bytes.NewReader(d)}}, nil
	}
	if e := probe(context.Background(), r); e != nil {
		t.Fatal(e)
	}
	if e := stopServer(context.Background(), "/state", r.Instance); e != nil {
		t.Fatal(e)
	}
	if e := probe(context.Background(), registryRecord{}); e == nil {
		t.Fatal("invalid probe")
	}
	var missingContext context.Context
	if e := probe(missingContext, r); e == nil {
		t.Fatal("nil context")
	}
	host.request = func(*http.Request, time.Duration) (*http.Response, error) { return nil, errBoundary }
	if e := probe(context.Background(), r); e == nil {
		t.Fatal("request")
	}
	if e := stopServer(context.Background(), "/state", r.Instance); e == nil {
		t.Fatal("unverified stop")
	}
	for _, body := range []string{"invalid", `{"type":"other"}`} {
		host.request = func(*http.Request, time.Duration) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: &readStream{Reader: bytes.NewReader([]byte(body)), closeErr: errBoundary}}, nil
		}
		if e := probe(context.Background(), r); e == nil {
			t.Fatal("identity")
		}
	}
	host.request = func(*http.Request, time.Duration) (*http.Response, error) {
		return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	if e := probe(context.Background(), r); e == nil {
		t.Fatal("status")
	}
	data = []byte("invalid")
	if _, _, e := readRecord("/state", r.Instance); e == nil {
		t.Fatal("JSON")
	}
	data = []byte(`{}`)
	if _, _, e := readRecord("/state", r.Instance); e == nil {
		t.Fatal("record")
	}
	host.readFile = func(string) ([]byte, error) { return nil, errBoundary }
	if _, _, e := readRecord("/state", r.Instance); e == nil {
		t.Fatal("read")
	}
	if e := stopServer(context.Background(), "/state", r.Instance); e == nil {
		t.Fatal("stop read")
	}
	host.lstat = func(string) (fs.FileInfo, error) { return nil, errBoundary }
	if _, _, e := readRecord("/state", r.Instance); e == nil {
		t.Fatal("stat")
	}
	host.lstat = func(string) (fs.FileInfo, error) { return fs.Stat(fstest.MapFS{"x": {Mode: fs.ModeSymlink}}, "x") }
	if _, _, e := readRecord("/state", r.Instance); e == nil {
		t.Fatal("symlink")
	}
	if e := rejectRedirect(nil, nil); e != http.ErrUseLastResponse {
		t.Fatal(e)
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (fn roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }
func TestNativeAdapterForwarding(t *testing.T) {
	savedOpen, savedTemp, savedTransport := rawOpen, rawTemp, clientTransport
	t.Cleanup(func() { rawOpen = savedOpen; rawTemp = savedTemp; clientTransport = savedTransport })
	rawOpen = func(string) (*os.File, error) { return nil, errBoundary }
	if _, e := host.open("input"); !errors.Is(e, errBoundary) {
		t.Fatal(e)
	}
	rawTemp = func(string, string) (*os.File, error) { return nil, errBoundary }
	if _, e := host.temp("state", "pattern"); !errors.Is(e, errBoundary) {
		t.Fatal(e)
	}
	clientTransport = roundTrip(func(*http.Request) (*http.Response, error) { return nil, errBoundary })
	if _, e := host.request(httptest.NewRequest("GET", "http://localhost/", nil), time.Second); e == nil {
		t.Fatal("adapter swallowed failure")
	}
	f := host.newFile(^uintptr(0), "invalid")
	if file, ok := f.(*os.File); !ok || file != nil {
		t.Fatal("invalid descriptor unexpectedly produced file")
	}
}
func TestRegistryListStalenessAndStopResponses(t *testing.T) {
	files := fakeHost(t)
	r, e := newRecord("/workspace", 57300, 1, "")
	if e != nil {
		t.Fatal(e)
	}
	second := r
	second.Instance = "01234567-0123-0123-0123-012345678901"
	second.Port = 57301
	second.URL = strings.Replace(second.URL, ":57300", ":57301", 1)
	records := map[string]registryRecord{r.Instance: r, second.Instance: second}
	for id, value := range records {
		b, e := json.Marshal(value)
		if e != nil {
			t.Fatal(e)
		}
		files["state/"+id+".json"] = &fstest.MapFile{Data: b}
	}
	files["state/ignore"] = &fstest.MapFile{}
	files["state/invalid.json"] = &fstest.MapFile{}
	host.readDir = func(string) ([]os.DirEntry, error) { return fs.ReadDir(files, "state") }
	host.lstat = func(p string) (fs.FileInfo, error) { return fs.Stat(files, strings.TrimPrefix(p, "/")) }
	host.readFile = func(p string) ([]byte, error) { return fs.ReadFile(files, strings.TrimPrefix(p, "/")) }
	host.request = func(req *http.Request, _ time.Duration) (*http.Response, error) {
		ready := r.readyRecord
		if req.URL.Port() == "57301" {
			ready = second.readyRecord
		}
		b, e := json.Marshal(ready)
		if e != nil {
			t.Fatal(e)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(b))}, nil
	}
	servers, e := listServers(context.Background(), "/state")
	if e != nil || len(servers) != 2 || servers[0].Port != 57300 {
		t.Fatal(servers, e)
	}
	if e := run([]string{"stop", "--state-dir", "/state", "--instance", r.Instance}, io.NopCloser(strings.NewReader("")), io.Discard); e != nil {
		t.Fatal(e)
	}
	original := host.request
	host.request = func(req *http.Request, d time.Duration) (*http.Response, error) {
		if req.Method == "POST" {
			return nil, errBoundary
		}
		return original(req, d)
	}
	if e := stopServer(context.Background(), "/state", r.Instance); e == nil {
		t.Fatal("close transport")
	}
	host.request = func(req *http.Request, d time.Duration) (*http.Response, error) {
		if req.Method == "POST" {
			return &http.Response{StatusCode: 403, Body: &readStream{Reader: bytes.NewReader(nil), closeErr: errBoundary}}, nil
		}
		return original(req, d)
	}
	if e := stopServer(context.Background(), "/state", r.Instance); e == nil {
		t.Fatal("refused close")
	}
	host.request = func(*http.Request, time.Duration) (*http.Response, error) { return nil, errBoundary }
	pruned := 0
	host.remove = func(string) error { pruned++; return nil }
	servers, e = listServers(context.Background(), "/state")
	if e != nil || len(servers) != 0 || pruned != 2 {
		t.Fatal(servers, pruned, e)
	}
	host.remove = func(string) error { return errBoundary }
	if _, e := listServers(context.Background(), "/state"); e == nil {
		t.Fatal("prune error")
	}
	host.lstat = func(string) (fs.FileInfo, error) { return nil, errBoundary }
	if _, e := listServers(context.Background(), "/state"); e != nil {
		t.Fatal("no bytes must not prune", e)
	}
}
func TestRegistryStageAndHTTPCleanupFailures(t *testing.T) {
	v := unitViewer(t)
	host.mkdir = func(string, fs.FileMode) error { return errBoundary }
	if e := writeRecord("/state", v.record); e == nil {
		t.Fatal("stage error")
	}
	original := host.eval
	host.eval = func(name string) (string, error) {
		if strings.HasSuffix(name, "z.txt") {
			return "", errBoundary
		}
		return original(name)
	}
	unitResponse(t, v, "GET", "api/tree", 200)
	host.open = func(string) (io.ReadSeekCloser, error) {
		return &readStream{Reader: bytes.NewReader([]byte("text")), closeErr: errBoundary}, nil
	}
	unitResponse(t, v, "GET", "api/raw?path=README.md", 200)
}
func TestMarkdownRenderFailureResponse(t *testing.T) {
	v := unitViewer(t)
	host.markdown = func([]byte, string) (string, []string, error) { return "", nil, errBoundary }
	unitResponse(t, v, "GET", "api/file?path=README.md", 500)
	v.watchPaths(nil, "README.md")
}

type memoryWorkspace struct {
	files    fstest.MapFS
	key      func(string) string
	closeErr error
}

func (m *memoryWorkspace) Open(name string) (io.ReadSeekCloser, error) {
	return host.open("/workspace/" + name)
}
func (m *memoryWorkspace) Stat(name string) (fs.FileInfo, error) {
	return host.stat("/workspace/" + name)
}
func (m *memoryWorkspace) ReadDir(name string) ([]os.DirEntry, error) {
	return host.readDir("/workspace/" + name)
}
func (m *memoryWorkspace) Close() error { return m.closeErr }
