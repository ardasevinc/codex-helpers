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

Run the `codex-auth` package gate:

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
- `codex-auth use [name] [--json|-j]` — switch to a saved account (interactive if no name)
- `codex-auth list [--json|-j]` — list all accounts with plan type and usage (expired accounts flagged)
- `codex-auth current [--json|-j]` — show active account and usage
- `codex-auth delete <name> [--yes] [--json|-j]` — delete a saved account
- `codex-auth prune [--yes] [--json|-j]` — check all accounts and delete expired ones
- `codex-auth export` — dump all accounts as JSON to stdout
- `codex-auth import [--overwrite] [--json|-j]` — import `codex-auth export` JSON from stdin
- `codex-auth push <host> [--overwrite] [--json|-j]` — push accounts to a remote host via SSH
- `codex-auth -v` / `codex-auth -V` — print the current version

Output and automation:

- `--json` / `-j` emits machine-readable JSON and disables interactive prompts.
- AI agents are detected via `is-ai-agent`, and agent-detected runs automatically switch to non-interactive behavior.
- Invalid flags now fail fast instead of being silently ignored.
- Destructive flows require explicit flags in non-interactive mode:
  - `save` needs `--overwrite` when overwriting
  - `delete` needs `--yes`
  - `prune` needs `--yes`
- `use` without a name is interactive-only; in non-interactive mode pass the account name explicitly.

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
