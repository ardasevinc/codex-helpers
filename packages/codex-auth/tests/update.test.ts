import {
	chmodSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanTmpDir, createTmpDir } from './helpers.ts'

const envKeys = ['CODEX_AUTH_UPDATE_BIN_PATH', 'CODEX_AUTH_UPDATE_API_BASE'] as const

afterEach(() => {
	for (const key of envKeys) {
		delete process.env[key]
	}
	vi.restoreAllMocks()
	vi.resetModules()
})

describe('update helpers', () => {
	test('resolveInstallTarget marks symlinked script installs unsupported', async () => {
		const tempDir = createTmpDir()
		const sourcePath = `${tempDir}/src/cli.ts`
		const linkPath = `${tempDir}/codex-auth`

		mkdirSync(`${tempDir}/src`, { recursive: true })
		writeFileSync(sourcePath, '#!/bin/sh\necho 0.3.5\n')
		chmodSync(sourcePath, 0o755)
		symlinkSync(sourcePath, linkPath)
		process.env.CODEX_AUTH_UPDATE_BIN_PATH = linkPath

		try {
			const { resolveInstallTarget } = await import('../src/lib/update.ts')
			const target = await resolveInstallTarget()

			expect(target.kind).toBe('symlink')
			expect(target.path).toBe(linkPath)
			expect(target.realPath).toBe(realpathSync(sourcePath))
			expect(target.reason).toContain('regular-file installs')
			expect(target.installedVersion).toBeNull()
		} finally {
			cleanTmpDir(tempDir)
		}
	})

	test('installReleaseBinary atomically replaces the target file', async () => {
		const tempDir = createTmpDir()
		const targetPath = `${tempDir}/codex-auth`
		writeFileSync(targetPath, '#!/bin/sh\necho old\n')
		chmodSync(targetPath, 0o755)

		try {
			const { installReleaseBinary } = await import('../src/lib/update.ts')
			await installReleaseBinary(targetPath, new Uint8Array(Buffer.from('#!/bin/sh\necho new\n')))

			expect(readFileSync(targetPath, 'utf8')).toBe('#!/bin/sh\necho new\n')
			expect(statSync(targetPath).mode & 0o111).not.toBe(0)
		} finally {
			cleanTmpDir(tempDir)
		}
	})

	test('fetchLatestRelease picks the newest codex-auth release asset for this platform', async () => {
		process.env.CODEX_AUTH_UPDATE_API_BASE = 'https://updates.example.test'

		type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
		const setFetch = (handler: FetchHandler) => {
			vi.stubGlobal(
				'fetch',
				Object.assign(handler, {
					preconnect: fetch.preconnect?.bind(fetch),
				}),
			)
		}

		setFetch(async (input) => {
			const url = String(input)
			expect(url).toBe('https://updates.example.test/releases?per_page=20')

			return new Response(
				JSON.stringify([
					{ tag_name: 'other-tool-v1.0.0', assets: [] },
					{
						tag_name: 'codex-auth-v0.3.6',
						assets: [
							{
								name: `codex-auth-${process.platform}-${process.arch}`,
								browser_download_url: 'https://downloads.example.test/codex-auth',
							},
						],
					},
				]),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			)
		})

		const { fetchLatestRelease } = await import('../src/lib/update.ts')
		await expect(fetchLatestRelease()).resolves.toEqual({
			version: '0.3.6',
			tag: 'codex-auth-v0.3.6',
			assetName: `codex-auth-${process.platform}-${process.arch}`,
			assetUrl: 'https://downloads.example.test/codex-auth',
		})
	})
})
