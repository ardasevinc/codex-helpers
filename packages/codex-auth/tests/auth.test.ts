import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { needsRefresh, readAuth, refreshToken } from '../src/lib/auth.ts'
import { cleanTmpDir, createTmpDir, mockAuth } from './helpers.ts'

let tmpDir: string

const setFetch = (fn: any) => {
	globalThis.fetch = fn
}

beforeEach(() => {
	tmpDir = createTmpDir()
})

afterEach(() => {
	cleanTmpDir(tmpDir)
	mock.restore()
})

describe('readAuth', () => {
	test('reads and parses auth.json', () => {
		const authPath = join(tmpDir, 'auth.json')
		const auth = mockAuth()
		writeFileSync(authPath, JSON.stringify(auth, null, 2))

		const result = readAuth(authPath)
		expect(result.tokens.access_token).toBe('test-access-token')
		expect(result.tokens.refresh_token).toBe('test-refresh-token')
	})

	test('throws on missing token fields', () => {
		const authPath = join(tmpDir, 'auth.json')
		writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: null, tokens: {} }))

		expect(() => readAuth(authPath)).toThrow('missing required token fields')
	})

	test('throws on non-existent file', () => {
		expect(() => readAuth(join(tmpDir, 'nonexistent.json'))).toThrow()
	})
})

describe('needsRefresh', () => {
	test('returns true when last_refresh is missing', () => {
		const auth = mockAuth()
		auth.last_refresh = ''
		expect(needsRefresh(auth)).toBe(true)
	})

	test('returns true when token is older than 8 days', () => {
		const auth = mockAuth()
		const nineAgo = new Date(Date.now() - 9 * 86400_000)
		auth.last_refresh = nineAgo.toISOString()
		expect(needsRefresh(auth)).toBe(true)
	})

	test('returns false when token is fresh', () => {
		const auth = mockAuth()
		auth.last_refresh = new Date().toISOString()
		expect(needsRefresh(auth)).toBe(false)
	})

	test('returns false when token is 7 days old', () => {
		const auth = mockAuth()
		const sevenAgo = new Date(Date.now() - 7 * 86400_000)
		auth.last_refresh = sevenAgo.toISOString()
		expect(needsRefresh(auth)).toBe(false)
	})
})

describe('refreshToken', () => {
	test('refreshes token successfully', async () => {
		const auth = mockAuth()

		setFetch(
			mock(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							access_token: 'new-access',
							refresh_token: 'new-refresh',
							id_token: 'new-id',
						}),
						{ status: 200 },
					),
				),
			),
		)

		const result = await refreshToken(auth)
		expect(result.tokens.access_token).toBe('new-access')
		expect(result.tokens.refresh_token).toBe('new-refresh')
		expect(result.tokens.id_token).toBe('new-id')
		expect(result.last_refresh).toBeTruthy()
	})

	test('handles refresh_token_expired error', async () => {
		const auth = mockAuth()

		setFetch(
			mock(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: 'refresh_token_expired' } }), {
						status: 400,
					}),
				),
			),
		)

		await expect(refreshToken(auth)).rejects.toThrow('Session expired')
	})

	test('handles refresh_token_reused error', async () => {
		const auth = mockAuth()

		setFetch(
			mock(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: 'refresh_token_reused' } }), {
						status: 400,
					}),
				),
			),
		)

		await expect(refreshToken(auth)).rejects.toThrow('Token conflict')
	})

	test('handles refresh_token_invalidated error', async () => {
		const auth = mockAuth()

		setFetch(
			mock(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: 'refresh_token_invalidated' } }), {
						status: 400,
					}),
				),
			),
		)

		await expect(refreshToken(auth)).rejects.toThrow('Token revoked')
	})

	test('handles missing access_token in response', async () => {
		const auth = mockAuth()

		setFetch(mock(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))))

		await expect(refreshToken(auth)).rejects.toThrow('missing access_token')
	})

	test('sends correct request format', async () => {
		const auth = mockAuth()
		let capturedUrl = ''

		setFetch(
			mock((input: string | URL | Request) => {
				capturedUrl =
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
				return Promise.resolve(
					new Response(JSON.stringify({ access_token: 'new' }), { status: 200 }),
				)
			}),
		)

		await refreshToken(auth)
		expect(capturedUrl).toBe('https://auth.openai.com/oauth/token')
	})
})
