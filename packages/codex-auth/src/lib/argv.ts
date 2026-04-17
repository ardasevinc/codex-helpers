type ArgDef = {
	type?: 'boolean' | 'string' | 'positional'
	alias?: string | string[]
}

type CommandShape = {
	args?: unknown
	subCommands?: Record<string, unknown>
}

type FlagSpec = {
	takesValue: boolean
}

const COMMAND_ALIASES: Record<string, string> = {
	switch: 'use',
	remove: 'delete',
	rm: 'delete',
	ls: 'list',
}

function getArgDefs(command: CommandShape): Record<string, ArgDef> {
	if (!command.args || typeof command.args !== 'object') return {}
	return command.args as Record<string, ArgDef>
}

function getSubCommands(command: CommandShape): Record<string, CommandShape> {
	if (!command.subCommands || typeof command.subCommands !== 'object') return {}
	return command.subCommands as Record<string, CommandShape>
}

function getFlagSpecs(command: CommandShape): Map<string, FlagSpec> {
	const specs = new Map<string, FlagSpec>([
		['--help', { takesValue: false }],
		['-h', { takesValue: false }],
	])

	for (const [name, def] of Object.entries(getArgDefs(command))) {
		if (def.type === 'positional') continue

		const takesValue = def.type === 'string'
		specs.set(`--${name}`, { takesValue })

		const aliases = Array.isArray(def.alias) ? def.alias : def.alias ? [def.alias] : []
		for (const alias of aliases) {
			specs.set(alias.length === 1 ? `-${alias}` : `--${alias}`, { takesValue })
		}
	}

	return specs
}

function consumeFlagValue(rawArgs: string[], index: number, token: string): number | null {
	if (token.includes('=')) return index
	const next = rawArgs[index + 1]
	if (next === undefined) return null
	return index + 1
}

export function hasJsonFlag(rawArgs: string[]): boolean {
	return rawArgs.includes('--json') || rawArgs.includes('-j')
}

export function normalizeRawArgs(rawArgs: string[]): string[] {
	for (let i = 0; i < rawArgs.length; i += 1) {
		const token = rawArgs[i]
		if (!token || token === '--') break
		if (token.startsWith('-')) continue

		const canonical = COMMAND_ALIASES[token]
		if (!canonical) return rawArgs

		const normalized = [...rawArgs]
		normalized[i] = canonical
		return normalized
	}

	return rawArgs
}

export function validateRawArgs(rawArgs: string[], root: CommandShape): string | null {
	if (rawArgs.length === 1 && (rawArgs[0] === '-v' || rawArgs[0] === '-V')) {
		return null
	}

	let current = root
	let specs = getFlagSpecs(current)

	for (let i = 0; i < rawArgs.length; i += 1) {
		const token = rawArgs[i]
		if (!token || token === '--') break

		if (token.startsWith('--')) {
			const name = token.split('=', 1)[0] ?? token
			const spec = specs.get(name)
			if (!spec) {
				return `Unknown flag: ${name}`
			}
			if (spec.takesValue) {
				const nextIndex = consumeFlagValue(rawArgs, i, token)
				if (nextIndex === null) {
					return `Missing value for flag: ${name}`
				}
				i = nextIndex
			}
			continue
		}

		if (token.startsWith('-') && token !== '-') {
			const shorts = token.slice(1).split('')
			for (let shortIndex = 0; shortIndex < shorts.length; shortIndex += 1) {
				const short = shorts[shortIndex]
				const name = `-${short}`
				const spec = specs.get(name)
				if (!spec) {
					return `Unknown flag: ${name}`
				}
				if (spec.takesValue) {
					if (shortIndex < shorts.length - 1) {
						return `Missing value for flag: ${name}`
					}
					const nextIndex = consumeFlagValue(rawArgs, i, token)
					if (nextIndex === null) {
						return `Missing value for flag: ${name}`
					}
					i = nextIndex
				}
			}
			continue
		}

		const subCommand = getSubCommands(current)[token]
		if (subCommand) {
			current = subCommand
			specs = getFlagSpecs(current)
		}
	}

	return null
}
