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
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/server.ts'],
  coverageThreshold: {
    global: { lines: 90, branches: 85 },
    // Критичный код — 100 % (ADR 0009)
    './src/common/decimal.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
  },
  clearMocks: true,
};
