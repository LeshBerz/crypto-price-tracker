// Conventional Commits (бриф §4)
const AI_SIGNATURE = /co-authored-by:|generated with/i;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // В репозитории нет подписей AI-инструментов (бриф §4). Встроенный trailer-exists
        // сравнивает ключ трейлера с учётом регистра и пропускает «Co-Authored-By», поэтому своё правило.
        'no-ai-signature': ({ raw }) => [!AI_SIGNATURE.test(raw ?? ''), 'подписи AI-инструментов запрещены'],
      },
    },
  ],
  rules: {
    'body-max-line-length': [0],
    'no-ai-signature': [2, 'always'],
  },
};
