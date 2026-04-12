import { mock } from 'bun:test'

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
	const exitMock = mock((code?: number | string | null) => {
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
	const confirm = mock(async () => overrides?.confirmResult ?? true)
	const select = mock(async () => overrides?.selectResult ?? 'personal')
	const cancel = mock((_message: string) => {})
	const note = mock((_message: string, _title?: string) => {})
	const intro = mock((_message: string) => {})
	const outro = mock((_message: string) => {})
	const info = mock((_message: string) => {})
	const warn = mock((_message: string) => {})
	const spinnerStart = mock((_message: string) => {})
	const spinnerStop = mock((_message: string) => {})

	mock.module('@clack/prompts', () => ({
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
	mock.module('is-ai-agent', () => ({
		isAgent: mock(() => null),
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
	const isAgent = mock(() => agent)

	mock.module('is-ai-agent', () => ({
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

	console.log = mock((...args: unknown[]) => {
		logs.push(args.map(String).join(' '))
	}) as typeof console.log
	console.warn = mock((...args: unknown[]) => {
		warns.push(args.map(String).join(' '))
	}) as typeof console.warn
	console.error = mock((...args: unknown[]) => {
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
	return (await import(`${path}?test=${importCounter}`)) as T
}

export async function runCommand(command: { run?: (ctx: any) => any }, ctx: any) {
	if (!command.run) {
		throw new Error('Command has no run() handler')
	}
	return await command.run(ctx)
}
