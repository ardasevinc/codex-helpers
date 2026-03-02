import * as p from '@clack/prompts'
import ansis from 'ansis'
import { defineCommand } from 'citty'
import { deleteAccount, listAccounts } from '../lib/accounts.ts'
import { findExpired } from '../lib/expiry.ts'
import { fetchAllUsage } from '../lib/usage.ts'

export const pruneCommand = defineCommand({
	meta: {
		name: 'prune',
		description: 'Check all accounts and delete expired ones',
	},
	async run() {
		const accounts = listAccounts()
		if (accounts.length === 0) {
			p.log.info('No accounts saved.')
			return
		}

		const s = p.spinner()
		s.start('Checking all accounts...')
		const usageMap = await fetchAllUsage(accounts)
		s.stop('Done')

		const expired = findExpired(usageMap)

		if (expired.size === 0) {
			p.log.info('All accounts are healthy. Nothing to prune.')
			return
		}

		p.intro(`Found ${expired.size} expired account${expired.size === 1 ? '' : 's'}`)
		for (const [name, reason] of expired) {
			console.log(`  ${ansis.red('✕')} ${name} — ${reason}`)
		}
		console.log()

		const confirmed = await p.confirm({
			message: `Delete ${expired.size} expired account${expired.size === 1 ? '' : 's'}?`,
		})
		if (p.isCancel(confirmed) || !confirmed) {
			p.cancel('Cancelled.')
			process.exit(0)
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

		p.note(lines.join('\n'), `${deleted.length} pruned, ${failed.length} failed`)
	},
})
