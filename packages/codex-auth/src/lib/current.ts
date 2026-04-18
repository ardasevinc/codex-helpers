import type { AccountUsage } from '../types.ts'
import { accountExists, getActiveAccount } from './accounts.ts'
import { fetchUsageForAccount } from './usage.ts'

export type CurrentAccountTarget =
	| {
			status: 'none'
	  }
	| {
			status: 'missing_snapshot'
			active: { name: string; switchedAt: string; snapshotExists: false }
	  }
	| {
			status: 'ready'
			active: { name: string; switchedAt: string; snapshotExists: true }
	  }

export type CurrentAccountState =
	| {
			status: 'none'
	  }
	| {
			status: 'missing_snapshot'
			active: { name: string; switchedAt: string; snapshotExists: false }
	  }
	| {
			status: 'ok'
			active: { name: string; switchedAt: string; snapshotExists: true }
			usage: AccountUsage
	  }
	| {
			status: 'error'
			active: { name: string; switchedAt: string; snapshotExists: true }
			error: string
	  }

export function getCurrentAccountTarget(): CurrentAccountTarget {
	const active = getActiveAccount()
	if (!active) {
		return { status: 'none' }
	}

	if (!accountExists(active.name)) {
		return {
			status: 'missing_snapshot',
			active: {
				name: active.name,
				switchedAt: active.switched_at,
				snapshotExists: false,
			},
		}
	}

	return {
		status: 'ready',
		active: {
			name: active.name,
			switchedAt: active.switched_at,
			snapshotExists: true,
		},
	}
}

export async function getCurrentAccountState(): Promise<CurrentAccountState> {
	const target = getCurrentAccountTarget()
	if (target.status !== 'ready') {
		return target
	}

	try {
		const usage = await fetchUsageForAccount(target.active.name)
		return {
			status: 'ok',
			active: target.active,
			usage,
		}
	} catch (err) {
		return {
			status: 'error',
			active: target.active,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}
