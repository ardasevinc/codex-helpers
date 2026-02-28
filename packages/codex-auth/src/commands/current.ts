import * as p from '@clack/prompts'
import ansis from 'ansis'
import { defineCommand } from 'citty'
import { accountExists, getActiveAccount } from '../lib/accounts.ts'
import { formatAccountUsage } from '../lib/display.ts'
import { fetchUsageForAccount } from '../lib/usage.ts'

export const currentCommand = defineCommand({
	meta: {
		name: 'current',
		description: 'Show the currently active account and its usage',
	},
	async run() {
		const active = getActiveAccount()
		if (!active) {
			p.log.info('No active account. Run `codex-auth use` to select one.')
			return
		}

		if (!accountExists(active.name)) {
			p.log.warn(`Active account "${active.name}" not found — snapshot may have been deleted.`)
			return
		}

		const s = p.spinner()
		s.start('Fetching usage...')

		let lines: string[]
		try {
			const usage = await fetchUsageForAccount(active.name)
			lines = [`plan: ${ansis.bold(usage.planType)}`, ...formatAccountUsage(usage)]
		} catch (err) {
			lines = [
				`${ansis.yellow('⚠')} could not fetch usage: ${err instanceof Error ? err.message : err}`,
			]
		}

		s.stop('Done')
		p.note(lines.join('\n'), `Active account: ${active.name}`)
	},
})
