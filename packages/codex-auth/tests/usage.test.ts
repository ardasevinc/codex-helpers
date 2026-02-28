import { afterEach, describe, expect, mock, test } from 'bun:test'
import { fetchUsage, parseUsageResponse } from '../src/lib/usage.ts'
import { mockUsageResponse } from './helpers.ts'

const setFetch = (fn: any) => {
	globalThis.fetch = fn
}

afterEach(() => {
	mock.restore()
})

describe('parseUsageResponse', () => {
	test('parses primary and secondary windows', () => {
		const raw = mockUsageResponse()
		const usage = parseUsageResponse(raw)

		expect(usage.planType).toBe('plus')
		expect(usage.session.usedPercent).toBe(25)
		expect(usage.session.windowSeconds).toBe(18000)
		expect(usage.weekly.usedPercent).toBe(10)
		expect(usage.weekly.windowSeconds).toBe(604800)
	})

	test('parses credits when present', () => {
		const raw = mockUsageResponse({
			credits: { has_credits: true, unlimited: false, balance: 5.39 },
		})
		const usage = parseUsageResponse(raw)

		expect(usage.credits?.hasCredits).toBe(true)
		expect(usage.credits?.balance).toBe(5.39)
	})

	test('handles missing credits', () => {
		const raw = mockUsageResponse()
		const usage = parseUsageResponse(raw)
		expect(usage.credits).toBeUndefined()
	})

	test('converts reset_at to Date', () => {
		const now = Math.floor(Date.now() / 1000)
		const raw = mockUsageResponse({
			rate_limit: {
				primary_window: { used_percent: 50, reset_at: now + 3600, limit_window_seconds: 18000 },
				secondary_window: {
					used_percent: 20,
					reset_at: now + 86400,
					limit_window_seconds: 604800,
				},
			},
		})
		const usage = parseUsageResponse(raw)

		expect(usage.session.resetAt).toBeInstanceOf(Date)
		expect(usage.weekly.resetAt).toBeInstanceOf(Date)
		expect(usage.session.resetAt.getTime()).toBeGreaterThan(Date.now())
	})
})

describe('fetchUsage', () => {
	test('sends correct headers', async () => {
		let capturedHeaders: Headers | null = null

		setFetch(
			mock((_input: Request | string | URL, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers)
				return Promise.resolve(new Response(JSON.stringify(mockUsageResponse()), { status: 200 }))
			}),
		)

		await fetchUsage('my-token', 'my-account-id')

		expect(capturedHeaders!.get('Authorization')).toBe('Bearer my-token')
		expect(capturedHeaders!.get('Accept')).toBe('application/json')
		expect(capturedHeaders!.get('User-Agent')).toBe('codex-auth')
		expect(capturedHeaders!.get('ChatGPT-Account-Id')).toBe('my-account-id')
	})

	test('omits account-id header when not provided', async () => {
		let capturedHeaders: Headers | null = null

		setFetch(
			mock((_input: Request | string | URL, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers)
				return Promise.resolve(new Response(JSON.stringify(mockUsageResponse()), { status: 200 }))
			}),
		)

		await fetchUsage('my-token')

		expect(capturedHeaders!.get('ChatGPT-Account-Id')).toBeNull()
	})

	test('throws AuthError on 401', async () => {
		setFetch(mock(() => Promise.resolve(new Response('Unauthorized', { status: 401 }))))

		await expect(fetchUsage('bad-token')).rejects.toThrow('Auth failed')
	})

	test('throws AuthError on 403', async () => {
		setFetch(mock(() => Promise.resolve(new Response('Forbidden', { status: 403 }))))

		await expect(fetchUsage('bad-token')).rejects.toThrow('Auth failed')
	})

	test('throws on other HTTP errors', async () => {
		setFetch(mock(() => Promise.resolve(new Response('Server Error', { status: 500 }))))

		await expect(fetchUsage('token')).rejects.toThrow('Usage API returned 500')
	})

	test('fetches usage successfully', async () => {
		const mockResp = mockUsageResponse({ plan_type: 'pro' })

		setFetch(mock(() => Promise.resolve(new Response(JSON.stringify(mockResp), { status: 200 }))))

		const result = await fetchUsage('token')
		expect(result.plan_type).toBe('pro')
	})
})
