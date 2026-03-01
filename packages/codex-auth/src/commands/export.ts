import { defineCommand } from 'citty'
import { exportAccounts } from '../lib/accounts.ts'

export const exportCommand = defineCommand({
	meta: {
		name: 'export',
		description: 'Export all accounts as JSON to stdout',
	},
	run() {
		const data = exportAccounts()
		if (Object.keys(data).length === 0) {
			process.stderr.write('No accounts to export.\n')
			process.exit(1)
		}
		process.stdout.write(JSON.stringify(data, null, 2))
	},
})
