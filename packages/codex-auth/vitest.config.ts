import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		globals: false,
		setupFiles: ['tests/vitest.setup.ts'],
		clearMocks: true,
		restoreMocks: true,
		mockReset: true,
	},
})
