// Общий файл окружения репозитория (ADR 0004, поправка от 12.10): один `.env` в корне читают Docker Compose,
// npm-скрипты api и web. Next сам загружает только `.env*` из каталога приложения, поэтому корневой файл web
// читает здесь. Значения не попадают в `process.env`: конфиг берёт из них только свои переменные, а ключ
// CoinMarketCap и остальное окружение api в процессе web не появляются.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';

/** Признак корня репозитория. В Docker-образе web такого файла нет — и общего `.env` там не ищут */
const ROOT_MARKER = 'docker-compose.yml';
/** web запускают из корня (`next dev apps/web`) или из `apps/web` (`npm run dev -w @cpt/web`): корень не дальше двух уровней */
const MAX_DEPTH = 2;

export function findRootEnvFile(start: string, exists: (path: string) => boolean = existsSync): string | null {
  let dir = start;
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
    if (exists(join(/* turbopackIgnore: true */ dir, ROOT_MARKER))) {
      const file = join(/* turbopackIgnore: true */ dir, '.env');
      return exists(file) ? file : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Переменные из корневого `.env`; файла нет — пустой объект. Разбор — `util.parseEnv` из Node: без подстановки
 * переменных, поэтому хэш пароля со знаками `$` пишется как есть (в одинарных кавычках — их требует Compose).
 */
export function readRootEnv(start: string = process.cwd()): Record<string, string | undefined> {
  const file = findRootEnvFile(start);
  return file ? parseEnv(readFileSync(/* turbopackIgnore: true */ file, 'utf8')) : {};
}
