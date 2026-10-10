import { decodeCursor, encodeCursor } from '../../src/common/cursor.ts';

describe('keyset-курсор', () => {
  it('✅ кодируется в base64url и разбирается обратно', () => {
    const text = encodeCursor({ at: 1_791_374_400_000, id: 42 });
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(text)).toEqual({ at: 1_791_374_400_000, id: 42 });
  });

  it.each([
    ['не base64 от нашего формата', 'not-a-cursor'],
    ['нет id', Buffer.from('123').toString('base64url')],
    ['отрицательное время', Buffer.from('-1.2').toString('base64url')],
    ['число за пределами safe integer', Buffer.from('9999999999999999.1').toString('base64url')],
  ])('❌ %s → null', (_name, text) => {
    expect(decodeCursor(text)).toBeNull();
  });
});
