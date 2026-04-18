import { defineCommand } from 'citty'
import {
	createSpinner,
	fail,
	printInfo,
	printJson,
	printNote,
	resolveOutputMode,
} from '../lib/output.ts'
import {
	downloadReleaseAsset,
	fetchLatestRelease,
	fetchReleaseByVersion,
	installReleaseBinary,
	resolveInstallTarget,
} from '../lib/update.ts'

type UpdateStatus = 'up-to-date' | 'update-available'

function getStatus(installedVersion: string | null, targetVersion: string): UpdateStatus {
	return installedVersion === targetVersion ? 'up-to-date' : 'update-available'
}

function installHint(version: string): string {
	return `curl -fsSL https://raw.githubusercontent.com/ardasevinc/codex-helpers/main/install.sh | sh -s -- codex-auth ${version}`
}

export const updateCommand = defineCommand({
	meta: {
		name: 'update',
		description: 'Check for or install a codex-auth release update',
	},
	args: {
		version: {
			type: 'positional',
			description: 'Install a specific version instead of the latest release',
			required: false,
		},
		check: {
			type: 'boolean',
			description: 'Check the latest available version without installing',
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
		const target = await resolveInstallTarget().catch((error) => {
			fail(mode, error instanceof Error ? error.message : String(error))
		})

		const release = await (args.version
			? fetchReleaseByVersion(args.version)
			: fetchLatestRelease()
		).catch((error) => {
			fail(mode, error instanceof Error ? error.message : String(error))
		})

		const status = getStatus(target.installedVersion, release.version)

		if (args.check) {
			if (mode.json) {
				printJson({
					ok: true,
					status,
					targetPath: target.path,
					installKind: target.kind,
					canSelfUpdate: target.reason === null,
					reason: target.reason,
					installedVersion: target.installedVersion,
					latestVersion: release.version,
					tag: release.tag,
				})
				return
			}

			const lines = [
				`installed: ${target.installedVersion ?? 'unknown'}`,
				`latest: ${release.version}`,
				`path: ${target.path}`,
				`mode: ${target.kind}`,
				target.reason ? `self-update: unsupported (${target.reason})` : 'self-update: supported',
				`status: ${status}`,
			]
			printNote(mode, lines.join('\n'), 'codex-auth update check')
			return
		}

		if (target.reason) {
			fail(mode, `${target.reason}\nUse the installer instead:\n${installHint(release.version)}`)
		}

		if (status === 'up-to-date') {
			if (mode.json) {
				printJson({
					ok: true,
					status,
					targetPath: target.path,
					installedVersion: target.installedVersion,
					latestVersion: release.version,
				})
				return
			}

			printInfo(mode, `codex-auth ${release.version} is already installed at ${target.path}.`)
			return
		}

		const spinner = createSpinner(mode)
		spinner.start(`Downloading codex-auth ${release.version}...`)
		const bytes = await downloadReleaseAsset(release.assetUrl).catch((error) => {
			spinner.stop('Failed')
			fail(mode, error instanceof Error ? error.message : String(error))
		})

		spinner.stop('Downloaded')

		try {
			await installReleaseBinary(target.path, bytes)
		} catch (error) {
			fail(
				mode,
				`Failed to install update at ${target.path}: ${error instanceof Error ? error.message : String(error)}\nTry the installer instead:\n${installHint(release.version)}`,
			)
		}

		if (mode.json) {
			printJson({
				ok: true,
				status: 'updated',
				targetPath: target.path,
				fromVersion: target.installedVersion,
				toVersion: release.version,
			})
			return
		}

		const body = [
			`updated: ${target.installedVersion ?? 'unknown'} -> ${release.version}`,
			`path: ${target.path}`,
			`asset: ${release.assetName}`,
		]
		printNote(mode, body.join('\n'), 'codex-auth updated')
	},
})
