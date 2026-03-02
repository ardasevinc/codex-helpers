import { describe, expect, test } from 'bun:test'
import { classifyAccount, findExpired } from '../src/lib/expiry.ts'
import type { AccountUsage } from '../src/types.ts'

function okUsage(planType = 'plus'): AccountUsage {
	return {
		planType,
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

describe('classifyAccount', () => {
	test('returns ok for paid plan usage', () => {
		const result = classifyAccount(okUsage('plus'))
		expect(result.state).toBe('ok')
	})

	test('returns expired for free plan', () => {
		const result = classifyAccount(okUsage('free'))
		expect(result).toEqual({ state: 'expired', reason: 'subscription lapsed (free plan)' })
	})

	test('returns expired for session expired error', () => {
		const result = classifyAccount(new Error('Session expired — re-login with `codex` CLI'))
		expect(result).toEqual({ state: 'expired', reason: 'session expired' })
	})

	test('returns expired for token revoked error', () => {
		const result = classifyAccount(new Error('Token revoked — re-login with `codex` CLI'))
		expect(result).toEqual({ state: 'expired', reason: 'token revoked' })
	})

	test('returns expired for token conflict error', () => {
		const result = classifyAccount(new Error('Token conflict — another session may have refreshed'))
		expect(result).toEqual({ state: 'expired', reason: 'token conflict' })
	})

	test('returns expired for auth failed error', () => {
		const result = classifyAccount(new Error('Auth failed with status 401'))
		expect(result).toEqual({ state: 'expired', reason: 'auth failed' })
	})

	test('returns expired for token refresh failed error', () => {
		const result = classifyAccount(new Error('Token refresh failed: unknown'))
		expect(result).toEqual({ state: 'expired', reason: 'token refresh failed' })
	})

	test('returns error for unknown errors', () => {
		const result = classifyAccount(new Error('network timeout'))
		expect(result).toEqual({ state: 'error', message: 'network timeout' })
	})

	test('returns ok for pro plan', () => {
		const result = classifyAccount(okUsage('pro'))
		expect(result.state).toBe('ok')
	})
})

describe('findExpired', () => {
	test('returns only expired accounts', () => {
		const map = new Map<string, AccountUsage | Error>([
			['healthy', okUsage('plus')],
			['dead', new Error('Session expired — re-login with `codex` CLI')],
			['lapsed', okUsage('free')],
			['errored', new Error('network timeout')],
		])

		const expired = findExpired(map)

		expect(expired.size).toBe(2)
		expect(expired.get('dead')).toBe('session expired')
		expect(expired.get('lapsed')).toBe('subscription lapsed (free plan)')
		expect(expired.has('healthy')).toBe(false)
		expect(expired.has('errored')).toBe(false)
	})

	test('returns empty map when all healthy', () => {
		const map = new Map<string, AccountUsage | Error>([
			['a', okUsage('plus')],
			['b', okUsage('pro')],
		])

		expect(findExpired(map).size).toBe(0)
	})

	test('returns all when all expired', () => {
		const map = new Map<string, AccountUsage | Error>([
			['a', okUsage('free')],
			['b', new Error('Auth failed with status 403')],
		])

		expect(findExpired(map).size).toBe(2)
	})
})
