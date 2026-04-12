import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { accountExists, saveAccount } from '../lib/accounts.ts'
import {
	fail,
	printJson,
	printNote,
	requireFlagInNonInteractiveMode,
	resolveOutputMode,
} from '../lib/output.ts'
import { resolveAuthPath, validateName } from '../lib/paths.ts'

export const saveCommand = defineCommand({
	meta: {
		name: 'save',
		description: 'Save the current codex session as a named account',
	},
	args: {
		name: {
			type: 'positional',
			description: 'Account name (letters, numbers, hyphens, underscores)',
			required: true,
		},
		overwrite: {
			type: 'boolean',
			description: 'Overwrite an existing saved account without prompting',
			default: false,
		},
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			alias: 'j',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args)
		const { name } = args

		if (!validateName(name)) {
			fail(mode, `Invalid name "${name}". Use only letters, numbers, hyphens, underscores.`)
		}

		const authPath = resolveAuthPath()
		if (!authPath) {
			fail(mode, 'No auth.json found. Log in with `codex` CLI first.')
		}

		const exists = accountExists(name)
		if (exists && !args.overwrite) {
			if (mode.interactive) {
				const overwrite = await p.confirm({
					message: `Account "${name}" already exists. Overwrite?`,
				})
				if (p.isCancel(overwrite) || !overwrite) {
					fail(mode, 'Cancelled.', 0)
				}
			} else {
				requireFlagInNonInteractiveMode(
					mode,
					args.overwrite,
					'--overwrite',
					`Saving account "${name}"`,
				)
			}
		}

		try {
			saveAccount(name, authPath)
		} catch (err) {
			fail(mode, `Failed to save: ${err instanceof Error ? err.message : err}`)
		}

		if (mode.json) {
			printJson({
				ok: true,
				saved: name,
				snapshotPath: `~/.codex/accounts/${name}.json`,
				authPath,
				active: true,
				overwrote: exists,
			})
			return
		}

		printNote(
			mode,
			`Copied to ~/.codex/accounts/${name}.json\nThis account is now active.`,
			`Saved current session as "${name}"`,
		)
	},
})
