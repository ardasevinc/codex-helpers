import { afterEach, describe, expect, mock, test } from 'bun:test'
import { parseImportInput } from '../../src/commands/import.ts'
import { mockAuth } from '../helpers.ts'
import {
	captureConsole,
	ExitError,
	importFresh,
	mockAgent,
	mockPrompts,
	runCommand,
	stubProcessExit,
} from './helpers.ts'

afterEach(() => {
	mock.restore()
})

describe('parseImportInput', () => {
	test('parses export-style account maps', () => {
		const input = JSON.stringify({
			main: mockAuth(),
			alt: mockAuth({
				tokens: { ...mockAuth().tokens, access_token: 'alt-token' },
			}),
		})

		const parsed = parseImportInput(input)
		expect(Object.keys(parsed).sort()).toEqual(['alt', 'main'])
		expect(parsed.alt?.tokens.access_token).toBe('alt-token')
	})

	test('rejects single auth.json input with a clear error', () => {
		const input = JSON.stringify({
			auth_mode: 'chatgpt',
			...mockAuth(),
		})

		expect(() => parseImportInput(input)).toThrow(
			'Received a single auth.json payload. `codex-auth import` expects `codex-auth export` output mapping account names to auth data.',
		)
	})

	test('rejects malformed auth blobs inside an account map', () => {
		const input = JSON.stringify({
			main: mockAuth(),
			broken: {
				OPENAI_API_KEY: null,
				tokens: { access_token: 'only-one-field' },
				last_refresh: new Date().toISOString(),
			},
		})

		expect(() => parseImportInput(input)).toThrow('Invalid auth data for account "broken".')
	})

	test('emits JSON output on successful import', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const originalText = Bun.stdin.text
		Bun.stdin.text = mock(async () => JSON.stringify({ main: mockAuth(), alt: mockAuth() }))
		const importAccounts = mock(() => ({ imported: ['main', 'alt'], skipped: [] }))

		mock.module('../../src/lib/accounts.ts', () => ({
			importAccounts,
			validateImportData: (data: unknown) => data,
		}))

		try {
			const { importCommand } = await importFresh<typeof import('../../src/commands/import.ts')>(
				'../../src/commands/import.ts',
			)
			await runCommand(importCommand, { args: { overwrite: false, json: true } })
		} finally {
			Bun.stdin.text = originalText
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			imported: string[]
			skipped: string[]
			counts: { imported: number; skipped: number }
		}
		expect(payload.ok).toBe(true)
		expect(payload.imported).toEqual(['main', 'alt'])
		expect(payload.counts).toEqual({ imported: 2, skipped: 0 })
	})

	test('emits JSON errors for malformed input', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const exit = stubProcessExit()
		const originalText = Bun.stdin.text
		Bun.stdin.text = mock(async () => JSON.stringify({ main: mockAuth() }))
		mock.module('../../src/lib/accounts.ts', () => ({
			importAccounts: mock(() => ({ imported: [], skipped: [] })),
			validateImportData: () => {
				throw new Error('Received a single auth.json payload.')
			},
		}))

		try {
			const { importCommand } = await importFresh<typeof import('../../src/commands/import.ts')>(
				'../../src/commands/import.ts',
			)
			await expect(
				runCommand(importCommand, { args: { overwrite: false, json: true } }),
			).rejects.toBeInstanceOf(ExitError)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
				ok: boolean
				error: string
			}
			expect(payload.ok).toBe(false)
			expect(payload.error).toContain('single auth.json payload')
		} finally {
			Bun.stdin.text = originalText
			consoleCapture.restore()
			exit.restore()
		}
	})
})
