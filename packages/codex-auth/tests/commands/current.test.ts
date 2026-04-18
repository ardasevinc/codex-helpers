import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AccountUsage } from '../../src/types.ts'
import {
	captureConsole,
	importFresh,
	mockAgent,
	mockModule,
	mockPrompts,
	resetTestState,
	runCommand,
	setMockBaseUrl,
} from './helpers.ts'

setMockBaseUrl(import.meta.url)

afterEach(() => {
	resetTestState()
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
		mockModule('../../src/lib/current.ts', () => ({
			getCurrentAccountTarget: vi.fn(() => ({ status: 'none' })),
			getCurrentAccountState: vi.fn(async () => ({ status: 'none' })),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn((_usage: AccountUsage) => ['line 1']),
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
		mockModule('../../src/lib/current.ts', () => ({
			getCurrentAccountTarget: vi.fn(() => ({
				status: 'missing_snapshot',
				active: {
					name: 'personal',
					switchedAt: '2026-04-18T00:00:00.000Z',
					snapshotExists: false,
				},
			})),
			getCurrentAccountState: vi.fn(async () => ({
				status: 'missing_snapshot',
				active: {
					name: 'personal',
					switchedAt: '2026-04-18T00:00:00.000Z',
					snapshotExists: false,
				},
			})),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn((_usage: AccountUsage) => ['line 1']),
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

		mockModule('../../src/lib/current.ts', () => ({
			getCurrentAccountTarget: vi.fn(() => ({
				status: 'ready',
				active: {
					name: 'personal',
					switchedAt: '2026-04-18T00:00:00.000Z',
					snapshotExists: true,
				},
			})),
			getCurrentAccountState: vi.fn(async () => ({
				status: 'ok',
				active: {
					name: 'personal',
					switchedAt: '2026-04-18T00:00:00.000Z',
					snapshotExists: true,
				},
				usage,
			})),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn((_usage: AccountUsage) => [
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

		mockModule('../../src/lib/current.ts', () => ({
			getCurrentAccountTarget: vi.fn(() => ({
				status: 'ready',
				active: {
					name: 'personal',
					switchedAt: '2026-04-12T10:00:00.000Z',
					snapshotExists: true,
				},
			})),
			getCurrentAccountState: vi.fn(async () => ({
				status: 'ok',
				active: {
					name: 'personal',
					switchedAt: '2026-04-12T10:00:00.000Z',
					snapshotExists: true,
				},
				usage,
			})),
		}))
		mockModule('../../src/lib/display.ts', () => ({
			formatAccountUsage: vi.fn(() => ['unused']),
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
