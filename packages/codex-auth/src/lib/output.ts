import * as p from '@clack/prompts'
import { isAgent } from 'is-ai-agent'
import type { AccountUsage } from '../types.ts'

export type AgentName = ReturnType<typeof isAgent>

export interface OutputMode {
	json: boolean
	interactive: boolean
	agent: AgentName
}

export function resolveOutputMode(args?: { json?: boolean }): OutputMode {
	const agent = isAgent()
	const json = Boolean(args?.json)
	return {
		json,
		interactive: !json && agent === null,
		agent,
	}
}

export function createSpinner(mode: OutputMode) {
	if (mode.interactive) {
		return p.spinner()
	}

	return {
		start(_message: string) {},
		stop(_message: string) {},
	}
}

export function printJson(payload: unknown): void {
	console.log(JSON.stringify(payload, null, 2))
}

export function printInfo(mode: OutputMode, message: string): void {
	if (mode.json) return
	if (mode.interactive) {
		p.log.info(message)
		return
	}
	console.log(message)
}

export function printWarn(mode: OutputMode, message: string): void {
	if (mode.json) return
	if (mode.interactive) {
		p.log.warn(message)
		return
	}
	console.warn(message)
}

export function printIntro(mode: OutputMode, message: string): void {
	if (mode.json) return
	if (mode.interactive) {
		p.intro(message)
		return
	}
	console.log(message)
}

export function printOutro(mode: OutputMode, message: string): void {
	if (mode.json) return
	if (mode.interactive) {
		p.outro(message)
		return
	}
	console.log(message)
}

export function printNote(mode: OutputMode, body: string, title: string): void {
	if (mode.json) return
	if (mode.interactive) {
		p.note(body, title)
		return
	}
	console.log(title)
	if (body) {
		console.log(body)
	}
}

export function fail(mode: OutputMode, message: string, code = 1): never {
	if (mode.json) {
		printJson({ ok: false, error: message })
	} else if (mode.interactive) {
		p.cancel(message)
	} else {
		console.error(message)
	}

	process.exit(code)
}

export function requireInteractive(
	mode: OutputMode,
	message: string,
): asserts mode is OutputMode & { interactive: true } {
	if (!mode.interactive) {
		fail(mode, message)
	}
}

export function requireFlagInNonInteractiveMode(
	mode: OutputMode,
	flagEnabled: boolean,
	flag: string,
	action: string,
): void {
	if (!mode.interactive && !flagEnabled) {
		fail(mode, `${action} requires ${flag} in non-interactive mode.`)
	}
}

export function serializeUsage(usage: AccountUsage) {
	return {
		planType: usage.planType,
		session: {
			usedPercent: usage.session.usedPercent,
			resetAt: usage.session.resetAt.toISOString(),
			windowSeconds: usage.session.windowSeconds,
		},
		weekly: {
			usedPercent: usage.weekly.usedPercent,
			resetAt: usage.weekly.resetAt.toISOString(),
			windowSeconds: usage.weekly.windowSeconds,
		},
		credits: usage.credits
			? {
					hasCredits: usage.credits.hasCredits,
					unlimited: usage.credits.unlimited,
					balance: usage.credits.balance,
				}
			: undefined,
	}
}
