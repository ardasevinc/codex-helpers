import { describe, expect, test } from 'bun:test'
import { parseImportInput } from '../../src/commands/import.ts'
import { mockAuth } from '../helpers.ts'

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
})
