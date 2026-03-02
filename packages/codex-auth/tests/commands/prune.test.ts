import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AccountUsage } from '../../src/types.ts'
import { ExitError, importFresh, mockPrompts, runCommand, stubProcessExit } from './helpers.ts'

afterEach(() => {
	mock.restore()
})

function okUsage(): AccountUsage {
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

describe('pruneCommand', () => {
	test('shows info when no accounts saved', async () => {
		const prompts = mockPrompts()

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => []),
			deleteAccount: mock(() => {}),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(async () => new Map()),
		}))

		const { pruneCommand } = await importFresh<typeof import('../../src/commands/prune.ts')>(
			'../../src/commands/prune.ts',
		)
		await runCommand(pruneCommand, {})

		expect(prompts.info).toHaveBeenCalledWith('No accounts saved.')
	})

	test('shows info when all accounts healthy', async () => {
		const prompts = mockPrompts()

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [{ name: 'a', auth: {} as never, isActive: true }]),
			deleteAccount: mock(() => {}),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(async () => new Map<string, AccountUsage | Error>([['a', okUsage()]])),
		}))

		const { pruneCommand } = await importFresh<typeof import('../../src/commands/prune.ts')>(
			'../../src/commands/prune.ts',
		)
		await runCommand(pruneCommand, {})

		expect(prompts.info).toHaveBeenCalledWith('All accounts are healthy. Nothing to prune.')
	})

	test('deletes expired accounts after confirmation', async () => {
		const prompts = mockPrompts({ confirmResult: true })
		const deleteAccount = mock((_name: string) => {})
		const logs: string[] = []
		const originalLog = console.log
		console.log = mock((...args: unknown[]) => {
			logs.push(args.map(String).join(' '))
		}) as typeof console.log

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [
				{ name: 'healthy', auth: {} as never, isActive: true },
				{ name: 'dead', auth: {} as never, isActive: false },
				{ name: 'lapsed', auth: {} as never, isActive: false },
			]),
			deleteAccount,
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['healthy', okUsage()],
						['dead', new Error('Session expired — re-login with `codex` CLI')],
						['lapsed', { ...okUsage(), planType: 'free' }],
					]),
			),
		}))

		try {
			const { pruneCommand } = await importFresh<typeof import('../../src/commands/prune.ts')>(
				'../../src/commands/prune.ts',
			)
			await runCommand(pruneCommand, {})
		} finally {
			console.log = originalLog
		}

		expect(deleteAccount).toHaveBeenCalledTimes(2)
		expect(prompts.confirm).toHaveBeenCalled()
		expect(prompts.note).toHaveBeenCalled()
		expect(logs.some((line) => line.includes('dead'))).toBe(true)
		expect(logs.some((line) => line.includes('lapsed'))).toBe(true)
	})

	test('cancels when user declines', async () => {
		const prompts = mockPrompts({ confirmResult: false })
		const exit = stubProcessExit()
		const deleteAccount = mock((_name: string) => {})

		mock.module('../../src/lib/accounts.ts', () => ({
			listAccounts: mock(() => [{ name: 'dead', auth: {} as never, isActive: false }]),
			deleteAccount,
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['dead', new Error('Auth failed with status 401')],
					]),
			),
		}))

		try {
			const { pruneCommand } = await importFresh<typeof import('../../src/commands/prune.ts')>(
				'../../src/commands/prune.ts',
			)
			await expect(runCommand(pruneCommand, {})).rejects.toBeInstanceOf(ExitError)
			expect(deleteAccount).not.toHaveBeenCalled()
			expect(prompts.cancel).toHaveBeenCalled()
		} finally {
			exit.restore()
		}
	})
})
