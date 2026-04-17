#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty'
import pkg from '../package.json'
import { currentCommand } from './commands/current.ts'
import { deleteCommand } from './commands/delete.ts'
import { exportCommand } from './commands/export.ts'
import { importCommand } from './commands/import.ts'
import { listCommand } from './commands/list.ts'
import { pruneCommand } from './commands/prune.ts'
import { pushCommand } from './commands/push.ts'
import { saveCommand } from './commands/save.ts'
import { runUseInteractive, useCommand } from './commands/use.ts'
import { hasJsonFlag, normalizeRawArgs, validateRawArgs } from './lib/argv.ts'
import { fail, printJson, resolveOutputMode } from './lib/output.ts'

const main = defineCommand({
	meta: {
		name: 'codex-auth',
		version: pkg.version,
		description: 'Manage multiple Codex CLI accounts with usage monitoring',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			alias: 'j',
			default: false,
		},
	},
	subCommands: {
		save: saveCommand,
		use: useCommand,
		list: listCommand,
		current: currentCommand,
		delete: deleteCommand,
		prune: pruneCommand,
		export: exportCommand,
		import: importCommand,
		push: pushCommand,
	},
	async run({ rawArgs, args }) {
		if (rawArgs.length === 1 && (rawArgs[0] === '-v' || rawArgs[0] === '-V')) {
			console.log(pkg.version)
			return
		}

		const mode = resolveOutputMode(args)
		// Default to interactive use when no subcommand given
		if (rawArgs.length === 0) {
			if (mode.interactive) {
				await runUseInteractive()
				return
			}

			if (mode.json) {
				printJson({
					ok: false,
					error: 'Interactive mode is disabled in non-interactive mode. Use a subcommand.',
				})
				process.exit(1)
			}

			fail(mode, 'Interactive mode is disabled in non-interactive mode. Use a subcommand.')
		}
	},
})

const rawArgs = normalizeRawArgs(process.argv.slice(2))
const validationError = validateRawArgs(rawArgs, main as Parameters<typeof validateRawArgs>[1])

if (validationError) {
	if (hasJsonFlag(rawArgs)) {
		printJson({ ok: false, error: validationError })
	} else {
		console.error(validationError)
	}
	process.exit(1)
}

runMain(main, { rawArgs })
