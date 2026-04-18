import ansis from 'ansis'
import { defineCommand } from 'citty'
import { getCurrentAccountState, getCurrentAccountTarget } from '../lib/current.ts'
import { formatAccountUsage } from '../lib/display.ts'
import {
	createSpinner,
	fail,
	printInfo,
	printJson,
	printNote,
	printWarn,
	resolveOutputMode,
	serializeUsage,
} from '../lib/output.ts'

export const currentCommand = defineCommand({
	meta: {
		name: 'current',
		description: 'Show the currently active account and its usage',
	},
	args: {
		json: {
			type: 'boolean',
			description: 'Emit machine-readable JSON output',
			alias: 'j',
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args)
		const target = getCurrentAccountTarget()
		if (target.status === 'none') {
			if (mode.json) {
				printJson({ ok: true, status: 'none', active: null })
				return
			}
			printInfo(mode, 'No active account. Run `codex-auth use` to select one.')
			return
		}

		if (target.status === 'missing_snapshot') {
			if (mode.json) {
				printJson({
					ok: true,
					status: 'missing_snapshot',
					active: target.active,
				})
				return
			}
			printWarn(
				mode,
				`Active account "${target.active.name}" not found — snapshot may have been deleted.`,
			)
			return
		}

		const s = createSpinner(mode)
		s.start('Fetching usage...')
		const initialState = await getCurrentAccountState()

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
		if (initialState.status === 'ok') {
			lines = [
				`plan: ${ansis.bold(initialState.usage.planType)}`,
				...formatAccountUsage(initialState.usage),
			]
			jsonPayload = {
				ok: true,
				status: 'ok',
				active: initialState.active,
				usage: serializeUsage(initialState.usage),
			}
		} else if (initialState.status === 'error') {
			lines = [`${ansis.yellow('⚠')} could not fetch usage: ${initialState.error}`]
			jsonPayload = {
				ok: true,
				status: 'error',
				active: initialState.active,
				error: initialState.error,
			}
		} else {
			fail(mode, 'Unexpected current account state.')
		}

		s.stop('Done')
		if (mode.json) {
			printJson(jsonPayload)
			return
		}
		printNote(mode, lines.join('\n'), `Active account: ${target.active.name}`)
	},
})
