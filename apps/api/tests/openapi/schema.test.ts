import {
  coerce,
  createSchemaCompiler,
  isDateTime,
  pointer,
  SpecError,
  type CompileOptions,
  type ValidationIssue,
} from '../../src/openapi/schema.ts';

const COMPONENTS = {
  Timestamp: { type: 'string', format: 'date-time' },
  Symbol: { type: 'string', pattern: '^[A-Z0-9]{1,15}$' },
  Node: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } },
  },
};

function compile(schema: unknown, options?: CompileOptions) {
  const validate = createSchemaCompiler({ components: { schemas: COMPONENTS } }).compile(schema, '#/test', options);
  return (value: unknown): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    validate(value, '/body', issues);
    return issues;
  };
}
const ok = (schema: unknown, value: unknown) => expect(compile(schema)(value)).toEqual([]);
const fails = (schema: unknown, value: unknown, message: string, path = '/body') =>
  expect(compile(schema)(value)).toEqual([{ path, message }]);

describe('валидатор: типы', () => {
  it.each([
    ['string', 'x', 1],
    ['integer', 10, 1.5],
    ['integer', -3, '3'],
    ['number', 1.5, '1.5'],
    ['number', 0, Number.NaN],
    ['number', 2, Number.POSITIVE_INFINITY],
    ['boolean', false, 'false'],
    ['array', [], {}],
  ])('%s: %p проходит, %p — нет', (type, good, bad) => {
    const schema = type === 'array' ? { type, items: { type: 'string' } } : { type };
    ok(schema, good);
    fails(schema, bad, `must be ${type}`);
  });

  it('object: только простой объект, не массив и не null', () => {
    const schema = { type: 'object', additionalProperties: false };
    ok(schema, {});
    fails(schema, [], 'must be object');
    fails(schema, null, 'must be object');
  });

  it('integer: числа за пределами 2^53 отклоняются отдельным сообщением — JSON.parse их уже исказил', () => {
    fails({ type: 'integer' }, 2 ** 53, 'must be a safe integer (|n| <= 2^53 - 1)');
    ok({ type: 'integer' }, Number.MAX_SAFE_INTEGER);
  });

  it('при неверном типе остальные проверки не выполняются — одна понятная ошибка', () => {
    fails({ type: 'string', minLength: 3, pattern: '^a' }, 5, 'must be string');
  });

  it('nullable: null проходит только при nullable: true', () => {
    ok({ type: 'string', nullable: true }, null);
    fails({ type: 'string' }, null, 'must be string');
    fails({ type: 'string', nullable: false }, null, 'must be string');
  });
});

describe('валидатор: ключевые слова', () => {
  it('enum', () => {
    const schema = { type: 'string', enum: ['24h', '7d'] };
    ok(schema, '7d');
    fails(schema, '1y', 'must be one of: 24h, 7d');
    fails({ enum: [1, null] }, 2, 'must be one of: 1, null');
    ok({ enum: [1, null] }, null);
  });

  it('minLength / maxLength считают символы Unicode, а не UTF-16', () => {
    const schema = { type: 'string', minLength: 2, maxLength: 3 };
    ok(schema, '𝔹𝔹𝔹'); // 6 code units, 3 символа
    fails(schema, '𝔹', 'must NOT have fewer than 2 characters');
    fails(schema, 'abcd', 'must NOT have more than 3 characters');
  });

  it('pattern: без якорей ищется вхождение, флаг u включён', () => {
    ok({ type: 'string', pattern: '\\S' }, '  x ');
    fails({ type: 'string', pattern: '\\S' }, '   ', 'must match pattern \\S');
    fails({ $ref: '#/components/schemas/Symbol' }, 'btc', 'must match pattern ^[A-Z0-9]{1,15}$');
  });

  it('format: date-time с обязательной зоной', () => {
    const schema = { type: 'string', format: 'date-time' };
    ok(schema, '2026-10-06T12:00:00.000Z');
    fails(schema, '2026-10-06T12:00:00', 'must be a date-time (RFC 3339) with a time zone: Z or ±hh:mm');
  });

  it('minimum / maximum', () => {
    const schema = { type: 'integer', minimum: 1, maximum: 1000 };
    ok(schema, 1);
    ok(schema, 1000);
    fails(schema, 0, 'must be >= 1');
    fails(schema, 1001, 'must be <= 1000');
  });

  it('items / minItems / maxItems: ошибки элементов — с индексом в пути', () => {
    const schema = { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } };
    ok(schema, [1, 2]);
    fails(schema, [], 'must NOT have fewer than 1 items');
    fails(schema, [1, 2, 3], 'must NOT have more than 2 items');
    fails(schema, [1, 'x'], 'must be integer', '/body/1');
  });

  it('объект: required, запрет лишних полей и все ошибки сразу, с путями', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['symbol'],
      properties: { symbol: { $ref: '#/components/schemas/Symbol' }, cmcId: { type: 'integer', minimum: 1 } },
    };
    ok(schema, { symbol: 'BTC' });
    expect(compile(schema)({ cmcId: 0, extra: true })).toEqual([
      { path: '/body/symbol', message: 'is required' },
      { path: '/body/extra', message: 'is not allowed' },
      { path: '/body/cmcId', message: 'must be >= 1' },
    ]);
  });

  it('объект: "__proto__" из JSON.parse — обычное лишнее поле (mass assignment / prototype pollution)', () => {
    const schema = { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } };
    fails(schema, JSON.parse('{"__proto__":{"isAdmin":true}}'), 'is not allowed', '/body/__proto__');
  });

  it('объект: ключи экранируются в JSON Pointer (RFC 6901)', () => {
    fails({ type: 'object', additionalProperties: false }, { 'a/b~c': 1 }, 'is not allowed', '/body/a~1b~0c');
    expect(pointer('/query', 'x/y')).toBe('/query/x~1y');
  });

  it('объект: minProperties — PATCH без полей (поправка ADR 0014)', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: { name: { type: 'string' }, isPaused: { type: 'boolean' } },
    };
    ok(schema, { isPaused: true });
    fails(schema, {}, 'must NOT have fewer than 1 properties');
  });

  it('allOf из одного элемента: идиома «$ref + nullable» означает T | null', () => {
    const schema = { type: 'string', nullable: true, allOf: [{ $ref: '#/components/schemas/Timestamp' }] };
    ok(schema, null);
    ok(schema, '2026-10-06T12:00:00Z');
    fails(schema, 'yesterday', 'must be a date-time (RFC 3339) with a time zone: Z or ±hh:mm');
    const object = { type: 'object', nullable: true, allOf: [{ $ref: '#/components/schemas/Node' }] };
    ok(object, null);
    fails(object, {}, 'is required', '/body/name');
  });

  it('$ref: рекурсивная схема компилируется и проверяется на любой глубине', () => {
    const tree = { name: 'a', children: [{ name: 'b', children: [{ children: [] }] }] };
    fails({ $ref: '#/components/schemas/Node' }, tree, 'is required', '/body/children/0/children/0/name');
  });

  it('аннотации description, example, title игнорируются', () => {
    ok({ type: 'string', description: 'd', example: 'e', title: 't' }, 'x');
  });
});

describe('валидатор: default (только параметры query/path)', () => {
  it('разрешён с allowDefault и проверяется собственной схемой при компиляции', () => {
    expect(() => compile({ type: 'integer', minimum: 1, default: 100 }, { allowDefault: true })).not.toThrow();
    expect(() => compile({ type: 'integer', minimum: 1, default: 0 }, { allowDefault: true })).toThrow(
      'default не проходит собственную схему',
    );
  });

  it('вне параметров и во вложенных схемах — ошибка компиляции', () => {
    expect(() => compile({ type: 'integer', default: 1 })).toThrow('default разрешён только в схеме параметра');
    expect(() =>
      compile({ type: 'string', allOf: [{ type: 'string', default: 'x' }] }, { allowDefault: true }),
    ).toThrow(SpecError);
  });
});

describe('валидатор: fail-fast при компиляции (ADR 0008)', () => {
  it.each([
    ['схема не объект', 'string', 'схема должна быть объектом'],
    ['соседи у $ref', { $ref: '#/components/schemas/Symbol', nullable: true }, 'рядом с $ref'],
    ['oneOf', { oneOf: [{ type: 'string' }] }, 'ключевое слово "oneOf" не поддерживается'],
    ['discriminator', { type: 'object', discriminator: {} }, '"discriminator" не поддерживается'],
    ['readOnly', { type: 'string', readOnly: true }, '"readOnly" не поддерживается'],
    ['type null (3.1)', { type: 'null' }, 'type должен быть одним из'],
    ['type массивом (3.1)', { type: ['string', 'null'] }, 'type должен быть одним из'],
    ['слово не по типу', { type: 'integer', pattern: '^1' }, '"pattern" неприменимо к type integer'],
    ['слово без type', { minLength: 1 }, '"minLength" неприменимо к type (не задан)'],
    ['nullable не boolean', { type: 'string', nullable: 'yes' }, 'nullable должен быть boolean'],
    ['nullable без type', { nullable: true, allOf: [{ type: 'string' }] }, 'nullable без type не действует'],
    ['allOf из двух', { type: 'string', allOf: [{ type: 'string' }, { type: 'string' }] }, 'allOf поддерживается'],
    ['allOf не массив', { type: 'string', allOf: { type: 'string' } }, 'allOf поддерживается'],
    ['additionalProperties: true', { type: 'object', additionalProperties: true }, 'additionalProperties: false'],
    ['открытый объект', { type: 'object', properties: {} }, 'должно быть additionalProperties: false'],
    [
      'allOf рядом с properties',
      { type: 'object', allOf: [{ $ref: '#/components/schemas/Node' }], properties: {} },
      'объект с allOf описывается только через allOf',
    ],
    ['properties не объект', { type: 'object', additionalProperties: false, properties: [] }, 'properties'],
    [
      'required вне properties',
      { type: 'object', additionalProperties: false, required: ['x'] },
      'required должен перечислять поля из properties',
    ],
    [
      'required не массив',
      { type: 'object', additionalProperties: false, required: 'x', properties: { x: { type: 'string' } } },
      'required должен перечислять',
    ],
    ['minProperties < 0', { type: 'object', additionalProperties: false, minProperties: -1 }, 'minProperties'],
    ['массив без items', { type: 'array' }, 'должна быть схема items'],
    ['minItems дробный', { type: 'array', items: { type: 'string' }, minItems: 1.5 }, 'minItems'],
    ['maxItems строкой', { type: 'array', items: { type: 'string' }, maxItems: '2' }, 'maxItems'],
    ['enum пустой', { enum: [] }, 'enum должен быть непустым массивом примитивов'],
    ['enum с объектом', { enum: [{}] }, 'enum должен быть'],
    ['minLength строкой', { type: 'string', minLength: 'x' }, 'minLength'],
    ['maxLength < 0', { type: 'string', maxLength: -1 }, 'maxLength'],
    ['битый pattern', { type: 'string', pattern: '(' }, 'pattern не компилируется'],
    ['format email', { type: 'string', format: 'email' }, 'format "email" не поддерживается'],
    ['minimum строкой', { type: 'number', minimum: '1' }, 'minimum должен быть числом'],
    ['maximum null', { type: 'number', maximum: null }, 'maximum должен быть числом'],
    ['$ref не в components', { $ref: '#/definitions/X' }, 'не ведёт в #/components/schemas'],
    ['$ref на несуществующую схему', { $ref: '#/components/schemas/Missing' }, 'не ведёт'],
    ['$ref не строкой', { $ref: 1 }, 'не ведёт'],
  ])('%s', (_case, schema, message) => {
    expect(() => compile(schema)).toThrow(SpecError);
    expect(() => compile(schema)).toThrow(message);
  });

  it('место ошибки указывает путь в спеке', () => {
    expect(() => compile({ type: 'object', additionalProperties: false, properties: { a: { oneOf: [] } } })).toThrow(
      '#/test/properties/a: ключевое слово "oneOf"',
    );
  });

  it('документ без components — любой $ref ошибка', () => {
    expect(() => createSchemaCompiler({}).compile({ $ref: '#/components/schemas/X' }, '#')).toThrow(SpecError);
  });
});

describe('typeOf', () => {
  const compiler = createSchemaCompiler({ components: { schemas: COMPONENTS } });
  it('разворачивает $ref и не падает на мусоре', () => {
    expect(compiler.typeOf({ $ref: '#/components/schemas/Timestamp' }, '#')).toBe('string');
    expect(compiler.typeOf({ type: 'integer' }, '#')).toBe('integer');
    expect(compiler.typeOf({ enum: ['a'] }, '#')).toBeUndefined();
    expect(compiler.typeOf(undefined, '#')).toBeUndefined();
  });
});

describe('isDateTime (RFC 3339)', () => {
  it.each([
    '2026-10-06T12:00:00Z',
    '2026-10-06T12:00:00.123456+03:00',
    '2026-10-06t12:00:00z',
    '2026-10-06T23:59:59-23:59',
    '2024-02-29T00:00:00Z',
    '2000-02-29T00:00:00Z',
    '2026-12-31T00:00:00Z',
  ])('✅ %s', (text) => expect(isDateTime(text)).toBe(true));

  it.each([
    ['без зоны', '2026-10-06T12:00:00'],
    ['только дата', '2026-10-06'],
    ['пробел вместо T', '2026-10-06 12:00:00Z'],
    ['29.02 не високосного', '2026-02-29T00:00:00Z'],
    ['1900 — не високосный (кратен 100)', '1900-02-29T00:00:00Z'],
    ['31 апреля', '2026-04-31T00:00:00Z'],
    ['месяц 13', '2026-13-01T00:00:00Z'],
    ['месяц 00', '2026-00-10T00:00:00Z'],
    ['день 00', '2026-10-00T00:00:00Z'],
    ['24 часа', '2026-10-06T24:00:00Z'],
    ['60 минут', '2026-10-06T12:60:00Z'],
    ['секунда координации', '2026-12-31T23:59:60Z'],
    ['зона +24:00', '2026-10-06T12:00:00+24:00'],
    ['зона +03:60', '2026-10-06T12:00:00+03:60'],
    ['зона без двоеточия', '2026-10-06T12:00:00+0300'],
    ['пробелы вокруг', ' 2026-10-06T12:00:00Z'],
  ])('❌ %s', (_case, text) => expect(isDateTime(text)).toBe(false));
});

describe('coerce (query/path → тип схемы)', () => {
  it.each([
    ['10', 'integer', 10],
    ['-3', 'integer', -3],
    ['0', 'integer', 0],
    ['010', 'integer', '010'],
    ['1e3', 'integer', '1e3'],
    ['+1', 'integer', '+1'],
    ['', 'integer', ''],
    ['1.5', 'number', 1.5],
    ['-0.25', 'number', -0.25],
    ['.5', 'number', '.5'],
    ['true', 'boolean', true],
    ['false', 'boolean', false],
    ['1', 'boolean', '1'],
    ['abc', 'string', 'abc'],
    ['abc', undefined, 'abc'],
  ] as const)('%p как %s → %p', (raw, type, expected) => {
    expect(coerce(raw, type)).toBe(expected);
  });

  it('не трогает не-строки: повторённый параметр (?a=1&a=2) останется массивом и не пройдёт тип', () => {
    expect(coerce(['1', '2'], 'integer')).toEqual(['1', '2']);
    expect(coerce(undefined, 'integer')).toBeUndefined();
  });
});
