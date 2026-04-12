import ansis from 'ansis'
import { defineCommand } from 'citty'
import { listAccounts } from '../lib/accounts.ts'
import { formatUsageLine } from '../lib/display.ts'
import { classifyAccount } from '../lib/expiry.ts'
import {
	createSpinner,
	printInfo,
	printIntro,
	printJson,
	printOutro,
	resolveOutputMode,
	serializeUsage,
} from '../lib/output.ts'
import { fetchAllUsage } from '../lib/usage.ts'
import type { AccountUsage } from '../types.ts'

export const listCommand = defineCommand({
	meta: {
		name: 'list',
		description: 'List all saved accounts with usage',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			alias: 'j',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args)
		const accounts = listAccounts()
		if (accounts.length === 0) {
			if (mode.json) {
				printJson({
					ok: true,
					accounts: [],
					summary: { total: 0, active: null, ok: 0, expired: 0, error: 0 },
				})
				return
			}
			printInfo(
				mode,
				'No accounts saved. Run `codex-auth save <name>` to save your current session.',
			)
			return
		}

		const s = createSpinner(mode)
		s.start('Fetching usage...')
		const usageMap = await fetchAllUsage(accounts)
		s.stop('Usage fetched')

		if (mode.json) {
			const items = accounts.map((acc) => {
				const result = usageMap.get(acc.name)
				if (!result) {
					return {
						name: acc.name,
						isActive: acc.isActive,
						status: 'error',
						message: 'usage missing',
					}
				}

				const status = classifyAccount(result)
				if (status.state === 'ok') {
					return {
						name: acc.name,
						isActive: acc.isActive,
						status: 'ok',
						usage: serializeUsage(status.usage),
					}
				}
				if (status.state === 'expired') {
					return {
						name: acc.name,
						isActive: acc.isActive,
						status: 'expired',
						reason: status.reason,
					}
				}
				return {
					name: acc.name,
					isActive: acc.isActive,
					status: 'error',
					message: status.message,
				}
			})

			printJson({
				ok: true,
				accounts: items,
				summary: {
					total: items.length,
					active: items.find((item) => item.isActive)?.name ?? null,
					ok: items.filter((item) => item.status === 'ok').length,
					expired: items.filter((item) => item.status === 'expired').length,
					error: items.filter((item) => item.status === 'error').length,
				},
			})
			return
		}

		printIntro(mode, 'Saved accounts')

		for (const acc of accounts) {
			const marker = acc.isActive ? ansis.green('●') : ansis.dim('○')
			const label = acc.isActive ? `${acc.name} ${ansis.dim('(active)')}` : acc.name
			const result = usageMap.get(acc.name)

			if (!result) {
				console.log(`  ${marker} ${label}`)
				console.log()
				continue
			}

			const status = classifyAccount(result)

			if (status.state === 'ok') {
				const planTag = ansis.dim(`[${status.usage.planType}]`)
				console.log(`  ${marker} ${label} ${planTag}`)
				printUsage(status.usage)
			} else if (status.state === 'expired') {
				console.log(`  ${marker} ${label}`)
				console.log(`    ${ansis.red('⚠')} ${status.reason}`)
			} else {
				console.log(`  ${marker} ${label}`)
				console.log(`    ${ansis.yellow('⚠')} could not fetch usage (${status.message})`)
			}
			console.log()
		}

		printOutro(mode, `${accounts.length} account${accounts.length === 1 ? '' : 's'} saved`)
	},
})

function printUsage(usage: AccountUsage) {
	console.log(`    ${formatUsageLine('5hr   ', usage.session.usedPercent, usage.session.resetAt)}`)
	console.log(`    ${formatUsageLine('weekly', usage.weekly.usedPercent, usage.weekly.resetAt)}`)
	if (usage.credits?.hasCredits && typeof usage.credits.balance === 'number') {
		console.log(`    credits: $${usage.credits.balance.toFixed(2)} remaining`)
	}
}
