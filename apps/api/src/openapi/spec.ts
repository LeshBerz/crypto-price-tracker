// Компиляция openapi.yaml (собранного в src/generated/openapi.ts) в операции для роутера (ADR 0008).
// Всё, что роутер и валидатор не умеют честно выполнить, — ошибка старта, а не молчаливый пропуск.
import {
  coerce,
  createSchemaCompiler,
  isJsonObject,
  pointer,
  SpecError,
  type SchemaType,
  type ValidationIssue,
  type Validator,
} from './schema.ts';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type RequestInput = {
  path: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
};
export type RawRequest = {
  params: Readonly<Record<string, unknown>>;
  query: Readonly<Record<string, unknown>>;
  body: unknown;
  /** Есть ли у запроса тело (Content-Length > 0 или chunked) — отличает «тела нет» от «тело пустое» */
  hasBody: boolean;
};
export type ParseResult = { ok: true; input: RequestInput } | { ok: false; issues: ValidationIssue[] };

type HeaderSpec = { type: SchemaType | undefined; validate: Validator };
export type ResponseSpec = {
  headers: ReadonlyMap<string, HeaderSpec>;
  /** media type → валидатор тела (null — схема не задана) */
  content: ReadonlyMap<string, Validator | null>;
};

export type CompiledOperation = {
  operationId: string;
  method: HttpMethod;
  /** Путь как в спеке: /api/v1/cryptocurrencies/{id} */
  path: string;
  /** Тот же путь для Express: /api/v1/cryptocurrencies/:id */
  expressPath: string;
  isPublic: boolean;
  requiredScopes: readonly string[];
  requestBody: { required: boolean } | null;
  responses: ReadonlyMap<string, ResponseSpec>;
  parseRequest(raw: RawRequest): ParseResult;
};

export type CompiledSpec = {
  operations: readonly CompiledOperation[];
  operation(operationId: string): CompiledOperation;
  /** Валидатор схемы из components.schemas — например, Problem для ответов роутера 404/405 */
  componentSchema(name: string): Validator;
};

type Json = Record<string, unknown>;
type Param = {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  type: SchemaType | undefined;
  validate: Validator;
  default: unknown;
};

const PATH_ITEM_KEYS = new Set([...HTTP_METHODS, 'parameters', 'summary', 'description']);
const OPERATION_KEYS = new Set([
  'tags',
  'operationId',
  'summary',
  'description',
  'security',
  'x-required-scopes',
  'parameters',
  'requestBody',
  'responses',
]);
const PARAMETER_KEYS = new Set(['name', 'in', 'required', 'schema', 'description', 'example']);
const STATIC_SEGMENT = /^[A-Za-z0-9._~-]*$/;
const TEMPLATE_SEGMENT = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function compileSpec(document: unknown): CompiledSpec {
  if (!isJsonObject(document) || typeof document.openapi !== 'string' || !document.openapi.startsWith('3.0.')) {
    throw new SpecError('#: ожидается документ OpenAPI 3.0.x');
  }
  if (!isJsonObject(document.paths)) throw new SpecError('#/paths: ожидается объект');
  const compiler = createSchemaCompiler(document);
  const components = isJsonObject(document.components) ? document.components : {};

  /** Разворачивает { $ref: '#/components/<kind>/<name>' }; объект без $ref возвращает как есть */
  const resolve = (kind: string, value: unknown, location: string): { value: Json; location: string } => {
    if (!isJsonObject(value)) throw new SpecError(`${location}: ожидается объект`);
    if (value.$ref === undefined) return { value, location };
    const match = new RegExp(`^#/components/${kind}/([A-Za-z0-9._-]+)$`).exec(String(value.$ref));
    const section = components[kind];
    const name = match?.[1];
    if (name === undefined || !isJsonObject(section) || !isJsonObject(section[name]) || Object.keys(value).length > 1) {
      throw new SpecError(`${location}: $ref должен вести в #/components/${kind} и стоять один`);
    }
    return { value: section[name], location: `#/components/${kind}/${name}` };
  };

  const compileParameter = (raw: unknown, location: string): Param => {
    const { value: param, location: at } = resolve('parameters', raw, location);
    for (const key of Object.keys(param)) {
      if (!PARAMETER_KEYS.has(key)) throw new SpecError(`${at}: "${key}" у параметра не поддерживается`);
    }
    if (typeof param.name !== 'string' || param.name === '') throw new SpecError(`${at}: у параметра нет name`);
    if (param.in !== 'path' && param.in !== 'query') {
      throw new SpecError(`${at}: поддерживаются параметры только в path и query`);
    }
    if (param.in === 'path' && param.required !== true) {
      throw new SpecError(`${at}: параметр пути должен быть required: true`);
    }
    const type = compiler.typeOf(param.schema, `${at}/schema`);
    if (type === 'object' || type === 'array') {
      throw new SpecError(`${at}: объекты и массивы в ${param.in} не поддерживаются (нет style/explode)`);
    }
    return {
      name: param.name,
      in: param.in,
      required: param.required === true,
      type,
      validate: compiler.compile(param.schema, `${at}/schema`, { allowDefault: param.in === 'query' }),
      // compile выше уже проверил, что схема — объект
      default: (param.schema as Json).default,
    };
  };

  const compileParameters = (list: unknown, location: string): Param[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new SpecError(`${location}: parameters должен быть массивом`);
    const params = list.map((raw, i) => compileParameter(raw, `${location}/${i}`));
    const keys = params.map((p) => `${p.in}:${p.name}`);
    if (new Set(keys).size !== keys.length) throw new SpecError(`${location}: параметры повторяются`);
    return params;
  };

  const compileResponse = (raw: unknown, location: string): ResponseSpec => {
    const { value: response, location: at } = resolve('responses', raw, location);
    const headers = new Map<string, HeaderSpec>();
    for (const [name, rawHeader] of Object.entries(isJsonObject(response.headers) ? response.headers : {})) {
      const { value: header, location: headerAt } = resolve('headers', rawHeader, pointer(`${at}/headers`, name));
      headers.set(name.toLowerCase(), {
        type: compiler.typeOf(header.schema, `${headerAt}/schema`),
        validate: compiler.compile(header.schema, `${headerAt}/schema`),
      });
    }
    const content = new Map<string, Validator | null>();
    for (const [media, rawMedia] of Object.entries(isJsonObject(response.content) ? response.content : {})) {
      if (!isJsonObject(rawMedia)) throw new SpecError(`${pointer(`${at}/content`, media)}: ожидается объект`);
      const schema = rawMedia.schema;
      content.set(
        media,
        schema === undefined ? null : compiler.compile(schema, `${pointer(`${at}/content`, media)}/schema`),
      );
    }
    return { headers, content };
  };

  const operations: CompiledOperation[] = [];
  for (const [path, rawItem] of Object.entries(document.paths)) {
    const itemAt = pointer('#/paths', path);
    if (!isJsonObject(rawItem)) throw new SpecError(`${itemAt}: ожидается объект`);
    for (const key of Object.keys(rawItem)) {
      if (!PATH_ITEM_KEYS.has(key)) throw new SpecError(`${itemAt}: "${key}" не поддерживается роутером`);
    }
    const { expressPath, templateParams } = toExpressPath(path, itemAt);
    const shared = compileParameters(rawItem.parameters, `${itemAt}/parameters`);

    for (const method of HTTP_METHODS) {
      const raw = rawItem[method];
      if (raw === undefined) continue;
      const at = `${itemAt}/${method}`;
      if (!isJsonObject(raw)) throw new SpecError(`${at}: ожидается объект`);
      for (const key of Object.keys(raw)) {
        if (!OPERATION_KEYS.has(key)) throw new SpecError(`${at}: "${key}" не поддерживается роутером`);
      }
      const own = compileParameters(raw.parameters, `${at}/parameters`);
      // Параметр операции переопределяет одноимённый параметр пути (OpenAPI 3.0, Path Item Object)
      const params = [...shared.filter((s) => !own.some((o) => o.in === s.in && o.name === s.name)), ...own];
      const pathNames = params.filter((p) => p.in === 'path').map((p) => p.name);
      if (pathNames.length !== templateParams.length || !templateParams.every((n) => pathNames.includes(n))) {
        throw new SpecError(`${at}: параметры пути не совпадают с шаблоном ${path}`);
      }
      operations.push(compileOperation(raw, at, method, path, expressPath, params, compileResponse, compiler));
    }
  }

  const byId = new Map<string, CompiledOperation>();
  for (const op of operations) {
    if (byId.has(op.operationId)) throw new SpecError(`#/paths: operationId ${op.operationId} повторяется`);
    byId.set(op.operationId, op);
  }

  const schemaValidators = new Map<string, Validator>();
  return {
    operations,
    operation(operationId) {
      const op = byId.get(operationId);
      if (!op) throw new Error(`Операции ${operationId} нет в спеке`);
      return op;
    },
    componentSchema(name) {
      let validate = schemaValidators.get(name);
      if (!validate) {
        validate = compiler.compile({ $ref: `#/components/schemas/${name}` }, `componentSchema(${name})`);
        schemaValidators.set(name, validate);
      }
      return validate;
    },
  };
}

function compileOperation(
  raw: Json,
  at: string,
  method: HttpMethod,
  path: string,
  expressPath: string,
  params: Param[],
  compileResponse: (raw: unknown, location: string) => ResponseSpec,
  compiler: ReturnType<typeof createSchemaCompiler>,
): CompiledOperation {
  if (typeof raw.operationId !== 'string' || raw.operationId === '') {
    throw new SpecError(`${at}: нет operationId — роутер монтирует хендлеры по нему`);
  }
  const operationId = raw.operationId;

  // security: [] — публичная операция; иначе действует глобальная bearerAuth и нужны scopes (ADR 0002, 0014)
  const isPublic = Array.isArray(raw.security) && raw.security.length === 0;
  const scopes = raw['x-required-scopes'] ?? [];
  if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === 'string' && s !== '')) {
    throw new SpecError(`${at}: x-required-scopes должен быть массивом строк`);
  }
  if (isPublic === scopes.length > 0) {
    throw new SpecError(`${at}: у защищённой операции должны быть x-required-scopes, у публичной — нет`);
  }

  let requestBody: { required: boolean; validate: Validator } | null = null;
  if (raw.requestBody !== undefined) {
    const body = isJsonObject(raw.requestBody) ? raw.requestBody : {};
    const content = isJsonObject(body.content) ? body.content : {};
    const json = content['application/json'];
    if (Object.keys(content).length !== 1 || !isJsonObject(json) || json.schema === undefined) {
      throw new SpecError(`${at}/requestBody: поддерживается только content application/json со схемой`);
    }
    requestBody = {
      required: body.required === true,
      validate: compiler.compile(json.schema, `${at}/requestBody/content/application~1json/schema`),
    };
  }

  if (!isJsonObject(raw.responses) || Object.keys(raw.responses).length === 0) {
    throw new SpecError(`${at}: нет responses`);
  }
  const responses = new Map<string, ResponseSpec>();
  for (const [status, response] of Object.entries(raw.responses)) {
    if (!/^[1-5]\d\d$/.test(status)) throw new SpecError(`${at}/responses: код ${status} не поддерживается`);
    responses.set(status, compileResponse(response, `${at}/responses/${status}`));
  }

  const pathParams = params.filter((p) => p.in === 'path');
  const queryParams = new Map(params.filter((p) => p.in === 'query').map((p) => [p.name, p]));

  const parseRequest = (rawRequest: RawRequest): ParseResult => {
    const issues: ValidationIssue[] = [];
    const input: RequestInput = { path: {}, query: {}, body: undefined };

    for (const param of pathParams) {
      const value = coerce(rawRequest.params[param.name], param.type);
      param.validate(value, pointer('/path', param.name), issues);
      input.path[param.name] = value;
    }

    for (const name of Object.keys(rawRequest.query)) {
      if (!queryParams.has(name)) issues.push({ path: pointer('/query', name), message: 'is not allowed' });
    }
    for (const param of queryParams.values()) {
      const raw = rawRequest.query[param.name];
      if (raw === undefined) {
        if (param.required) issues.push({ path: pointer('/query', param.name), message: 'is required' });
        else if (param.default !== undefined) input.query[param.name] = param.default;
        continue;
      }
      const value = coerce(raw, param.type);
      param.validate(value, pointer('/query', param.name), issues);
      input.query[param.name] = value;
    }

    if (requestBody === null) {
      // У операции нет тела по контракту — присланное тело не игнорируем молча (C10)
      if (rawRequest.hasBody) issues.push({ path: '/body', message: 'must be empty: operation has no request body' });
    } else if (!rawRequest.hasBody) {
      if (requestBody.required) issues.push({ path: '/body', message: 'is required' });
    } else {
      requestBody.validate(rawRequest.body, '/body', issues);
      input.body = rawRequest.body;
    }

    return issues.length > 0 ? { ok: false, issues } : { ok: true, input };
  };

  return {
    operationId,
    method,
    path,
    expressPath,
    isPublic,
    requiredScopes: scopes as string[],
    requestBody: requestBody && { required: requestBody.required },
    responses,
    parseRequest,
  };
}

function toExpressPath(path: string, location: string): { expressPath: string; templateParams: string[] } {
  if (!path.startsWith('/')) throw new SpecError(`${location}: путь должен начинаться с /`);
  const templateParams: string[] = [];
  const segments = path
    .slice(1)
    .split('/')
    .map((segment) => {
      const name = TEMPLATE_SEGMENT.exec(segment)?.[1];
      if (name !== undefined) {
        templateParams.push(name);
        return `:${name}`;
      }
      // Спецсимволы path-to-regexp (:, *, ?, скобки) в статичном сегменте поменяли бы смысл маршрута
      if (!STATIC_SEGMENT.test(segment)) throw new SpecError(`${location}: сегмент "${segment}" не поддерживается`);
      return segment;
    });
  return { expressPath: `/${segments.join('/')}`, templateParams };
}

export type ResponseUnderTest = {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: unknown;
  /** Сырое тело: отличает «тела нет» от пустого объекта, который supertest подставляет сам */
  text: string;
};

/** Сверяет ответ с контрактом операции. Пустой список — ответ соответствует спеке (ADR 0008, toMatchContract) */
export function checkResponse(op: CompiledOperation, response: ResponseUnderTest): string[] {
  const spec = op.responses.get(String(response.status));
  if (!spec) return [`статус ${response.status} не объявлен в ${op.operationId}`];
  const problems: string[] = [];
  const report = (issues: ValidationIssue[]) =>
    problems.push(...issues.map((issue) => `${issue.path || '/'} ${issue.message}`));

  for (const [name, header] of spec.headers) {
    const value = response.headers[name];
    if (value === undefined) continue;
    const issues: ValidationIssue[] = [];
    header.validate(coerce(value, header.type), pointer('/headers', name), issues);
    report(issues);
  }

  if (spec.content.size === 0) {
    if (response.text !== '') problems.push('тело должно быть пустым: content не объявлен');
    return problems;
  }
  const contentType = response.headers['content-type'];
  const media = typeof contentType === 'string' ? contentType.split(';')[0]?.trim().toLowerCase() : undefined;
  if (media === undefined || !spec.content.has(media)) {
    problems.push(`Content-Type ${String(contentType)} не объявлен (ожидается ${[...spec.content.keys()].join(', ')})`);
    return problems;
  }
  const validate = spec.content.get(media);
  if (validate) {
    const issues: ValidationIssue[] = [];
    // JSON-ответ сверяем распарсенным, остальные (text/event-stream) — как текст
    const isJson = media === 'application/json' || media.endsWith('+json');
    validate(isJson ? response.body : response.text, '', issues);
    report(issues);
  }
  return problems;
}
