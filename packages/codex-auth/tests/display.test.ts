import { describe, expect, test } from 'vitest'
import { formatTimeRemaining, renderBar } from '../src/lib/display.ts'

function expectColorOrPlain(bar: string, ansiCode: string, plainBar: string) {
	if (bar.includes('\x1b[')) {
		expect(bar).toContain(ansiCode)
		return
	}
	expect(bar).toBe(plainBar)
}

function withFrozenNow<T>(now: number, fn: () => T): T {
	const realNow = Date.now
	Date.now = () => now
	try {
		return fn()
	} finally {
		Date.now = realNow
	}
}

describe('renderBar', () => {
	test('renders at 0%', () => {
		const bar = renderBar(0)
		// Should be all empty chars (with ANSI color codes)
		expect(bar).toContain('░░░░░░░░░░')
	})

	test('renders at 100%', () => {
		const bar = renderBar(100)
		expect(bar).toContain('██████████')
	})

	test('renders at 50%', () => {
		const bar = renderBar(50)
		expect(bar).toContain('█████░░░░░')
	})

	test('clamps values below 0', () => {
		const bar = renderBar(-10)
		expect(bar).toContain('░░░░░░░░░░')
	})

	test('clamps values above 100', () => {
		const bar = renderBar(150)
		expect(bar).toContain('██████████')
	})

	test('applies green color below 50%', () => {
		const bar = renderBar(30)
		expectColorOrPlain(bar, '\x1b[32m', '███░░░░░░░')
	})

	test('applies yellow color at 50%', () => {
		const bar = renderBar(50)
		expectColorOrPlain(bar, '\x1b[33m', '█████░░░░░')
	})

	test('applies yellow color at 79%', () => {
		const bar = renderBar(79)
		expectColorOrPlain(bar, '\x1b[33m', '████████░░')
	})

	test('applies red color at 80%', () => {
		const bar = renderBar(80)
		expectColorOrPlain(bar, '\x1b[31m', '████████░░')
	})

	test('applies red color at 100%', () => {
		const bar = renderBar(100)
		expectColorOrPlain(bar, '\x1b[31m', '██████████')
	})
})

describe('formatTimeRemaining', () => {
	test('formats less than 1 hour', () => {
		const now = Date.now()
		const resetAt = new Date(now + 42 * 60_000) // 42 minutes
		withFrozenNow(now, () => {
			expect(formatTimeRemaining(resetAt)).toBe('42m')
		})
	})

	test('formats exactly 0 minutes remaining', () => {
		const now = Date.now()
		const resetAt = new Date(now - 1000) // in the past
		withFrozenNow(now, () => {
			expect(formatTimeRemaining(resetAt)).toBe('now')
		})
	})

	test('formats 1-24 hours', () => {
		const now = Date.now()
		const resetAt = new Date(now + 3 * 3600_000 + 42 * 60_000) // 3h 42m
		withFrozenNow(now, () => {
			const result = formatTimeRemaining(resetAt)
			expect(result).toBe('3h 42m')
		})
	})

	test('formats more than 24 hours', () => {
		const now = Date.now()
		const resetAt = new Date(now + 4 * 86400_000 + 11 * 3600_000) // 4d 11h
		withFrozenNow(now, () => {
			const result = formatTimeRemaining(resetAt)
			expect(result).toBe('4d 11h')
		})
	})

	test('formats exactly 1 hour', () => {
		const now = Date.now()
		const resetAt = new Date(now + 3600_000)
		withFrozenNow(now, () => {
			const result = formatTimeRemaining(resetAt)
			expect(result).toBe('1h 0m')
		})
	})

	test('formats exactly 24 hours', () => {
		const now = Date.now()
		const resetAt = new Date(now + 86400_000)
		withFrozenNow(now, () => {
			const result = formatTimeRemaining(resetAt)
			expect(result).toBe('1d 0h')
		})
	})
})
