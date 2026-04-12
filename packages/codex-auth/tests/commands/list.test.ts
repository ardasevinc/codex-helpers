import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AccountUsage } from '../../src/types.ts'
import { captureConsole, importFresh, mockAgent, mockPrompts, runCommand } from './helpers.ts'

afterEach(() => {
	mock.restore()
})

function sampleUsage(): AccountUsage {
	return {
		planType: 'plus',
		session: {
			usedPercent: 42,
			resetAt: new Date(Date.now() + 1_800_000),
			windowSeconds: 18_000,
		},
		weekly: {
			usedPercent: 12,
			resetAt: new Date(Date.now() + 3 * 86_400_000),
			windowSeconds: 604_800,
		},
	}
}

describe('listCommand', () => {
	test('shows friendly message when no accounts exist', async () => {
		const prompts = mockPrompts()
		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => []),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(async () => new Map()),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatUsageLine: mock(() => ''),
		}))

		const { listCommand } = await importFresh<typeof import('../../src/commands/list.ts')>(
			'../../src/commands/list.ts',
		)
		await runCommand(listCommand, {})

		expect(prompts.info).toHaveBeenCalledWith(
			'No accounts saved. Run `codex-auth save <name>` to save your current session.',
		)
	})

	test('renders accounts and handles per-account usage failures', async () => {
		const prompts = mockPrompts()
		const usage = sampleUsage()
		const logs: string[] = []
		const originalLog = console.log
		console.log = mock((...args: unknown[]) => {
			logs.push(args.map(String).join(' '))
		}) as typeof console.log

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [
				{ name: 'personal', auth: {} as never, isActive: true },
				{ name: 'work', auth: {} as never, isActive: false },
			]),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['personal', usage],
						['work', new Error('network timeout')],
					]),
			),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatUsageLine: mock((label: string) => `${label}: line`),
		}))

		try {
			const { listCommand } = await importFresh<typeof import('../../src/commands/list.ts')>(
				'../../src/commands/list.ts',
			)
			await runCommand(listCommand, {})
		} finally {
			console.log = originalLog
		}

		expect(prompts.intro).toHaveBeenCalledWith('Saved accounts')
		expect(prompts.outro).toHaveBeenCalledWith('2 accounts saved')
		expect(logs.some((line) => line.includes('personal'))).toBe(true)
		expect(logs.some((line) => line.includes('[plus]'))).toBe(true)
		expect(logs.some((line) => line.includes('could not fetch usage (network timeout)'))).toBe(true)
	})

	test('shows plan type tag for healthy accounts', async () => {
		mockPrompts()
		const logs: string[] = []
		const originalLog = console.log
		console.log = mock((...args: unknown[]) => {
			logs.push(args.map(String).join(' '))
		}) as typeof console.log

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [{ name: 'pro-acc', auth: {} as never, isActive: false }]),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['pro-acc', { ...sampleUsage(), planType: 'pro' }],
					]),
			),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatUsageLine: mock((label: string) => `${label}: line`),
		}))

		try {
			const { listCommand } = await importFresh<typeof import('../../src/commands/list.ts')>(
				'../../src/commands/list.ts',
			)
			await runCommand(listCommand, {})
		} finally {
			console.log = originalLog
		}

		expect(logs.some((line) => line.includes('[pro]'))).toBe(true)
	})

	test('shows expired status for auth errors', async () => {
		mockPrompts()
		const logs: string[] = []
		const originalLog = console.log
		console.log = mock((...args: unknown[]) => {
			logs.push(args.map(String).join(' '))
		}) as typeof console.log

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [{ name: 'dead', auth: {} as never, isActive: false }]),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['dead', new Error('Session expired — re-login with `codex` CLI')],
					]),
			),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatUsageLine: mock(() => ''),
		}))

		try {
			const { listCommand } = await importFresh<typeof import('../../src/commands/list.ts')>(
				'../../src/commands/list.ts',
			)
			await runCommand(listCommand, {})
		} finally {
			console.log = originalLog
		}

		expect(logs.some((line) => line.includes('session expired'))).toBe(true)
	})

	test('shows expired status for free plan', async () => {
		mockPrompts()
		const logs: string[] = []
		const originalLog = console.log
		console.log = mock((...args: unknown[]) => {
			logs.push(args.map(String).join(' '))
		}) as typeof console.log

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [{ name: 'lapsed', auth: {} as never, isActive: false }]),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['lapsed', { ...sampleUsage(), planType: 'free' }],
					]),
			),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatUsageLine: mock(() => ''),
		}))

		try {
			const { listCommand } = await importFresh<typeof import('../../src/commands/list.ts')>(
				'../../src/commands/list.ts',
			)
			await runCommand(listCommand, {})
		} finally {
			console.log = originalLog
		}

		expect(logs.some((line) => line.includes('subscription lapsed (free plan)'))).toBe(true)
	})

	test('emits JSON output', async () => {
		mockPrompts()
		mockAgent('codex')
		const usage = sampleUsage()
		const consoleCapture = captureConsole()

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [
				{ name: 'personal', auth: {} as never, isActive: true },
				{ name: 'dead', auth: {} as never, isActive: false },
			]),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['personal', usage],
						['dead', new Error('Session expired — re-login with `codex` CLI')],
					]),
			),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatUsageLine: mock(() => ''),
		}))

		try {
			const { listCommand } = await importFresh<typeof import('../../src/commands/list.ts')>(
				'../../src/commands/list.ts',
			)
			await runCommand(listCommand, { args: { json: true } })
		} finally {
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			accounts: Array<{ name: string; status: string; isActive: boolean }>
			summary: { total: number; active: string | null; ok: number; expired: number; error: number }
		}
		expect(payload.ok).toBe(true)
		expect(payload.summary).toEqual({
			total: 2,
			active: 'personal',
			ok: 1,
			expired: 1,
			error: 0,
		})
		expect(payload.accounts[0]?.name).toBe('personal')
		expect(payload.accounts[1]?.status).toBe('expired')
	})
})
