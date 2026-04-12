import ansis from 'ansis'
import { defineCommand } from 'citty'
import { accountExists, getActiveAccount } from '../lib/accounts.ts'
import { formatAccountUsage } from '../lib/display.ts'
import {
	createSpinner,
	printInfo,
	printJson,
	printNote,
	printWarn,
	resolveOutputMode,
	serializeUsage,
} from '../lib/output.ts'
import { fetchUsageForAccount } from '../lib/usage.ts'

export const currentCommand = defineCommand({
	meta: {
		name: 'current',
		description: 'Show the currently active account and its usage',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args)
		const active = getActiveAccount()
		if (!active) {
			if (mode.json) {
				printJson({ ok: true, status: 'none', active: null })
				return
			}
			printInfo(mode, 'No active account. Run `codex-auth use` to select one.')
			return
		}

		if (!accountExists(active.name)) {
			if (mode.json) {
				printJson({
					ok: true,
					status: 'missing_snapshot',
					active: {
						name: active.name,
						switchedAt: active.switched_at,
						snapshotExists: false,
					},
				})
				return
			}
			printWarn(mode, `Active account "${active.name}" not found — snapshot may have been deleted.`)
			return
		}

		const s = createSpinner(mode)
		s.start('Fetching usage...')

		let lines: string[]
		let jsonPayload:
			| {
					ok: true
					status: 'ok'
					active: { name: string; switchedAt: string; snapshotExists: true }
					usage: ReturnType<typeof serializeUsage>
			  }
			| {
					ok: true
					status: 'error'
					active: { name: string; switchedAt: string; snapshotExists: true }
					error: string
			  }
		try {
			const usage = await fetchUsageForAccount(active.name)
			lines = [`plan: ${ansis.bold(usage.planType)}`, ...formatAccountUsage(usage)]
			jsonPayload = {
				ok: true,
				status: 'ok',
				active: {
					name: active.name,
					switchedAt: active.switched_at,
					snapshotExists: true,
				},
				usage: serializeUsage(usage),
			}
		} catch (err) {
			lines = [
				`${ansis.yellow('⚠')} could not fetch usage: ${err instanceof Error ? err.message : err}`,
			]
			jsonPayload = {
				ok: true,
				status: 'error',
				active: {
					name: active.name,
					switchedAt: active.switched_at,
					snapshotExists: true,
				},
				error: err instanceof Error ? err.message : String(err),
			}
		}

		s.stop('Done')
		if (mode.json) {
			printJson(jsonPayload)
			return
		}
		printNote(mode, lines.join('\n'), `Active account: ${active.name}`)
	},
})
