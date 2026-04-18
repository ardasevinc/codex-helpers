import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	captureConsole,
	ExitError,
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

describe('deleteCommand', () => {
	test('deletes account after confirmation', async () => {
		const prompts = mockPrompts({ confirmResult: true })
		const deleteAccount = vi.fn((_name: string) => {})

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn((_name: string) => true),
			deleteAccount,
			getActiveAccount: vi.fn(() => null),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => true),
		}))

		const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
			'../../src/commands/delete.ts',
		)

		await runCommand(deleteCommand, { args: { name: 'personal' } })

		expect(deleteAccount).toHaveBeenCalledWith('personal')
		expect(prompts.note).toHaveBeenCalled()
	})

	test('errors on invalid name', async () => {
		const prompts = mockPrompts()
		const exit = stubProcessExit()

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn(() => false),
			deleteAccount: vi.fn(() => {}),
			getActiveAccount: vi.fn(() => null),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => false),
		}))

		try {
			const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
				'../../src/commands/delete.ts',
			)
			await expect(
				runCommand(deleteCommand, { args: { name: 'bad name' } }),
			).rejects.toBeInstanceOf(ExitError)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			expect(prompts.cancel).toHaveBeenCalled()
		} finally {
			exit.restore()
		}
	})

	test('errors when account not found', async () => {
		const prompts = mockPrompts()
		const exit = stubProcessExit()

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn((_name: string) => false),
			deleteAccount: vi.fn(() => {}),
			getActiveAccount: vi.fn(() => null),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => true),
		}))

		try {
			const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
				'../../src/commands/delete.ts',
			)
			await expect(runCommand(deleteCommand, { args: { name: 'ghost' } })).rejects.toBeInstanceOf(
				ExitError,
			)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			expect(prompts.cancel).toHaveBeenCalled()
		} finally {
			exit.restore()
		}
	})

	test('exits when user cancels confirmation', async () => {
		mockPrompts({ confirmResult: false })
		const exit = stubProcessExit()

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn((_name: string) => true),
			deleteAccount: vi.fn(() => {}),
			getActiveAccount: vi.fn(() => null),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => true),
		}))

		try {
			const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
				'../../src/commands/delete.ts',
			)
			await expect(
				runCommand(deleteCommand, { args: { name: 'personal' } }),
			).rejects.toBeInstanceOf(ExitError)
			expect(exit.exitMock).toHaveBeenCalledWith(0)
		} finally {
			exit.restore()
		}
	})

	test('mentions active status in confirm message', async () => {
		const prompts = mockPrompts({ confirmResult: true })
		const deleteAccount = vi.fn((_name: string) => {})

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn((_name: string) => true),
			deleteAccount,
			getActiveAccount: vi.fn(() => ({ name: 'personal', switched_at: new Date().toISOString() })),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => true),
		}))

		const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
			'../../src/commands/delete.ts',
		)

		await runCommand(deleteCommand, { args: { name: 'personal' } })
		expect(prompts.confirm).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('currently active') }),
		)
	})

	test('requires --yes in agent mode', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()
		const exit = stubProcessExit()

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn((_name: string) => true),
			deleteAccount: vi.fn(() => {}),
			getActiveAccount: vi.fn(() => null),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => true),
		}))

		try {
			const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
				'../../src/commands/delete.ts',
			)
			await expect(
				runCommand(deleteCommand, { args: { name: 'personal' } }),
			).rejects.toBeInstanceOf(ExitError)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			expect(consoleCapture.errors.at(-1)).toContain('--yes')
		} finally {
			consoleCapture.restore()
			exit.restore()
		}
	})

	test('emits JSON output on delete', async () => {
		mockPrompts()
		mockAgent('codex')
		const consoleCapture = captureConsole()

		mockModule('../../src/lib/accounts.ts', () => ({
			accountExists: vi.fn((_name: string) => true),
			deleteAccount: vi.fn((_name: string) => {}),
			getActiveAccount: vi.fn(() => ({ name: 'personal', switched_at: new Date().toISOString() })),
		}))
		mockModule('../../src/lib/paths.ts', () => ({
			validateName: vi.fn((_name: string) => true),
		}))

		try {
			const { deleteCommand } = await importFresh<typeof import('../../src/commands/delete.ts')>(
				'../../src/commands/delete.ts',
			)
			await runCommand(deleteCommand, { args: { name: 'personal', yes: true, json: true } })
		} finally {
			consoleCapture.restore()
		}

		const payload = JSON.parse(consoleCapture.logs.at(-1) ?? '{}') as {
			ok: boolean
			deleted: string
			wasActive: boolean
			activeCleared: boolean
		}
		expect(payload).toEqual({
			ok: true,
			deleted: 'personal',
			wasActive: true,
			activeCleared: true,
		})
	})
})
