import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { importAccounts } from '../lib/accounts.ts'
import type { CodexAuth } from '../types.ts'

export const importCommand = defineCommand({
	meta: {
		name: 'import',
		description: 'Import accounts from JSON on stdin',
	},
	args: {
		overwrite: {
			type: 'boolean',
			description: 'Overwrite existing accounts',
			default: false,
		},
	},
	async run({ args }) {
		const input = await Bun.stdin.text()
		if (!input.trim()) {
			p.cancel('No input received. Pipe JSON via stdin.')
			process.exit(1)
		}

		let data: Record<string, CodexAuth>
		try {
			data = JSON.parse(input)
		} catch {
			p.cancel('Invalid JSON input.')
			process.exit(1)
		}

		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			p.cancel('Expected a JSON object mapping account names to auth data.')
			process.exit(1)
		}

		const { imported, skipped } = importAccounts(data, args.overwrite)

		const lines: string[] = []
		if (imported.length > 0) {
			lines.push(`Imported: ${imported.join(', ')}`)
		}
		if (skipped.length > 0) {
			lines.push(`Skipped: ${skipped.join(', ')}`)
		}

		p.note(lines.join('\n'), `${imported.length} imported, ${skipped.length} skipped`)
	},
})
