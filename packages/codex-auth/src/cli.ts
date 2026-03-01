#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty'
import pkg from '../package.json'
import { currentCommand } from './commands/current.ts'
import { listCommand } from './commands/list.ts'
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
	},
	async run({ rawArgs }) {
		// Default to interactive use when no subcommand given
		if (rawArgs.length === 0) {
			await runUseInteractive()
		}
	},
})

runMain(main)
