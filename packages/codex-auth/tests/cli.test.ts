import { describe, expect, test } from 'bun:test'
import { currentCommand } from '../src/commands/current.ts'
import { validateRawArgs } from '../src/lib/argv.ts'

const rootCommand = {
	args: {
		json: {
			type: 'boolean' as const,
			alias: 'j',
		},
	},
	subCommands: {
		current: currentCommand,
	},
}

describe('raw arg validation', () => {
	test('accepts current -j', () => {
		expect(validateRawArgs(['current', '-j'], rootCommand)).toBeNull()
	})

	test('rejects unknown flags', () => {
		expect(validateRawArgs(['current', '--definitely-invalid'], rootCommand)).toBe(
			'Unknown flag: --definitely-invalid',
		)
	})

	test('rejects unknown short flags', () => {
		expect(validateRawArgs(['current', '-x'], rootCommand)).toBe('Unknown flag: -x')
	})
})

describe('json shorthand alias', () => {
	test('registers -j as the json alias for current', () => {
		const args = currentCommand.args as { json?: { alias?: string } } | undefined
		expect(args?.json?.alias).toBe('j')
	})
})
