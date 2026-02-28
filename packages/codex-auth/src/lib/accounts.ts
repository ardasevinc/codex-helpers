import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Account, ActiveAccount, CodexAuth } from '../types.ts'
import { accountPath, accountsDir, activeFile, defaultAuthPath, validateName } from './paths.ts'

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

	// Replace auth.json with symlink
	const target = defaultAuthPath()
	if (existsSync(target) || isSymlinkAt(target)) {
		unlinkSync(target)
	}
	symlinkSync(resolve(dest), target)
}

export function switchAccount(name: string): void {
	const src = accountPath(name)
	if (!existsSync(src)) {
		throw new Error(`Account "${name}" not found.`)
	}

	const target = defaultAuthPath()
	if (existsSync(target) || isSymlinkAt(target)) {
		unlinkSync(target)
	}

	symlinkSync(resolve(src), target)
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

function setActive(name: string): void {
	const active: ActiveAccount = {
		name,
		switched_at: new Date().toISOString(),
	}
	atomicWrite(activeFile(), JSON.stringify(active, null, 2))
}

function atomicWrite(dest: string, content: string): void {
	const tmp = join(tmpdir(), `codex-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
