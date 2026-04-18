import { vi } from 'vitest'
import { mockModule, resetTestState, setMockBaseUrl } from '../helpers.ts'

export { mockModule, resetTestState, setMockBaseUrl }

type DeepPartial<T> = T extends (...args: never[]) => unknown
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T

export class ExitError extends Error {
	code: number

	constructor(code: number) {
		super(`process.exit(${code})`)
		this.name = 'ExitError'
		this.code = code
	}
}

export function stubProcessExit() {
	const original = process.exit
	const exitMock = vi.fn((code?: number | string | null) => {
		throw new ExitError(typeof code === 'number' ? code : 0)
	})
	process.exit = exitMock as unknown as typeof process.exit
	return {
		exitMock,
		restore: () => {
			process.exit = original
		},
	}
}

export function mockPrompts(overrides?: {
	confirmResult?: boolean | symbol
	selectResult?: string | symbol
}) {
	const cancelToken = Symbol('cancel')
	const confirm = vi.fn(async () => overrides?.confirmResult ?? true)
	const select = vi.fn(async () => overrides?.selectResult ?? 'personal')
	const cancel = vi.fn((_message: string) => {})
	const note = vi.fn((_message: string, _title?: string) => {})
	const intro = vi.fn((_message: string) => {})
	const outro = vi.fn((_message: string) => {})
	const info = vi.fn((_message: string) => {})
	const warn = vi.fn((_message: string) => {})
	const spinnerStart = vi.fn((_message: string) => {})
	const spinnerStop = vi.fn((_message: string) => {})

	mockModule('@clack/prompts', () => ({
		confirm,
		select,
		cancel,
		note,
		intro,
		outro,
		log: {
			info,
			warn,
		},
		spinner: () => ({
			start: spinnerStart,
			stop: spinnerStop,
		}),
		isCancel: (value: unknown) => value === cancelToken,
	}))
	mockModule('is-ai-agent', () => ({
		isAgent: vi.fn(() => null),
	}))

	return {
		cancelToken,
		confirm,
		select,
		cancel,
		note,
		intro,
		outro,
		info,
		warn,
		spinnerStart,
		spinnerStop,
	}
}

export function mockAgent(agent: 'claude' | 'gemini' | 'codex' | 'opencode' | null = null) {
	const isAgent = vi.fn(() => agent)

	mockModule('is-ai-agent', () => ({
		isAgent,
	}))

	return { isAgent }
}

export function captureConsole() {
	const originalLog = console.log
	const originalWarn = console.warn
	const originalError = console.error
	const logs: string[] = []
	const warns: string[] = []
	const errors: string[] = []

	console.log = vi.fn((...args: unknown[]) => {
		logs.push(args.map(String).join(' '))
	}) as typeof console.log
	console.warn = vi.fn((...args: unknown[]) => {
		warns.push(args.map(String).join(' '))
	}) as typeof console.warn
	console.error = vi.fn((...args: unknown[]) => {
		errors.push(args.map(String).join(' '))
	}) as typeof console.error

	return {
		logs,
		warns,
		errors,
		restore: () => {
			console.log = originalLog
			console.warn = originalWarn
			console.error = originalError
		},
	}
}

let importCounter = 0

export async function importFresh<T>(path: string): Promise<T> {
	importCounter += 1
	return (await import(/* @vite-ignore */ `${path}?test=${importCounter}`)) as T
}

export async function runCommand<TContext>(
	command: { run?: (ctx: TContext) => unknown | Promise<unknown> },
	ctx: DeepPartial<TContext>,
) {
	if (!command.run) {
		throw new Error('Command has no run() handler')
	}
	return await command.run(ctx as TContext)
}
