import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanTmpDir, createTmpDir } from '../helpers.ts'
import {
	captureConsole,
	type ExitError,
	importFresh,
	mockAgent,
	mockModule,
	mockPrompts,
	resetTestState,
	runCommand,
	setMockBaseUrl,
	stubProcessExit,
} from './helpers.ts'

setMockBaseUrl(import.meta.url)

afterEach(() => {
	resetTestState()
})

describe('updateCommand', () => {
	test('emits JSON for --check on unsupported linked installs', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()

		mockModule('../../src/lib/update.ts', () => ({
			resolveInstallTarget: vi.fn(async () => ({
				path: '/Users/arda/.bun/bin/codex-auth',
				realPath: '/Users/arda/.bun/install/global/node_modules/codex-auth/src/cli.ts',
				kind: 'symlink',
				reason:
					'Self-update only supports regular-file installs. Current executable is a symlink to /Users/arda/.bun/install/global/node_modules/codex-auth/src/cli.ts.',
				installedVersion: '0.3.5',
			})),
			fetchLatestRelease: vi.fn(async () => ({
				version: '0.3.6',
				tag: 'codex-auth-v0.3.6',
				assetName: 'codex-auth-darwin-arm64',
				assetUrl: 'https://example.test/codex-auth-darwin-arm64',
			})),
			fetchReleaseByVersion: vi.fn(),
			downloadReleaseAsset: vi.fn(),
			installReleaseBinary: vi.fn(),
		}))

		const { updateCommand } = await importFresh<typeof import('../../src/commands/update.ts')>(
			'../../src/commands/update.ts',
		)
		await runCommand(updateCommand, { args: { check: true, json: true } })

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			status: string
			installKind: string
			canSelfUpdate: boolean
			installedVersion: string
			latestVersion: string
		}
		expect(payload.ok).toBe(true)
		expect(payload.status).toBe('update-available')
		expect(payload.installKind).toBe('symlink')
		expect(payload.canSelfUpdate).toBe(false)
		expect(payload.installedVersion).toBe('0.3.5')
		expect(payload.latestVersion).toBe('0.3.6')

		consoleCapture.restore()
	})

	test('refuses to update unsupported linked installs', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const exitStub = stubProcessExit()

		mockModule('../../src/lib/update.ts', () => ({
			resolveInstallTarget: vi.fn(async () => ({
				path: '/Users/arda/.bun/bin/codex-auth',
				realPath: '/Users/arda/.bun/install/global/node_modules/codex-auth/src/cli.ts',
				kind: 'symlink',
				reason:
					'Self-update only supports regular-file installs. Current executable is a symlink to /Users/arda/.bun/install/global/node_modules/codex-auth/src/cli.ts.',
				installedVersion: '0.3.5',
			})),
			fetchLatestRelease: vi.fn(async () => ({
				version: '0.3.6',
				tag: 'codex-auth-v0.3.6',
				assetName: 'codex-auth-darwin-arm64',
				assetUrl: 'https://example.test/codex-auth-darwin-arm64',
			})),
			fetchReleaseByVersion: vi.fn(),
			downloadReleaseAsset: vi.fn(),
			installReleaseBinary: vi.fn(),
		}))

		try {
			const { updateCommand } = await importFresh<typeof import('../../src/commands/update.ts')>(
				'../../src/commands/update.ts',
			)
			await runCommand(updateCommand, { args: { check: false, json: true } })
		} catch (error) {
			expect((error as ExitError).code).toBe(1)
		} finally {
			exitStub.restore()
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			error: string
		}
		expect(payload.ok).toBe(false)
		expect(payload.error).toContain('Self-update only supports regular-file installs.')
		expect(payload.error).toContain('install.sh')
	})

	test('installs the requested release into a regular target', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const tempDir = createTmpDir()
		const targetPath = `${tempDir}/codex-auth`
		const downloadedBytes = new Uint8Array(Buffer.from('#!/bin/sh\necho 0.3.6\n'))
		const installReleaseBinary = vi.fn(async (path: string, bytes: Uint8Array) => {
			await writeFile(path, bytes)
		})

		mockModule('../../src/lib/update.ts', () => ({
			resolveInstallTarget: vi.fn(async () => ({
				path: targetPath,
				realPath: targetPath,
				kind: 'regular',
				reason: null,
				installedVersion: '0.3.5',
			})),
			fetchLatestRelease: vi.fn(async () => ({
				version: '0.3.6',
				tag: 'codex-auth-v0.3.6',
				assetName: 'codex-auth-darwin-arm64',
				assetUrl: 'https://example.test/codex-auth-darwin-arm64',
			})),
			fetchReleaseByVersion: vi.fn(),
			downloadReleaseAsset: vi.fn(async () => downloadedBytes),
			installReleaseBinary,
		}))

		try {
			const { updateCommand } = await importFresh<typeof import('../../src/commands/update.ts')>(
				'../../src/commands/update.ts',
			)
			await runCommand(updateCommand, { args: { check: false, json: true } })
		} finally {
			consoleCapture.restore()
			cleanTmpDir(tempDir)
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			status: string
			targetPath: string
			fromVersion: string
			toVersion: string
		}
		expect(payload.ok).toBe(true)
		expect(payload.status).toBe('updated')
		expect(payload.targetPath).toBe(targetPath)
		expect(payload.fromVersion).toBe('0.3.5')
		expect(payload.toVersion).toBe('0.3.6')
		expect(installReleaseBinary).toHaveBeenCalledWith(targetPath, downloadedBytes)
	})
})
