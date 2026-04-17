import { describe, expect, test } from 'bun:test'
import { currentCommand } from '../src/commands/current.ts'
import { normalizeRawArgs, validateRawArgs } from '../src/lib/argv.ts'

const rootCommand = {
	args: {
		json: {
			type: 'boolean' as const,
			alias: 'j',
		},
	},
	subCommands: {
		use: currentCommand,
		list: currentCommand,
		delete: currentCommand,
		current: currentCommand,
	},
}

describe('command aliases', () => {
	test('normalizes switch to use', () => {
		expect(normalizeRawArgs(['switch', 'work'])).toEqual(['use', 'work'])
	})

	test('normalizes remove and rm to delete', () => {
		expect(normalizeRawArgs(['remove', 'work'])).toEqual(['delete', 'work'])
		expect(normalizeRawArgs(['rm', 'work'])).toEqual(['delete', 'work'])
	})

	test('normalizes ls to list', () => {
		expect(normalizeRawArgs(['ls'])).toEqual(['list'])
	})
})

describe('raw arg validation', () => {
	test('accepts current -j', () => {
		expect(validateRawArgs(['current', '-j'], rootCommand)).toBeNull()
	})

	test('accepts alias-normalized command args', () => {
		expect(validateRawArgs(normalizeRawArgs(['switch', '-j']), rootCommand)).toBeNull()
		expect(validateRawArgs(normalizeRawArgs(['rm', 'work']), rootCommand)).toBeNull()
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
