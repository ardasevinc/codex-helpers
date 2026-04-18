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
			usedPercent: 70,
			resetAt: new Date(Date.now() + 2 * 3_600_000),
			windowSeconds: 18_000,
		},
		weekly: {
			usedPercent: 33,
			resetAt: new Date(Date.now() + 4 * 86_400_000),
			windowSeconds: 604_800,
		},
		credits: {
			hasCredits: true,
			unlimited: false,
			balance: 5.39,
		},
	}
}

describe('currentCommand', () => {
	test('shows message when no active account exists', async () => {
		const prompts = mockPrompts()
		mock.module('../../src/lib/accounts.ts', () => ({
			getActiveAccount: mock(() => null),
			accountExists: mock((_name: string) => false),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: mock(async (_name: string) => sampleUsage()),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: mock((_usage: AccountUsage) => ['line 1']),
		}))

		const { currentCommand } = await importFresh<typeof import('../../src/commands/current.ts')>(
			'../../src/commands/current.ts',
		)
		await runCommand(currentCommand, {})

		expect(prompts.info).toHaveBeenCalledWith(
			'No active account. Run `codex-auth use` to select one.',
		)
	})

	test('warns when active snapshot is missing', async () => {
		const prompts = mockPrompts()
		mock.module('../../src/lib/accounts.ts', () => ({
			getActiveAccount: mock(() => ({ name: 'personal', switched_at: new Date().toISOString() })),
			accountExists: mock((_name: string) => false),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: mock(async (_name: string) => sampleUsage()),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: mock((_usage: AccountUsage) => ['line 1']),
		}))

		const { currentCommand } = await importFresh<typeof import('../../src/commands/current.ts')>(
			'../../src/commands/current.ts',
		)
		await runCommand(currentCommand, {})

		expect(prompts.warn).toHaveBeenCalledWith(
			'Active account "personal" not found — snapshot may have been deleted.',
		)
	})

	test('shows active account usage', async () => {
		const prompts = mockPrompts()
		const usage = sampleUsage()

		mock.module('../../src/lib/accounts.ts', () => ({
			getActiveAccount: mock(() => ({ name: 'personal', switched_at: new Date().toISOString() })),
			accountExists: mock((_name: string) => true),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: mock(async (_name: string) => usage),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: mock((_usage: AccountUsage) => [
				'5hr line',
				'weekly line',
				'credits line',
			]),
		}))

		const { currentCommand } = await importFresh<typeof import('../../src/commands/current.ts')>(
			'../../src/commands/current.ts',
		)
		await runCommand(currentCommand, {})

		expect(prompts.note).toHaveBeenCalled()
		const [body, title] = prompts.note.mock.calls[0] as [string, string]
		expect(title).toBe('Active account: personal')
		expect(body).toContain('plan:')
		expect(body).toContain('plus')
		expect(body).toContain('5hr line')
	})

	test('emits JSON output for the active account', async () => {
		mockPrompts()
		mockAgent('codex')
		const usage = sampleUsage()
		const consoleCapture = captureConsole()

		mock.module('../../src/lib/accounts.ts', () => ({
			getActiveAccount: mock(() => ({ name: 'personal', switched_at: '2026-04-12T10:00:00.000Z' })),
			accountExists: mock((_name: string) => true),
		}))
		mock.module('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: mock(async (_name: string) => usage),
		}))
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: mock(() => ['unused']),
		}))

		try {
			const { currentCommand } = await importFresh<typeof import('../../src/commands/current.ts')>(
				'../../src/commands/current.ts',
			)
			await runCommand(currentCommand, { args: { json: true } })
		} finally {
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			status: string
			active: { name: string; switchedAt: string; snapshotExists: boolean }
			usage: { planType: string; credits?: { balance: number } }
		}
		expect(payload.ok).toBe(true)
		expect(payload.status).toBe('ok')
		expect(payload.active.name).toBe('personal')
		expect(payload.usage.planType).toBe('plus')
		expect(payload.usage.credits?.balance).toBe(5.39)
	})
})
