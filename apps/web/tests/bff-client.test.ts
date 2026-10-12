import { BffError, buildBffUrl, createBffClient, isUnauthorized } from '@/lib/bff-client';

type Call = { url: string; init: RequestInit };

function setup(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const onUnauthorized = jest.fn();
  const client = createBffClient({
    fetch: (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve().then(reply);
    },
    onUnauthorized,
  });
  return { client, calls, onUnauthorized };
}

const problem = (status: number, type: string, extra: Record<string, unknown> = {}) =>
  Response.json(
    { type, title: 'Ошибка', status, requestId: 'req-1', ...extra },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

describe('[bff-client] адрес запроса', () => {
  it('✅ префикс BFF + путь api', () => {
    expect(buildBffUrl('/api/v1/prices')).toBe('/api/bff/api/v1/prices');
  });

  it('✅ параметр пути подставляется и кодируется, параметры запроса — в строку', () => {
    expect(buildBffUrl('/api/v1/cryptocurrencies/{id}/prices', { id: 7 }, { limit: 50, cursor: 'a b' })).toBe(
      '/api/bff/api/v1/cryptocurrencies/7/prices?limit=50&cursor=a+b',
    );
    expect(buildBffUrl('/api/v1/cryptocurrencies/{id}', { id: '../x' })).toBe(
      '/api/bff/api/v1/cryptocurrencies/..%2Fx',
    );
  });

  it('✅ параметр запроса со значением undefined пропускается', () => {
    expect(buildBffUrl('/api/v1/prices/sparklines', {}, { window: undefined })).toBe(
      '/api/bff/api/v1/prices/sparklines',
    );
  });

  it('❌ параметр пути не задан — ошибка, а не запрос с «{id}» в адресе', () => {
    expect(() => buildBffUrl('/api/v1/cryptocurrencies/{id}')).toThrow('{id}');
  });
});

describe('[bff-client] GET', () => {
  it('✅ возвращает тело ответа; запрос — на свой origin, без признака фона', async () => {
    const { client, calls } = setup(() => Response.json({ window: '7d', items: [] }));

    await expect(client.get('/api/v1/prices/sparklines', { query: { window: '7d' } })).resolves.toEqual({
      window: '7d',
      items: [],
    });
    expect(calls[0]?.url).toBe('/api/bff/api/v1/prices/sparklines?window=7d');
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(new Headers(calls[0]?.init.headers).has('x-cpt-background')).toBe(false);
  });

  it('✅ фоновый запрос помечается заголовком', async () => {
    const { client, calls } = setup(() => Response.json({ items: [] }));
    await client.get('/api/v1/prices', { background: true });

    expect(new Headers(calls[0]?.init.headers).get('x-cpt-background')).toBe('1');
  });

  it('❌ Problem от api: статус, тип и requestId — в ошибке; источник — api', async () => {
    const { client, onUnauthorized } = setup(() => problem(404, 'urn:cpt:problem:not-found'));
    const error = await client.get('/api/v1/cryptocurrencies/{id}', { params: { id: 99 } }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BffError);
    expect(error).toMatchObject({ status: 404, source: 'api', requestId: 'req-1', isUnavailable: false });
    expect((error as BffError).problem?.type).toBe('urn:cpt:problem:not-found');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([
    [502, 'urn:cpt:web:problem:upstream-unavailable'],
    [504, 'urn:cpt:web:problem:upstream-timeout'],
  ])('❌ %i от BFF: источник — web, данные недоступны', async (status, type) => {
    const { client } = setup(() => problem(status, type));
    const error = await client.get('/api/v1/prices').catch((e: unknown) => e);

    expect(error).toMatchObject({ status, source: 'web', isUnavailable: true, requestId: 'req-1' });
  });

  it('❌ 401: вызывается выход на страницу входа, ошибка распознаётся как «нет сессии»', async () => {
    const { client, onUnauthorized } = setup(() => problem(401, 'urn:cpt:web:problem:unauthorized'));
    const error = await client.get('/api/v1/prices').catch((e: unknown) => e);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(isUnauthorized(error)).toBe(true);
  });

  it('❌ сеть недоступна: статус 0, источник — network', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await client.get('/api/v1/prices').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 0, source: 'network', isUnavailable: true, requestId: null });
  });

  it('❌ ошибка не в формате Problem (HTML от прокси): статус сохранён, тела нет', async () => {
    const { client } = setup(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const error = await client.get('/api/v1/prices').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502, problem: null, isUnavailable: true });
  });

  it('❌ отмена запроса пробрасывается как есть: слой данных не считает её ошибкой', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const { client } = setup(() => Promise.reject(abort));

    await expect(client.get('/api/v1/prices')).rejects.toBe(abort);
  });
});
