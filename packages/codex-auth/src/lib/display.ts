import ansis from 'ansis'
import type { AccountUsage } from '../types.ts'

const BAR_WIDTH = 10
const FILLED = '█'
const EMPTY = '░'

/** Render a colored progress bar */
export function renderBar(percent: number): string {
	const clamped = Math.max(0, Math.min(100, percent))
	const filled = Math.round((clamped / 100) * BAR_WIDTH)
	const empty = BAR_WIDTH - filled

	const bar = FILLED.repeat(filled) + EMPTY.repeat(empty)

	if (clamped >= 80) return ansis.red(bar)
	if (clamped >= 50) return ansis.yellow(bar)
	return ansis.green(bar)
}

/** Format a reset timestamp as relative time */
export function formatTimeRemaining(resetAt: Date): string {
	const now = Date.now()
	const diffMs = resetAt.getTime() - now

	if (diffMs <= 0) return 'now'

	const totalMinutes = Math.floor(diffMs / 60_000)
	const totalHours = Math.floor(totalMinutes / 60)
	const totalDays = Math.floor(totalHours / 24)

	if (totalHours < 1) {
		return `${totalMinutes}m`
	}
	if (totalHours < 24) {
		const mins = totalMinutes % 60
		return `${totalHours}h ${mins}m`
	}
	const hours = totalHours % 24
	return `${totalDays}d ${hours}h`
}

/** Format a single usage line: "5hr: ████████░░ 78% used  ·  resets in 3h 42m" */
export function formatUsageLine(label: string, usedPercent: number, resetAt: Date): string {
	const bar = renderBar(usedPercent)
	const pct = `${Math.round(usedPercent)}%`
	const reset = formatTimeRemaining(resetAt)
	return `${label}: ${bar} ${pct.padStart(4)} used  ·  resets in ${reset}`
}

/** Format full usage display for an account */
export function formatAccountUsage(usage: AccountUsage): string[] {
	const lines: string[] = []
	lines.push(formatUsageLine('5hr   ', usage.session.usedPercent, usage.session.resetAt))
	lines.push(formatUsageLine('weekly', usage.weekly.usedPercent, usage.weekly.resetAt))
	if (usage.credits?.hasCredits && typeof usage.credits.balance === 'number') {
		lines.push(`credits: $${usage.credits.balance.toFixed(2)} remaining`)
	}
	return lines
}

/** Format usage as a compact single line for select menus */
export function formatUsageCompact(usage: AccountUsage): string {
	const s = renderBar(usage.session.usedPercent)
	const w = renderBar(usage.weekly.usedPercent)
	const sp = `${Math.round(usage.session.usedPercent)}%`.padStart(4)
	const wp = `${Math.round(usage.weekly.usedPercent)}%`.padStart(4)
	return `5hr: ${s} ${sp}  ·  weekly: ${w} ${wp}`
}
