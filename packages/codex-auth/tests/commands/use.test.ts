import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AccountUsage } from '../../src/types.ts'
import {
	captureConsole,
	ExitError,
	importFresh,
	mockAgent,
	mockModule,
	mockPrompts,
	resetTestState,
	runCommand,
	setMockBaseUrl,
	stubProcessExit,
} from './helpers.ts'

setMockBaseUrl(import.meta.url)

afterEach(() => {
	resetTestState()
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
		const switchAccount = vi.fn((_name: string) => {})
		const fetchUsageForAccount = vi.fn(async (_name: string) => sampleUsage())
		const formatAccountUsage = vi.fn((_usage: AccountUsage) => ['line 1', 'line 2'])

		mockModule('../../src/lib/accounts.ts', () => ({
			switchAccount,
			listAccounts: vi.fn(() => []),
		}))
		mockModule('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount,
			fetchAllUsage: vi.fn(async () => new Map()),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage,
			formatUsageCompact: vi.fn((_usage: AccountUsage) => 'compact'),
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

		mockModule('../../src/lib/accounts.ts', () => ({
			switchAccount: vi.fn((_name: string) => {
				throw new Error('Account "missing" not found.')
			}),
			listAccounts: vi.fn(() => []),
		}))
		mockModule('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: vi.fn(async (_name: string) => sampleUsage()),
			fetchAllUsage: vi.fn(async () => new Map()),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn((_usage: AccountUsage) => ['line 1']),
			formatUsageCompact: vi.fn((_usage: AccountUsage) => 'compact'),
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
		const switchAccount = vi.fn((_name: string) => {})

		mockModule('../../src/lib/accounts.ts', () => ({
			switchAccount,
			listAccounts: vi.fn(() => [
				{ name: 'personal', auth: {} as never, isActive: true },
				{ name: 'work', auth: {} as never, isActive: false },
			]),
		}))
		mockModule('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: vi.fn(async (_name: string) => usage),
			fetchAllUsage: vi.fn(
				async () =>
					new Map<string, AccountUsage | Error>([
						['personal', usage],
						['work', usage],
					]),
			),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn((_usage: AccountUsage) => ['line 1']),
			formatUsageCompact: vi.fn((_usage: AccountUsage) => 'compact'),
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

	test('requires a name in agent mode', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const exit = stubProcessExit()

		mockModule('../../src/lib/accounts.ts', () => ({
			switchAccount: vi.fn(() => {}),
			listAccounts: vi.fn(() => []),
		}))
		mockModule('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: vi.fn(async () => sampleUsage()),
			fetchAllUsage: vi.fn(async () => new Map()),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn(() => []),
			formatUsageCompact: vi.fn(() => 'compact'),
		}))

		try {
			const { useCommand } = await importFresh<typeof import('../../src/commands/use.ts')>(
				'../../src/commands/use.ts',
			)
			await expect(runCommand(useCommand, { args: {} })).rejects.toBeInstanceOf(ExitError)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			expect(consoleCapture.errors.at(-1)).toContain(
				'Interactive account selection is disabled in non-interactive mode. Pass an account name.',
			)
		} finally {
			consoleCapture.restore()
			exit.restore()
		}
	})

	test('emits JSON output for named switches', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const usage = sampleUsage()

		mockModule('../../src/lib/accounts.ts', () => ({
			switchAccount: vi.fn((_name: string) => {}),
			listAccounts: vi.fn(() => []),
		}))
		mockModule('../../src/lib/usage.ts', () => ({
			fetchUsageForAccount: vi.fn(async (_name: string) => usage),
			fetchAllUsage: vi.fn(async () => new Map()),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn((_usage: AccountUsage) => []),
			formatUsageCompact: vi.fn((_usage: AccountUsage) => 'compact'),
		}))

		try {
			const { useCommand } = await importFresh<typeof import('../../src/commands/use.ts')>(
				'../../src/commands/use.ts',
			)
			await runCommand(useCommand, { args: { name: 'work', json: true } })
		} finally {
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			switchedTo: string
			usage: { planType: string }
			usageError: string | null
		}
		expect(payload.ok).toBe(true)
		expect(payload.switchedTo).toBe('work')
		expect(payload.usage.planType).toBe('plus')
		expect(payload.usageError).toBeNull()
	})
})
