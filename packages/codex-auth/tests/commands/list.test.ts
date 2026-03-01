import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AccountUsage } from '../../src/types.ts'
import { importFresh, mockPrompts, runCommand } from './helpers.ts'

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
						['work', new Error('token expired')],
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
		expect(logs.some((line) => line.includes('could not fetch usage (token expired)'))).toBe(true)
	})
})
