import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { accountExists, saveAccount } from '../lib/accounts.ts'
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
	},
	async run({ args }) {
		const { name } = args

		if (!validateName(name)) {
			p.cancel(`Invalid name "${name}". Use only letters, numbers, hyphens, underscores.`)
			process.exit(1)
		}

		const authPath = resolveAuthPath()
		if (!authPath) {
			p.cancel('No auth.json found. Log in with `codex` CLI first.')
			process.exit(1)
		}

		if (accountExists(name)) {
			const overwrite = await p.confirm({
				message: `Account "${name}" already exists. Overwrite?`,
			})
			if (p.isCancel(overwrite) || !overwrite) {
				p.cancel('Cancelled.')
				process.exit(0)
			}
		}

		try {
			saveAccount(name, authPath)
		} catch (err) {
			p.cancel(`Failed to save: ${err instanceof Error ? err.message : err}`)
			process.exit(1)
		}

		p.note(
			`Copied to ~/.codex/accounts/${name}.json\nThis account is now active.`,
			`Saved current session as "${name}"`,
		)
	},
})
