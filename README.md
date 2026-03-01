# codex-helpers

Bun monorepo for Codex CLI helper tools.

## Packages

- `packages/codex-auth`: switch between saved Codex auth sessions and view usage.

## Development

Install dependencies from repo root:

```bash
bun install
```

Run checks:

```bash
bun x @biomejs/biome check .
bun x tsc --noEmit
bun test
```

## codex-auth CLI

Link locally:

```bash
cd packages/codex-auth
bun link
```

Commands:

- `codex-auth save <name>`
- `codex-auth use [name]`
- `codex-auth list`
- `codex-auth current`

Behavior note:

- account snapshots are immutable files in `~/.codex/accounts/*.json`
- active session is copied into `~/.codex/auth.json` as a regular file (no symlink), which avoids snapshot corruption during future `codex` logins
