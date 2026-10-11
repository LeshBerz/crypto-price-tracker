// ESLint (flat config). Правила, которые держат решения ADR, — с пометкой ADR.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '.claude/',
      '**/coverage/',
      '**/src/generated/',
      '**/openapi/.bundle/',
      '**/.next/',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Код приложения api: ESM в рантайме, но Jest компилирует его в CommonJS (ADR 0004)
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/common/clock.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MetaProperty[meta.name='import'][property.name='meta']",
          message: 'import.meta не работает в Jest (ts-jest → CommonJS, ADR 0004). Передайте путь через конфиг.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Время — только через порт Clock (ADR 0009, 0015).',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Текущее время — только через порт Clock (ADR 0009, 0015).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:timers/promises',
              message: 'Fake timers Jest его не подменяют — ожидание через Clock.sleep (ADR 0009).',
            },
          ],
        },
      ],
    },
  },
  {
    // apps/web — React: правила хуков ловят условные вызовы и пропущенные зависимости эффектов
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  prettier,
);
