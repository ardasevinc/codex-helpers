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
        ├── src/
        │   ├── cli.ts        # entry point, citty command definitions
        │   ├── commands/
        │   │   ├── save.ts   # `codex-auth save <name>`
        │   │   ├── use.ts    # `codex-auth use [name]`
        │   │   ├── list.ts   # `codex-auth list`
        │   │   ├── current.ts# `codex-auth current`
        │   │   ├── export.ts # `codex-auth export`
        │   │   ├── import.ts # `codex-auth import`
        │   │   └── push.ts   # `codex-auth push <host>`
        │   ├── lib/
        │   │   ├── accounts.ts   # account CRUD (snapshot, restore, list)
        │   │   ├── auth.ts       # auth.json reading, token refresh
        │   │   ├── usage.ts      # usage API fetching & parsing
        │   │   └── paths.ts      # path resolution constants
        │   └── types.ts      # shared type definitions
        └── tests/
            ├── accounts.test.ts
            ├── auth.test.ts
            ├── usage.test.ts
            └── commands/
                ├── save.test.ts
                ├── use.test.ts
                ├── list.test.ts
                └── current.test.ts
```

### Tech Stack

| Layer              | Library           | Version    | Purpose                          |
| ------------------ | ----------------- | ---------- | -------------------------------- |
| Runtime            | Bun               | latest     | Runtime, test runner, package mgr|
| CLI framework      | citty             | latest     | Command parsing, subcommands     |
| Interactive prompts | @clack/prompts   | latest     | Select menus, spinners, confirm  |
| Colors             | ansis             | latest     | Terminal color output             |
| Testing            | bun:test          | built-in   | Unit and integration tests       |

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

### `codex-auth save <name>`

Snapshot the current `auth.json` as a named account.

**Args:**
- `name` (required, positional): Account name. Must match `/^[a-zA-Z0-9_-]+$/`.

**Behavior:**
1. Validate `name` format.
2. Resolve auth.json path (see resolution order above).
3. If auth.json doesn't exist, error: `"No auth.json found. Log in with codex first."`
4. If account `name` already exists, prompt for overwrite confirmation via clack confirm.
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

### `codex-auth use [name]`

Switch to a saved account.

**Args:**
- `name` (optional, positional): Account to switch to.

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

**Output (after switch):**
```
◆ Switched to "work"
│ 5hr:    █░░░░░░░░░  6% used  ·  resets in 3h 42m
│ weekly: ██░░░░░░░░ 15% used  ·  resets in 4d 11h
└
```

### `codex-auth list`

List all saved accounts with usage data.

**Behavior:**
1. Read all `.json` files in `~/.codex/accounts/` (excluding `_active.json`).
2. Read `_active.json` to determine active account.
3. Fetch usage for all accounts concurrently (with a spinner).
4. Display table with usage:
   ```
   ◆ Saved accounts
   │
   │ ● personal (active)
   │   5hr: ████████░░ 78%  ·  weekly: ███░░░░░░░ 24%  ·  resets in 1h 23m
   │
   │ ○ work
   │   5hr: █░░░░░░░░░  6%  ·  weekly: ██░░░░░░░░ 15%  ·  resets in 3h 42m
   │
   │ ○ side-project
   │   5hr: ░░░░░░░░░░  0%  ·  weekly: █░░░░░░░░░  3%  ·  resets in 6d 2h
   │
   └ 3 accounts saved
   ```
5. If no accounts exist: `"No accounts saved. Run codex-auth save <name> to save your current session."`

**Error handling for usage fetch:**
- If usage fetch fails for an account (expired token, network error), show the account with a warning instead of usage bars:
  ```
  │ ○ old-account
  │   ⚠ could not fetch usage (token expired)
  ```

### `codex-auth current`

Show the currently active account and its usage.

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

**Behavior:**
1. Read JSON from stdin (e.g. piped from `codex-auth export`).
2. Validate the input is a JSON object mapping names to `CodexAuth` data.
3. For each entry: validate the name, skip if account exists (unless `--overwrite`), write snapshot.
4. Report results: how many imported, how many skipped.

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

### Default Command (no subcommand)

Running bare `codex-auth` with no arguments should behave the same as `codex-auth use` (interactive mode). This is the primary UX entrypoint.

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
| Usage API unreachable | Show account without usage, warn |
| Token expired | Attempt refresh, if fails show "token expired" inline |
| Token refresh fails | Show specific error, suggest re-login |
| accounts dir doesn't exist | Create it automatically |
| Concurrent usage fetches fail partially | Show successful ones, warn on failed ones |

---

## Test Plan

All tests use `bun:test`. Tests should mock filesystem and network operations — never touch real `~/.codex/` or hit real APIs.

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
- `codex-auth remove <name>` command
- `codex-auth rename <old> <new>` command
- Shell completions
- Integration with codex CLI as a wrapper/plugin
- Notifications when usage is approaching limits
