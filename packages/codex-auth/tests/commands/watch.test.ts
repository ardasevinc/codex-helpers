import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { CurrentAccountState } from '../../src/lib/current.ts'
import { importFresh } from './helpers.ts'

afterEach(() => {
	mock.restore()
})

function okState(): CurrentAccountState {
	return {
		status: 'ok',
		active: {
			name: 'main',
			switchedAt: '2026-04-18T00:00:00.000Z',
			snapshotExists: true,
		},
		usage: {
			planType: 'plus',
			session: {
				usedPercent: 42,
				resetAt: new Date('2026-04-18T05:00:00.000Z'),
				windowSeconds: 18_000,
			},
			weekly: {
				usedPercent: 12,
				resetAt: new Date('2026-04-22T00:00:00.000Z'),
				windowSeconds: 604_800,
			},
			credits: {
				hasCredits: true,
				unlimited: false,
				balance: 5.39,
			},
		},
	}
}

describe('renderWatchFrame', () => {
	test('renders active account usage in a bordered frame', async () => {
		mock.module('../../src/lib/display.ts', () => ({
			formatAccountUsage: () => ['5hr line', 'weekly line', 'credits: $5.39 remaining'],
		}))
		const { renderWatchFrame } = await importFresh<typeof import('../../src/commands/watch.ts')>(
			'../../src/commands/watch.ts',
		)
		const frame = renderWatchFrame(okState(), {
			intervalSeconds: 5,
			now: new Date('2026-04-18T01:23:45.000Z'),
		})

		expect(frame).toContain('codex-auth watch')
		expect(frame).toContain('main')
		expect(frame).toContain('[plus]')
		expect(frame).toContain('every 5s')
		expect(frame).toContain('Ctrl+C to stop')
		expect(frame).toContain('5hr line')
		expect(frame).toContain('weekly line')
		expect(frame).toContain('credits: $5.39 remaining')
	})

	test('renders a helpful empty-state frame', async () => {
		const { renderWatchFrame } = await importFresh<typeof import('../../src/commands/watch.ts')>(
			'../../src/commands/watch.ts',
		)
		const frame = renderWatchFrame(
			{ status: 'none' },
			{
				intervalSeconds: 5,
				now: new Date('2026-04-18T01:23:45.000Z'),
			},
		)

		expect(frame).toContain('No active account.')
		expect(frame).toContain('codex-auth use <name>')
	})
})

describe('runWatch', () => {
	test('writes a single frame in once mode without terminal clearing', async () => {
		const { runWatch } = await importFresh<typeof import('../../src/commands/watch.ts')>(
			'../../src/commands/watch.ts',
		)
		const chunks: string[] = []
		await runWatch(
			{ intervalSeconds: 5, once: true },
			{
				getState: async () => okState(),
				now: () => new Date('2026-04-18T01:23:45.000Z'),
				write: (chunk) => {
					chunks.push(chunk)
				},
				sleep: mock(async (_ms: number) => {}),
				isTTY: true,
			},
		)

		expect(chunks).toHaveLength(1)
		expect(chunks[0]).toContain('codex-auth watch')
		expect(chunks[0]).toContain('main')
		expect(chunks[0]).not.toContain('\x1b[2J\x1b[H')
	})
})
