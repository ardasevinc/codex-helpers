import type { Account, AccountUsage, UsageResponse } from '../types.ts'
import { needsRefresh, readAuthForAccount, refreshToken } from './auth.ts'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const USAGE_TIMEOUT_MS = 10_000

export function parseUsageResponse(raw: UsageResponse): AccountUsage {
	return {
		planType: raw.plan_type,
		session: {
			usedPercent: raw.rate_limit.primary_window.used_percent,
			resetAt: new Date(raw.rate_limit.primary_window.reset_at * 1000),
			windowSeconds: raw.rate_limit.primary_window.limit_window_seconds,
		},
		weekly: {
			usedPercent: raw.rate_limit.secondary_window.used_percent,
			resetAt: new Date(raw.rate_limit.secondary_window.reset_at * 1000),
			windowSeconds: raw.rate_limit.secondary_window.limit_window_seconds,
		},
		credits: raw.credits
			? {
					hasCredits: raw.credits.has_credits,
					unlimited: raw.credits.unlimited,
					balance: raw.credits.balance,
				}
			: undefined,
	}
}

export async function fetchUsage(accessToken: string, accountId?: string): Promise<UsageResponse> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		Accept: 'application/json',
		'User-Agent': 'codex-auth',
	}
	if (accountId) {
		headers['ChatGPT-Account-Id'] = accountId
	}

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS)

	try {
		const resp = await fetch(USAGE_URL, {
			method: 'GET',
			headers,
			signal: controller.signal,
		})

		if (resp.status === 401 || resp.status === 403) {
			throw new AuthError(resp.status)
		}

		if (!resp.ok) {
			throw new Error(`Usage API returned ${resp.status}`)
		}

		return (await resp.json()) as UsageResponse
	} finally {
		clearTimeout(timeout)
	}
}

export class AuthError extends Error {
	constructor(public status: number) {
		super(`Auth failed with status ${status}`)
		this.name = 'AuthError'
	}
}

/** Fetch usage with automatic token refresh on 401/403 */
export async function fetchUsageForAccount(accountName: string): Promise<AccountUsage> {
	let auth = readAuthForAccount(accountName)

	// Proactive refresh if token is old
	if (needsRefresh(auth)) {
		try {
			auth = await refreshToken(auth, accountName)
		} catch {
			// try with existing token
		}
	}

	try {
		const raw = await fetchUsage(auth.tokens.access_token, auth.tokens.account_id)
		return parseUsageResponse(raw)
	} catch (err) {
		if (err instanceof AuthError) {
			// Retry once with refreshed token
			auth = await refreshToken(auth, accountName)
			const raw = await fetchUsage(auth.tokens.access_token, auth.tokens.account_id)
			return parseUsageResponse(raw)
		}
		throw err
	}
}

/** Fetch usage for all accounts concurrently */
export async function fetchAllUsage(
	accounts: Account[],
): Promise<Map<string, AccountUsage | Error>> {
	const results = await Promise.allSettled(
		accounts.map(async (acc) => {
			const usage = await fetchUsageForAccount(acc.name)
			return { name: acc.name, usage }
		}),
	)

	const map = new Map<string, AccountUsage | Error>()
	for (const result of results) {
		if (result.status === 'fulfilled') {
			map.set(result.value.name, result.value.usage)
		} else {
			// Extract account name from the error context — match by index
			const idx = results.indexOf(result)
			const name = accounts[idx]?.name ?? 'unknown'
			map.set(
				name,
				result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
			)
		}
	}

	return map
}
