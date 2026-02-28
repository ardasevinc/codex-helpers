import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { listAccounts, switchAccount } from '../lib/accounts.ts'
import { formatAccountUsage, formatUsageCompact } from '../lib/display.ts'
import { fetchAllUsage, fetchUsageForAccount } from '../lib/usage.ts'
import type { AccountUsage } from '../types.ts'

export const useCommand = defineCommand({
	meta: {
		name: 'use',
		description: 'Switch to a saved account',
	},
	args: {
		name: {
			type: 'positional',
			description: 'Account name (interactive if omitted)',
			required: false,
		},
	},
	async run({ args }) {
		if (args.name) {
			await switchNamed(args.name)
		} else {
			await switchInteractive()
		}
	},
})

async function switchNamed(name: string) {
	const s = p.spinner()
	s.start('Fetching usage...')

	let usage: AccountUsage | null = null
	try {
		usage = await fetchUsageForAccount(name)
	} catch {
		// proceed without usage
	}
	s.stop('Usage fetched')

	try {
		switchAccount(name)
	} catch (err) {
		p.cancel(`Failed to switch: ${err instanceof Error ? err.message : err}`)
		process.exit(1)
	}

	const lines = usage ? formatAccountUsage(usage) : ['Could not fetch usage data']
	p.note(lines.join('\n'), `Switched to "${name}"`)
}

async function switchInteractive() {
	const accounts = listAccounts()
	if (accounts.length === 0) {
		p.cancel('No accounts saved. Run `codex-auth save <name>` to save your current session.')
		process.exit(1)
	}

	const s = p.spinner()
	s.start('Fetching usage for all accounts...')
	const usageMap = await fetchAllUsage(accounts)
	s.stop('Usage fetched')

	const options = accounts.map((acc) => {
		const usage = usageMap.get(acc.name)
		const hint =
			usage instanceof Error
				? `\u26A0 ${usage.message}`
				: usage
					? formatUsageCompact(usage)
					: undefined

		return {
			value: acc.name,
			label: acc.isActive ? `${acc.name} (active)` : acc.name,
			hint,
		}
	})

	const selected = await p.select({
		message: 'Select account',
		options,
		initialValue: accounts.find((a) => a.isActive)?.name,
	})

	if (p.isCancel(selected)) {
		p.cancel('Cancelled.')
		process.exit(0)
	}

	try {
		switchAccount(selected)
	} catch (err) {
		p.cancel(`Failed to switch: ${err instanceof Error ? err.message : err}`)
		process.exit(1)
	}

	const usage = usageMap.get(selected)
	const lines =
		usage && !(usage instanceof Error) ? formatAccountUsage(usage) : ['Could not fetch usage data']
	p.note(lines.join('\n'), `Switched to "${selected}"`)
}

/** Run the interactive use flow — exported for default command */
export async function runUseInteractive() {
	await switchInteractive()
}
