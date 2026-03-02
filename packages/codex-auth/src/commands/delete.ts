import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { accountExists, deleteAccount, getActiveAccount } from '../lib/accounts.ts'
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
	},
	async run({ args }) {
		const { name } = args

		if (!validateName(name)) {
			p.cancel(`Invalid name "${name}". Use only letters, numbers, hyphens, underscores.`)
			process.exit(1)
		}

		if (!accountExists(name)) {
			p.cancel(`Account "${name}" not found.`)
			process.exit(1)
		}

		const wasActive = getActiveAccount()?.name === name

		const confirmed = await p.confirm({
			message: `Delete account "${name}"?${wasActive ? ' (currently active)' : ''}`,
		})
		if (p.isCancel(confirmed) || !confirmed) {
			p.cancel('Cancelled.')
			process.exit(0)
		}

		try {
			deleteAccount(name)
		} catch (err) {
			p.cancel(`Failed to delete: ${err instanceof Error ? err.message : err}`)
			process.exit(1)
		}

		const note = wasActive
			? `Removed ~/.codex/accounts/${name}.json\nNo active account — run \`codex-auth use\` to select one.`
			: `Removed ~/.codex/accounts/${name}.json`
		p.note(note, `Deleted "${name}"`)
	},
})
