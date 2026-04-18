import { afterEach, describe, expect, test, vi } from 'vitest'
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

describe('pushCommand', () => {
	test('emits JSON output for push results', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()

		mockModule('../../src/lib/accounts.ts', () => ({
			exportAccounts: vi.fn(() => ({
				main: {
					OPENAI_API_KEY: null,
					tokens: { access_token: 'a', refresh_token: 'b', id_token: 'c' },
					last_refresh: '2026-04-12T00:00:00.000Z',
				},
				alt: {
					OPENAI_API_KEY: null,
					tokens: { access_token: 'd', refresh_token: 'e', id_token: 'f' },
					last_refresh: '2026-04-12T00:00:00.000Z',
				},
			})),
		}))

		const spawn = vi.fn((args: string[]) => {
			const command = args.join(' ')
			if (command.includes('mkdir -p')) {
				return { exited: Promise.resolve(0), stderr: new Response('').body } as const
			}
			if (command.includes('test -f ~/.codex/accounts/main.json')) {
				return { exited: Promise.resolve(0), stderr: new Response('').body } as const
			}
			if (command.includes('test -f ~/.codex/accounts/alt.json')) {
				return { exited: Promise.resolve(1), stderr: new Response('').body } as const
			}
			return { exited: Promise.resolve(0), stderr: new Response('').body } as const
		})

		const originalSpawn = Bun.spawn
		Bun.spawn = spawn as unknown as typeof Bun.spawn

		try {
			const { pushCommand } = await importFresh<typeof import('../../src/commands/push.ts')>(
				'../../src/commands/push.ts',
			)
			await runCommand(pushCommand, { args: { host: 'my-vps', overwrite: false, json: true } })
		} finally {
			Bun.spawn = originalSpawn
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			host: string
			pushed: string[]
			skipped: string[]
			failed: string[]
			counts: { pushed: number; skipped: number; failed: number }
		}
		expect(payload.ok).toBe(true)
		expect(payload.host).toBe('my-vps')
		expect(payload.pushed).toEqual(['alt'])
		expect(payload.skipped).toEqual(['main'])
		expect(payload.failed).toEqual([])
		expect(payload.counts).toEqual({ pushed: 1, skipped: 1, failed: 0 })
	})
})
