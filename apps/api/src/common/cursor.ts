// Непрозрачный keyset-курсор (ADR 0014): пара (время, id) последней строки страницы в base64url.
// Клиент не разбирает его и не собирает сам — формат можно менять, не ломая контракт.

export type KeysetCursor = { at: number; id: number };

const SHAPE = /^(\d{1,16})\.(\d{1,16})$/;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.at}.${cursor.id}`).toString('base64url');
}

/** null — курсор не наш: обрезан, подделан или от другой версии формата */
export function decodeCursor(text: string): KeysetCursor | null {
  const match = SHAPE.exec(Buffer.from(text, 'base64url').toString('utf8'));
  if (!match) return null;
  const cursor = { at: Number(match[1]), id: Number(match[2]) };
  return Number.isSafeInteger(cursor.at) && Number.isSafeInteger(cursor.id) ? cursor : null;
}
