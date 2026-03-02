import type { AccountUsage } from '../types.ts'

export type AccountStatus =
	| { state: 'ok'; usage: AccountUsage }
	| { state: 'expired'; reason: string }
	| { state: 'error'; message: string }

/** Error messages that indicate the account is dead/expired */
const EXPIRED_PATTERNS = [
	'Session expired',
	'Token revoked',
	'Token conflict',
	'Auth failed',
] as const

/** Classify an account's usage result into a health status */
export function classifyAccount(result: AccountUsage | Error): AccountStatus {
	if (result instanceof Error) {
		for (const pattern of EXPIRED_PATTERNS) {
			if (result.message.includes(pattern)) {
				return { state: 'expired', reason: deriveReason(result.message) }
			}
		}
		return { state: 'error', message: result.message }
	}

	if (result.planType === 'free') {
		return { state: 'expired', reason: 'subscription lapsed (free plan)' }
	}

	return { state: 'ok', usage: result }
}

function deriveReason(message: string): string {
	if (message.includes('Session expired')) return 'session expired'
	if (message.includes('Token revoked')) return 'token revoked'
	if (message.includes('Token conflict')) return 'token conflict'
	return 'auth failed'
}

/** Filter a usage map down to only expired accounts */
export function findExpired(usageMap: Map<string, AccountUsage | Error>): Map<string, string> {
	const expired = new Map<string, string>()
	for (const [name, result] of usageMap) {
		const status = classifyAccount(result)
		if (status.state === 'expired') {
			expired.set(name, status.reason)
		}
	}
	return expired
}
