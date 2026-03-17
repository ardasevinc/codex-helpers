import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as accounts from '../src/lib/accounts.ts'
import { accountPath, setCodexDir } from '../src/lib/paths.ts'
import { cleanTmpDir, createTmpDir, mockAuth, writeAuthFile } from './helpers.ts'

let tmpDir: string

beforeEach(() => {
	tmpDir = createTmpDir()
	setCodexDir(tmpDir)
})

afterEach(() => {
	cleanTmpDir(tmpDir)
	setCodexDir(join(require('node:os').homedir(), '.codex'))
})

describe('saveAccount', () => {
	test('saves auth.json as named snapshot', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const snapshotPath = accountPath('personal')
		expect(existsSync(snapshotPath)).toBe(true)

		const saved = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
		expect(saved.tokens.access_token).toBe('test-access-token')
	})

	test('creates accounts directory if missing', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('work', authPath)
		expect(existsSync(join(tmpDir, 'accounts'))).toBe(true)
	})

	test('creates regular file copy of snapshot', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const target = join(tmpDir, 'auth.json')
		expect(lstatSync(target).isFile()).toBe(true)
	})

	test('sets account as active after save', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const active = accounts.getActiveAccount()
		expect(active?.name).toBe('personal')
	})

	test('rejects invalid account names', () => {
		const authPath = writeAuthFile(tmpDir)
		expect(() => accounts.saveAccount('bad name', authPath)).toThrow('Invalid account name')
		expect(() => accounts.saveAccount('bad!name', authPath)).toThrow('Invalid account name')
		expect(() => accounts.saveAccount('', authPath)).toThrow('Invalid account name')
	})

	test('overwrites existing snapshot', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const newAuth = mockAuth({ tokens: { ...mockAuth().tokens, access_token: 'new-token' } })
		// Write new auth to a separate temp path
		const newAuthPath = join(tmpDir, 'auth-new.json')
		writeFileSync(newAuthPath, JSON.stringify(newAuth, null, 2))
		accounts.saveAccount('personal', newAuthPath)

		const snapshotPath = accountPath('personal')
		const saved = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
		expect(saved.tokens.access_token).toBe('new-token')
	})
})

describe('switchAccount', () => {
	test('switches to named account', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const newAuthPath = join(tmpDir, 'auth-work.json')
		writeFileSync(newAuthPath, JSON.stringify(mockAuth(), null, 2))
		accounts.saveAccount('work', newAuthPath)

		accounts.switchAccount('personal')
		const active = accounts.getActiveAccount()
		expect(active?.name).toBe('personal')
	})

	test('errors when account does not exist', () => {
		expect(() => accounts.switchAccount('nonexistent')).toThrow('not found')
	})

	test('copies snapshot to auth path on switch', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const target = join(tmpDir, 'auth.json')
		expect(lstatSync(target).isFile()).toBe(true)
	})
})

describe('snapshot isolation', () => {
	test('does not corrupt snapshot when auth.json is overwritten', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		// Simulate codex CLI overwriting auth.json with new account
		const target = join(tmpDir, 'auth.json')
		const newAuth = mockAuth({
			tokens: { ...mockAuth().tokens, access_token: 'different-account' },
		})
		writeFileSync(target, JSON.stringify(newAuth, null, 2))

		// Original snapshot should be untouched
		const snapshotPath = accountPath('personal')
		const saved = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
		expect(saved.tokens.access_token).toBe('test-access-token')
	})
})

describe('listAccounts', () => {
	test('returns empty array when no accounts', () => {
		expect(accounts.listAccounts()).toEqual([])
	})

	test('lists all saved accounts alphabetically', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('zeta', authPath)

		const newAuthPath = join(tmpDir, 'auth-alpha.json')
		writeFileSync(newAuthPath, JSON.stringify(mockAuth(), null, 2))
		accounts.saveAccount('alpha', newAuthPath)

		const list = accounts.listAccounts()
		expect(list.map((a) => a.name)).toEqual(['alpha', 'zeta'])
	})

	test('marks active account', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const list = accounts.listAccounts()
		const active = list.find((a) => a.name === 'personal')
		expect(active?.isActive).toBe(true)
	})
})

describe('exportAccounts', () => {
	test('returns all saved accounts as name→auth map', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const altAuth = mockAuth({
			tokens: { ...mockAuth().tokens, access_token: 'alt-token' },
		})
		const altPath = join(tmpDir, 'auth-alt.json')
		writeFileSync(altPath, JSON.stringify(altAuth, null, 2))
		accounts.saveAccount('alt', altPath)

		const exported = accounts.exportAccounts()
		expect(Object.keys(exported).sort()).toEqual(['alt', 'personal'])
		expect(exported.personal!.tokens.access_token).toBe('test-access-token')
		expect(exported.alt!.tokens.access_token).toBe('alt-token')
	})

	test('returns empty object when no accounts', () => {
		expect(accounts.exportAccounts()).toEqual({})
	})
})

describe('importAccounts', () => {
	test('accepts export-style account maps', () => {
		const data = {
			main: mockAuth(),
			alt: mockAuth({
				tokens: { ...mockAuth().tokens, access_token: 'alt-token' },
			}),
		}

		expect(accounts.validateImportData(data)).toEqual(data)
	})

	test('rejects a single raw auth.json payload', () => {
		const rawAuth = {
			auth_mode: 'chatgpt',
			...mockAuth(),
		}

		expect(() => accounts.validateImportData(rawAuth)).toThrow('single auth.json payload')
	})

	test('rejects invalid auth entries before import', () => {
		expect(() =>
			accounts.validateImportData({
				valid: mockAuth(),
				broken: {
					OPENAI_API_KEY: null,
					tokens: { access_token: 'x' },
					last_refresh: new Date().toISOString(),
				},
			}),
		).toThrow('Invalid auth data for account "broken".')
	})

	test('creates snapshot files for each entry', () => {
		const data = {
			main: mockAuth(),
			alt: mockAuth({
				tokens: { ...mockAuth().tokens, access_token: 'alt-token' },
			}),
		}

		const result = accounts.importAccounts(data)
		expect(result.imported.sort()).toEqual(['alt', 'main'])
		expect(result.skipped).toEqual([])

		const saved = JSON.parse(readFileSync(accountPath('main'), 'utf-8'))
		expect(saved.tokens.access_token).toBe('test-access-token')
	})

	test('skips existing accounts by default', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const data = {
			personal: mockAuth({
				tokens: { ...mockAuth().tokens, access_token: 'new-token' },
			}),
			fresh: mockAuth(),
		}

		const result = accounts.importAccounts(data)
		expect(result.imported).toEqual(['fresh'])
		expect(result.skipped).toEqual(['personal'])

		// Original should be untouched
		const saved = JSON.parse(readFileSync(accountPath('personal'), 'utf-8'))
		expect(saved.tokens.access_token).toBe('test-access-token')
	})

	test('overwrites existing accounts when overwrite is true', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const data = {
			personal: mockAuth({
				tokens: { ...mockAuth().tokens, access_token: 'overwritten' },
			}),
		}

		const result = accounts.importAccounts(data, true)
		expect(result.imported).toEqual(['personal'])

		const saved = JSON.parse(readFileSync(accountPath('personal'), 'utf-8'))
		expect(saved.tokens.access_token).toBe('overwritten')
	})

	test('skips invalid account names', () => {
		const data = { 'bad name': mockAuth(), valid: mockAuth() }
		const result = accounts.importAccounts(data)
		expect(result.imported).toEqual(['valid'])
		expect(result.skipped).toEqual(['bad name'])
	})
})

describe('deleteAccount', () => {
	test('removes snapshot file', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)
		expect(existsSync(accountPath('personal'))).toBe(true)

		accounts.deleteAccount('personal')
		expect(existsSync(accountPath('personal'))).toBe(false)
	})

	test('clears active tracker if deleted account was active', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)
		expect(accounts.getActiveAccount()?.name).toBe('personal')

		accounts.deleteAccount('personal')
		expect(accounts.getActiveAccount()).toBeNull()
	})

	test('preserves active tracker if deleted account was not active', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const workPath = join(tmpDir, 'auth-work.json')
		writeFileSync(workPath, JSON.stringify(mockAuth(), null, 2))
		accounts.saveAccount('work', workPath)

		// work is now active, delete personal
		accounts.deleteAccount('personal')
		expect(accounts.getActiveAccount()?.name).toBe('work')
	})

	test('throws on invalid name', () => {
		expect(() => accounts.deleteAccount('bad name')).toThrow('Invalid account name')
	})

	test('throws on nonexistent account', () => {
		expect(() => accounts.deleteAccount('ghost')).toThrow('not found')
	})

	test('account no longer appears in listAccounts', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const workPath = join(tmpDir, 'auth-work.json')
		writeFileSync(workPath, JSON.stringify(mockAuth(), null, 2))
		accounts.saveAccount('work', workPath)

		accounts.deleteAccount('personal')
		const names = accounts.listAccounts().map((a) => a.name)
		expect(names).toEqual(['work'])
	})
})

describe('getActiveAccount', () => {
	test('returns null when no active account', () => {
		expect(accounts.getActiveAccount()).toBeNull()
	})

	test('returns active account after save', () => {
		const authPath = writeAuthFile(tmpDir)
		accounts.saveAccount('personal', authPath)

		const active = accounts.getActiveAccount()
		expect(active?.name).toBe('personal')
		expect(active?.switched_at).toBeTruthy()
	})
})
