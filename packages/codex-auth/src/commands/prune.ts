import * as p from '@clack/prompts'
import ansis from 'ansis'
import { defineCommand } from 'citty'
import { deleteAccount, listAccounts } from '../lib/accounts.ts'
import { findExpired } from '../lib/expiry.ts'
import {
	createSpinner,
	fail,
	printInfo,
	printIntro,
	printJson,
	printNote,
	requireFlagInNonInteractiveMode,
	resolveOutputMode,
} from '../lib/output.ts'
import { fetchAllUsage } from '../lib/usage.ts'

export const pruneCommand = defineCommand({
	meta: {
		name: 'prune',
		description: 'Check all accounts and delete expired ones',
	},
	args: {
		yes: {
			type: 'boolean',
			description: 'Delete expired accounts without prompting',
			default: false,
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
		const yes = Boolean(args?.yes)
		const accounts = listAccounts()
		if (accounts.length === 0) {
			if (mode.json) {
				printJson({ ok: true, total: 0, expired: [], deleted: [], failed: [] })
				return
			}
			printInfo(mode, 'No accounts saved.')
			return
		}

		const s = createSpinner(mode)
		s.start('Checking all accounts...')
		const usageMap = await fetchAllUsage(accounts)
		s.stop('Done')

		const expired = findExpired(usageMap)

		if (expired.size === 0) {
			if (mode.json) {
				printJson({
					ok: true,
					total: accounts.length,
					expired: [],
					deleted: [],
					failed: [],
				})
				return
			}
			printInfo(mode, 'All accounts are healthy. Nothing to prune.')
			return
		}

		const expiredItems = Array.from(expired, ([name, reason]) => ({ name, reason }))

		if (mode.json) {
			requireFlagInNonInteractiveMode(
				mode,
				yes,
				'--yes',
				`Pruning ${expired.size} expired account${expired.size === 1 ? '' : 's'}`,
			)
		} else {
			printIntro(mode, `Found ${expired.size} expired account${expired.size === 1 ? '' : 's'}`)
			for (const { name, reason } of expiredItems) {
				console.log(`  ${ansis.red('✕')} ${name} — ${reason}`)
			}
			console.log()
		}

		if (!yes) {
			if (mode.interactive) {
				const confirmed = await p.confirm({
					message: `Delete ${expired.size} expired account${expired.size === 1 ? '' : 's'}?`,
				})
				if (p.isCancel(confirmed) || !confirmed) {
					fail(mode, 'Cancelled.', 0)
				}
			} else {
				requireFlagInNonInteractiveMode(
					mode,
					yes,
					'--yes',
					`Pruning ${expired.size} expired account${expired.size === 1 ? '' : 's'}`,
				)
			}
		}

		const deleted: string[] = []
		const failed: string[] = []

		for (const [name] of expired) {
			try {
				deleteAccount(name)
				deleted.push(name)
			} catch {
				failed.push(name)
			}
		}

		const lines: string[] = []
		if (deleted.length > 0) {
			lines.push(`Deleted: ${deleted.join(', ')}`)
		}
		if (failed.length > 0) {
			lines.push(`Failed: ${failed.join(', ')}`)
		}

		if (mode.json) {
			printJson({
				ok: failed.length === 0,
				total: accounts.length,
				expired: expiredItems,
				deleted,
				failed,
			})
			if (failed.length > 0) {
				process.exit(1)
			}
			return
		}

		printNote(mode, lines.join('\n'), `${deleted.length} pruned, ${failed.length} failed`)
	},
})
