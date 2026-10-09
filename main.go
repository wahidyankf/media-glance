package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "media viewer:", err)
		host.exit(1)
	}
}

var version = "v0.1.2"

func run(args []string, input io.ReadCloser, output io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: media-glance serve|list|stop|version")
	}
	if args[0] == "version" {
		if len(args) != 2 || args[1] != "--json" {
			return fmt.Errorf("version requires --json")
		}
		return json.NewEncoder(output).Encode(struct {
			Version  string `json:"version"`
			Protocol int    `json:"protocol"`
		}{version, 1})
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	state := flags.String("state-dir", "", "private registry directory")
	root := flags.String("root", "", "absolute workspace directory")
	owner := flags.Int("owner-pid", 0, "owning Neovim process")
	initial := flags.String("initial-file", "", "initial absolute file or empty")
	instance := flags.String("instance", "", "server identity to stop")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 || !filepath.IsAbs(*state) {
		return fmt.Errorf("state-dir must be absolute; unexpected positional arguments are forbidden")
	}
	switch args[0] {
	case "list":
		servers, err := listServers(context.Background(), *state)
		if err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(struct {
			Type    string        `json:"type"`
			Version int           `json:"version"`
			Servers []readyRecord `json:"servers"`
		}{"list", 1, servers})
	case "stop":
		if !validIdentity(*instance) {
			return fmt.Errorf("instance must be a valid server identity")
		}
		if err := stopServer(context.Background(), *state, *instance); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(struct {
			Type     string `json:"type"`
			Version  int    `json:"version"`
			Instance string `json:"instance"`
		}{"stopped", 1, *instance})
	case "serve":
		if !filepath.IsAbs(*root) || *owner < 1 {
			return fmt.Errorf("serve requires absolute root and a positive owner-pid")
		}
		canonical, err := host.eval(*root)
		if err != nil {
			return fmt.Errorf("workspace: %w", err)
		}
		info, err := host.stat(canonical)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return fmt.Errorf("workspace root is not a directory")
		}
		selected := ""
		if *initial != "" {
			if !filepath.IsAbs(*initial) {
				return fmt.Errorf("initial-file must be absolute or empty")
			}
			rel, err := host.rel(canonical, *initial)
			if err != nil {
				return err
			}
			if _, fi, err := resolvePath(canonical, rel); err == nil && fi.Mode().IsRegular() {
				selected = filepath.ToSlash(rel)
			}
		}
		if selected == "" {
			if _, fi, err := resolvePath(canonical, "README.md"); err == nil && fi.Mode().IsRegular() {
				selected = "README.md"
			}
		}
		return serve(context.Background(), canonical, *state, selected, *owner, input, output)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func listenPort() (net.Listener, int, error) {
	for port := 57300; port <= 57399; port++ {
		listener, err := host.listen("tcp4", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return listener, port, nil
		}
		if !isPortOccupied(err) {
			return nil, 0, fmt.Errorf("bind media viewer: %w", err)
		}
	}
	return nil, 0, fmt.Errorf("all media viewer ports 57300–57399 are occupied")
}

func serve(ctx context.Context, root, state, initial string, owner int, input io.ReadCloser, output io.Writer) error {
	var err error
	input, err = interruptibleInput(input)
	if err != nil {
		return err
	}
	defer func() {
		if err := input.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
			fmt.Fprintln(os.Stderr, "owner input cleanup:", err)
		}
	}()
	if err := host.kill(owner, 0); err != nil {
		return fmt.Errorf("owner process is unavailable: %w", err)
	}
	listener, port, err := listenPort()
	if err != nil {
		return err
	}
	defer func() {
		if err := listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			fmt.Fprintln(os.Stderr, "listener close:", err)
		}
	}()
	record, err := newRecord(root, port, owner, initial)
	if err != nil {
		return err
	}
	ctx, cancel := host.notify(ctx, os.Interrupt, syscall.SIGTERM)
	defer cancel()
	files, err := host.openRoot(root)
	if err != nil {
		return fmt.Errorf("open workspace: %w", err)
	}
	defer func() {
		if err := files.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "workspace close:", err)
		}
	}()
	app := &viewer{root: root, files: files, record: record, stop: cancel}
	server := host.server(app)
	var workers sync.WaitGroup
	workers.Add(3)
	serverError := make(chan error, 1)
	go func() {
		defer workers.Done()
		err := server.Serve(listener)
		if err != nil && err != http.ErrServerClosed {
			serverError <- err
			cancel()
		}
	}()
	go func() {
		defer workers.Done()
		scanner := bufio.NewScanner(input)
		for scanner.Scan() {
			if strings.TrimSpace(scanner.Text()) == "stop" {
				cancel()
				return
			}
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			fmt.Fprintln(os.Stderr, "owner input:", err)
		}
		cancel()
	}()
	go func() {
		defer workers.Done()
		ticker := host.ticker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := host.kill(owner, 0); err == syscall.ESRCH {
					cancel()
					return
				}
			}
		}
	}()
	// A registry reader must never encounter a server whose accept loop has
	// not started. Verify this exact authenticated identity before publication.
	startupErr := probe(ctx, record)
	if startupErr == nil {
		startupErr = writeRecord(state, record)
		if startupErr == nil {
			defer func() {
				if err := removeRecord(state, record.Instance); err != nil {
					fmt.Fprintln(os.Stderr, "registry cleanup:", err)
				}
			}()
			startupErr = json.NewEncoder(output).Encode(record.readyRecord)
		}
	}
	if startupErr != nil {
		cancel()
		if err := input.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "owner input close:", err)
		}
		if err := server.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "server close:", err)
		}
		workers.Wait()
		return startupErr
	}
	<-ctx.Done()
	if err := input.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "owner input close:", err)
	}
	// Closing active connections cancels SSE requests and releases their watches.
	if err := server.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "server close:", err)
	}
	workers.Wait()
	select {
	case err := <-serverError:
		return err
	default:
		return nil
	}
}

func interruptibleInput(input io.ReadCloser) (io.ReadCloser, error) {
	file, ok := input.(*os.File)
	if !ok {
		return input, nil
	}
	// Inherited stdin starts as a blocking descriptor. Register a nonblocking
	// duplicate with Go's poller so Close interrupts its scanner during an HTTP
	// close or owner-death shutdown, even while the ownership pipe remains open.
	descriptor, err := host.dup(int(file.Fd()))
	if err != nil {
		return nil, fmt.Errorf("duplicate ownership pipe: %w", err)
	}
	host.closeExec(descriptor)
	if err := host.nonblock(descriptor, true); err != nil {
		if closeErr := host.closeFD(descriptor); closeErr != nil {
			return nil, fmt.Errorf("set ownership pipe nonblocking: %v; close: %w", err, closeErr)
		}
		return nil, fmt.Errorf("set ownership pipe nonblocking: %w", err)
	}
	replacement := host.newFile(uintptr(descriptor), file.Name())
	if err := host.closeFile(file); err != nil {
		if closeErr := replacement.Close(); closeErr != nil {
			return nil, fmt.Errorf("close inherited ownership pipe: %v; close replacement: %w", err, closeErr)
		}
		return nil, fmt.Errorf("close inherited ownership pipe: %w", err)
	}
	return replacement, nil
}
