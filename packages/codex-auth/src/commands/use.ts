import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { listAccounts, switchAccount } from '../lib/accounts.ts'
import { formatAccountUsage, formatUsageCompact } from '../lib/display.ts'
import {
	createSpinner,
	fail,
	printJson,
	printNote,
	requireInteractive,
	resolveOutputMode,
	serializeUsage,
} from '../lib/output.ts'
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
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			alias: 'j',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args)
		if (args.name) {
			await switchNamed(args.name, mode)
		} else {
			requireInteractive(
				mode,
				'Interactive account selection is disabled in non-interactive mode. Pass an account name.',
			)
			await switchInteractive(mode)
		}
	},
})

async function switchNamed(name: string, mode: ReturnType<typeof resolveOutputMode>) {
	const s = createSpinner(mode)
	s.start('Fetching usage...')

	let usage: AccountUsage | null = null
	let usageError: string | null = null
	try {
		usage = await fetchUsageForAccount(name)
	} catch (err) {
		usageError = err instanceof Error ? err.message : String(err)
	}
	s.stop('Usage fetched')

	try {
		switchAccount(name)
	} catch (err) {
		fail(mode, `Failed to switch: ${err instanceof Error ? err.message : err}`)
	}

	if (mode.json) {
		printJson({
			ok: true,
			switchedTo: name,
			usage: usage ? serializeUsage(usage) : null,
			usageError,
		})
		return
	}

	const lines = usage ? formatAccountUsage(usage) : ['Could not fetch usage data']
	printNote(mode, lines.join('\n'), `Switched to "${name}"`)
}

async function switchInteractive(mode: ReturnType<typeof resolveOutputMode>) {
	const accounts = listAccounts()
	if (accounts.length === 0) {
		fail(mode, 'No accounts saved. Run `codex-auth save <name>` to save your current session.')
	}

	const s = createSpinner(mode)
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
		fail(mode, 'Cancelled.', 0)
	}

	try {
		switchAccount(selected)
	} catch (err) {
		fail(mode, `Failed to switch: ${err instanceof Error ? err.message : err}`)
	}

	const usage = usageMap.get(selected)
	const lines =
		usage && !(usage instanceof Error) ? formatAccountUsage(usage) : ['Could not fetch usage data']
	printNote(mode, lines.join('\n'), `Switched to "${selected}"`)
}

/** Run the interactive use flow — exported for default command */
export async function runUseInteractive() {
	await switchInteractive(resolveOutputMode())
}
