import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { importAccounts, validateImportData } from '../lib/accounts.ts'
import type { CodexAuth } from '../types.ts'

export function parseImportInput(input: string): Record<string, CodexAuth> {
	let data: unknown
	try {
		data = JSON.parse(input)
	} catch {
		throw new Error('Invalid JSON input.')
	}

	return validateImportData(data)
}

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

		try {
			const data = parseImportInput(input)
			const { imported, skipped } = importAccounts(data, args.overwrite)

			const lines: string[] = []
			if (imported.length > 0) {
				lines.push(`Imported: ${imported.join(', ')}`)
			}
			if (skipped.length > 0) {
				lines.push(`Skipped: ${skipped.join(', ')}`)
			}

			p.note(lines.join('\n'), `${imported.length} imported, ${skipped.length} skipped`)
		} catch (err) {
			p.cancel(err instanceof Error ? err.message : String(err))
			process.exit(1)
		}
	},
})
