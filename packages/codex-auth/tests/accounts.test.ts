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
		// Write new auth to a temp path (not the symlinked one)
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
