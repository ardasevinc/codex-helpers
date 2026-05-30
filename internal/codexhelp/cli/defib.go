package cli

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	sha1 "crypto/sha1" // #nosec G505 -- RFC 6455 requires SHA-1 for Sec-WebSocket-Accept.
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
)

const (
	defibDefaultTarget = "cli"
	defibClientName    = "codexhelp_defib"
	defibClientVersion = "0.1.0"
)

var errDefibBusy = errors.New("app-server has active loaded threads")

type defibOptions struct {
	target  string
	dryRun  bool
	yes     bool
	surgery bool
	json    bool
}

type defibReport struct {
	Target         string              `json:"target"`
	CodexHome      string              `json:"codexHome"`
	WouldMutate    bool                `json:"wouldMutate"`
	Mutated        bool                `json:"mutated"`
	Busy           bool                `json:"busy"`
	PromptRequired bool                `json:"promptRequired"`
	Surgery        bool                `json:"surgery"`
	DryRun         bool                `json:"dryRun"`
	Daemon         defibDaemonReport   `json:"daemon"`
	Targets        []defibProcess      `json:"targets"`
	Nearby         []defibProcess      `json:"nearby"`
	RuntimeFiles   []defibRuntimeFile  `json:"runtimeFiles"`
	Actions        []defibAction       `json:"actions"`
	Errors         []string            `json:"errors,omitempty"`
	ActiveThreads  []defibThreadStatus `json:"activeThreads,omitempty"`
	LoadedThreads  []defibThreadStatus `json:"loadedThreads,omitempty"`
}

type defibDaemonReport struct {
	StateDir         string `json:"stateDir"`
	ControlDir       string `json:"controlDir"`
	ControlSocket    string `json:"controlSocket"`
	AppServerPID     string `json:"appServerPidFile"`
	UpdaterPID       string `json:"updaterPidFile"`
	SocketReachable  bool   `json:"socketReachable"`
	SocketError      string `json:"socketError,omitempty"`
	AppServerVersion string `json:"appServerVersion,omitempty"`
}

type defibProcess struct {
	PID     int    `json:"pid"`
	PPID    int    `json:"ppid"`
	PGID    int    `json:"pgid"`
	Kind    string `json:"kind"`
	Owner   string `json:"owner"`
	Command string `json:"command"`
	Source  string `json:"source"`
	Alive   bool   `json:"alive"`
}

type defibRuntimeFile struct {
	Path      string `json:"path"`
	Relative  string `json:"relative"`
	Exists    bool   `json:"exists"`
	Action    string `json:"action,omitempty"`
	Dest      string `json:"dest,omitempty"`
	Protected bool   `json:"protected,omitempty"`
	Error     string `json:"error,omitempty"`
}

type defibAction struct {
	Step    string `json:"step"`
	Status  string `json:"status"`
	Detail  string `json:"detail,omitempty"`
	Command string `json:"command,omitempty"`
	PID     int    `json:"pid,omitempty"`
}

type defibThreadStatus struct {
	ThreadID    string   `json:"threadId"`
	Status      string   `json:"status"`
	ActiveFlags []string `json:"activeFlags,omitempty"`
}

type defibPaths struct {
	codexHome   string
	daemonDir   string
	controlDir  string
	socket      string
	appPID      string
	updaterPID  string
	runtimeFile []string
}

type defibSystem interface {
	HomeDir() (string, error)
	Env(key string) string
	Now() time.Time
	ListProcesses(ctx context.Context) ([]processInfo, error)
	Run(ctx context.Context, name string, args ...string) ([]byte, error)
	Signal(pid int, sig syscall.Signal) error
	ReadFile(path string) ([]byte, error)
	Stat(path string) (os.FileInfo, error)
	MkdirAll(path string, perm os.FileMode) error
	Rename(oldpath, newpath string) error
	Remove(path string) error
}

type osDefibSystem struct{}

type processInfo struct {
	PID     int
	PPID    int
	PGID    int
	Command string
}

func newDefibCommand(state *appState) *cobra.Command {
	opts := defibOptions{target: defibDefaultTarget}
	cmd := &cobra.Command{
		Use:   "defib",
		Short: "Diagnose and repair Codex app-server runtime state",
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				return fmt.Errorf("defib does not accept positional arguments")
			}
			return runDefib(cmd.Context(), state, osDefibSystem{}, opts)
		},
	}
	cmd.Flags().StringVar(&opts.target, "target", defibDefaultTarget, "target scope: cli, app, or all")
	cmd.Flags().BoolVar(&opts.dryRun, "dry-run", false, "diagnose and print planned actions without prompting or mutating")
	cmd.Flags().BoolVar(&opts.yes, "yes", false, "accept the repair plan without prompting")
	cmd.Flags().BoolVar(&opts.surgery, "surgery", false, "delete stale runtime files instead of quarantining them")
	cmd.Flags().BoolVar(&opts.json, "json", false, "emit machine-readable JSON")
	return cmd
}

func runDefib(ctx context.Context, state *appState, sys defibSystem, opts defibOptions) error {
	opts.target = strings.ToLower(strings.TrimSpace(opts.target))
	if opts.target == "" {
		opts.target = defibDefaultTarget
	}
	if opts.target != "cli" && opts.target != "app" && opts.target != "all" {
		return fmt.Errorf("invalid --target %q: expected cli, app, or all", opts.target)
	}
	if opts.dryRun && opts.yes {
		return fmt.Errorf("--dry-run and --yes cannot be combined")
	}

	paths, err := defibResolvePaths(sys)
	if err != nil {
		return err
	}
	report := defibReport{
		Target:    opts.target,
		CodexHome: paths.codexHome,
		Surgery:   opts.surgery,
		DryRun:    opts.dryRun,
		Daemon: defibDaemonReport{
			StateDir:      paths.daemonDir,
			ControlDir:    paths.controlDir,
			ControlSocket: paths.socket,
			AppServerPID:  paths.appPID,
			UpdaterPID:    paths.updaterPID,
		},
	}

	processes, err := sys.ListProcesses(ctx)
	if err != nil {
		report.Errors = append(report.Errors, err.Error())
		writeDefibReport(state, opts, report)
		return exitError{code: 3, err: err}
	}
	report.Targets, report.Nearby = defibClassifyProcesses(opts.target, processes)
	report.Targets = defibAddPidfileTargets(sys, paths, opts.target, report.Targets, processes)
	sortDefibProcesses(report.Targets)
	sortDefibProcesses(report.Nearby)
	report.RuntimeFiles = defibRuntimeFiles(sys, paths, wantsCLITarget(opts.target))
	report.WouldMutate = len(report.Targets) > 0 || defibHasExistingRuntimeFiles(report.RuntimeFiles)

	if wantsCLITarget(opts.target) {
		probe := defibProbeAppServer(ctx, paths.socket)
		report.Daemon.SocketReachable = probe.reachable
		report.Daemon.SocketError = probe.errText
		report.Daemon.AppServerVersion = probe.version
		report.LoadedThreads = probe.threads
		for _, thread := range probe.threads {
			if thread.Status == "active" {
				report.ActiveThreads = append(report.ActiveThreads, thread)
			}
		}
		if len(report.ActiveThreads) > 0 {
			report.Busy = true
			report.Actions = append(report.Actions, defibAction{Step: "idle-check", Status: "blocked", Detail: "active loaded app-server threads found"})
			writeDefibReport(state, opts, report)
			return exitError{code: 2, err: errDefibBusy}
		}
	}

	if opts.dryRun {
		report.Actions = append(report.Actions, defibAction{Step: "dry-run", Status: "ok", Detail: "no mutations performed"})
		writeDefibReport(state, opts, report)
		return nil
	}
	if !report.WouldMutate {
		report.Actions = append(report.Actions, defibAction{Step: "diagnose", Status: "ok", Detail: "no target processes or stale runtime files found"})
		writeDefibReport(state, opts, report)
		return nil
	}
	if opts.json && !opts.yes {
		report.PromptRequired = true
		report.Actions = append(report.Actions, defibAction{Step: "approval", Status: "skipped", Detail: "json mode requires --yes to mutate"})
		writeDefibReport(state, opts, report)
		return exitError{code: 1, err: errors.New("repair needed; rerun with --yes to apply")}
	}
	if !opts.yes {
		if !stateInputIsTerminal(state) {
			report.PromptRequired = true
			report.Actions = append(report.Actions, defibAction{Step: "approval", Status: "skipped", Detail: "non-interactive input requires --yes or --dry-run"})
			writeDefibReport(state, opts, report)
			return exitError{code: 1, err: errors.New("repair needed; rerun with --yes or --dry-run")}
		}
		writeDefibReport(state, opts, report)
		ok, err := confirmDefib(state)
		if err != nil {
			return exitError{code: 1, err: err}
		}
		if !ok {
			return exitError{code: 1, err: errors.New("repair declined")}
		}
	}

	mutated, err := applyDefib(ctx, sys, paths, opts, &report)
	report.Mutated = mutated
	if err != nil {
		report.Errors = append(report.Errors, err.Error())
		writeDefibReport(state, opts, report)
		return exitError{code: 3, err: err}
	}
	writeDefibReport(state, opts, report)
	return nil
}

func applyDefib(ctx context.Context, sys defibSystem, paths defibPaths, opts defibOptions, report *defibReport) (bool, error) {
	mutated := false
	if wantsCLITarget(opts.target) {
		output, err := sys.Run(ctx, "codex", "app-server", "daemon", "stop")
		action := defibAction{Step: "official-stop", Command: "codex app-server daemon stop"}
		if len(bytes.TrimSpace(output)) > 0 {
			action.Detail = string(bytes.TrimSpace(output))
		}
		if err != nil {
			action.Status = "error"
			if action.Detail == "" {
				action.Detail = err.Error()
			} else {
				action.Detail += ": " + err.Error()
			}
		} else {
			action.Status = "ok"
			mutated = true
		}
		report.Actions = append(report.Actions, action)
	}

	targets := liveTargets(sys, report.Targets)
	for _, proc := range targets {
		err := sys.Signal(proc.PID, syscall.SIGTERM)
		action := defibAction{Step: "terminate", PID: proc.PID, Status: "ok", Detail: proc.Command}
		if err != nil && !errors.Is(err, os.ErrProcessDone) {
			action.Status = "error"
			action.Detail = err.Error()
		} else {
			mutated = true
		}
		report.Actions = append(report.Actions, action)
	}
	if len(targets) > 0 {
		time.Sleep(700 * time.Millisecond)
	}

	leftovers := liveTargets(sys, report.Targets)
	for _, proc := range leftovers {
		err := sys.Signal(proc.PID, syscall.SIGKILL)
		action := defibAction{Step: "kill", PID: proc.PID, Status: "ok", Detail: proc.Command}
		if err != nil && !errors.Is(err, os.ErrProcessDone) {
			action.Status = "error"
			action.Detail = err.Error()
		} else {
			mutated = true
		}
		report.Actions = append(report.Actions, action)
	}
	if len(leftovers) > 0 {
		time.Sleep(700 * time.Millisecond)
	}

	survivors := liveTargets(sys, report.Targets)
	if len(survivors) > 0 {
		return mutated, fmt.Errorf("%d target process(es) survived termination", len(survivors))
	}

	if wantsCLITarget(opts.target) {
		changed, err := cleanDefibRuntimeFiles(sys, paths, opts, report)
		mutated = mutated || changed
		if err != nil {
			return mutated, err
		}
	}
	report.Actions = append(report.Actions, defibAction{Step: "final-check", Status: "ok", Detail: "target processes are gone"})
	return mutated, nil
}

func defibResolvePaths(sys defibSystem) (defibPaths, error) {
	codexHome := strings.TrimSpace(sys.Env("CODEX_HOME"))
	if codexHome == "" {
		home, err := sys.HomeDir()
		if err != nil {
			return defibPaths{}, err
		}
		codexHome = filepath.Join(home, ".codex")
	}
	daemonDir := filepath.Join(codexHome, "app-server-daemon")
	controlDir := filepath.Join(codexHome, "app-server-control")
	paths := defibPaths{
		codexHome:  codexHome,
		daemonDir:  daemonDir,
		controlDir: controlDir,
		socket:     filepath.Join(controlDir, "app-server-control.sock"),
		appPID:     filepath.Join(daemonDir, "app-server.pid"),
		updaterPID: filepath.Join(daemonDir, "app-server-updater.pid"),
	}
	paths.runtimeFile = []string{
		paths.appPID,
		paths.updaterPID,
		filepath.Join(daemonDir, "app-server.pid.lock"),
		filepath.Join(daemonDir, "app-server-updater.pid.lock"),
		filepath.Join(daemonDir, "daemon.lock"),
		paths.socket,
		filepath.Join(controlDir, "app-server-startup.lock"),
	}
	return paths, nil
}

func wantsCLITarget(target string) bool {
	return target == "cli" || target == "all"
}

func wantsAppTarget(target string) bool {
	return target == "app" || target == "all"
}

func defibClassifyProcesses(target string, processes []processInfo) ([]defibProcess, []defibProcess) {
	targets := make([]defibProcess, 0)
	nearby := make([]defibProcess, 0)
	for _, proc := range processes {
		kind, owner, ok := classifyDefibProcess(proc.Command)
		if !ok {
			continue
		}
		entry := defibProcess{
			PID: proc.PID, PPID: proc.PPID, PGID: proc.PGID,
			Kind: kind, Owner: owner, Command: proc.Command, Source: "process-list", Alive: true,
		}
		if (owner == "cli" && wantsCLITarget(target)) || (owner == "app" && wantsAppTarget(target)) {
			targets = append(targets, entry)
		} else {
			nearby = append(nearby, entry)
		}
	}
	return dedupeDefibProcesses(targets), dedupeDefibProcesses(nearby)
}

func classifyDefibProcess(command string) (kind string, owner string, ok bool) {
	if !strings.Contains(command, "codex") || !strings.Contains(command, "app-server") {
		return "", "", false
	}
	owner = "cli"
	if strings.Contains(command, "/Codex.app/") || strings.Contains(command, `\Codex.app\`) {
		owner = "app"
	}
	switch {
	case strings.Contains(command, " app-server daemon pid-update-loop"):
		return "updater", owner, true
	case strings.Contains(command, " app-server"):
		return "app-server", owner, true
	default:
		return "", "", false
	}
}

func defibAddPidfileTargets(sys defibSystem, paths defibPaths, target string, targets []defibProcess, processes []processInfo) []defibProcess {
	if !wantsCLITarget(target) {
		return targets
	}
	byPID := map[int]processInfo{}
	for _, proc := range processes {
		byPID[proc.PID] = proc
	}
	for _, item := range []struct {
		path string
		kind string
	}{
		{paths.appPID, "app-server"},
		{paths.updaterPID, "updater"},
	} {
		pid, ok := readPidfile(sys, item.path)
		if !ok {
			continue
		}
		command := "pidfile target"
		ppid, pgid := 0, 0
		if proc, exists := byPID[pid]; exists {
			command = proc.Command
			ppid = proc.PPID
			pgid = proc.PGID
		}
		targets = append(targets, defibProcess{
			PID: pid, PPID: ppid, PGID: pgid, Kind: item.kind, Owner: "cli",
			Command: command, Source: item.path, Alive: processAlive(sys, pid),
		})
	}
	return dedupeDefibProcesses(targets)
}

func readPidfile(sys defibSystem, path string) (int, bool) {
	data, err := sys.ReadFile(path)
	if err != nil {
		return 0, false
	}
	var parsed struct {
		PID int `json:"pid"`
	}
	if err := json.Unmarshal(data, &parsed); err == nil && parsed.PID > 0 {
		return parsed.PID, true
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(data)))
	return n, err == nil && n > 0
}

func defibRuntimeFiles(sys defibSystem, paths defibPaths, include bool) []defibRuntimeFile {
	if !include {
		return nil
	}
	files := make([]defibRuntimeFile, 0, len(paths.runtimeFile))
	for _, path := range paths.runtimeFile {
		_, err := sys.Stat(path)
		exists := err == nil
		rel, _ := filepath.Rel(paths.codexHome, path)
		files = append(files, defibRuntimeFile{Path: path, Relative: rel, Exists: exists})
	}
	return files
}

func defibHasExistingRuntimeFiles(files []defibRuntimeFile) bool {
	for _, file := range files {
		if file.Exists {
			return true
		}
	}
	return false
}

func cleanDefibRuntimeFiles(sys defibSystem, paths defibPaths, opts defibOptions, report *defibReport) (bool, error) {
	changed := false
	quarantine := ""
	if !opts.surgery {
		quarantine = filepath.Join(paths.codexHome, "defib-quarantine", sys.Now().UTC().Format("20060102T150405Z"))
	}
	for i := range report.RuntimeFiles {
		if !report.RuntimeFiles[i].Exists {
			continue
		}
		path := report.RuntimeFiles[i].Path
		if opts.surgery {
			if err := sys.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				report.RuntimeFiles[i].Error = err.Error()
				return changed, err
			}
			report.RuntimeFiles[i].Action = "deleted"
			report.Actions = append(report.Actions, defibAction{Step: "cleanup", Status: "ok", Detail: "deleted " + report.RuntimeFiles[i].Relative})
			changed = true
			continue
		}
		dest := filepath.Join(quarantine, report.RuntimeFiles[i].Relative)
		if err := sys.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			report.RuntimeFiles[i].Error = err.Error()
			return changed, err
		}
		if err := sys.Rename(path, dest); err != nil {
			report.RuntimeFiles[i].Error = err.Error()
			return changed, err
		}
		report.RuntimeFiles[i].Action = "moved"
		report.RuntimeFiles[i].Dest = dest
		report.Actions = append(report.Actions, defibAction{Step: "cleanup", Status: "ok", Detail: "moved " + report.RuntimeFiles[i].Relative})
		changed = true
	}
	return changed, nil
}

func liveTargets(sys defibSystem, targets []defibProcess) []defibProcess {
	live := make([]defibProcess, 0)
	for _, target := range targets {
		if target.PID > 0 && processAlive(sys, target.PID) {
			live = append(live, target)
		}
	}
	return live
}

func processAlive(sys defibSystem, pid int) bool {
	if pid <= 0 {
		return false
	}
	err := sys.Signal(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func dedupeDefibProcesses(processes []defibProcess) []defibProcess {
	seen := map[int]bool{}
	out := make([]defibProcess, 0, len(processes))
	for _, proc := range processes {
		if proc.PID <= 0 || seen[proc.PID] {
			continue
		}
		seen[proc.PID] = true
		out = append(out, proc)
	}
	return out
}

func sortDefibProcesses(processes []defibProcess) {
	sort.Slice(processes, func(i, j int) bool {
		return processes[i].PID < processes[j].PID
	})
}

func writeDefibReport(state *appState, opts defibOptions, report defibReport) {
	if opts.json {
		enc := json.NewEncoder(state.out)
		enc.SetIndent("", "  ")
		_ = enc.Encode(report)
		return
	}
	_, _ = fmt.Fprintf(state.out, "target: %s\n", report.Target)
	_, _ = fmt.Fprintf(state.out, "codex home: %s\n", report.CodexHome)
	if report.Daemon.ControlSocket != "" {
		status := "unreachable"
		if report.Daemon.SocketReachable {
			status = "reachable"
		}
		_, _ = fmt.Fprintf(state.out, "control socket: %s (%s)\n", report.Daemon.ControlSocket, status)
		if report.Daemon.SocketError != "" {
			_, _ = fmt.Fprintf(state.out, "socket error: %s\n", report.Daemon.SocketError)
		}
	}
	if len(report.ActiveThreads) > 0 {
		_, _ = fmt.Fprintln(state.out, "active threads:")
		for _, thread := range report.ActiveThreads {
			_, _ = fmt.Fprintf(state.out, "  - %s %s %s\n", thread.ThreadID, thread.Status, strings.Join(thread.ActiveFlags, ","))
		}
	}
	if len(report.Targets) > 0 {
		_, _ = fmt.Fprintln(state.out, "target processes:")
		for _, proc := range report.Targets {
			_, _ = fmt.Fprintf(state.out, "  - pid=%d owner=%s kind=%s %s\n", proc.PID, proc.Owner, proc.Kind, proc.Command)
		}
	}
	if len(report.Nearby) > 0 {
		_, _ = fmt.Fprintln(state.out, "nearby app-server processes not targeted:")
		for _, proc := range report.Nearby {
			_, _ = fmt.Fprintf(state.out, "  - pid=%d owner=%s kind=%s %s\n", proc.PID, proc.Owner, proc.Kind, proc.Command)
		}
	}
	for _, action := range report.Actions {
		detail := strings.TrimSpace(action.Detail)
		if detail != "" {
			_, _ = fmt.Fprintf(state.out, "%s: %s (%s)\n", action.Step, action.Status, detail)
		} else {
			_, _ = fmt.Fprintf(state.out, "%s: %s\n", action.Step, action.Status)
		}
	}
	if report.WouldMutate && !report.Mutated && !report.Busy && !opts.dryRun {
		_, _ = fmt.Fprintln(state.out, "repair is available but has not been applied")
	}
}

func confirmDefib(state *appState) (bool, error) {
	_, _ = fmt.Fprint(state.out, "apply defib repair? [y/N] ")
	reader := bufio.NewReader(state.in)
	line, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return false, err
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes", nil
}

func stateInputIsTerminal(state *appState) bool {
	file, ok := state.in.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func (osDefibSystem) HomeDir() (string, error) { return os.UserHomeDir() }
func (osDefibSystem) Env(key string) string    { return os.Getenv(key) }
func (osDefibSystem) Now() time.Time           { return time.Now() }
func (osDefibSystem) ReadFile(path string) ([]byte, error) {
	// #nosec G304 -- callers pass fixed Codex runtime/pid paths resolved from CODEX_HOME.
	return os.ReadFile(path)
}

func (osDefibSystem) Stat(path string) (os.FileInfo, error) {
	return os.Stat(path)
}

func (osDefibSystem) MkdirAll(path string, perm os.FileMode) error {
	return os.MkdirAll(path, perm)
}

func (osDefibSystem) Rename(oldpath, newpath string) error {
	return os.Rename(oldpath, newpath)
}

func (osDefibSystem) Remove(path string) error {
	return os.Remove(path)
}

func (osDefibSystem) Signal(pid int, sig syscall.Signal) error {
	return syscall.Kill(pid, sig)
}

func (osDefibSystem) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	// #nosec G204 -- defib only calls this with the fixed official Codex daemon stop command.
	cmd := exec.CommandContext(ctx, name, args...)
	return cmd.CombinedOutput()
}

func (osDefibSystem) ListProcesses(ctx context.Context) ([]processInfo, error) {
	if runtime.GOOS == "linux" {
		return listLinuxProcesses()
	}
	cmd := exec.CommandContext(ctx, "ps", "-axo", "pid=,ppid=,pgid=,command=")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var processes []processInfo
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		pgid, err3 := strconv.Atoi(fields[2])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		processes = append(processes, processInfo{
			PID: pid, PPID: ppid, PGID: pgid,
			Command: strings.Join(fields[3:], " "),
		})
	}
	return processes, nil
}

func listLinuxProcesses() ([]processInfo, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var processes []processInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		ppid, pgid, statCommand, ok := readLinuxStat(pid)
		if !ok {
			continue
		}
		command := readLinuxCmdline(pid)
		if command == "" {
			command = statCommand
		}
		processes = append(processes, processInfo{
			PID:     pid,
			PPID:    ppid,
			PGID:    pgid,
			Command: command,
		})
	}
	return processes, nil
}

func readLinuxStat(pid int) (ppid int, pgid int, command string, ok bool) {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return 0, 0, "", false
	}
	text := string(data)
	open := strings.IndexByte(text, '(')
	close := strings.LastIndexByte(text, ')')
	if open < 0 || close <= open {
		return 0, 0, "", false
	}
	command = text[open+1 : close]
	fields := strings.Fields(text[close+1:])
	if len(fields) < 3 {
		return 0, 0, "", false
	}
	ppid, err1 := strconv.Atoi(fields[1])
	pgid, err2 := strconv.Atoi(fields[2])
	return ppid, pgid, command, err1 == nil && err2 == nil
}

func readLinuxCmdline(pid int) string {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cmdline"))
	if err != nil || len(data) == 0 {
		return ""
	}
	parts := bytes.Split(bytes.TrimRight(data, "\x00"), []byte{0})
	fields := make([]string, 0, len(parts))
	for _, part := range parts {
		if len(part) > 0 {
			fields = append(fields, string(part))
		}
	}
	return strings.Join(fields, " ")
}

type defibProbeResult struct {
	reachable bool
	errText   string
	version   string
	threads   []defibThreadStatus
}

func defibProbeAppServer(ctx context.Context, socketPath string) defibProbeResult {
	if runtime.GOOS == "windows" {
		return defibProbeResult{errText: "unix socket probing is unsupported on windows"}
	}
	if _, err := os.Stat(socketPath); err != nil {
		return defibProbeResult{errText: err.Error()}
	}
	ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	conn, err := dialAppServerWebsocket(ctx, socketPath)
	if err != nil {
		return defibProbeResult{errText: err.Error()}
	}
	defer func() { _ = conn.Close() }()

	probe := defibProbeResult{reachable: true}
	init, err := appServerRequest(ctx, conn, 1, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    defibClientName,
			"title":   "codexhelp defib",
			"version": defibClientVersion,
		},
		"capabilities": map[string]any{"experimentalApi": true},
	})
	if err != nil {
		probe.reachable = false
		probe.errText = err.Error()
		return probe
	}
	if ua, ok := init["userAgent"].(string); ok {
		probe.version = parseAppServerVersion(ua)
	}
	_ = appServerNotify(ctx, conn, "initialized", nil)
	loaded, err := appServerRequest(ctx, conn, 2, "thread/loaded/list", map[string]any{"cursor": nil, "limit": nil})
	if err != nil {
		probe.errText = err.Error()
		return probe
	}
	data, _ := loaded["data"].([]any)
	for i, value := range data {
		threadID, ok := value.(string)
		if !ok || threadID == "" {
			continue
		}
		read, err := appServerRequest(ctx, conn, int64(10+i), "thread/read", map[string]any{"threadId": threadID, "includeTurns": false})
		if err != nil {
			probe.threads = append(probe.threads, defibThreadStatus{ThreadID: threadID, Status: "unknown"})
			continue
		}
		probe.threads = append(probe.threads, parseThreadStatus(threadID, read))
	}
	return probe
}

func parseAppServerVersion(userAgent string) string {
	_, rest, ok := strings.Cut(userAgent, "/")
	if !ok {
		return ""
	}
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func parseThreadStatus(threadID string, response map[string]any) defibThreadStatus {
	result := defibThreadStatus{ThreadID: threadID, Status: "unknown"}
	thread, _ := response["thread"].(map[string]any)
	status, _ := thread["status"].(map[string]any)
	statusType, _ := status["type"].(string)
	if statusType == "" {
		return result
	}
	result.Status = statusType
	if flags, ok := status["activeFlags"].([]any); ok {
		for _, flag := range flags {
			if text, ok := flag.(string); ok {
				result.ActiveFlags = append(result.ActiveFlags, text)
			}
		}
	}
	return result
}

type appServerWS struct {
	conn net.Conn
	rw   *bufio.ReadWriter
}

func dialAppServerWebsocket(ctx context.Context, socketPath string) (*appServerWS, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "unix", socketPath)
	if err != nil {
		return nil, err
	}
	rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	request := "GET /rpc HTTP/1.1\r\n" +
		"Host: localhost\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n\r\n"
	if _, err := rw.WriteString(request); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	status, err := rw.ReadString('\n')
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if !strings.Contains(status, " 101 ") {
		_ = conn.Close()
		return nil, fmt.Errorf("websocket upgrade failed: %s", strings.TrimSpace(status))
	}
	headers := map[string]string{}
	for {
		line, err := rw.ReadString('\n')
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		name, value, ok := strings.Cut(line, ":")
		if ok {
			headers[strings.ToLower(strings.TrimSpace(name))] = strings.TrimSpace(value)
		}
	}
	if accept := headers["sec-websocket-accept"]; accept != websocketAccept(key) {
		_ = conn.Close()
		return nil, fmt.Errorf("websocket accept mismatch")
	}
	return &appServerWS{conn: conn, rw: rw}, nil
}

func websocketAccept(key string) string {
	// #nosec G401 -- SHA-1 is mandated by RFC 6455 for Sec-WebSocket-Accept, not used for security decisions here.
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func (ws *appServerWS) Close() error {
	_ = ws.writeFrame(0x8, nil)
	return ws.conn.Close()
}

func appServerRequest(ctx context.Context, ws *appServerWS, id int64, method string, params any) (map[string]any, error) {
	message := map[string]any{"id": id, "method": method}
	if params != nil {
		message["params"] = params
	}
	if err := ws.writeJSON(message); err != nil {
		return nil, err
	}
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		var response map[string]any
		if err := ws.readJSON(&response); err != nil {
			return nil, err
		}
		gotID, ok := numericID(response["id"])
		if !ok || gotID != id {
			continue
		}
		if errObj, ok := response["error"].(map[string]any); ok {
			if msg, ok := errObj["message"].(string); ok {
				return nil, errors.New(msg)
			}
			return nil, errors.New("app-server JSON-RPC error")
		}
		result, _ := response["result"].(map[string]any)
		return result, nil
	}
}

func appServerNotify(_ context.Context, ws *appServerWS, method string, params any) error {
	message := map[string]any{"method": method}
	if params != nil {
		message["params"] = params
	}
	return ws.writeJSON(message)
}

func numericID(value any) (int64, bool) {
	switch v := value.(type) {
	case float64:
		return int64(v), true
	case int64:
		return v, true
	case int:
		return int64(v), true
	default:
		return 0, false
	}
}

func (ws *appServerWS) writeJSON(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return ws.writeFrame(0x1, data)
}

func (ws *appServerWS) readJSON(dst any) error {
	for {
		opcode, payload, err := ws.readFrame()
		if err != nil {
			return err
		}
		switch opcode {
		case 0x1:
			return json.Unmarshal(payload, dst)
		case 0x8:
			return io.EOF
		case 0x9:
			_ = ws.writeFrame(0xA, payload)
		}
	}
}

func (ws *appServerWS) writeFrame(opcode byte, payload []byte) error {
	header := []byte{0x80 | opcode}
	length := len(payload)
	switch {
	case length < 126:
		// #nosec G115 -- guarded by length < 126 above.
		header = append(header, byte(0x80|length))
	case length <= 0xffff:
		// #nosec G115 -- guarded by length <= 0xffff above.
		header = append(header, 0x80|126, byte(length>>8), byte(length))
	default:
		header = append(header, 0x80|127)
		var buf [8]byte
		binary.BigEndian.PutUint64(buf[:], uint64(length))
		header = append(header, buf[:]...)
	}
	mask := make([]byte, 4)
	if _, err := rand.Read(mask); err != nil {
		return err
	}
	header = append(header, mask...)
	masked := make([]byte, length)
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	if _, err := ws.rw.Write(header); err != nil {
		return err
	}
	if _, err := ws.rw.Write(masked); err != nil {
		return err
	}
	return ws.rw.Flush()
}

func (ws *appServerWS) readFrame() (byte, []byte, error) {
	first, err := ws.rw.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	second, err := ws.rw.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	opcode := first & 0x0f
	masked := second&0x80 != 0
	length := uint64(second & 0x7f)
	switch length {
	case 126:
		var buf [2]byte
		if _, err := io.ReadFull(ws.rw, buf[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(buf[:]))
	case 127:
		var buf [8]byte
		if _, err := io.ReadFull(ws.rw, buf[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(buf[:])
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(ws.rw, mask[:]); err != nil {
			return 0, nil, err
		}
	}
	if length > 128<<20 {
		return 0, nil, fmt.Errorf("websocket frame too large: %d", length)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(ws.rw, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return opcode, payload, nil
}
