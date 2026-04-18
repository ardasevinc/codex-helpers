import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import type { CodexAuth, UsageResponse } from '../src/types.ts'

const mockedModules = new Set<string>()
let mockBaseUrl: string | null = null
type DoMockFactory = Exclude<Parameters<typeof vi.doMock>[1], undefined | { spy?: boolean }>

export function setMockBaseUrl(url: string) {
	mockBaseUrl = url
}

export function mockModule(path: string, factory: DoMockFactory) {
	const resolved =
		path.startsWith('.') && mockBaseUrl ? fileURLToPath(new URL(path, mockBaseUrl)) : path
	mockedModules.add(resolved)
	vi.doUnmock(resolved)
	vi.doMock(resolved, factory)
}

export function resetTestState() {
	vi.restoreAllMocks()
	vi.resetAllMocks()
	vi.clearAllMocks()
	vi.unstubAllGlobals()
	vi.resetModules()

	for (const path of mockedModules) {
		vi.doUnmock(path)
	}

	mockedModules.clear()
}

/** Create an isolated temp directory for test filesystem ops */
export function createTmpDir(): string {
	return mkdtempSync(join(tmpdir(), 'codex-auth-test-'))
}

/** Clean up a temp directory */
export function cleanTmpDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true })
}

/** Generate a valid CodexAuth object */
export function mockAuth(overrides?: Partial<CodexAuth>): CodexAuth {
	return {
		OPENAI_API_KEY: null,
		tokens: {
			access_token: 'test-access-token',
			refresh_token: 'test-refresh-token',
			id_token: 'test-id-token',
			account_id: 'test-account-id',
			...overrides?.tokens,
		},
		last_refresh: new Date().toISOString(),
		...overrides,
		// Re-apply tokens after spread to handle nested override
		...(overrides?.tokens ? { tokens: { ...mockAuth().tokens, ...overrides.tokens } } : {}),
	}
}

/** Generate a valid UsageResponse */
export function mockUsageResponse(overrides?: Partial<UsageResponse>): UsageResponse {
	const now = Math.floor(Date.now() / 1000)
	return {
		plan_type: 'plus',
		rate_limit: {
			primary_window: {
				used_percent: 25,
				reset_at: now + 3600,
				limit_window_seconds: 18000,
			},
			secondary_window: {
				used_percent: 10,
				reset_at: now + 86400 * 3,
				limit_window_seconds: 604800,
			},
		},
		...overrides,
	}
}

/** Write a mock auth.json to a directory */
export function writeAuthFile(dir: string, auth?: CodexAuth): string {
	const authPath = join(dir, 'auth.json')
	writeFileSync(authPath, JSON.stringify(auth ?? mockAuth(), null, 2))
	return authPath
}

/** Set up an accounts dir with named snapshots */
export function setupAccounts(
	baseDir: string,
	accounts: Array<{ name: string; auth?: CodexAuth; active?: boolean }>,
): string {
	const accountsDir = join(baseDir, 'accounts')
	mkdirSync(accountsDir, { recursive: true })

	for (const acc of accounts) {
		writeFileSync(
			join(accountsDir, `${acc.name}.json`),
			JSON.stringify(acc.auth ?? mockAuth(), null, 2),
		)
	}

	const activeAcc = accounts.find((a) => a.active)
	if (activeAcc) {
		writeFileSync(
			join(accountsDir, '_active.json'),
			JSON.stringify({ name: activeAcc.name, switched_at: new Date().toISOString() }),
		)
	}

	return accountsDir
}
