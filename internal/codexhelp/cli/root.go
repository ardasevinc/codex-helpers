package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ardasevinc/codex-helpers/internal/codexhelp/buildinfo"
)

type exitError struct {
	code int
	err  error
}

func (e exitError) Error() string {
	return e.err.Error()
}

func (e exitError) Unwrap() error {
	return e.err
}

func ExitCode(err error) int {
	if err == nil {
		return 0
	}
	var ee exitError
	if errors.As(err, &ee) {
		return ee.code
	}
	return 1
}

type appState struct {
	in  io.Reader
	out io.Writer
	err io.Writer
}

func Execute(ctx context.Context, args []string) error {
	state := &appState{in: os.Stdin, out: os.Stdout, err: os.Stderr}
	cmd := NewRootCommand(state)
	cmd.SetContext(ctx)
	cmd.SetArgs(normalizeRootArgs(args))
	cmd.SetIn(state.in)
	cmd.SetOut(state.out)
	cmd.SetErr(state.err)
	if err := cmd.Execute(); err != nil {
		_, _ = fmt.Fprintln(state.err, "error:", err)
		return exitError{code: 1, err: err}
	}
	return nil
}

func normalizeRootArgs(args []string) []string {
	if len(args) != 1 {
		return args
	}
	switch args[0] {
	case "-v", "-V":
		return []string{"version"}
	default:
		return args
	}
}

func NewRootCommand(state *appState) *cobra.Command {
	if state == nil {
		state = &appState{in: os.Stdin, out: os.Stdout, err: os.Stderr}
	}
	root := &cobra.Command{
		Use:           "codexhelp",
		Short:         "Small Codex recovery and maintenance helpers",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       versionString(),
	}
	root.SetVersionTemplate("codexhelp {{.Version}}\n")
	root.AddCommand(newDefibCommand(state))
	root.AddCommand(newUpdateCommand(state))
	root.AddCommand(newVersionCommand(state))
	return root
}

func newVersionCommand(state *appState) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print codexhelp version",
		Run: func(_ *cobra.Command, _ []string) {
			_, _ = fmt.Fprintln(state.out, versionString())
		},
	}
}

func versionString() string {
	version := strings.TrimSpace(buildinfo.Version)
	commit := strings.TrimSpace(buildinfo.Commit)
	if version == "" {
		version = "dev"
	}
	if commit == "" || commit == "dev" {
		return version
	}
	if len(commit) > 12 {
		commit = commit[:12]
	}
	return version + " (" + commit + ")"
}
