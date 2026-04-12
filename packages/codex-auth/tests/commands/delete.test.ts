import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
	captureConsole,
	ExitError,
	importFresh,
	mockAgent,
	mockPrompts,
	runCommand,
	stubProcessExit,
} from './helpers.ts'

afterEach(() => {
	mock.restore()
})

describe('deleteCommand', () => {
	test('deletes account after confirmation', async () => {
		const prompts = mockPrompts({ confirmResult: true })
		const deleteAccount = mock((_name: string) => {})

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock((_name: string) => true),
			deleteAccount,
			getActiveAccount: mock(() => null),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
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

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock(() => false),
			deleteAccount: mock(() => {}),
			getActiveAccount: mock(() => null),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => false),
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

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock((_name: string) => false),
			deleteAccount: mock(() => {}),
			getActiveAccount: mock(() => null),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
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

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock((_name: string) => true),
			deleteAccount: mock(() => {}),
			getActiveAccount: mock(() => null),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
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
		const deleteAccount = mock((_name: string) => {})

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock((_name: string) => true),
			deleteAccount,
			getActiveAccount: mock(() => ({ name: 'personal', switched_at: new Date().toISOString() })),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
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

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock((_name: string) => true),
			deleteAccount: mock(() => {}),
			getActiveAccount: mock(() => null),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
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

		mock.module('../../src/lib/accounts.ts', () => ({
			accountExists: mock((_name: string) => true),
			deleteAccount: mock((_name: string) => {}),
			getActiveAccount: mock(() => ({ name: 'personal', switched_at: new Date().toISOString() })),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
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
