// Логика CLI keys:create / keys:revoke (ADR 0002). Ввод-вывод внедряется, поэтому команда тестируется без процесса;
// точка входа с открытием БД — cli/keys.ts.
import { parseArgs } from 'node:util';
import type { Clock } from '../common/clock.ts';
import type { UnitOfWork } from '../unit-of-work.ts';
import { apiKeyPrefix, generateApiKey, hashApiKey, isScope, ROLE_SCOPES, SCOPES, type Role } from '../auth/api-key.ts';
import { BOOTSTRAP_NAME_PREFIX } from '../auth/bootstrap.ts';

export type KeysCommandDeps = {
  uow: UnitOfWork;
  clock: Clock;
  /** Ключ — только сюда и только один раз: так его удобно забрать скриптом (`KEY=$(npm run -s keys:create …)`) */
  stdout: (line: string) => void;
  /** Подсказки и ошибки — отдельно от ключа */
  stderr: (line: string) => void;
  generateKey?: () => string;
};

export const USAGE = `Использование:
  keys:create --name <имя> (--role viewer|operator | --scopes <scope,scope>)
  keys:revoke --name <имя>
Scopes: ${SCOPES.join(', ')}`;

class UsageError extends Error {}

/** Код выхода: 0 — успех, 1 — команда не выполнена, 2 — неверные аргументы */
export async function runKeysCommand(argv: readonly string[], deps: KeysCommandDeps): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === 'create') return await create(rest, deps);
    if (command === 'revoke') return await revoke(rest, deps);
    throw new UsageError(`Неизвестная команда: ${command ?? '(нет)'}`);
  } catch (error) {
    if (error instanceof UsageError || isParseArgsError(error)) {
      deps.stderr(`${(error as Error).message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}

/** По code, а не instanceof TypeError: ошибки node:* создаются в другом realm, и в Jest instanceof для них ложен */
function isParseArgsError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS');
}

function readName(args: readonly string[], extra: Record<string, { type: 'string' }> = {}) {
  const { values } = parseArgs({ args: [...args], options: { name: { type: 'string' }, ...extra }, strict: true });
  const name = values.name?.trim();
  if (!name || name.length > 64) throw new UsageError('--name: обязательно, от 1 до 64 символов');
  return { name, values: values as Record<string, string | undefined> };
}

function readScopes(values: Record<string, string | undefined>): string[] {
  const { role, scopes } = values;
  if ((role === undefined) === (scopes === undefined)) throw new UsageError('Укажите ровно одно: --role или --scopes');
  if (role !== undefined) {
    if (!(role in ROLE_SCOPES)) throw new UsageError(`--role: ожидается ${Object.keys(ROLE_SCOPES).join(' или ')}`);
    return [...ROLE_SCOPES[role as Role]];
  }
  const list = [...new Set((scopes as string).split(',').map((s) => s.trim()))].filter((s) => s !== '');
  const unknown = list.filter((s) => !isScope(s));
  if (list.length === 0 || unknown.length > 0) {
    throw new UsageError(`--scopes: неизвестные или пустые scope: ${unknown.join(', ') || '(пусто)'}`);
  }
  return list;
}

async function create(args: readonly string[], deps: KeysCommandDeps): Promise<number> {
  const { name, values } = readName(args, { role: { type: 'string' }, scopes: { type: 'string' } });
  if (name.startsWith(BOOTSTRAP_NAME_PREFIX)) {
    throw new UsageError(`--name: префикс ${BOOTSTRAP_NAME_PREFIX} зарезервирован за ключами из env`);
  }
  const scopes = readScopes(values);
  const generate = deps.generateKey ?? (() => generateApiKey());

  const key = await deps.uow.run(async ({ apiKeys }) => {
    if ((await apiKeys.findByName(name)) !== null) return null;
    // Префикс — 48 случайных бит, совпадение почти невозможно, но UNIQUE в схеме его не простит: берём другой ключ
    let candidate = generate();
    for (let attempt = 1; (await apiKeys.findByPrefix(apiKeyPrefix(candidate))) !== null; attempt++) {
      if (attempt >= 3) throw new Error('Не удалось сгенерировать ключ с уникальным префиксом');
      candidate = generate();
    }
    await apiKeys.create({
      name,
      keyPrefix: apiKeyPrefix(candidate),
      keyHash: hashApiKey(candidate),
      scopes,
      createdAt: deps.clock.now(),
    });
    return candidate;
  });

  if (key === null) {
    deps.stderr(`Ключ с именем «${name}» уже существует`);
    return 1;
  }
  deps.stdout(key);
  deps.stderr(
    `Ключ «${name}» создан, scopes: ${scopes.join(' ')}. Сохраните его сейчас: в БД только хэш, показать ещё раз нельзя`,
  );
  return 0;
}

async function revoke(args: readonly string[], deps: KeysCommandDeps): Promise<number> {
  const { name } = readName(args);
  const result = await deps.uow.run(async ({ apiKeys }) => {
    if (await apiKeys.revoke(name, deps.clock.now())) return 'revoked';
    return (await apiKeys.findByName(name)) === null ? 'not-found' : 'already-revoked';
  });
  if (result === 'not-found') {
    deps.stderr(`Ключ «${name}» не найден`);
    return 1;
  }
  // Повторный отзыв — не ошибка: команда идемпотентна
  deps.stderr(result === 'revoked' ? `Ключ «${name}» отозван` : `Ключ «${name}» уже был отозван`);
  return 0;
}
