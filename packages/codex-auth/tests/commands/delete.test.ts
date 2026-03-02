import { afterEach, describe, expect, mock, test } from 'bun:test'
import { ExitError, importFresh, mockPrompts, runCommand, stubProcessExit } from './helpers.ts'

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

		const confirmCall = prompts.confirm.mock.calls[0]
		expect(confirmCall[0].message).toContain('currently active')
	})
})
