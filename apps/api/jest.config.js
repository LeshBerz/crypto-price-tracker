// Jest 30 + ts-jest: тесты компилируются в CommonJS, чтобы не зависеть от экспериментального
// ESM-режима Jest (ADR 0004). Приложение при этом остаётся ESM.
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  // Точки входа (server.ts, cli/keys.ts, cli/rollups.ts) только собирают зависимости; их логика покрыта через тестируемые модули
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/generated/**',
    '!src/server.ts',
    '!src/cli/keys.ts',
    '!src/cli/rollups.ts',
  ],
  coverageThreshold: {
    global: { lines: 90, branches: 85 },
    // Критичный код — 100 % (ADR 0009)
    './src/common/decimal.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/openapi/': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/http/auth.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
    './src/auth/': { lines: 100, branches: 100, functions: 100, statements: 100 },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/contract.ts'],
  clearMocks: true,
};
