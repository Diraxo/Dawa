/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  haste: { retainAllFiles: false },
  moduleNameMapper: {
    '^@/lib/supabase$': '<rootDir>/__tests__/__mocks__/supabase.ts',
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
}
