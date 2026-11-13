import { defineConfig } from 'vitest/config'

// Node's builtin test runner covers keeper/*.test.mjs separately.
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'sdk/**/*.test.ts'] },
})
