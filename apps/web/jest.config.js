// Jest через next/jest (ADR 0009): тот же раннер, что в api; TypeScript компилирует SWC из состава Next.
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

export default createJestConfig({
  // Тестируется серверная часть (пароли, сессии, обработчики /api/session) — DOM не нужен
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  clearMocks: true,
});
