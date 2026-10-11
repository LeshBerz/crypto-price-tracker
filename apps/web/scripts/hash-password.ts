// Хэш пароля для WEB_BOOTSTRAP_PASSWORD_HASH (ADR 0016): в окружении хранится только хэш, не пароль.
//   npm run hash-password -w @cpt/web        — спросит пароль
// Пароль читается из stdin, а не из аргументов: аргументы видны в истории shell и в списке процессов.
import { createInterface } from 'node:readline/promises';
import {
  hashPassword,
  isAcceptablePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../src/server/passwords.ts';

// Приглашение идёт в stderr: в stdout попадает только хэш, его можно перенаправить в файл
const input = createInterface({ input: process.stdin, output: process.stderr });
const password = await input.question(process.stdin.isTTY ? 'Пароль: ' : '');
input.close();

if (!isAcceptablePassword(password)) {
  process.stderr.write(`Длина пароля — от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов\n`);
  process.exit(1);
}
process.stdout.write(`${await hashPassword(password)}\n`);
