package cli

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestDefibClassifiesTargetsByOwner(t *testing.T) {
	processes := []processInfo{
		{PID: 10, Command: "/Users/arda/.codex/packages/standalone/current/codex app-server --remote-control --listen unix://"},
		{PID: 11, Command: "/Users/arda/.codex/packages/standalone/current/codex app-server daemon pid-update-loop"},
		{PID: 12, Command: "/Applications/Codex.app/Contents/Resources/codex app-server --listen stdio://"},
		{PID: 13, Command: "codex --yolo"},
	}
	targets, nearby := defibClassifyProcesses("cli", processes)
	if got, want := len(targets), 2; got != want {
		t.Fatalf("cli targets = %d, want %d: %#v", got, want, targets)
	}
	if got, want := len(nearby), 1; got != want {
		t.Fatalf("nearby = %d, want %d: %#v", got, want, nearby)
	}
	if nearby[0].Owner != "app" || nearby[0].PID != 12 {
		t.Fatalf("nearby app process not preserved: %#v", nearby[0])
	}

	targets, nearby = defibClassifyProcesses("app", processes)
	if got, want := len(targets), 1; got != want {
		t.Fatalf("app targets = %d, want %d: %#v", got, want, targets)
	}
	if targets[0].PID != 12 || targets[0].Owner != "app" {
		t.Fatalf("app target mismatch: %#v", targets[0])
	}
	if got, want := len(nearby), 2; got != want {
		t.Fatalf("app nearby = %d, want %d: %#v", got, want, nearby)
	}
}

func TestDefibDryRunDoesNotMutateRuntimeFiles(t *testing.T) {
	dir := t.TempDir()
	sys := newFakeDefibSystem(t, dir)
	writeRuntimeFixture(t, dir)
	var out bytes.Buffer
	err := runDefib(context.Background(), &appState{in: strings.NewReader(""), out: &out, err: &bytes.Buffer{}}, sys, defibOptions{
		target: "cli",
		dryRun: true,
		json:   true,
	})
	if err != nil {
		t.Fatalf("runDefib dry-run returned error: %v", err)
	}
	if len(sys.removed) != 0 || len(sys.renamed) != 0 || len(sys.commands) != 0 {
		t.Fatalf("dry-run mutated: removed=%v renamed=%v commands=%v", sys.removed, sys.renamed, sys.commands)
	}
	if _, err := os.Stat(filepath.Join(dir, "app-server-daemon", "app-server.pid")); err != nil {
		t.Fatalf("pidfile should remain after dry-run: %v", err)
	}
	if !strings.Contains(out.String(), `"dryRun": true`) {
		t.Fatalf("json dry-run output missing marker: %s", out.String())
	}
}

func TestDefibQuarantinesOnlyRuntimeFiles(t *testing.T) {
	dir := t.TempDir()
	sys := newFakeDefibSystem(t, dir)
	writeRuntimeFixture(t, dir)
	var out bytes.Buffer
	err := runDefib(context.Background(), &appState{in: strings.NewReader(""), out: &out, err: &bytes.Buffer{}}, sys, defibOptions{
		target: "cli",
		yes:    true,
	})
	if err != nil {
		t.Fatalf("runDefib apply returned error: %v\n%s", err, out.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "app-server-daemon", "settings.json")); err != nil {
		t.Fatalf("settings.json should be protected: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "app-server-daemon", "app-server.stderr.log")); err != nil {
		t.Fatalf("stderr log should be protected: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "app-server-daemon", "app-server.pid")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pidfile should be moved, stat err=%v", err)
	}
	quarantined := filepath.Join(dir, "defib-quarantine", "20260530T120000Z", "app-server-daemon", "app-server.pid")
	if _, err := os.Stat(quarantined); err != nil {
		t.Fatalf("pidfile should be quarantined with relative path: %v", err)
	}
	if len(sys.commands) != 1 || sys.commands[0] != "codex app-server daemon stop" {
		t.Fatalf("official stop command mismatch: %#v", sys.commands)
	}
}

func TestDefibSurgeryDeletesRuntimeFiles(t *testing.T) {
	dir := t.TempDir()
	sys := newFakeDefibSystem(t, dir)
	writeRuntimeFixture(t, dir)
	var out bytes.Buffer
	err := runDefib(context.Background(), &appState{in: strings.NewReader(""), out: &out, err: &bytes.Buffer{}}, sys, defibOptions{
		target:  "cli",
		yes:     true,
		surgery: true,
	})
	if err != nil {
		t.Fatalf("runDefib surgery returned error: %v\n%s", err, out.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "app-server-daemon", "app-server.pid")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pidfile should be deleted, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "defib-quarantine")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("surgery should not create quarantine, stat err=%v", err)
	}
}

func TestDefibAppTargetDoesNotCleanCLIRuntimeFiles(t *testing.T) {
	dir := t.TempDir()
	sys := newFakeDefibSystem(t, dir)
	writeRuntimeFixture(t, dir)
	sys.processes = []processInfo{
		{PID: 42, PPID: 1, PGID: 42, Command: "/Applications/Codex.app/Contents/Resources/codex app-server --listen stdio://"},
	}
	sys.alive[42] = false
	var out bytes.Buffer
	err := runDefib(context.Background(), &appState{in: strings.NewReader(""), out: &out, err: &bytes.Buffer{}}, sys, defibOptions{
		target: "app",
		yes:    true,
	})
	if err != nil {
		t.Fatalf("runDefib app target returned error: %v\n%s", err, out.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "app-server-daemon", "app-server.pid")); err != nil {
		t.Fatalf("app target should not touch cli runtime files: %v", err)
	}
	if len(sys.commands) != 0 {
		t.Fatalf("app target should not run daemon stop: %#v", sys.commands)
	}
}

func TestDefibTerminatesExactAliveTargets(t *testing.T) {
	dir := t.TempDir()
	sys := newFakeDefibSystem(t, dir)
	sys.processes = []processInfo{
		{PID: 42, PPID: 1, PGID: 42, Command: "/Users/arda/.codex/packages/standalone/current/codex app-server --listen unix://"},
		{PID: 43, PPID: 1, PGID: 43, Command: "codex --yolo"},
	}
	sys.alive[42] = true
	var out bytes.Buffer
	err := runDefib(context.Background(), &appState{in: strings.NewReader(""), out: &out, err: &bytes.Buffer{}}, sys, defibOptions{
		target: "cli",
		yes:    true,
	})
	if err != nil {
		t.Fatalf("runDefib terminate returned error: %v\n%s", err, out.String())
	}
	if sys.alive[42] {
		t.Fatal("target process should have been terminated")
	}
	if _, ok := sys.alive[43]; ok {
		t.Fatal("generic codex client should not be signaled")
	}
}

func TestDefibNonTTYRequiresYesWhenRepairNeeded(t *testing.T) {
	dir := t.TempDir()
	sys := newFakeDefibSystem(t, dir)
	writeRuntimeFixture(t, dir)
	var out bytes.Buffer
	err := runDefib(context.Background(), &appState{in: strings.NewReader(""), out: &out, err: &bytes.Buffer{}}, sys, defibOptions{target: "cli"})
	if err == nil || ExitCode(err) != 1 {
		t.Fatalf("expected exit code 1, got err=%v code=%d", err, ExitCode(err))
	}
	if len(sys.commands) != 0 || len(sys.renamed) != 0 {
		t.Fatalf("non-tty without --yes mutated: commands=%v renamed=%v", sys.commands, sys.renamed)
	}
}

func writeRuntimeFixture(t *testing.T, dir string) {
	t.Helper()
	files := map[string]string{
		"app-server-daemon/app-server.pid":              `{"pid":999999}`,
		"app-server-daemon/app-server-updater.pid":      `{"pid":999998}`,
		"app-server-daemon/app-server.pid.lock":         "",
		"app-server-daemon/app-server-updater.pid.lock": "",
		"app-server-daemon/daemon.lock":                 "",
		"app-server-control/app-server-control.sock":    "",
		"app-server-control/app-server-startup.lock":    "",
		"app-server-daemon/settings.json":               `{"remoteControlEnabled":true}`,
		"app-server-daemon/app-server.stderr.log":       "log",
	}
	for rel, contents := range files {
		path := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

type fakeDefibSystem struct {
	t         *testing.T
	home      string
	codexHome string
	now       time.Time
	processes []processInfo
	alive     map[int]bool
	commands  []string
	removed   []string
	renamed   [][2]string
}

func newFakeDefibSystem(t *testing.T, codexHome string) *fakeDefibSystem {
	t.Helper()
	return &fakeDefibSystem{
		t:         t,
		home:      filepath.Dir(codexHome),
		codexHome: codexHome,
		now:       time.Date(2026, 5, 30, 12, 0, 0, 0, time.UTC),
		alive:     map[int]bool{},
	}
}

func (f *fakeDefibSystem) HomeDir() (string, error) { return f.home, nil }
func (f *fakeDefibSystem) Env(key string) string {
	if key == "CODEX_HOME" {
		return f.codexHome
	}
	return ""
}
func (f *fakeDefibSystem) Now() time.Time { return f.now }
func (f *fakeDefibSystem) ListProcesses(context.Context) ([]processInfo, error) {
	return f.processes, nil
}

func (f *fakeDefibSystem) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	cmd := name + " " + strings.Join(args, " ")
	f.commands = append(f.commands, cmd)
	return []byte(`{"status":"notRunning"}`), nil
}

func (f *fakeDefibSystem) Signal(pid int, sig syscall.Signal) error {
	if sig == 0 {
		if f.alive[pid] {
			return nil
		}
		return syscall.ESRCH
	}
	f.alive[pid] = false
	return nil
}
func (f *fakeDefibSystem) ReadFile(path string) ([]byte, error)  { return os.ReadFile(path) }
func (f *fakeDefibSystem) Stat(path string) (os.FileInfo, error) { return os.Stat(path) }
func (f *fakeDefibSystem) MkdirAll(path string, perm os.FileMode) error {
	return os.MkdirAll(path, perm)
}

func (f *fakeDefibSystem) Rename(oldpath, newpath string) error {
	f.renamed = append(f.renamed, [2]string{oldpath, newpath})
	return os.Rename(oldpath, newpath)
}

func (f *fakeDefibSystem) Remove(path string) error {
	f.removed = append(f.removed, path)
	return os.Remove(path)
}
