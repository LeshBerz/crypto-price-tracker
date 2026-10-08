// Типовые тесты: контракт проверяет компилятор, а не только Jest. Строки с @ts-expect-error обязаны
// не компилироваться — если тип ослабнет и ошибка пропадёт, упадёт typecheck (ts-jest и npm run typecheck).
import type { operations } from '../../src/generated/api-types.ts';
import type { Handler } from '../../src/http/router.ts';

type H<K extends keyof operations> = Handler<operations[K]>;

const READINESS = { status: 'fail', checks: { database: 'fail', migrations: 'fail', scheduler: 'disabled' } } as const;

export const examples = {
  ok: (() => ({ status: 200, body: { status: 'ok' } })) satisfies H<'getLiveness'>,

  // @ts-expect-error — тело не по схеме: enum [ok]
  wrongBody: (() => ({ status: 200, body: { status: 'fine' } })) satisfies H<'getLiveness'>,

  // @ts-expect-error — статус не объявлен в операции
  undeclaredStatus: (() => ({ status: 201, body: { status: 'ok' } })) satisfies H<'getLiveness'>,

  // @ts-expect-error — ошибки не возвращают, а бросают HttpProblem (их content — application/problem+json)
  problemReturned: (() => ({ status: 404 })) satisfies H<'getCryptocurrency'>,

  // 503 readiness — с телом Readiness: application/json, поэтому возвращается обычным ответом
  notReady: (() => ({ status: 503, body: READINESS })) satisfies H<'getReadiness'>,

  noContent: (() => ({ status: 204 })) satisfies H<'deleteCryptocurrency'>,

  // @ts-expect-error — у 204 тела нет
  noContentWithBody: (() => ({ status: 204, body: {} })) satisfies H<'deleteCryptocurrency'>,

  typedPath: (({ input }) => {
    const id: number = input.path.id;
    // @ts-expect-error — у GET тела нет: body имеет тип undefined
    void input.body.symbol;
    throw new Error(`только для типов: ${id}`);
  }) satisfies H<'getCryptocurrency'>,

  typedBody: (({ input }) => {
    const symbol: string = input.body.symbol;
    // @ts-expect-error — такого поля в схеме тела нет
    void input.body.isAdmin;
    throw new Error(`только для типов: ${symbol}`);
  }) satisfies H<'createCryptocurrency'>,
};

describe('типы хендлеров', () => {
  it('проверяются компилятором (файл компилируется ts-jest с диагностикой)', () => {
    expect(examples.ok()).toEqual({ status: 200, body: { status: 'ok' } });
  });
});
