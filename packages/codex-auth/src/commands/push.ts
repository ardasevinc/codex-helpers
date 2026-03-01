import * as p from '@clack/prompts'
import { defineCommand } from 'citty'
import { exportAccounts } from '../lib/accounts.ts'

export const pushCommand = defineCommand({
	meta: {
		name: 'push',
		description: 'Push all accounts to a remote host via SSH',
	},
	args: {
		host: {
			type: 'positional',
			description: 'SSH host (e.g. user@vps, vps-alias)',
			required: true,
		},
		overwrite: {
			type: 'boolean',
			description: 'Overwrite existing accounts on remote',
			default: false,
		},
	},
	async run({ args }) {
		const data = exportAccounts()
		const names = Object.keys(data)

		if (names.length === 0) {
			p.cancel('No accounts to push.')
			process.exit(1)
		}

		const s = p.spinner()
		s.start(`Pushing ${names.length} account(s) to ${args.host}...`)

		// Ensure remote accounts dir exists
		const mkdirProc = Bun.spawn(['ssh', args.host, 'mkdir -p ~/.codex/accounts'], {
			stdout: 'ignore',
			stderr: 'pipe',
		})
		const mkdirExit = await mkdirProc.exited
		if (mkdirExit !== 0) {
			const err = await new Response(mkdirProc.stderr).text()
			s.stop('Failed')
			p.cancel(`SSH connection failed: ${err.trim()}`)
			process.exit(1)
		}

		const pushed: string[] = []
		const skipped: string[] = []
		const failed: string[] = []

		for (const [name, auth] of Object.entries(data)) {
			// Check if remote file exists (skip if not overwriting)
			if (!args.overwrite) {
				const testProc = Bun.spawn(['ssh', args.host, `test -f ~/.codex/accounts/${name}.json`], {
					stdout: 'ignore',
					stderr: 'ignore',
				})
				const testExit = await testProc.exited
				if (testExit === 0) {
					skipped.push(name)
					continue
				}
			}

			// Write snapshot to remote
			const content = JSON.stringify(auth, null, 2)
			const proc = Bun.spawn(['ssh', args.host, `cat > ~/.codex/accounts/${name}.json`], {
				stdin: new Response(content).body,
				stdout: 'ignore',
				stderr: 'pipe',
			})
			const exit = await proc.exited
			if (exit === 0) {
				pushed.push(name)
			} else {
				failed.push(name)
			}
		}

		s.stop('Done')

		const lines: string[] = []
		if (pushed.length > 0) lines.push(`Pushed: ${pushed.join(', ')}`)
		if (skipped.length > 0) lines.push(`Skipped (exists): ${skipped.join(', ')}`)
		if (failed.length > 0) lines.push(`Failed: ${failed.join(', ')}`)

		p.note(lines.join('\n'), `${args.host}: ${pushed.length} pushed, ${skipped.length} skipped`)

		if (failed.length > 0) process.exit(1)
	},
})
