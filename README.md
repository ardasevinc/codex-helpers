# codex-helpers

Bun monorepo for Codex CLI helper tools.

> **Disclaimer**: This project is not affiliated with, endorsed by, or associated with OpenAI. It's an independent developer utility that works with the [Codex CLI](https://github.com/openai/codex).

## Packages

- `packages/codex-auth`: switch between saved Codex auth sessions and view usage.

## Development

Install dependencies from repo root:

```bash
bun install
```

Run the repo wrapper from the root:

```bash
bun run gate
bun run full-gate
```

Or run the `codex-auth` package scripts directly:

```bash
cd packages/codex-auth
bun run gate
```

Or run individual checks:

```bash
cd packages/codex-auth
bun run lint
bun run typecheck
bun run test
bun run test:watch
bun run full-gate
```

Testing uses `vitest`, executed through Bun-managed package scripts.

Release notes helper:

```bash
./scripts/release-notes.sh codex-auth 0.3.3 <<'EOF' > /tmp/codex-auth-release-notes.md
- summarize the shipped changes here
EOF

gh release create codex-auth-v0.3.3 \
  --title "codex-auth v0.3.3" \
  --notes-file /tmp/codex-auth-release-notes.md
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/ardasevinc/codex-helpers/main/install.sh | sh -s -- codex-auth
```

Or link locally for development:

```bash
cd packages/codex-auth
bun link
```

## codex-auth CLI

Commands:

- `codex-auth save <name> [--overwrite] [--json|-j]` — save current session as a named account
- `codex-auth use [name] [--json|-j]` / `codex-auth switch [name] [--json|-j]` — switch to a saved account (interactive if no name)
- `codex-auth list [--json|-j]` / `codex-auth ls [--json|-j]` — list all accounts with plan type and usage (expired accounts flagged)
- `codex-auth current [--json|-j]` — show active account and usage
- `codex-auth watch [--interval <seconds>] [--once]` — live-refresh the current account usage in a terminal view
- `codex-auth delete <name> [--yes] [--json|-j]` / `codex-auth remove <name>` / `codex-auth rm <name>` — delete a saved account
- `codex-auth prune [--yes] [--json|-j]` — check all accounts and delete expired ones
- `codex-auth export` — dump all accounts as JSON to stdout
- `codex-auth import [--overwrite] [--json|-j]` — import `codex-auth export` JSON from stdin
- `codex-auth push <host> [--overwrite] [--json|-j]` — push accounts to a remote host via SSH
- `codex-auth update [version] [--check] [--json|-j]` / `codex-auth upgrade [version] [--check] [--json|-j]` — check for or install a released binary update
- `codex-auth -v` / `codex-auth -V` — print the current version

Output and automation:

- `--json` / `-j` emits machine-readable JSON and disables interactive prompts.
- command aliases: `switch -> use`, `ls -> list`, `remove|rm -> delete`, `upgrade -> update`
- AI agents are detected via `is-ai-agent`, and agent-detected runs automatically switch to non-interactive behavior.
- Invalid flags now fail fast instead of being silently ignored.
- Destructive flows require explicit flags in non-interactive mode:
  - `save` needs `--overwrite` when overwriting
  - `delete` needs `--yes`
  - `prune` needs `--yes`
- `use` without a name is interactive-only; in non-interactive mode pass the account name explicitly.
- `watch` is terminal-oriented; live mode requires an interactive TTY, but `--once` prints a single snapshot and exits.
- `update --check` reports the installed path/version and latest release without changing anything.
- `update` only self-updates regular-file installs created by the release installer. Bun-linked or other symlink/script installs are detected and refused with an installer hint.

Multi-machine sync:

```bash
# Push to a VPS (no codex-auth needed on remote)
codex-auth push my-vps

# Or pipe between machines
codex-auth export | ssh vps 'codex-auth import'
```

Behavior notes:

- account snapshots are immutable files in `~/.codex/accounts/*.json`
- active session is copied into `~/.codex/auth.json` as a regular file (no symlink), which avoids snapshot corruption during future `codex` logins
