package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

type readyRecord struct {
	Type     string `json:"type"`
	Version  int    `json:"version"`
	Instance string `json:"instance"`
	Root     string `json:"root"`
	Port     int    `json:"port"`
	URL      string `json:"url"`
	OwnerPID int    `json:"ownerPid"`
	PID      int    `json:"pid"`
}

type registryRecord struct {
	readyRecord
	Token     string `json:"token"`
	StartedAt string `json:"startedAt"`
}

func validIdentity(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}

func newRecord(root string, port, owner int, initial string) (registryRecord, error) {
	var identity [16]byte
	var token [32]byte
	if _, err := host.random(identity[:]); err != nil {
		return registryRecord{}, err
	}
	if _, err := host.random(token[:]); err != nil {
		return registryRecord{}, err
	}
	identity[6] = (identity[6] & 15) | 64
	identity[8] = (identity[8] & 63) | 128
	h := hex.EncodeToString(identity[:])
	id := h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
	secret := hex.EncodeToString(token[:])
	address := fmt.Sprintf("http://127.0.0.1:%d/v/%s/", port, secret)
	if initial != "" {
		address += "?file=" + url.QueryEscape(initial)
	}
	return registryRecord{readyRecord{"ready", 1, id, root, port, address, owner, host.pid()}, secret, host.now().UTC().Format(time.RFC3339Nano)}, nil
}

func writeRecord(state string, record registryRecord) error {
	temporary, err := stageRecord(state, record)
	if err != nil {
		return err
	}
	return publishRecord(state, record, temporary)
}

func stageRecord(state string, record registryRecord) (string, error) {
	if err := host.mkdir(state, 0700); err != nil {
		return "", err
	}
	if err := host.chmod(state, 0700); err != nil {
		return "", err
	}
	// The registry scanner ignores this name until a complete, closed record
	// is atomically published under its UUID. CreateTemp uses private mode 0600.
	file, err := host.temp(state, ".media-viewer-*")
	if err != nil {
		return "", err
	}
	writeErr := json.NewEncoder(file).Encode(record)
	closeErr := file.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return "", errors.Join(err, host.remove(file.Name()))
	}
	return file.Name(), nil
}

func publishRecord(state string, record registryRecord, temporary string) error {
	final := filepath.Join(state, record.Instance+".json")
	// Linking within the state directory publishes atomically without replacing
	// a record another process already owns.
	if err := host.link(temporary, final); err != nil {
		return errors.Join(err, host.remove(temporary))
	}
	if err := host.remove(temporary); err != nil {
		return errors.Join(err, host.remove(final))
	}
	return nil
}

func removeRecord(state, instance string) error {
	err := host.remove(filepath.Join(state, instance+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func validRecord(record registryRecord) bool {
	if record.Version != 1 || record.Type != "ready" || !validIdentity(record.Instance) || record.Port < 57300 || record.Port > 57399 || record.OwnerPID < 1 || record.PID < 1 || !filepath.IsAbs(record.Root) || len(record.Token) != 64 {
		return false
	}
	if _, err := hex.DecodeString(record.Token); err != nil {
		return false
	}
	u, err := url.Parse(record.URL)
	return err == nil && u.Scheme == "http" && u.Host == fmt.Sprintf("127.0.0.1:%d", record.Port) && u.Path == "/v/"+record.Token+"/" && u.User == nil
}

func probe(ctx context.Context, record registryRecord) error {
	if !validRecord(record) {
		return fmt.Errorf("invalid registry record")
	}
	address := fmt.Sprintf("http://127.0.0.1:%d/v/%s/api/info", record.Port, record.Token)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return err
	}
	response, err := host.request(request, 500*time.Millisecond)
	if err != nil {
		return err
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "probe close:", err)
		}
	}()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("server did not authenticate")
	}
	var ready readyRecord
	if err := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&ready); err != nil {
		return err
	}
	if ready != record.readyRecord {
		return fmt.Errorf("server identity does not match registry")
	}
	return nil
}

func readRecord(state, instance string) (registryRecord, []byte, error) {
	path := filepath.Join(state, instance+".json")
	info, err := host.lstat(path)
	if err != nil {
		return registryRecord{}, nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16384 {
		return registryRecord{}, nil, fmt.Errorf("invalid registry file")
	}
	data, err := host.readFile(path)
	if err != nil {
		return registryRecord{}, nil, err
	}
	var record registryRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return record, data, err
	}
	if record.Instance != instance || !validRecord(record) {
		return record, data, fmt.Errorf("invalid registry identity")
	}
	return record, data, nil
}

func listServers(ctx context.Context, state string) ([]readyRecord, error) {
	servers := []readyRecord{}
	entries, err := host.readDir(state)
	if errors.Is(err, os.ErrNotExist) {
		return servers, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !strings.HasSuffix(entry.Name(), ".json") || !validIdentity(id) {
			continue
		}
		record, data, err := readRecord(state, id)
		if err == nil {
			err = probe(ctx, record)
		}
		if err == nil {
			servers = append(servers, record.readyRecord)
			continue
		}
		// A concurrent replacement is not ours to prune.
		current, readErr := host.readFile(filepath.Join(state, entry.Name()))
		if readErr == nil && data != nil && bytes.Equal(current, data) {
			if err := removeRecord(state, id); err != nil {
				return nil, err
			}
		}
	}
	sort.Slice(servers, func(i, j int) bool { return servers[i].Port < servers[j].Port })
	return servers, nil
}

func stopServer(ctx context.Context, state, instance string) error {
	record, _, err := readRecord(state, instance)
	if err != nil {
		return err
	}
	if err := probe(ctx, record); err != nil {
		return fmt.Errorf("refusing to stop unverified server: %w", err)
	}
	address := fmt.Sprintf("http://127.0.0.1:%d/v/%s/api/stop", record.Port, record.Token)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, address, nil)
	if err != nil {
		return err
	}
	response, err := host.request(request, 2*time.Second)
	if err != nil {
		return err
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "stop close:", err)
		}
	}()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("server refused authenticated close")
	}
	return nil
}

func isPortOccupied(err error) bool { return errors.Is(err, syscall.EADDRINUSE) }
