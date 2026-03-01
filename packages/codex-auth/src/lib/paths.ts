import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()

export const AUTH_FILE = 'auth.json'
export const NAME_REGEX = /^[a-zA-Z0-9_-]+$/

/** Mutable base dir — override in tests via `setCodexDir()` */
let codexDir = join(HOME, '.codex')

/** Override the codex base directory (for testing) */
export function setCodexDir(dir: string): void {
	codexDir = dir
}

/** Get the current codex base directory */
export function getCodexDir(): string {
	return codexDir
}

/** Default codex config directories in priority order */
function configDirs(): string[] {
	return [join(HOME, '.config', 'codex'), codexDir]
}

/** Where account snapshots live */
export function accountsDir(): string {
	return join(codexDir, 'accounts')
}

/** Path to the active account tracker */
export function activeFile(): string {
	return join(accountsDir(), '_active.json')
}

/** Resolve the auth.json path, checking CODEX_HOME first */
export function resolveAuthPath(): string | null {
	const codexHome = process.env.CODEX_HOME
	if (codexHome) {
		const p = join(codexHome, AUTH_FILE)
		if (existsSync(p)) return p
	}

	for (const dir of configDirs()) {
		const p = join(dir, AUTH_FILE)
		if (existsSync(p)) return p
	}

	return null
}

/** Get the default auth.json path used by the active Codex session */
export function defaultAuthPath(): string {
	const codexHome = process.env.CODEX_HOME
	if (codexHome) return join(codexHome, AUTH_FILE)
	return join(codexDir, AUTH_FILE)
}

/** Get the snapshot path for a named account */
export function accountPath(name: string): string {
	return join(accountsDir(), `${name}.json`)
}

/** Validate an account name */
export function validateName(name: string): boolean {
	return NAME_REGEX.test(name)
}
