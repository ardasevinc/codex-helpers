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

const main = defineCommand({
	meta: {
		name: 'codex-auth',
		version: pkg.version,
		description: 'Manage multiple Codex CLI accounts with usage monitoring',
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
	async run({ rawArgs }) {
		// Default to interactive use when no subcommand given
		if (rawArgs.length === 0) {
			await runUseInteractive()
		}
	},
})

runMain(main)
