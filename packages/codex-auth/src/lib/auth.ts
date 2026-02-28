import { readFileSync, writeFileSync } from 'node:fs'
import type { CodexAuth } from '../types.ts'
import { accountPath } from './paths.ts'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_URL = 'https://auth.openai.com/oauth/token'
const REFRESH_TIMEOUT_MS = 15_000
const REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000 // 8 days

export function readAuth(path: string): CodexAuth {
	const content = readFileSync(path, 'utf-8')
	const auth = JSON.parse(content) as CodexAuth

	if (!auth.tokens?.access_token || !auth.tokens?.refresh_token) {
		throw new Error('Invalid auth.json: missing required token fields')
	}

	return auth
}

export function readAuthForAccount(name: string): CodexAuth {
	return readAuth(accountPath(name))
}

export function needsRefresh(auth: CodexAuth): boolean {
	if (!auth.last_refresh) return true
	const lastRefresh = new Date(auth.last_refresh).getTime()
	return Date.now() - lastRefresh > REFRESH_AGE_MS
}

export async function refreshToken(auth: CodexAuth, accountName?: string): Promise<CodexAuth> {
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		client_id: CLIENT_ID,
		refresh_token: auth.tokens.refresh_token,
	})

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)

	try {
		const resp = await fetch(REFRESH_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
			signal: controller.signal,
		})

		if (!resp.ok) {
			const errorBody = (await resp.json().catch(() => ({}))) as Record<string, any>
			const code = errorBody.error?.code || errorBody.error || errorBody.code || 'unknown'

			if (code === 'refresh_token_expired') {
				throw new Error('Session expired — re-login with `codex` CLI')
			}
			if (code === 'refresh_token_reused') {
				throw new Error('Token conflict — another session may have refreshed')
			}
			if (code === 'refresh_token_invalidated') {
				throw new Error('Token revoked — re-login with `codex` CLI')
			}
			throw new Error(`Token refresh failed: ${code}`)
		}

		const data = (await resp.json()) as Record<string, string>
		if (!data.access_token) {
			throw new Error('Refresh response missing access_token')
		}

		auth.tokens.access_token = data.access_token
		if (data.refresh_token) auth.tokens.refresh_token = data.refresh_token
		if (data.id_token) auth.tokens.id_token = data.id_token
		auth.last_refresh = new Date().toISOString()

		// Persist updated tokens to snapshot
		if (accountName) {
			const dest = accountPath(accountName)
			writeFileSync(dest, JSON.stringify(auth, null, 2), 'utf-8')
		}

		return auth
	} finally {
		clearTimeout(timeout)
	}
}
