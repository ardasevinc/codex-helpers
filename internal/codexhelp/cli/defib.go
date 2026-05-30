package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newDefibCommand(state *appState) *cobra.Command {
	return &cobra.Command{
		Use:   "defib",
		Short: "Reserved Codex recovery command",
		RunE: func(_ *cobra.Command, _ []string) error {
			_, _ = fmt.Fprintln(state.out, "codexhelp defib is scaffolded; behavior is intentionally unset.")
			return nil
		},
	}
}
