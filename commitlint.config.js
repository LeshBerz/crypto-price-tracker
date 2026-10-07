// Conventional Commits (бриф §4)
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    // В репозитории нет подписей AI-инструментов (бриф §4, CLAUDE.md)
    'trailer-exists': [2, 'never', 'Co-authored-by:'],
  },
};
