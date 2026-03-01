import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AccountUsage } from '../../src/types.ts'
import { ExitError, importFresh, mockPrompts, runCommand, stubProcessExit } from './helpers.ts'

afterEach(() => {
	mock.restore()
})

function sampleUsage(): AccountUsage {
	return {
		planType: 'plus',
		session: {
			usedPercent: 20,
			resetAt: new Date(Date.now() + 3_600_000),
			windowSeconds: 18_000,
		},
		weekly: {
			usedPercent: 15,
			resetAt: new Date(Date.now() + 2 * 86_400_000),
			windowSeconds: 604_800,
		},
	}
}

describe('useCommand', () => {
	test('switches to named account and shows usage', async () => {
		const prompts = mockPrompts()
		const switchAccount = mock((_name: string) => {})
		const fetchUsageForAccount = mock(async (_name: string) => sampleUsage())
		const formatAccountUsage = mock((_usage: AccountUsage) => ['line 1', 'line 2'])

		mock.module('../../src/lib/accounts.ts', () => ({
			switchAccount,
			listAccounts: mock(() => []),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount,
			fetchAllUsage: mock(async () => new Map()),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage,
			formatUsageCompact: mock((_usage: AccountUsage) => 'compact'),
		}))

		const { useCommand } = await importFresh<typeof import('../../src/commands/use.ts')>(
			'../../src/commands/use.ts',
		)

		await runCommand(useCommand, { args: { name: 'work' } })

		expect(fetchUsageForAccount).toHaveBeenCalledWith('work')
		expect(switchAccount).toHaveBeenCalledWith('work')
		expect(prompts.note).toHaveBeenCalledWith('line 1\nline 2', 'Switched to "work"')
	})

	test('fails when switching to missing account', async () => {
		const prompts = mockPrompts()
		const exit = stubProcessExit()

		mock.module('../../src/lib/accounts.ts', () => ({
			switchAccount: mock((_name: string) => {
				throw new Error('Account "missing" not found.')
			}),
			listAccounts: mock(() => []),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: mock(async (_name: string) => sampleUsage()),
			fetchAllUsage: mock(async () => new Map()),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: mock((_usage: AccountUsage) => ['line 1']),
			formatUsageCompact: mock((_usage: AccountUsage) => 'compact'),
		}))

		try {
			const { useCommand } = await importFresh<typeof import('../../src/commands/use.ts')>(
				'../../src/commands/use.ts',
			)
			await expect(runCommand(useCommand, { args: { name: 'missing' } })).rejects.toBeInstanceOf(
				ExitError,
			)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			expect(prompts.cancel).toHaveBeenCalled()
		} finally {
			exit.restore()
		}
	})

	test('interactive mode preselects active account', async () => {
		const prompts = mockPrompts({ selectResult: 'work' })
		const usage = sampleUsage()
		const switchAccount = mock((_name: string) => {})

		mock.module('../../src/lib/accounts.ts', () => ({
			switchAccount,
			listAccounts: mock(() => [
				{ name: 'personal', auth: {} as never, isActive: true },
				{ name: 'work', auth: {} as never, isActive: false },
			]),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: mock(async (_name: string) => usage),
			fetchAllUsage: mock(
				async () =>
					new Map<string, AccountUsage | Error>([
						['personal', usage],
						['work', usage],
					]),
			),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: mock((_usage: AccountUsage) => ['line 1']),
			formatUsageCompact: mock((_usage: AccountUsage) => 'compact'),
		}))

		const { useCommand } = await importFresh<typeof import('../../src/commands/use.ts')>(
			'../../src/commands/use.ts',
		)

		await runCommand(useCommand, { args: {} })

		expect(prompts.select).toHaveBeenCalledWith(
			expect.objectContaining({
				initialValue: 'personal',
			}),
		)
		expect(switchAccount).toHaveBeenCalledWith('work')
	})
})
