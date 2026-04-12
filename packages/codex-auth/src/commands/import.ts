import { defineCommand } from 'citty'
import { importAccounts, validateImportData } from '../lib/accounts.ts'
import { fail, printJson, printNote, resolveOutputMode } from '../lib/output.ts'
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
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args)
		const input = await Bun.stdin.text()
		if (!input.trim()) {
			fail(mode, 'No input received. Pipe JSON via stdin.')
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

			if (mode.json) {
				printJson({
					ok: true,
					imported,
					skipped,
					counts: {
						imported: imported.length,
						skipped: skipped.length,
					},
				})
				return
			}

			printNote(mode, lines.join('\n'), `${imported.length} imported, ${skipped.length} skipped`)
		} catch (err) {
			fail(mode, err instanceof Error ? err.message : String(err))
		}
	},
})
