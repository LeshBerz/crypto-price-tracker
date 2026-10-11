// Дымовая проверка запущенного сервиса (E1.2): готовность → добавить монету → ручная синхронизация → цены → поток.
// Запуск: BOOTSTRAP_OPERATOR_KEY=… BOOTSTRAP_VIEWER_KEY=… node scripts/smoke.ts [http://localhost:3000]
// Ключи — те же, с которыми поднят сервис. Без зависимостей: fetch из Node.
const baseUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const operator = process.env['BOOTSTRAP_OPERATOR_KEY'];
const viewer = process.env['BOOTSTRAP_VIEWER_KEY'];
if (!operator || !viewer) {
  process.stderr.write('smoke: задайте BOOTSTRAP_OPERATOR_KEY и BOOTSTRAP_VIEWER_KEY — ключи запущенного сервиса\n');
  process.exit(2);
}

type Json = Record<string, unknown>;

async function call(method: string, path: string, key?: string, body?: Json): Promise<{ status: number; json: Json }> {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Json) : {} };
}

function check(step: string, ok: boolean, details: unknown): void {
  process.stdout.write(`${ok ? '✅' : '❌'} ${step}\n`);
  if (!ok) {
    process.stdout.write(`   ${JSON.stringify(details)}\n`);
    process.exit(1);
  }
}

const ready = await call('GET', '/health/ready');
check('GET /health/ready → 200', ready.status === 200, ready);

const docs = await fetch(`${baseUrl}/openapi.json`);
check('GET /openapi.json → 200', docs.status === 200, docs.status);

const denied = await call('GET', '/api/v1/prices');
check('GET /api/v1/prices без ключа → 401', denied.status === 401, denied);

const forbidden = await call('POST', '/api/v1/cryptocurrencies', viewer, { symbol: 'BTC' });
check('POST /api/v1/cryptocurrencies ключом viewer → 403', forbidden.status === 403, forbidden);

// Поток открываем до синхронизации: её итог должен прийти в него
const stream = await fetch(`${baseUrl}/api/v1/stream`, { headers: { Authorization: `Bearer ${viewer}` } });
if (stream.status !== 200 || stream.body === null)
  check('GET /api/v1/stream → 200 text/event-stream', false, stream.status);
check('GET /api/v1/stream → 200 text/event-stream', true, null);
const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
let events = '';
const pump = (async () => {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    events += new TextDecoder().decode(value);
  }
})().catch(() => undefined);

const created = await call('POST', '/api/v1/cryptocurrencies', operator, { symbol: 'BTC' });
// 409 — монета осталась от прошлого прогона: проверку можно повторять на той же БД
check('POST /api/v1/cryptocurrencies { symbol: BTC } → 201 или 409', [201, 409].includes(created.status), created);

const started = await call('POST', '/api/v1/sync-runs', operator);
// 409 — уже идёт запуск планировщика: ждём его же
check('POST /api/v1/sync-runs → 202 или 409', [202, 409].includes(started.status), started);
const runId = started.status === 202 ? started.json['id'] : started.json['conflictingId'];

let run: Json = {};
for (let attempt = 0; attempt < 50; attempt++) {
  ({ json: run } = await call('GET', `/api/v1/sync-runs/${String(runId)}`, operator));
  if (run['status'] !== 'running') break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
check(`GET /api/v1/sync-runs/${String(runId)} → succeeded`, run['status'] === 'succeeded', run);

if (started.status === 409) {
  // Чужой запуск мог начаться до добавления монеты — запускаем свой
  await call('POST', '/api/v1/sync-runs', operator);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const prices = await call('GET', '/api/v1/prices', viewer);
const items = (prices.json['items'] ?? []) as Json[];
const btc = items.find((item) => item['symbol'] === 'BTC');
const price = (btc?.['latest'] as Json | null | undefined)?.['price'];
check('GET /api/v1/prices → цена BTC строкой', prices.status === 200 && typeof price === 'string', prices);

for (let attempt = 0; attempt < 25 && !events.includes('event: sync.finished'); attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
check('в поток пришло событие sync.finished', events.includes('event: sync.finished'), events);

await reader.cancel();
await pump;
process.stdout.write(`smoke: OK (${baseUrl}, BTC = ${String(price)} USD)\n`);
