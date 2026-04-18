import ansis from 'ansis'
import { defineCommand } from 'citty'
import { getCurrentAccountState } from '../lib/current.ts'
import { formatAccountUsage } from '../lib/display.ts'
import { fail, resolveOutputMode } from '../lib/output.ts'

const CLEAR_SCREEN = '\x1b[2J\x1b[H'
const MIN_INTERVAL_SECONDS = 1
const DEFAULT_INTERVAL_SECONDS = 5

type WatchDeps = {
	getState: typeof getCurrentAccountState
	now: () => Date
	write: (chunk: string) => void
	sleep: (ms: number) => Promise<void>
	isTTY: boolean
}

type WatchOptions = {
	intervalSeconds: number
	once: boolean
}

function stripAnsi(input: string): string {
	return ansis.strip(input)
}

function visibleLength(input: string): number {
	return stripAnsi(input).length
}

function padRight(input: string, width: number): string {
	return `${input}${' '.repeat(Math.max(0, width - visibleLength(input)))}`
}

function formatTimestamp(now: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0')
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function frameTitle(state: Awaited<ReturnType<typeof getCurrentAccountState>>) {
	if (state.status === 'ok') {
		return `codex-auth watch  ${ansis.dim('·')}  ${state.active.name} ${ansis.dim(`[${state.usage.planType}]`)}`
	}
	if (state.status === 'error' || state.status === 'missing_snapshot') {
		return `codex-auth watch  ${ansis.dim('·')}  ${state.active.name}`
	}
	return 'codex-auth watch'
}

export function renderWatchFrame(
	state: Awaited<ReturnType<typeof getCurrentAccountState>>,
	options: { intervalSeconds: number; now: Date },
): string {
	const metaLines = [
		`${ansis.dim('updated')}  ${formatTimestamp(options.now)}`,
		`${ansis.dim('refresh')}  every ${options.intervalSeconds}s  ${ansis.dim('·')}  Ctrl+C to stop`,
	]

	const contentLines =
		state.status === 'none'
			? [
					`${ansis.yellow('No active account.')}`,
					'Run `codex-auth use <name>` to select one, then rerun watch.',
				]
			: state.status === 'missing_snapshot'
				? [
						`${ansis.yellow('Active snapshot is missing.')}`,
						`Account "${state.active.name}" was active, but its saved snapshot no longer exists.`,
					]
				: state.status === 'error'
					? [`${ansis.yellow('Usage unavailable.')}`, `error: ${state.error}`]
					: [...formatAccountUsage(state.usage)]

	const lines = [...metaLines, '', ...contentLines]
	const width = Math.max(60, visibleLength(frameTitle(state)), ...lines.map(visibleLength))

	return [
		`╭─ ${padRight(frameTitle(state), width)} ─╮`,
		...lines.map((line) => `│ ${padRight(line, width)} │`),
		`╰─${'─'.repeat(width + 2)}╯`,
	].join('\n')
}

function parseIntervalSeconds(raw: string | undefined): number {
	const fallback = raw === undefined ? DEFAULT_INTERVAL_SECONDS : Number(raw)
	if (!Number.isFinite(fallback) || fallback < MIN_INTERVAL_SECONDS) {
		throw new Error(`Interval must be a number >= ${MIN_INTERVAL_SECONDS}.`)
	}
	return Math.floor(fallback)
}

export async function runWatch(
	options: WatchOptions,
	deps: WatchDeps = {
		getState: getCurrentAccountState,
		now: () => new Date(),
		write: (chunk) => process.stdout.write(chunk),
		sleep: (ms) => Bun.sleep(ms),
		isTTY: Boolean(process.stdout.isTTY),
	},
) {
	while (true) {
		const frame = renderWatchFrame(await deps.getState(), {
			intervalSeconds: options.intervalSeconds,
			now: deps.now(),
		})
		if (!options.once && deps.isTTY) {
			deps.write(CLEAR_SCREEN)
		}
		deps.write(`${frame}\n`)

		if (options.once) {
			return
		}

		await deps.sleep(options.intervalSeconds * 1000)
	}
}

export const watchCommand = defineCommand({
	meta: {
		name: 'watch',
		description: 'Live-refresh the current account usage in a terminal view',
	},
	args: {
		interval: {
			type: 'string',
			description: 'Refresh interval in seconds',
			default: String(DEFAULT_INTERVAL_SECONDS),
			alias: 'i',
		},
		once: {
			type: 'boolean',
			description: 'Render a single frame and exit',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode()
		let intervalSeconds: number
		try {
			intervalSeconds = parseIntervalSeconds(args.interval)
		} catch (err) {
			fail(mode, err instanceof Error ? err.message : String(err))
		}

		if (!args.once && (!mode.interactive || !process.stdout.isTTY)) {
			fail(
				mode,
				'Live watch mode requires an interactive terminal. Use `--once` for a single snapshot.',
			)
		}

		await runWatch({
			intervalSeconds,
			once: Boolean(args.once),
		})
	},
})
