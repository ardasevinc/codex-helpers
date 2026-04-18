# codex-helpers: codex-auth Specification

> Account switcher with usage monitoring for OpenAI Codex CLI

## Overview

`codex-auth` is a CLI tool for managing multiple OpenAI Codex CLI accounts. It snapshots and swaps `~/.codex/auth.json` files to switch between accounts, and displays real-time usage quotas (5-hour session window and 7-day weekly window) for each account.

The tool lives in a Bun monorepo (`codex-helpers`) designed to house multiple Codex-related CLI tools over time.

---

## Architecture

### Monorepo Structure

```
codex-helpers/
├── package.json              # root: private, workspaces
├── tsconfig.json             # base tsconfig (strict, ESNext)
├── bunfig.toml               # bun config if needed
├── bun.lock
├── docs/
│   └── SPEC.md               # this file
└── packages/
    └── codex-auth/
        ├── package.json      # bin: { "codex-auth": "./src/cli.ts" }
        ├── tsconfig.json     # extends root
        ├── vitest.config.ts  # package-local vitest config
        ├── src/
        │   ├── cli.ts        # entry point, citty command definitions
        │   ├── commands/
        │   │   ├── save.ts   # `codex-auth save <name>`
        │   │   ├── use.ts    # `codex-auth use [name]`
        │   │   ├── list.ts   # `codex-auth list`
        │   │   ├── current.ts# `codex-auth current`
        │   │   ├── watch.ts  # `codex-auth watch`
        │   │   ├── delete.ts # `codex-auth delete <name>`
        │   │   ├── prune.ts  # `codex-auth prune`
        │   │   ├── export.ts # `codex-auth export`
        │   │   ├── import.ts # `codex-auth import`
        │   │   ├── push.ts   # `codex-auth push <host>`
        │   │   └── update.ts # `codex-auth update [version]`
        │   ├── lib/
        │   │   ├── accounts.ts   # account CRUD (snapshot, restore, list, delete)
        │   │   ├── auth.ts       # auth.json reading, token refresh
        │   │   ├── usage.ts      # usage API fetching & parsing
        │   │   ├── expiry.ts     # account health classification
        │   │   ├── display.ts    # progress bars, time formatting
        │   │   ├── paths.ts      # path resolution constants
        │   │   └── update.ts     # release discovery, install detection, binary replacement
        │   └── types.ts      # shared type definitions
        └── tests/
            ├── helpers.ts
            ├── vitest.setup.ts
            ├── accounts.test.ts
            ├── auth.test.ts
            ├── display.test.ts
            ├── expiry.test.ts
            ├── update.test.ts
            ├── usage.test.ts
            └── commands/
                ├── helpers.ts
                ├── save.test.ts
                ├── use.test.ts
                ├── list.test.ts
                ├── current.test.ts
                ├── delete.test.ts
                ├── prune.test.ts
                └── update.test.ts
```

### Tech Stack

| Layer              | Library           | Version    | Purpose                          |
| ------------------ | ----------------- | ---------- | -------------------------------- |
| Runtime            | Bun               | latest     | Runtime and package manager      |
| CLI framework      | citty             | latest     | Command parsing, subcommands     |
| Interactive prompts | @clack/prompts   | latest     | Select menus, spinners, confirm  |
| Colors             | ansis             | latest     | Terminal color output             |
| Testing            | Vitest            | latest     | Unit and integration tests       |

No other dependencies unless strictly necessary.

### Installation

```bash
# Binary install (any machine)
curl -fsSL https://raw.githubusercontent.com/ardasevinc/codex-helpers/main/install.sh | sh -s -- codex-auth

# Development (from repo root)
bun install
cd packages/codex-auth
bun link
```

### Release Notes

Release descriptions should include:

- the generic install command
- the version-pinned update command
- direct binary download URLs for each target

Use the repo helper to generate that boilerplate:

```bash
./scripts/release-notes.sh codex-auth 0.3.3 <<'EOF' > /tmp/codex-auth-release-notes.md
- summarize the shipped changes here
EOF
```

---

## Codex Auth File Format

Codex CLI stores authentication at `~/.codex/auth.json`:

```jsonc
{
  "OPENAI_API_KEY": null,
  "tokens": {
    "access_token": "<jwt>",
    "refresh_token": "<token>",
    "id_token": "<jwt>",
    "account_id": "<uuid>"
  },
  "last_refresh": "2026-01-28T08:05:37Z"
}
```

### Auth File Resolution Order

Check these paths in order, use the first that exists:

1. `$CODEX_HOME/auth.json` (if `CODEX_HOME` env var is set)
2. `~/.config/codex/auth.json`
3. `~/.codex/auth.json`

> Note: The reference implementation also supports macOS keychain (`"Codex Auth"` service) as a fallback. This is out of scope for v1 but the path resolution should be extensible.

---

## Account Storage

Saved accounts are stored as JSON snapshots under `~/.codex/accounts/`:

```
~/.codex/accounts/
├── <name>.json          # snapshot of auth.json at save time
├── ...
└── _active.json         # tracks which account is currently active
```

### `_active.json` Format

```jsonc
{
  "name": "personal",
  "switched_at": "2026-03-01T12:00:00Z"
}
```

### Switching Mechanism

Always copy the selected snapshot into `~/.codex/auth.json` (regular file).

If `~/.codex/auth.json` is an old symlink from previous versions, remove the symlink first, then copy the snapshot.

Rationale: symlinks are transparent to writes. If `auth.json` points to a snapshot file, a later `codex` login can overwrite that snapshot and corrupt saved accounts.

---

## Commands

### Output Modes

- Commands that support `--json` / `-j` should emit machine-readable JSON to stdout and must not prompt.
- Root-level command aliases should normalize before validation and execution. Current aliases: `switch -> use`, `ls -> list`, `remove|rm -> delete`, `upgrade -> update`.
- Interactive prompts are allowed only when not in JSON mode and not running under an AI agent.
- AI agent detection should use the `is-ai-agent` package.
- When an AI agent is detected, commands must switch to non-interactive behavior automatically.
- Unknown or invalid flags should fail fast with a non-zero exit code instead of being silently ignored.
- In non-interactive mode:
  - `save` requires `--overwrite` to replace an existing account
  - `delete` requires `--yes`
  - `prune` requires `--yes`
  - `use` without a name is invalid and should error instead of opening a selector

### `codex-auth save <name>`

Snapshot the current `auth.json` as a named account.

**Args:**
- `name` (required, positional): Account name. Must match `/^[a-zA-Z0-9_-]+$/`.
- `--overwrite` (optional): Overwrite an existing saved account without prompting.
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Validate `name` format.
2. Resolve auth.json path (see resolution order above).
3. If auth.json doesn't exist, error: `"No auth.json found. Log in with codex first."`
4. If account `name` already exists:
   - interactive mode: prompt for overwrite confirmation via clack confirm
   - non-interactive mode: require `--overwrite`
5. Copy auth.json contents to `~/.codex/accounts/<name>.json`.
6. Set `_active.json` to this account name.
7. Replace `~/.codex/auth.json` with a regular-file copy of the new snapshot (unlink old symlink first, if present).
8. Display success message with account name.

**Output:**
```
◆ Saved current session as "personal"
│ Copied to ~/.codex/accounts/personal.json
└ This account is now active.
```

### `codex-auth use [name]` / `codex-auth switch [name]`

Switch to a saved account.

**Args:**
- `name` (optional, positional): Account to switch to.
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior (with name):**
1. Check account exists in `~/.codex/accounts/<name>.json`. Error if not.
2. Fetch usage data for the target account (see Usage API section).
3. Display usage before switching (so user can confirm).
4. Copy snapshot to `~/.codex/auth.json` (regular file; unlink old symlink first if present).
5. Update `_active.json`.
6. Display success.

**Behavior (without name — interactive):**
1. List all saved accounts.
2. Fetch usage data for ALL accounts concurrently.
3. Display interactive selector (clack select) with usage bars inline:
   ```
   ◆ Select account
   │ ● personal (active)
   │   5hr: ████████░░ 78%  ·  weekly: ███░░░░░░░ 24%
   │ ○ work
   │   5hr: █░░░░░░░░░  6%  ·  weekly: ██░░░░░░░░ 15%
   │ ○ side-project
   │   5hr: ░░░░░░░░░░  0%  ·  weekly: █░░░░░░░░░  3%
   └
   ```
4. On selection, switch (same as named flow from step 2).

**Behavior (without name — non-interactive):**
1. Error with a clear message instructing the caller to pass an account name explicitly.

**Output (after switch):**
```
◆ Switched to "work"
│ 5hr:    █░░░░░░░░░  6% used  ·  resets in 3h 42m
│ weekly: ██░░░░░░░░ 15% used  ·  resets in 4d 11h
└
```

### `codex-auth list` / `codex-auth ls`

List all saved accounts with plan type and usage data. Expired accounts are flagged.

**Args:**
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Read all `.json` files in `~/.codex/accounts/` (excluding `_active.json`).
2. Read `_active.json` to determine active account.
3. Fetch usage for all accounts concurrently (with a spinner).
4. Classify each account's result via `classifyAccount()` (see Account Health Classification).
5. Display table with usage:
   ```
   ◆ Saved accounts
   │
   │ ● personal (active) [plus]
   │   5hr: ████████░░ 78%  ·  weekly: ███░░░░░░░ 24%  ·  resets in 1h 23m
   │
   │ ○ work [plus]
   │   5hr: █░░░░░░░░░  6%  ·  weekly: ██░░░░░░░░ 15%  ·  resets in 3h 42m
   │
   │ ○ old-account
   │   ⚠ session expired
   │
   │ ○ lapsed-account
   │   ⚠ subscription lapsed (free plan)
   │
   └ 4 accounts saved
   ```
6. If no accounts exist: `"No accounts saved. Run codex-auth save <name> to save your current session."`

**Account status display:**
- **Healthy accounts**: show plan type tag (e.g. `[plus]`, `[pro]`) and usage bars
- **Expired accounts** (auth errors, token revoked, free plan): red `⚠` with reason
- **Unknown errors** (network timeout, etc.): yellow `⚠ could not fetch usage (...)`

### `codex-auth current`

Show the currently active account and its usage.

**Args:**
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Read `_active.json`. If not found, print `"No active account. Run codex-auth use to select one."` and exit.
2. Verify the active account's snapshot file still exists.
3. Fetch usage for the active account.
4. Display:
   ```
   ◆ Active account: personal
   │ plan:   plus
   │ 5hr:    ████████░░ 78% used  ·  resets in 1h 23m
   │ weekly: ███░░░░░░░ 24% used  ·  resets in 4d 11h
   └
   ```
5. If credits are available, also show:
   ```
   │ credits: $5.39 remaining
   ```

### `codex-auth watch`

Live-refresh the current account usage in a terminal-oriented view.

**Args:**
- `--interval <seconds>` (optional): Refresh cadence. Default `5`. Minimum `1`.
- `--once` (optional): Render a single frame and exit instead of looping.

**Behavior:**
1. Resolve the current active account.
2. Render a bordered terminal view with:
   - account name
   - plan type (when available)
   - last update timestamp
   - refresh cadence
   - the current 5-hour and weekly usage lines
   - credits line when available
3. In looping mode, clear and redraw the terminal every interval until interrupted.
4. If there is no active account, no saved snapshot, or usage fetch fails, render that state in the watch view instead of crashing.

**Notes:**
- Live looping mode requires an interactive TTY.
- `--once` is allowed in non-interactive contexts and is intended for quick snapshots/tests.

### `codex-auth delete <name>` / `codex-auth remove <name>` / `codex-auth rm <name>`

Delete a saved account.

**Args:**
- `name` (required, positional): Account name to delete.
- `--yes` (optional): Delete without prompting.
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Validate `name` format.
2. Check account exists. Error if not.
3. If account is currently active, mention this in the confirmation prompt.
4. Confirm deletion:
   - interactive mode: prompt via clack confirm
   - non-interactive mode: require `--yes`
5. Remove `~/.codex/accounts/<name>.json`.
6. If deleted account was active, remove `_active.json` (no active account state).
7. Display success.

**Output:**
```
◆ Deleted "personal"
│ Removed ~/.codex/accounts/personal.json
│ No active account — run `codex-auth use` to select one.
└
```

### `codex-auth prune`

Check all accounts for expiry and delete expired ones after confirmation.

**Args:**
- `--yes` (optional): Delete expired accounts without prompting.
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. List all accounts. If none, show info and exit.
2. Fetch usage for all accounts concurrently (with a spinner).
3. Classify results via `findExpired()` (see Account Health Classification).
4. If no expired accounts: `"All accounts are healthy. Nothing to prune."`
5. Display expired accounts with reasons:
   ```
   ◆ Found 2 expired accounts
   │ ✕ old-account — session expired
   │ ✕ lapsed-account — subscription lapsed (free plan)
   ```
6. Confirm deletion:
   - interactive mode: prompt for confirmation
   - non-interactive mode: require `--yes`
7. Delete all expired accounts, track successes and failures.
8. Report results.

**Output:**
```
◆ 2 pruned, 0 failed
│ Deleted: old-account, lapsed-account
└
```

### `codex-auth export`

Export all saved accounts as a JSON object to stdout. Designed for piping — no interactive UI on stdout.

**Behavior:**
1. Read all account snapshots from `~/.codex/accounts/`.
2. Output a JSON object mapping account names to their `CodexAuth` data.
3. If no accounts exist, write error to stderr and exit 1.

**Output (stdout):**
```json
{
  "personal": { "OPENAI_API_KEY": null, "tokens": { ... }, "last_refresh": "..." },
  "work": { "OPENAI_API_KEY": null, "tokens": { ... }, "last_refresh": "..." }
}
```

Active account metadata (`_active.json`) is not exported — each machine manages its own active state.

### `codex-auth import [--overwrite]`

Import accounts from JSON on stdin.

**Args:**
- `--overwrite` (optional): Replace existing accounts. Without this flag, existing accounts are skipped.
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Read JSON from stdin (e.g. piped from `codex-auth export`).
2. Validate the input is a JSON object mapping names to `CodexAuth` data.
3. Reject a single raw `auth.json` payload with a clear error instructing the user to provide `codex-auth export` output instead.
4. For each entry: validate the name, skip if account exists (unless `--overwrite`), write snapshot.
5. Report results: how many imported, how many skipped.

**Usage:**
```bash
# Pipe between machines
codex-auth export | ssh vps 'codex-auth import'

# With overwrite
codex-auth export | ssh vps 'codex-auth import --overwrite'
```

### `codex-auth push <host> [--overwrite]`

Push all accounts to a remote host via SSH. Does not require `codex-auth` to be installed on the remote — writes snapshot files directly.

**Args:**
- `host` (required, positional): SSH host (e.g. `user@vps`, `vps-alias`).
- `--overwrite` (optional): Replace existing accounts on remote.
- `--json` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Export all local accounts.
2. SSH to host, create `~/.codex/accounts/` if needed.
3. For each account: check if remote file exists (skip unless `--overwrite`), write snapshot via SSH stdin.
4. Report results per-account (pushed/skipped/failed).

**Usage:**
```bash
codex-auth push my-vps
codex-auth push user@192.168.1.10 --overwrite
```

**Output:**
```
◆ my-vps: 2 pushed, 0 skipped
│ Pushed: personal, work
└
```

### `codex-auth update [version]` / `codex-auth upgrade [version]`

Check for or install a released `codex-auth` binary update.

**Args:**
- `version` (optional, positional): Install a specific version instead of the latest package release.
- `--check` (optional): Report install status and latest release without modifying anything.
- `--json` / `-j` (optional): Emit machine-readable JSON output.

**Behavior:**
1. Discover the current `codex-auth` executable from `PATH`.
2. Detect install mode:
   - regular file install: self-update supported
   - symlink/script install (for example `bun link`): self-update refused with an installer hint
3. Fetch release metadata from GitHub:
   - latest package release when no version is given
   - exact `codex-auth-v<version>` release when a version is supplied
4. Select the asset matching the current OS/arch.
5. `--check` prints the installed path/version, latest version, and whether self-update is supported.
6. `update` downloads the asset and atomically replaces the discovered executable path.

**Notes:**
- Self-update intentionally refuses Bun-linked or other symlink/script installs. Those should be updated by relinking from the repo or by reinstalling a released binary.
- On write-permission failures, the command should fail with a clear fallback installer command.

### Default Command (no subcommand)

Running bare `codex-auth` with no arguments should behave the same as `codex-auth use` (interactive mode). This is the primary UX entrypoint.

When JSON mode is enabled or an AI agent is detected, the default command should not enter interactive account selection and should instead instruct the caller to use an explicit subcommand.

### Version Shortcuts

Running `codex-auth -v` or `codex-auth -V` should print the package version to stdout and exit successfully.

---

## Usage API

### Endpoint

```
GET https://chatgpt.com/backend-api/wham/usage
```

### Request Headers

```
Authorization: Bearer <access_token>
Accept: application/json
User-Agent: codex-auth
ChatGPT-Account-Id: <account_id>   (from auth.tokens.account_id, if present)
```

### Response Shape

```typescript
interface UsageResponse {
  plan_type: string;
  rate_limit: {
    primary_window: RateWindow;   // 5hr session
    secondary_window: RateWindow; // 7-day weekly
  };
  code_review_rate_limit?: {
    primary_window: RateWindow;
  };
  credits?: {
    has_credits: boolean;
    unlimited: boolean;
    balance: number;
  };
  additional_rate_limits?: Array<{
    limit_name: string;
    metered_feature: string;
    rate_limit: {
      primary_window: RateWindow;
      secondary_window: RateWindow;
    };
  }>;
}

interface RateWindow {
  used_percent: number;          // 0-100
  reset_at: number;              // unix seconds
  limit_window_seconds: number;  // 18000 (5hr) or 604800 (7d)
}
```

### Token Refresh

Access tokens expire. Refresh when:
- A usage request returns 401 or 403
- `last_refresh` in auth.json is older than 8 days (proactive)

**Refresh request:**
```
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=app_EMoamEEZ73f0CkXaXp7hrann
&refresh_token=<refresh_token>
```

**On successful refresh:**
1. Update the access_token, refresh_token, and id_token in the account's snapshot file.
2. Update `last_refresh` to current ISO timestamp.

**Refresh error codes to handle:**
- `refresh_token_expired` → show "Session expired — re-login with `codex` CLI"
- `refresh_token_reused` → show "Token conflict — another session may have refreshed"
- `refresh_token_invalidated` → show "Token revoked"

### Timeout

- Usage fetch: 10 second timeout
- Token refresh: 15 second timeout

---

## Account Health Classification

The `expiry.ts` module provides a pure, dependency-free classification of account health. Used by `list` and `prune` commands.

### Heuristics

An account is classified as **expired** if any of the following are true:
- Usage fetch fails with an auth error (HTTP 401/403)
- Token refresh fails with `refresh_token_expired`, `refresh_token_reused`, or `refresh_token_invalidated`
- Usage fetch succeeds but `plan_type` is `"free"` (subscription lapsed, reverted to free tier)

An account is classified as **error** (not expired) if:
- Usage fetch fails with a non-auth error (network timeout, server 500, etc.)

These transient errors are not treated as expiry to avoid false positives.

### Error Pattern Matching

Classification uses string pattern matching against error messages rather than `instanceof` checks. This keeps the module free of imports from other lib files and trivially testable. The matched patterns correspond to stable error messages from `auth.ts` and `usage.ts`:

| Pattern | Reason |
| --- | --- |
| `"Session expired"` | session expired |
| `"Token revoked"` | token revoked |
| `"Token conflict"` | token conflict |
| `"Auth failed"` | auth failed |
| `planType === "free"` | subscription lapsed (free plan) |

---

## Type Definitions

```typescript
// ~/.codex/auth.json shape
interface CodexAuth {
  OPENAI_API_KEY: string | null;
  tokens: {
    access_token: string;
    refresh_token: string;
    id_token: string;
    account_id?: string;
  };
  last_refresh: string; // ISO 8601
}

// ~/.codex/accounts/_active.json
interface ActiveAccount {
  name: string;
  switched_at: string; // ISO 8601
}

// Internal account representation
interface Account {
  name: string;
  auth: CodexAuth;
  isActive: boolean;
}

// Account health classification (from expiry.ts)
type AccountStatus =
  | { state: 'ok'; usage: AccountUsage }
  | { state: 'expired'; reason: string }
  | { state: 'error'; message: string };

// Parsed usage for display
interface AccountUsage {
  planType: string;
  session: {
    usedPercent: number;
    resetAt: Date;
    windowSeconds: number;
  };
  weekly: {
    usedPercent: number;
    resetAt: Date;
    windowSeconds: number;
  };
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: number;
  };
}
```

---

## Display Helpers

### Progress Bar Rendering

10-character bar using Unicode block characters:

```
████████░░  78%    — high usage (red when >= 80%)
███░░░░░░░  24%    — moderate (yellow when >= 50%)
█░░░░░░░░░   6%    — low (green)
```

- `█` (U+2588) for filled
- `░` (U+2591) for empty
- Color thresholds: green < 50% < yellow < 80% < red

### Time Remaining

Format `reset_at` relative to now:
- `< 1hr`: `"Xm"` (e.g., `"42m"`)
- `1hr - 24hr`: `"Xh Ym"` (e.g., `"3h 42m"`)
- `> 24hr`: `"Xd Yh"` (e.g., `"4d 11h"`)

---

## Error Handling

| Scenario | Behavior |
| --- | --- |
| No auth.json found | Error message, suggest logging in with codex CLI |
| No accounts saved | Friendly message, suggest `codex-auth save` |
| Account name invalid | Error with allowed character pattern |
| Account not found | Error listing available accounts |
| Usage API unreachable | Show account with yellow warning (transient error) |
| Token expired / revoked | Classify as expired, show red warning with reason |
| Token refresh fails (auth) | Classify as expired, show red warning with reason |
| Plan downgraded to free | Classify as expired (subscription lapsed) |
| accounts dir doesn't exist | Create it automatically |
| Concurrent usage fetches fail partially | Show successful ones, classify failed ones |
| Delete active account | Remove snapshot and clear `_active.json` |
| Prune with no expired accounts | Friendly message, no action taken |

---

## Test Plan

All tests use `vitest`, invoked via Bun-managed package scripts (`bun run test`, `bun run test:watch`, `bun run gate`). Tests should mock filesystem and network operations — never touch real `~/.codex/` or hit real APIs.

### Unit Tests

#### `tests/accounts.test.ts` — Account CRUD

```
- saves auth.json as named snapshot
- rejects invalid account names (spaces, special chars, empty)
- lists all saved accounts alphabetically
- detects active account from _active.json
- creates accounts directory if missing
- overwrites existing account snapshot
- handles missing auth.json gracefully
- handles missing accounts directory gracefully
- reads auth.json from correct path based on resolution order
- handles old symlink migration (unlink then copy)
- copies snapshot to auth.json as a regular file
- updates _active.json on switch
- deletes account snapshot file
- clears _active.json when deleting active account
- preserves _active.json when deleting non-active account
- rejects delete with invalid name
- rejects delete of nonexistent account
- deleted account no longer appears in listAccounts
```

#### `tests/expiry.test.ts` — Account Health Classification

```
- returns ok for paid plan usage (plus, pro)
- returns expired for free plan (subscription lapsed)
- returns expired for session expired error
- returns expired for token revoked error
- returns expired for token conflict error
- returns expired for auth failed error
- returns expired for token refresh failed error
- returns error for unknown errors (network, etc.)
- findExpired returns only expired entries from mixed map
- findExpired returns empty map when all healthy
- findExpired returns all when all expired
```

#### `tests/auth.test.ts` — Auth & Token Refresh

```
- reads auth.json and parses tokens
- resolves auth path with CODEX_HOME env var
- resolves auth path from ~/.config/codex/
- resolves auth path from ~/.codex/
- detects when token refresh is needed (> 8 days)
- does not refresh when token is fresh
- refreshes token successfully
- handles refresh_token_expired error
- handles refresh_token_reused error
- handles refresh_token_invalidated error
- updates snapshot file after successful refresh
- retries usage fetch after 401 with refreshed token
- handles network timeout on refresh (15s)
```

#### `tests/usage.test.ts` — Usage API

```
- fetches usage data successfully
- parses primary_window (5hr) correctly
- parses secondary_window (7day) correctly
- parses credits when present
- handles missing credits gracefully
- handles missing code_review_rate_limit gracefully
- sends correct headers (auth, account-id, user-agent)
- handles 401 response (triggers refresh)
- handles 403 response (triggers refresh)
- handles network timeout (10s)
- handles malformed response body
- fetches multiple accounts concurrently
- handles partial failures in concurrent fetch
```

### Integration Tests (Command-level)

#### `tests/commands/save.test.ts`

```
- saves current auth as named account end-to-end
- errors when no auth.json exists
- errors on invalid name
- prompts for overwrite when account exists
- creates regular-file auth.json copy after save
- sets account as active after save
```

#### `tests/commands/use.test.ts`

```
- switches to named account
- errors when account doesn't exist
- interactive mode lists all accounts with usage
- interactive mode pre-selects current account
- updates auth.json by copying snapshot
- updates _active.json on switch
- displays usage after switch
- handles usage fetch failure gracefully during switch
```

#### `tests/commands/list.test.ts`

```
- lists all accounts with usage bars
- marks active account
- shows message when no accounts exist
- handles usage fetch failures per-account
- sorts accounts alphabetically
- shows plan type tag for healthy accounts
- shows expired status for auth errors
- shows expired status for free plan (subscription lapsed)
```

#### `tests/commands/delete.test.ts`

```
- deletes account after confirmation
- errors on invalid name
- errors when account not found
- exits when user cancels confirmation
- mentions active status in confirm message
```

#### `tests/commands/prune.test.ts`

```
- shows info when no accounts saved
- shows info when all accounts healthy
- deletes expired accounts after confirmation
- cancels when user declines
```

#### `tests/commands/current.test.ts`

```
- shows active account with usage
- shows message when no active account
- shows credits when available
- handles usage fetch failure
- handles missing snapshot file for active account
```

### Display Tests

```
- renders progress bar at 0%
- renders progress bar at 50%
- renders progress bar at 100%
- renders progress bar at boundary values (49%, 50%, 79%, 80%)
- applies correct colors at thresholds
- formats time remaining < 1hr
- formats time remaining 1-24hr
- formats time remaining > 24hr
- formats time remaining at boundary (exactly 1hr, exactly 24hr)
```

### Test Utilities

Create a `tests/helpers.ts` with:
- `createTmpDir()` — creates isolated temp directory for test filesystem ops
- `mockAuth(overrides?)` — generates a valid CodexAuth object
- `mockUsageResponse(overrides?)` — generates a valid UsageResponse
- `mockFetch(responses)` — intercepts fetch calls with predetermined responses

---

## Edge Cases & Notes

- If `auth.json` is a symlink from an older version, unlink it before copying the selected snapshot.
- Account names are case-sensitive (`Work` and `work` are different accounts).
- If the user runs `codex-auth save` while auth.json is already linked by an older version, read auth contents via resolved path and save the snapshot normally.
- The tool should never log or display tokens/secrets. Only show account names, usage percentages, and plan type.
- All file operations should use atomic writes where possible (write to temp file, then rename) to prevent corruption if interrupted.

---

## Future Considerations

- Auto-rotation: detect rate limit hit, auto-switch to least-loaded account
- macOS keychain support for auth reading
- `codex-auth rename <old> <new>` command
- Shell completions
- Integration with codex CLI as a wrapper/plugin
- Notifications when usage is approaching limits
