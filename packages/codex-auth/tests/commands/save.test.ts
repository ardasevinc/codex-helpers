import { afterEach, describe, expect, mock, test } from 'bun:test'
import { ExitError, importFresh, mockPrompts, runCommand, stubProcessExit } from './helpers.ts'

afterEach(() => {
	mock.restore()
})

describe('saveCommand', () => {
	test('saves current auth as named account', async () => {
		const prompts = mockPrompts()
		const saveAccount = mock((_name: string, _path: string) => {})
		const accountExists = mock((_name: string) => false)
		const validateName = mock((_name: string) => true)
		const resolveAuthPath = mock(() => '/tmp/auth.json')

		mock.module('../../src/lib/accounts.ts', () => ({
			saveAccount,
			accountExists,
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName,
			resolveAuthPath,
		}))

		const { saveCommand } = await importFresh<typeof import('../../src/commands/save.ts')>(
			'../../src/commands/save.ts',
		)

		await runCommand(saveCommand, { args: { name: 'personal' } })

		expect(saveAccount).toHaveBeenCalledWith('personal', '/tmp/auth.json')
		expect(prompts.note).toHaveBeenCalledWith(
			'Copied to ~/.codex/accounts/personal.json\nThis account is now active.',
			'Saved current session as "personal"',
		)
	})

	test('errors on invalid name', async () => {
		const prompts = mockPrompts()
		const exit = stubProcessExit()
		const validateName = mock((_name: string) => false)

		mock.module('../../src/lib/accounts.ts', () => ({
			saveAccount: mock(() => {}),
			accountExists: mock(() => false),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName,
			resolveAuthPath: mock(() => '/tmp/auth.json'),
		}))

		try {
			const { saveCommand } = await importFresh<typeof import('../../src/commands/save.ts')>(
				'../../src/commands/save.ts',
			)
			await expect(runCommand(saveCommand, { args: { name: 'bad name' } })).rejects.toBeInstanceOf(
				ExitError,
			)
			expect(exit.exitMock).toHaveBeenCalledWith(1)
			expect(prompts.cancel).toHaveBeenCalled()
		} finally {
			exit.restore()
		}
	})

	test('prompts for overwrite when account exists', async () => {
		const prompts = mockPrompts({ confirmResult: true })
		const saveAccount = mock((_name: string, _path: string) => {})

		mock.module('../../src/lib/accounts.ts', () => ({
			saveAccount,
			accountExists: mock((_name: string) => true),
		}))
		mock.module('../../src/lib/paths.ts', () => ({
			validateName: mock((_name: string) => true),
			resolveAuthPath: mock(() => '/tmp/auth.json'),
		}))

		const { saveCommand } = await importFresh<typeof import('../../src/commands/save.ts')>(
			'../../src/commands/save.ts',
		)

		await runCommand(saveCommand, { args: { name: 'work' } })

		expect(prompts.confirm).toHaveBeenCalled()
		expect(saveAccount).toHaveBeenCalledWith('work', '/tmp/auth.json')
	})
})
