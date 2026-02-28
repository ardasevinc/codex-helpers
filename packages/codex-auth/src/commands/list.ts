import * as p from '@clack/prompts'
import ansis from 'ansis'
import { defineCommand } from 'citty'
import { listAccounts } from '../lib/accounts.ts'
import { formatUsageLine } from '../lib/display.ts'
import { fetchAllUsage } from '../lib/usage.ts'
import type { AccountUsage } from '../types.ts'

export const listCommand = defineCommand({
	meta: {
		name: 'list',
		description: 'List all saved accounts with usage',
	},
	async run() {
		const accounts = listAccounts()
		if (accounts.length === 0) {
			p.log.info('No accounts saved. Run `codex-auth save <name>` to save your current session.')
			return
		}

		const s = p.spinner()
		s.start('Fetching usage...')
		const usageMap = await fetchAllUsage(accounts)
		s.stop('Usage fetched')

		p.intro('Saved accounts')

		for (const acc of accounts) {
			const marker = acc.isActive ? ansis.green('●') : ansis.dim('○')
			const label = acc.isActive ? `${acc.name} ${ansis.dim('(active)')}` : acc.name
			const usage = usageMap.get(acc.name)

			console.log(`  ${marker} ${label}`)

			if (usage instanceof Error) {
				console.log(`    ${ansis.yellow('⚠')} could not fetch usage (${usage.message})`)
			} else if (usage) {
				printUsage(usage)
			}
			console.log()
		}

		p.outro(`${accounts.length} account${accounts.length === 1 ? '' : 's'} saved`)
	},
})

function printUsage(usage: AccountUsage) {
	console.log(`    ${formatUsageLine('5hr   ', usage.session.usedPercent, usage.session.resetAt)}`)
	console.log(`    ${formatUsageLine('weekly', usage.weekly.usedPercent, usage.weekly.resetAt)}`)
	if (usage.credits?.hasCredits && typeof usage.credits.balance === 'number') {
		console.log(`    credits: $${usage.credits.balance.toFixed(2)} remaining`)
	}
}
