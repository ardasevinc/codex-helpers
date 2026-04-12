import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { accountExists, deleteAccount, getActiveAccount } from '../lib/accounts.ts'
import {
	fail,
	printJson,
	printNote,
	requireFlagInNonInteractiveMode,
	resolveOutputMode,
} from '../lib/output.ts'
import { validateName } from '../lib/paths.ts'

export const deleteCommand = defineCommand({
	meta: {
		name: 'delete',
		description: 'Delete a saved account',
	},
	args: {
		name: {
			type: 'positional',
			description: 'Account name to delete',
			required: true,
		},
		yes: {
			type: 'boolean',
			description: 'Delete without prompting',
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

		if (!accountExists(name)) {
			fail(mode, `Account "${name}" not found.`)
		}

		const wasActive = getActiveAccount()?.name === name

		if (args.yes) {
			// no prompt
		} else if (mode.interactive) {
			const confirmed = await p.confirm({
				message: `Delete account "${name}"?${wasActive ? ' (currently active)' : ''}`,
			})
			if (p.isCancel(confirmed) || !confirmed) {
				fail(mode, 'Cancelled.', 0)
			}
		} else {
			requireFlagInNonInteractiveMode(mode, args.yes, '--yes', `Deleting account "${name}"`)
		}

		try {
			deleteAccount(name)
		} catch (err) {
			fail(mode, `Failed to delete: ${err instanceof Error ? err.message : err}`)
		}

		if (mode.json) {
			printJson({
				ok: true,
				deleted: name,
				wasActive,
				activeCleared: wasActive,
			})
			return
		}

		const note = wasActive
			? `Removed ~/.codex/accounts/${name}.json\nNo active account — run \`codex-auth use\` to select one.`
			: `Removed ~/.codex/accounts/${name}.json`
		printNote(mode, note, `Deleted "${name}"`)
	},
})
