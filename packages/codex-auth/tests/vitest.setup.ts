import { beforeEach, vi } from 'vitest'

beforeEach(() => {
	vi.stubGlobal('Bun', {
		stdin: {
			text: vi.fn(async () => ''),
		},
		spawn: vi.fn(),
		sleep: vi.fn(async (_ms: number) => {}),
	})
})
