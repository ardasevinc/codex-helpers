import { existsSync } from 'node:fs'
import { chmod, lstat, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, delimiter, dirname, extname, join } from 'node:path'

const PACKAGE_NAME = 'codex-auth'
const REPO = 'ardasevinc/codex-helpers'
const UPDATE_BIN_PATH_ENV = 'CODEX_AUTH_UPDATE_BIN_PATH'
const UPDATE_API_BASE_ENV = 'CODEX_AUTH_UPDATE_API_BASE'

type GithubReleaseAsset = {
	name: string
	browser_download_url: string
}

type GithubRelease = {
	tag_name: string
	assets: GithubReleaseAsset[]
}

export type InstallTargetKind = 'regular' | 'symlink' | 'script'

export type InstallTarget = {
	path: string
	realPath: string
	kind: InstallTargetKind
	reason: string | null
	installedVersion: string | null
}

export type ReleaseInfo = {
	version: string
	tag: string
	assetName: string
	assetUrl: string
}

function getExecutableName(): string {
	return PACKAGE_NAME
}

function getApiBase(): string {
	return (process.env[UPDATE_API_BASE_ENV] ?? `https://api.github.com/repos/${REPO}`).replace(
		/\/$/,
		'',
	)
}

function releasePrefix(): string {
	return `${PACKAGE_NAME}-v`
}

function releaseAssetName(): string {
	const platform = process.platform
	if (platform !== 'darwin' && platform !== 'linux') {
		throw new Error(`Unsupported OS for self-update: ${platform}`)
	}

	const arch = process.arch
	if (arch !== 'arm64' && arch !== 'x64') {
		throw new Error(`Unsupported architecture for self-update: ${arch}`)
	}

	return `${PACKAGE_NAME}-${platform}-${arch}`
}

function githubHeaders(): Record<string, string> {
	return {
		Accept: 'application/vnd.github+json',
		'User-Agent': `${PACKAGE_NAME}/self-update`,
	}
}

function findOnPath(name: string, pathEnv = process.env.PATH ?? ''): string | null {
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue
		const candidate = join(dir, name)
		if (existsSync(candidate)) {
			return candidate
		}
	}
	return null
}

function isScriptPath(path: string): boolean {
	const extension = extname(path)
	return (
		extension === '.ts' || extension === '.js' || path.includes('/install/global/node_modules/')
	)
}

async function readInstalledVersion(path: string): Promise<string | null> {
	try {
		const proc = Bun.spawn([path, '-V'], {
			stdout: 'pipe',
			stderr: 'ignore',
		})
		if ((await proc.exited) !== 0) {
			return null
		}
		const output = (await new Response(proc.stdout).text()).trim()
		return output.length > 0 ? output : null
	} catch {
		return null
	}
}

export async function resolveInstallTarget(): Promise<InstallTarget> {
	const discoveredPath =
		process.env[UPDATE_BIN_PATH_ENV] ?? findOnPath(getExecutableName(), process.env.PATH)
	if (!discoveredPath) {
		throw new Error(`Could not find ${PACKAGE_NAME} on PATH.`)
	}

	const stats = await lstat(discoveredPath)
	const realPath = await realpath(discoveredPath)
	const installedVersion = await readInstalledVersion(discoveredPath)

	if (stats.isSymbolicLink()) {
		return {
			path: discoveredPath,
			realPath,
			kind: 'symlink',
			reason: `Self-update only supports regular-file installs. Current executable is a symlink to ${realPath}.`,
			installedVersion,
		}
	}

	if (isScriptPath(realPath)) {
		return {
			path: discoveredPath,
			realPath,
			kind: 'script',
			reason: `Self-update only supports installed release binaries. Current executable resolves to ${realPath}.`,
			installedVersion,
		}
	}

	return {
		path: discoveredPath,
		realPath,
		kind: 'regular',
		reason: null,
		installedVersion,
	}
}

function parseReleaseVersion(tag: string): string | null {
	return tag.startsWith(releasePrefix()) ? tag.slice(releasePrefix().length) : null
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: githubHeaders() })
	if (!response.ok) {
		throw new Error(`GitHub API request failed (${response.status} ${response.statusText}).`)
	}
	return (await response.json()) as T
}

function selectReleaseAsset(release: GithubRelease): ReleaseInfo {
	const version = parseReleaseVersion(release.tag_name)
	if (!version) {
		throw new Error(`Unexpected release tag: ${release.tag_name}`)
	}

	const assetName = releaseAssetName()
	const asset = release.assets.find((item) => item.name === assetName)
	if (!asset) {
		throw new Error(`Release ${release.tag_name} does not include asset ${assetName}.`)
	}

	return {
		version,
		tag: release.tag_name,
		assetName,
		assetUrl: asset.browser_download_url,
	}
}

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
	const releases = await fetchJson<GithubRelease[]>(`${getApiBase()}/releases?per_page=20`)
	const release = releases.find((item) => parseReleaseVersion(item.tag_name) !== null)
	if (!release) {
		throw new Error(`No ${PACKAGE_NAME} releases found.`)
	}
	return selectReleaseAsset(release)
}

export async function fetchReleaseByVersion(version: string): Promise<ReleaseInfo> {
	const release = await fetchJson<GithubRelease>(
		`${getApiBase()}/releases/tags/${releasePrefix()}${version}`,
	)
	return selectReleaseAsset(release)
}

export async function downloadReleaseAsset(assetUrl: string): Promise<Uint8Array> {
	const response = await fetch(assetUrl, { headers: githubHeaders() })
	if (!response.ok) {
		throw new Error(`Download failed (${response.status} ${response.statusText}).`)
	}
	return new Uint8Array(await response.arrayBuffer())
}

export async function installReleaseBinary(targetPath: string, bytes: Uint8Array): Promise<void> {
	const tempPath = join(
		dirname(targetPath),
		`.${basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
	)

	try {
		await writeFile(tempPath, bytes)
		await chmod(tempPath, 0o755)
		await rename(tempPath, targetPath)
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => {})
		throw error
	}
}
