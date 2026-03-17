import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { Account, ActiveAccount, CodexAuth } from '../types.ts'
import { accountPath, accountsDir, activeFile, defaultAuthPath, validateName } from './paths.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isCodexAuth(value: unknown): value is CodexAuth {
	if (!isRecord(value)) return false
	if (!('OPENAI_API_KEY' in value)) return false
	if (!('tokens' in value)) return false
	if (!('last_refresh' in value)) return false

	if (value.OPENAI_API_KEY !== null && typeof value.OPENAI_API_KEY !== 'string') {
		return false
	}
	if (typeof value.last_refresh !== 'string') return false
	if (!isRecord(value.tokens)) return false

	return (
		typeof value.tokens.access_token === 'string' &&
		typeof value.tokens.refresh_token === 'string' &&
		typeof value.tokens.id_token === 'string' &&
		(value.tokens.account_id === undefined || typeof value.tokens.account_id === 'string')
	)
}

export function validateImportData(data: unknown): Record<string, CodexAuth> {
	if (!isRecord(data)) {
		throw new Error('Expected a JSON object mapping account names to auth data.')
	}

	if (isCodexAuth(data)) {
		throw new Error(
			'Received a single auth.json payload. `codex-auth import` expects `codex-auth export` output mapping account names to auth data.',
		)
	}

	for (const [name, auth] of Object.entries(data)) {
		if (!isCodexAuth(auth)) {
			throw new Error(`Invalid auth data for account "${name}".`)
		}
	}

	return data as Record<string, CodexAuth>
}

export function ensureAccountsDir(): void {
	const dir = accountsDir()
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
}

export function saveAccount(name: string, authPath: string): void {
	if (!validateName(name)) {
		throw new Error(
			`Invalid account name "${name}". Use only letters, numbers, hyphens, and underscores.`,
		)
	}

	const authContent = readFileSync(authPath, 'utf-8')
	const auth = JSON.parse(authContent) as CodexAuth

	ensureAccountsDir()

	const dest = accountPath(name)
	atomicWrite(dest, JSON.stringify(auth, null, 2))

	setActive(name)

	// Copy snapshot to auth.json (regular file, not symlink)
	const target = defaultAuthPath()
	if (isSymlinkAt(target)) {
		unlinkSync(target)
	}
	copyFileSync(accountPath(name), target)
}

export function switchAccount(name: string): void {
	const src = accountPath(name)
	if (!existsSync(src)) {
		throw new Error(`Account "${name}" not found.`)
	}

	const target = defaultAuthPath()
	if (isSymlinkAt(target)) {
		unlinkSync(target)
	}
	copyFileSync(src, target)
	setActive(name)
}

export function listAccounts(): Account[] {
	const dir = accountsDir()
	if (!existsSync(dir)) return []

	const active = getActiveAccount()
	const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== '_active.json')

	return files
		.map((f) => {
			const name = f.replace(/\.json$/, '')
			if (!validateName(name)) return null
			try {
				const content = readFileSync(join(dir, f), 'utf-8')
				const auth = JSON.parse(content) as CodexAuth
				return { name, auth, isActive: active?.name === name }
			} catch {
				return null
			}
		})
		.filter((a): a is Account => a !== null)
		.sort((a, b) => a.name.localeCompare(b.name))
}

export function getActiveAccount(): ActiveAccount | null {
	const path = activeFile()
	if (!existsSync(path)) return null
	try {
		const content = readFileSync(path, 'utf-8')
		return JSON.parse(content) as ActiveAccount
	} catch {
		return null
	}
}

export function accountExists(name: string): boolean {
	return existsSync(accountPath(name))
}

export function exportAccounts(): Record<string, CodexAuth> {
	const dir = accountsDir()
	if (!existsSync(dir)) return {}

	const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== '_active.json')
	const result: Record<string, CodexAuth> = {}

	for (const f of files) {
		const name = f.replace(/\.json$/, '')
		if (!validateName(name)) continue
		try {
			const content = readFileSync(join(dir, f), 'utf-8')
			result[name] = JSON.parse(content) as CodexAuth
		} catch {
			// skip corrupted snapshots
		}
	}

	return result
}

export function importAccounts(
	data: Record<string, CodexAuth>,
	overwrite = false,
): { imported: string[]; skipped: string[] } {
	const imported: string[] = []
	const skipped: string[] = []

	ensureAccountsDir()

	for (const [name, auth] of Object.entries(data)) {
		if (!validateName(name)) {
			skipped.push(name)
			continue
		}
		if (!overwrite && accountExists(name)) {
			skipped.push(name)
			continue
		}
		atomicWrite(accountPath(name), JSON.stringify(auth, null, 2))
		imported.push(name)
	}

	return { imported, skipped }
}

export function deleteAccount(name: string): void {
	if (!validateName(name)) {
		throw new Error(
			`Invalid account name "${name}". Use only letters, numbers, hyphens, and underscores.`,
		)
	}

	const path = accountPath(name)
	if (!existsSync(path)) {
		throw new Error(`Account "${name}" not found.`)
	}

	unlinkSync(path)

	const active = getActiveAccount()
	if (active?.name === name) {
		const af = activeFile()
		if (existsSync(af)) {
			unlinkSync(af)
		}
	}
}

function setActive(name: string): void {
	const active: ActiveAccount = {
		name,
		switched_at: new Date().toISOString(),
	}
	atomicWrite(activeFile(), JSON.stringify(active, null, 2))
}

function atomicWrite(dest: string, content: string): void {
	const tmp = join(
		dirname(dest),
		`.codex-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	)
	writeFileSync(tmp, content, 'utf-8')
	renameSync(tmp, dest)
}

function isSymlinkAt(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink()
	} catch {
		return false
	}
}
