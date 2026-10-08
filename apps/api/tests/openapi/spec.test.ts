import { openapiDocument } from '../../src/generated/openapi.ts';
import { SpecError } from '../../src/openapi/schema.ts';
import { checkResponse, compileSpec, type RawRequest } from '../../src/openapi/spec.ts';

type Json = Record<string, unknown>;

function fixture(): Json {
  return {
    openapi: '3.0.3',
    security: [{ bearerAuth: [] }],
    paths: {
      '/items/{id}': {
        parameters: [{ $ref: '#/components/parameters/Id' }],
        get: {
          operationId: 'getItem',
          'x-required-scopes': ['items:read'],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10, default: 5 } },
            { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            '200': {
              description: 'ok',
              headers: {
                'X-Request-Id': { $ref: '#/components/headers/XRequestId' },
                'Retry-After': { schema: { type: 'integer' } },
              },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
            },
            '204': { description: 'empty' },
            '400': { $ref: '#/components/responses/Problem' },
          },
        },
        patch: {
          operationId: 'updateItem',
          'x-required-scopes': ['items:write'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/items': {
        post: {
          operationId: 'createItem',
          'x-required-scopes': ['items:write'],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
          responses: { '201': { description: 'created' } },
        },
      },
      '/health': {
        summary: 'аннотации path item допустимы',
        get: {
          operationId: 'health',
          security: [],
          responses: { '200': { description: 'ok', content: { 'text/plain': {} } } },
        },
      },
    },
    components: {
      parameters: {
        Id: { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
      },
      headers: { XRequestId: { schema: { type: 'string', maxLength: 64 } } },
      responses: {
        Problem: {
          description: 'problem',
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
      },
      schemas: {
        Item: {
          type: 'object',
          additionalProperties: false,
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1 } },
        },
        Problem: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'integer' } },
        },
      },
    },
  };
}

const request = (overrides: Partial<RawRequest> = {}): RawRequest => ({
  params: {},
  query: {},
  body: undefined,
  hasBody: false,
  ...overrides,
});

describe('compileSpec: настоящий контракт', () => {
  const spec = compileSpec(openapiDocument);

  it('openapi.yaml компилируется целиком: ни одного неподдерживаемого слова (fail-fast на старте)', () => {
    expect(spec.operations).toHaveLength(16);
  });

  it('пути переводятся в синтаксис Express, scopes и публичность — из спеки', () => {
    const history = spec.operation('listPriceHistory');
    expect(history).toMatchObject({
      method: 'get',
      path: '/api/v1/cryptocurrencies/{id}/prices',
      expressPath: '/api/v1/cryptocurrencies/:id/prices',
      isPublic: false,
      requiredScopes: ['prices:read'],
      requestBody: null,
    });
    expect(spec.operation('getLiveness')).toMatchObject({ isPublic: true, requiredScopes: [] });
    expect(spec.operation('createCryptocurrency').requestBody).toEqual({ required: true });
  });

  it('listPriceHistory: приведение, default и все ошибки разом, с путями', () => {
    const op = spec.operation('listPriceHistory');
    expect(op.parseRequest(request({ params: { id: '7' } }))).toEqual({
      ok: true,
      input: { path: { id: 7 }, query: { limit: 100 }, body: undefined },
    });
    expect(
      op.parseRequest(
        request({ params: { id: 'abc' }, query: { from: '2026-10-06T12:00:00', limit: '0', cursor: '!', page: '2' } }),
      ),
    ).toEqual({
      ok: false,
      issues: [
        { path: '/path/id', message: 'must be integer' },
        { path: '/query/page', message: 'is not allowed' },
        { path: '/query/from', message: 'must be a date-time (RFC 3339) with a time zone: Z or ±hh:mm' },
        { path: '/query/limit', message: 'must be >= 1' },
        { path: '/query/cursor', message: 'must match pattern ^[A-Za-z0-9_-]+$' },
      ],
    });
  });

  it('getLiveness: неизвестный query-параметр → ошибка (поправка R1)', () => {
    expect(spec.operation('getLiveness').parseRequest(request({ query: { debug: '1' } }))).toEqual({
      ok: false,
      issues: [{ path: '/query/debug', message: 'is not allowed' }],
    });
  });

  it('componentSchema: валидатор схемы из components, один на имя', () => {
    const problem = spec.componentSchema('Problem');
    expect(spec.componentSchema('Problem')).toBe(problem);
    const issues: unknown[] = [];
    problem({ type: 'urn:cpt:problem:not-found', title: 'Not Found', status: 404, requestId: 'r' }, '', []);
    problem({ type: 'oops' }, '', issues as never);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('operation() с неизвестным id — ошибка', () => {
    expect(() => spec.operation('nope')).toThrow('Операции nope нет в спеке');
  });
});

describe('compileSpec: разбор запроса', () => {
  const spec = compileSpec(fixture());

  it('query: ошибки в порядке параметров спеки; повторённый не приводится к числу, обязательный отсутствует', () => {
    expect(
      spec.operation('getItem').parseRequest(request({ params: { id: '1' }, query: { limit: ['1', '2'] } })),
    ).toEqual({
      ok: false,
      issues: [
        { path: '/query/limit', message: 'must be integer' },
        { path: '/query/from', message: 'is required' },
      ],
    });
  });

  it('тело: обязательное отсутствует / проверяется схемой / есть у операции без тела', () => {
    const update = spec.operation('updateItem');
    expect(update.parseRequest(request({ params: { id: '1' } }))).toEqual({
      ok: false,
      issues: [{ path: '/body', message: 'is required' }],
    });
    expect(update.parseRequest(request({ params: { id: '1' }, hasBody: true, body: { name: '' } }))).toEqual({
      ok: false,
      issues: [{ path: '/body/name', message: 'must NOT have fewer than 1 characters' }],
    });
    expect(update.parseRequest(request({ params: { id: '1' }, hasBody: true, body: { name: 'x' } }))).toEqual({
      ok: true,
      input: { path: { id: 1 }, query: {}, body: { name: 'x' } },
    });
    expect(spec.operation('health').parseRequest(request({ hasBody: true, body: {} }))).toEqual({
      ok: false,
      issues: [{ path: '/body', message: 'must be empty: operation has no request body' }],
    });
  });

  it('необязательное тело можно не присылать', () => {
    const create = spec.operation('createItem');
    expect(create.requestBody).toEqual({ required: false });
    expect(create.parseRequest(request())).toEqual({ ok: true, input: { path: {}, query: {}, body: undefined } });
  });

  it('параметр операции переопределяет одноимённый параметр пути', () => {
    const doc = fixture();
    const item = (doc.paths as Json)['/items/{id}'] as Json;
    (item.patch as Json).parameters = [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer', maximum: 5 } },
    ];
    const op = compileSpec(doc).operation('updateItem');
    expect(op.parseRequest(request({ params: { id: '6' }, hasBody: true, body: { name: 'x' } }))).toEqual({
      ok: false,
      issues: [{ path: '/path/id', message: 'must be <= 5' }],
    });
  });
});

describe('compileSpec: fail-fast на структуре спеки', () => {
  type Mutation = (doc: Json, paths: Json, item: Json, get: Json) => void;
  const cases: [string, Mutation, string][] = [
    ['не OpenAPI 3.0', (doc) => (doc.openapi = '3.1.0'), 'ожидается документ OpenAPI 3.0.x'],
    ['нет paths', (doc) => delete doc.paths, '#/paths: ожидается объект'],
    ['path item не объект', (_d, paths) => (paths['/x'] = 1), '#/paths/~1x: ожидается объект'],
    ['путь без /', (_d, paths) => (paths['x'] = {}), 'путь должен начинаться с /'],
    ['спецсимвол в сегменте', (_d, paths) => (paths['/a:b'] = {}), 'сегмент "a:b" не поддерживается'],
    ['шаблон внутри сегмента', (_d, paths) => (paths['/v{id}'] = {}), 'сегмент "v{id}"'],
    ['servers у path item', (_d, _p, item) => (item.servers = []), '"servers" не поддерживается роутером'],
    ['HEAD-операция', (_d, _p, item) => (item.head = {}), '"head" не поддерживается роутером'],
    ['операция не объект', (_d, _p, item) => (item.put = 'x'), '/put: ожидается объект'],
    ['callbacks', (_d, _p, _i, get) => (get.callbacks = {}), '"callbacks" не поддерживается роутером'],
    ['нет operationId', (_d, _p, _i, get) => delete get.operationId, 'нет operationId'],
    ['повтор operationId', (_d, _p, item) => ((item.patch as Json).operationId = 'getItem'), 'getItem повторяется'],
    ['защищённая без scopes', (_d, _p, _i, get) => delete get['x-required-scopes'], 'должны быть x-required-scopes'],
    [
      'публичная со scopes',
      (_d, _p, _i, get) => (get.security = []),
      'у защищённой операции должны быть x-required-scopes, у публичной — нет',
    ],
    ['scopes не строки', (_d, _p, _i, get) => (get['x-required-scopes'] = [1]), 'массивом строк'],
    ['scopes не массив', (_d, _p, _i, get) => (get['x-required-scopes'] = 'a'), 'массивом строк'],
    [
      'битый $ref параметра',
      (_d, _p, item) => (item.parameters = [{ $ref: '#/x' }]),
      'должен вести в #/components/parameters',
    ],
    ['параметр не объект', (_d, _p, item) => (item.parameters = ['id']), 'parameters/0: ожидается объект'],
    [
      'style у параметра',
      (doc) => (comp(doc, 'parameters', 'Id').style = 'simple'),
      '"style" у параметра не поддерживается',
    ],
    ['параметр без name', (doc) => delete comp(doc, 'parameters', 'Id').name, 'у параметра нет name'],
    ['параметр в header', (doc) => (comp(doc, 'parameters', 'Id').in = 'header'), 'только в path и query'],
    ['path не required', (doc) => delete comp(doc, 'parameters', 'Id').required, 'должен быть required: true'],
    [
      'массив в query',
      (_d, _p, _i, get) => (get.parameters = [{ name: 'ids', in: 'query', schema: { type: 'array', items: {} } }]),
      'объекты и массивы в query не поддерживаются',
    ],
    ['parameters не массив', (_d, _p, item) => (item.parameters = {}), 'parameters должен быть массивом'],
    [
      'параметр повторяется',
      (_d, _p, item) =>
        (item.parameters = [{ $ref: '#/components/parameters/Id' }, { $ref: '#/components/parameters/Id' }]),
      'параметры повторяются',
    ],
    ['параметр пути не объявлен', (_d, _p, item) => delete item.parameters, 'параметры пути не совпадают с шаблоном'],
    [
      'тело не JSON',
      (_d, _p, item) =>
        ((item.patch as Json).requestBody = { content: { 'text/plain': { schema: { type: 'string' } } } }),
      'только content application/json со схемой',
    ],
    [
      'тело без схемы',
      (_d, _p, item) => ((item.patch as Json).requestBody = { content: { 'application/json': {} } }),
      'только content application/json',
    ],
    ['тело не объект', (_d, _p, item) => ((item.patch as Json).requestBody = 1), 'только content application/json'],
    ['нет responses', (_d, _p, _i, get) => delete get.responses, 'нет responses'],
    ['пустые responses', (_d, _p, _i, get) => (get.responses = {}), 'нет responses'],
    ['ответ default', (_d, _p, _i, get) => (get.responses = { default: {} }), 'код default не поддерживается'],
    [
      'битый $ref ответа',
      (_d, _p, _i, get) => (get.responses = { '400': { $ref: '#/components/responses/Nope' } }),
      'должен вести в #/components/responses',
    ],
    [
      'соседи у $ref ответа',
      (_d, _p, _i, get) => (get.responses = { '400': { $ref: '#/components/responses/Problem', description: 'x' } }),
      'и стоять один',
    ],
    [
      'media type не объект',
      (_d, _p, _i, get) => (get.responses = { '200': { description: 'x', content: { 'text/plain': 'x' } } }),
      'responses/200/content/text~1plain: ожидается объект',
    ],
    [
      'неподдерживаемая схема в ответе',
      (doc) => (comp(doc, 'schemas', 'Problem').properties = { status: { oneOf: [] } }),
      '#/components/schemas/Problem/properties/status: ключевое слово "oneOf"',
    ],
  ];

  it.each(cases)('%s', (_case, mutate, message) => {
    const doc = fixture();
    const paths = doc.paths as Json;
    const item = paths['/items/{id}'] as Json;
    mutate(doc, paths, item, item.get as Json);
    expect(() => compileSpec(doc)).toThrow(SpecError);
    expect(() => compileSpec(doc)).toThrow(message);
  });

  it('документ не объект', () => {
    expect(() => compileSpec(null)).toThrow(SpecError);
  });

  it('спека без components компилируется, если ссылки не нужны', () => {
    const doc = {
      openapi: '3.0.0',
      paths: { '/': { get: { operationId: 'root', security: [], responses: { '204': { description: 'x' } } } } },
    };
    expect(compileSpec(doc).operation('root').expressPath).toBe('/');
  });
});

function comp(doc: Json, kind: string, name: string): Json {
  return ((doc.components as Json)[kind] as Json)[name] as Json;
}

describe('checkResponse (основа toMatchContract)', () => {
  const op = compileSpec(fixture()).operation('getItem');
  const json = { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'r-1' };

  it('валидный ответ — пустой список', () => {
    expect(checkResponse(op, { status: 200, headers: json, body: { name: 'x' }, text: '{"name":"x"}' })).toEqual([]);
    expect(checkResponse(op, { status: 204, headers: {}, body: {}, text: '' })).toEqual([]);
  });

  it('статус не объявлен в операции', () => {
    expect(checkResponse(op, { status: 418, headers: {}, body: {}, text: '' })).toEqual([
      'статус 418 не объявлен в getItem',
    ]);
  });

  it('тело не по схеме — все ошибки с путями', () => {
    expect(checkResponse(op, { status: 200, headers: json, body: { extra: 1 }, text: '{}' })).toEqual([
      '/name is required',
      '/extra is not allowed',
    ]);
    expect(checkResponse(op, { status: 200, headers: json, body: 'x', text: '"x"' })).toEqual(['/ must be object']);
  });

  it('заголовки проверяются по схеме, если пришли (строки приводятся к типу)', () => {
    const headers = { ...json, 'x-request-id': 'a'.repeat(65), 'retry-after': 'soon' };
    expect(checkResponse(op, { status: 200, headers, body: { name: 'x' }, text: '{}' })).toEqual([
      '/headers/x-request-id must NOT have more than 64 characters',
      '/headers/retry-after must be integer',
    ]);
    expect(
      checkResponse(op, { status: 200, headers: { ...json, 'retry-after': '30' }, body: { name: 'x' }, text: '{}' }),
    ).toEqual([]);
  });

  it('Content-Type не из спеки или отсутствует', () => {
    expect(checkResponse(op, { status: 200, headers: { 'content-type': 'text/html' }, body: {}, text: '<p>' })).toEqual(
      ['Content-Type text/html не объявлен (ожидается application/json)'],
    );
    expect(checkResponse(op, { status: 400, headers: {}, body: {}, text: '{}' })).toEqual([
      'Content-Type undefined не объявлен (ожидается application/problem+json)',
    ]);
  });

  it('у ответа без content тело должно быть пустым', () => {
    expect(checkResponse(op, { status: 204, headers: {}, body: {}, text: 'x' })).toEqual([
      'тело должно быть пустым: content не объявлен',
    ]);
  });

  it('не-JSON ответ со схемой сверяется как текст (text/event-stream), а не как распарсенное тело', () => {
    const doc = fixture();
    const health = ((doc.paths as Json)['/health'] as Json).get as Json;
    health.responses = {
      '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string', maxLength: 2 } } } },
    };
    const op = compileSpec(doc).operation('health');
    const headers = { 'content-type': 'text/plain; charset=utf-8' };
    expect(checkResponse(op, { status: 200, headers, body: {}, text: 'ok' })).toEqual([]);
    expect(checkResponse(op, { status: 200, headers, body: {}, text: 'too long' })).toEqual([
      '/ must NOT have more than 2 characters',
    ]);
  });

  it('media type без схемы — проверяется только Content-Type', () => {
    const health = compileSpec(fixture()).operation('health');
    expect(
      checkResponse(health, { status: 200, headers: { 'content-type': 'text/plain' }, body: {}, text: 'ok' }),
    ).toEqual([]);
  });
});
