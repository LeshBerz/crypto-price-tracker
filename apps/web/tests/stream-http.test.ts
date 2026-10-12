import { guardStream, handleStream } from '@/server/bff/stream-http';
import { IDLE_TIMEOUT_MS } from '@/server/sessions';
import { createTestContext, TEST_API, type TestContext } from './helpers';

const URL_STREAM = 'http://localhost:3100/api/stream';
const HEARTBEAT = 'id: 9\nevent: heartbeat\ndata: {}\n\n';
const PRICE = 'id: 8\nevent: price.updated\ndata: {"symbol":"BTC","price":"64000.12"}\n\n';
const EXPIRED = '\n\nevent: session.expired\ndata: {}\n\n';

const encoder = new TextEncoder();

/** Поток api под управлением теста: что отправить и был ли он отменён */
function fakeUpstream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    stream,
    state,
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    sendBytes: (bytes: Uint8Array) => controller.enqueue(bytes),
    end: () => controller.close(),
    fail: () => controller.error(new Error('socket hang up')),
  };
}

function textReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  return {
    async next(): Promise<string | null> {
      const { done, value } = await reader.read();
      return done ? null : decoder.decode(value, { stream: true });
    },
    cancel: () => reader.cancel(),
  };
}

function request(token?: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_STREAM, { headers: { ...(token ? { cookie: `cpt_session=${token}` } : {}), ...headers } });
}

describe('[stream] guardStream', () => {
  it('✅ события проходят без изменений, пока сессия действует', async () => {
    const upstream = fakeUpstream();
    let checks = 0;
    const output = textReader(
      guardStream(upstream.stream, {
        isSessionValid: () => {
          checks += 1;
          return true;
        },
        idleMs: 5000,
      }),
    );

    upstream.send(PRICE);
    expect(await output.next()).toBe(PRICE);
    expect(checks).toBe(0);

    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(HEARTBEAT);
    expect(checks).toBe(1);

    upstream.end();
    expect(await output.next()).toBeNull();
  });

  it('❌ сессия отозвана: на ближайшем heartbeat — событие session.expired, поток и запрос к api закрыты', async () => {
    const upstream = fakeUpstream();
    let valid = true;
    const output = textReader(guardStream(upstream.stream, { isSessionValid: () => valid, idleMs: 5000 }));

    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(HEARTBEAT);

    valid = false;
    upstream.send(PRICE);
    expect(await output.next()).toBe(PRICE);
    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(EXPIRED);
    expect(await output.next()).toBeNull();
    expect(upstream.state.cancelled).toBe(true);
  });

  it('✅ heartbeat, разрезанный между чанками, распознаётся', async () => {
    const upstream = fakeUpstream();
    const output = textReader(guardStream(upstream.stream, { isSessionValid: () => false, idleMs: 5000 }));

    upstream.send('id: 9\nevent: hea');
    expect(await output.next()).toBe('id: 9\nevent: hea');
    upstream.send('rtbeat\ndata: {}\n\n');
    expect(await output.next()).toBe(EXPIRED);
  });

  it('✅ многобайтовый символ на границе чанков не ломает разбор', async () => {
    const upstream = fakeUpstream();
    let checks = 0;
    const guarded = guardStream(upstream.stream, {
      isSessionValid: () => {
        checks += 1;
        return true;
      },
      idleMs: 5000,
    });
    const reader = guarded.getReader();
    const bytes = encoder.encode(`event: price.updated\ndata: {"name":"Эфир"}\n\n${HEARTBEAT}`);
    const cut = bytes.indexOf(0xd0) + 1;
    upstream.sendBytes(bytes.slice(0, cut));
    upstream.sendBytes(bytes.slice(cut));
    const first = await reader.read();
    const second = await reader.read();
    expect(Buffer.concat([first.value ?? new Uint8Array(), second.value ?? new Uint8Array()])).toEqual(
      Buffer.from(bytes),
    );
    expect(checks).toBe(1);
  });

  it('✅ слова «event: heartbeat» внутри данных события — не heartbeat', async () => {
    const upstream = fakeUpstream();
    let checks = 0;
    const output = textReader(
      guardStream(upstream.stream, {
        isSessionValid: () => {
          checks += 1;
          return false;
        },
        idleMs: 5000,
      }),
    );
    const tricky = 'event: price.updated\ndata: {"note":"event: heartbeat"}\n\n';
    upstream.send(tricky);
    expect(await output.next()).toBe(tricky);
    expect(checks).toBe(0);
  });

  it('❌ api молчит дольше двух heartbeat: поток закрывается, запрос к api отменён', async () => {
    const upstream = fakeUpstream();
    const output = textReader(guardStream(upstream.stream, { isSessionValid: () => true, idleMs: 30 }));
    upstream.send(PRICE);
    expect(await output.next()).toBe(PRICE);
    expect(await output.next()).toBeNull();
    expect(upstream.state.cancelled).toBe(true);
  });

  it('❌ обрыв соединения с api: поток закрывается штатно', async () => {
    const upstream = fakeUpstream();
    const output = textReader(guardStream(upstream.stream, { isSessionValid: () => true, idleMs: 5000 }));
    upstream.fail();
    expect(await output.next()).toBeNull();
  });

  it('✅ клиент закрыл соединение: запрос к api отменён', async () => {
    const upstream = fakeUpstream();
    const output = textReader(guardStream(upstream.stream, { isSessionValid: () => true, idleMs: 5000 }));
    await output.cancel();
    expect(upstream.state.cancelled).toBe(true);
  });
});

describe('[stream] GET /api/stream', () => {
  let ctx: TestContext;
  let token: string;
  let calls: { url: string; init: RequestInit }[];

  function apiStreams(upstream: ReturnType<typeof fakeUpstream>): void {
    ctx.setApi((url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(upstream.stream, { headers: { 'content-type': 'text/event-stream' } }));
    });
  }

  beforeEach(async () => {
    ctx = createTestContext();
    calls = [];
    const userId = await ctx.addUser('oleg', 'correct horse battery', 'operator');
    token = ctx.sessions.create(userId, { ip: null, userAgent: null }).token;
  });

  it('✅ 200 text/event-stream; в api — ключ viewer даже для оператора и Last-Event-ID', async () => {
    const upstream = fakeUpstream();
    apiStreams(upstream);
    const response = await handleStream(request(token, { 'last-event-id': '41' }), ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(calls[0]?.url).toBe(`${TEST_API.baseUrl}/api/v1/stream`);
    const sent = new Headers(calls[0]?.init.headers);
    expect(sent.get('authorization')).toBe(`Bearer ${TEST_API.viewerKey}`);
    expect(sent.get('last-event-id')).toBe('41');
    expect(sent.get('cookie')).toBeNull();

    const output = textReader(response.body as ReadableStream<Uint8Array>);
    upstream.send(PRICE);
    expect(await output.next()).toBe(PRICE);
    await output.cancel();
  });

  it('❌ выход в другой вкладке закрывает открытый поток на ближайшем heartbeat', async () => {
    const upstream = fakeUpstream();
    apiStreams(upstream);
    const response = await handleStream(request(token), ctx);
    const output = textReader(response.body as ReadableStream<Uint8Array>);

    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(HEARTBEAT);

    ctx.sessions.revoke(token, 'logout');
    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(EXPIRED);
    expect(await output.next()).toBeNull();
    expect(upstream.state.cancelled).toBe(true);
  });

  it('❌ открытый поток не продлевает сессию: через 2 часа бездействия он закрывается', async () => {
    const upstream = fakeUpstream();
    apiStreams(upstream);
    const response = await handleStream(request(token), ctx);
    const output = textReader(response.body as ReadableStream<Uint8Array>);

    ctx.advance(IDLE_TIMEOUT_MS - 1000);
    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(HEARTBEAT);

    ctx.advance(1000);
    upstream.send(HEARTBEAT);
    expect(await output.next()).toBe(EXPIRED);
  });

  it('❌ 401 без сессии — запроса в api нет', async () => {
    const response = await handleStream(request(), ctx);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ type: 'urn:cpt:web:problem:unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it('❌ 401 от api — ключ web отклонён: 502, поток не открывается', async () => {
    ctx.setApi(() => Promise.resolve(new Response('{}', { status: 401 })));
    const response = await handleStream(request(token), ctx);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ type: 'urn:cpt:web:problem:upstream-rejected-key' });
  });

  it('❌ отказ api (503 при остановке) возвращается как Problem, а не как поток', async () => {
    const body = { type: 'urn:cpt:problem:service-unavailable', title: 'Сервис останавливается', status: 503 };
    ctx.setApi(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 503,
          headers: { 'content-type': 'application/problem+json', 'retry-after': '5' },
        }),
      ),
    );
    const response = await handleStream(request(token), ctx);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await response.json()).toEqual(body);
  });

  it('❌ 502: api недоступен', async () => {
    ctx.setApi(() => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })));
    const response = await handleStream(request(token), ctx);
    expect(response.status).toBe(502);
    expect(ctx.logs[0]?.fields).toMatchObject({ target: 'GET /api/v1/stream', code: 'ECONNREFUSED' });
  });
});
