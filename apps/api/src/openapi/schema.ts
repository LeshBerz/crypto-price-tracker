// Компилятор подмножества JSON Schema из OpenAPI 3.0.3 (ADR 0008 + поправка ADR 0014).
// ajv нельзя (C7), поэтому свой интерпретатор: схемы из спеки один раз при старте превращаются в функции,
// на запросе выполняется только готовая функция. Неизвестное ключевое слово — ошибка старта (fail-fast):
// спека не может обещать проверку, которой код не делает.

export type ValidationIssue = { path: string; message: string };
/** Проверяет value и дописывает найденные ошибки в issues. path — JSON Pointer места в запросе: /body/symbol */
export type Validator = (value: unknown, path: string, issues: ValidationIssue[]) => void;

/** Спека не годится для компиляции. Бросается только при старте, location — где именно в спеке */
export class SpecError extends Error {
  override name = 'SpecError';
}

export type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
const TYPES: readonly SchemaType[] = ['string', 'integer', 'number', 'boolean', 'object', 'array'];

// Какие ключевые слова имеют смысл для какого type. Слово «не по типу» — почти всегда опечатка в спеке
const KEYWORDS_BY_TYPE: Record<SchemaType, readonly string[]> = {
  string: ['pattern', 'minLength', 'maxLength', 'format'],
  integer: ['minimum', 'maximum'],
  number: ['minimum', 'maximum'],
  boolean: [],
  object: ['properties', 'required', 'additionalProperties', 'minProperties'],
  array: ['items', 'minItems', 'maxItems'],
};
const COMMON_KEYWORDS = ['type', 'nullable', 'enum', 'allOf', 'default'];
const ANNOTATIONS = new Set(['description', 'example', 'title']);
const SUPPORTED = new Set([...COMMON_KEYWORDS, ...Object.values(KEYWORDS_BY_TYPE).flat()]);
const SCHEMA_REF = /^#\/components\/schemas\/([A-Za-z0-9._-]+)$/;

export type CompileOptions = {
  /** default разрешён только в корне схемы параметра query/path (поправка ADR 0014) */
  allowDefault?: boolean;
};

export type SchemaCompiler = {
  compile(schema: unknown, location: string, options?: CompileOptions): Validator;
  /** type схемы с учётом $ref — нужен, чтобы привести строку query/path к числу или boolean */
  typeOf(schema: unknown, location: string): SchemaType | undefined;
};

type Json = Record<string, unknown>;

export function isJsonObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Сегмент JSON Pointer (RFC 6901): ~ → ~0, / → ~1 */
export function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function createSchemaCompiler(document: Json): SchemaCompiler {
  const components = isJsonObject(document.components) ? document.components : {};
  const schemas = isJsonObject(components.schemas) ? components.schemas : {};
  const refs = new Map<string, Validator>();

  const resolveRef = (ref: unknown, location: string): { name: string; schema: unknown } => {
    const name = typeof ref === 'string' ? SCHEMA_REF.exec(ref)?.[1] : undefined;
    if (name === undefined || !Object.hasOwn(schemas, name)) {
      throw new SpecError(`${location}: $ref ${JSON.stringify(ref)} не ведёт в #/components/schemas`);
    }
    return { name, schema: schemas[name] };
  };

  const compileRef = (ref: unknown, location: string): Validator => {
    const { name, schema } = resolveRef(ref, location);
    const cached = refs.get(name);
    if (cached) return cached;
    // Заглушка до компиляции: рекурсивная схема сошлётся на неё, а не уйдёт в бесконечную рекурсию
    const slot: { validate?: Validator } = {};
    refs.set(name, (value, path, issues) => (slot.validate as Validator)(value, path, issues));
    slot.validate = compileNode(schema, `#/components/schemas/${name}`, false);
    refs.set(name, slot.validate);
    return slot.validate;
  };

  const compileNode = (schema: unknown, location: string, allowDefault: boolean): Validator => {
    if (!isJsonObject(schema)) throw new SpecError(`${location}: схема должна быть объектом`);
    const keys = Object.keys(schema).filter((key) => !ANNOTATIONS.has(key));

    if (keys.includes('$ref')) {
      // В OpenAPI 3.0 соседи $ref игнорируются. Молча игнорировать — значит обещать проверку, которой нет
      if (keys.length > 1) throw new SpecError(`${location}: рядом с $ref не должно быть других ключевых слов`);
      return compileRef(schema.$ref, location);
    }
    for (const key of keys) {
      if (!SUPPORTED.has(key)) {
        throw new SpecError(`${location}: ключевое слово "${key}" не поддерживается валидатором (ADR 0008)`);
      }
    }

    const type = schema.type;
    if (type !== undefined && !TYPES.includes(type as SchemaType)) {
      throw new SpecError(`${location}: type должен быть одним из ${TYPES.join(', ')}`);
    }
    const typed = type as SchemaType | undefined;
    for (const key of keys) {
      if (COMMON_KEYWORDS.includes(key)) continue;
      if (typed === undefined || !KEYWORDS_BY_TYPE[typed].includes(key)) {
        throw new SpecError(`${location}: "${key}" неприменимо к type ${typed ?? '(не задан)'}`);
      }
    }
    if (schema.nullable !== undefined) {
      if (typeof schema.nullable !== 'boolean') throw new SpecError(`${location}: nullable должен быть boolean`);
      // OpenAPI 3.0.3: nullable действует, только если в той же схеме задан type (ловушка из ADR 0014)
      if (typed === undefined) throw new SpecError(`${location}: nullable без type не действует в OpenAPI 3.0.3`);
    }
    if (schema.default !== undefined && !allowDefault) {
      throw new SpecError(`${location}: default разрешён только в схеме параметра query/path`);
    }

    const checks: Validator[] = [];
    if (schema.enum !== undefined) checks.push(compileEnum(schema.enum, location));
    if (typed === 'string') checks.push(...compileString(schema, location));
    if (typed === 'integer' || typed === 'number') checks.push(...compileNumber(schema, location));
    if (typed === 'array') checks.push(...compileArray(schema, location));
    if (typed === 'object') checks.push(...compileObject(schema, location));
    if (schema.allOf !== undefined) {
      // Только идиома 3.0 «{ type, nullable: true, allOf: [$ref] }»: ровно один элемент (поправка ADR 0014)
      if (!Array.isArray(schema.allOf) || schema.allOf.length !== 1) {
        throw new SpecError(`${location}: allOf поддерживается только из одного элемента`);
      }
      checks.push(compileNode(schema.allOf[0], `${location}/allOf/0`, false));
    }

    const nullable = schema.nullable === true;
    const validate: Validator = (value, path, issues) => {
      // nullable: null проходит сразу, не доходя до allOf — так «$ref + nullable» означает «T | null»
      if (value === null && nullable) return;
      if (typed !== undefined && !hasType(value, typed)) {
        issues.push({ path, message: typeMessage(value, typed) });
        return;
      }
      for (const check of checks) check(value, path, issues);
    };

    if (schema.default !== undefined) {
      const issues: ValidationIssue[] = [];
      validate(schema.default, '', issues);
      if (issues.length > 0) throw new SpecError(`${location}: default не проходит собственную схему`);
    }
    return validate;
  };

  const compileObject = (schema: Json, location: string): Validator[] => {
    if (schema.allOf !== undefined) {
      // Обёртка «{ type: object, nullable: true, allOf: [$ref] }»: вся структура — в $ref, рядом ей не место
      if (['properties', 'required', 'additionalProperties', 'minProperties'].some((key) => key in schema)) {
        throw new SpecError(`${location}: объект с allOf описывается только через allOf`);
      }
      return [];
    }
    // Открытый объект — дыра для mass assignment: лишние поля прошли бы в обработчик (ADR 0008)
    if (schema.additionalProperties !== false) {
      throw new SpecError(`${location}: у объекта должно быть additionalProperties: false`);
    }
    const properties = schema.properties ?? {};
    if (!isJsonObject(properties)) throw new SpecError(`${location}: properties должен быть объектом`);
    const compiled = Object.entries(properties).map(
      ([key, sub]) => [key, compileNode(sub, pointer(`${location}/properties`, key), false)] as const,
    );
    const known = new Set(Object.keys(properties));

    const required = schema.required ?? [];
    if (!Array.isArray(required) || !required.every((key) => typeof key === 'string' && known.has(key))) {
      throw new SpecError(`${location}: required должен перечислять поля из properties`);
    }
    const minProperties = schema.minProperties;
    if (minProperties !== undefined) assertCount(minProperties, 'minProperties', location);

    const checks: Validator[] = [
      (value, path, issues) => {
        const object = value as Json;
        for (const key of required as string[]) {
          if (!Object.hasOwn(object, key)) issues.push({ path: pointer(path, key), message: 'is required' });
        }
        // Object.keys видит и "__proto__" из JSON.parse: он не в properties → отклоняется
        for (const key of Object.keys(object)) {
          if (!known.has(key)) issues.push({ path: pointer(path, key), message: 'is not allowed' });
        }
        for (const [key, validate] of compiled) {
          if (Object.hasOwn(object, key)) validate(object[key], pointer(path, key), issues);
        }
      },
    ];
    if (typeof minProperties === 'number') {
      checks.push((value, path, issues) => {
        if (Object.keys(value as Json).length < minProperties) {
          issues.push({ path, message: `must NOT have fewer than ${minProperties} properties` });
        }
      });
    }
    return checks;
  };

  const compileArray = (schema: Json, location: string): Validator[] => {
    if (schema.items === undefined) throw new SpecError(`${location}: у массива должна быть схема items`);
    const item = compileNode(schema.items, `${location}/items`, false);
    const checks: Validator[] = [
      (value, path, issues) => (value as unknown[]).forEach((element, i) => item(element, pointer(path, i), issues)),
    ];
    const { minItems, maxItems } = schema;
    if (minItems !== undefined) {
      assertCount(minItems, 'minItems', location);
      checks.push((value, path, issues) => {
        if ((value as unknown[]).length < minItems) {
          issues.push({ path, message: `must NOT have fewer than ${minItems} items` });
        }
      });
    }
    if (maxItems !== undefined) {
      assertCount(maxItems, 'maxItems', location);
      checks.push((value, path, issues) => {
        if ((value as unknown[]).length > maxItems) {
          issues.push({ path, message: `must NOT have more than ${maxItems} items` });
        }
      });
    }
    return checks;
  };

  const typeOf = (schema: unknown, location: string): SchemaType | undefined => {
    if (!isJsonObject(schema)) return undefined;
    if (schema.$ref !== undefined) return typeOf(resolveRef(schema.$ref, location).schema, location);
    return schema.type as SchemaType | undefined;
  };

  return {
    compile: (schema, location, options = {}) => compileNode(schema, location, options.allowDefault ?? false),
    typeOf,
  };
}

function compileEnum(values: unknown, location: string): Validator {
  const primitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  if (!Array.isArray(values) || values.length === 0 || !values.every(primitive)) {
    throw new SpecError(`${location}: enum должен быть непустым массивом примитивов`);
  }
  const message = `must be one of: ${values.map(String).join(', ')}`;
  return (value, path, issues) => {
    if (!values.includes(value)) issues.push({ path, message });
  };
}

function compileString(schema: Json, location: string): Validator[] {
  const checks: Validator[] = [];
  const { minLength, maxLength, pattern, format } = schema;
  if (minLength !== undefined) {
    assertCount(minLength, 'minLength', location);
    checks.push((value, path, issues) => {
      if (codePoints(value as string) < minLength) {
        issues.push({ path, message: `must NOT have fewer than ${minLength} characters` });
      }
    });
  }
  if (maxLength !== undefined) {
    assertCount(maxLength, 'maxLength', location);
    checks.push((value, path, issues) => {
      if (codePoints(value as string) > maxLength) {
        issues.push({ path, message: `must NOT have more than ${maxLength} characters` });
      }
    });
  }
  if (pattern !== undefined) {
    let regex: RegExp;
    try {
      // Флаг u: паттерны JSON Schema — ECMA-262 с Unicode (\S, \p{…}); без якорей ищется вхождение
      regex = new RegExp(String(pattern), 'u');
    } catch {
      throw new SpecError(`${location}: pattern не компилируется как регулярное выражение`);
    }
    checks.push((value, path, issues) => {
      if (!regex.test(value as string)) issues.push({ path, message: `must match pattern ${String(pattern)}` });
    });
  }
  if (format !== undefined) {
    if (format !== 'date-time') throw new SpecError(`${location}: format "${String(format)}" не поддерживается`);
    checks.push((value, path, issues) => {
      if (!isDateTime(value as string)) {
        issues.push({ path, message: 'must be a date-time (RFC 3339) with a time zone: Z or ±hh:mm' });
      }
    });
  }
  return checks;
}

function compileNumber(schema: Json, location: string): Validator[] {
  const checks: Validator[] = [];
  const { minimum, maximum } = schema;
  if (minimum !== undefined) {
    if (typeof minimum !== 'number') throw new SpecError(`${location}: minimum должен быть числом`);
    checks.push((value, path, issues) => {
      if ((value as number) < minimum) issues.push({ path, message: `must be >= ${minimum}` });
    });
  }
  if (maximum !== undefined) {
    if (typeof maximum !== 'number') throw new SpecError(`${location}: maximum должен быть числом`);
    checks.push((value, path, issues) => {
      if ((value as number) > maximum) issues.push({ path, message: `must be <= ${maximum}` });
    });
  }
  return checks;
}

function assertCount(value: unknown, keyword: string, location: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SpecError(`${location}: ${keyword} должен быть неотрицательным целым`);
  }
}

function hasType(value: unknown, type: SchemaType): boolean {
  switch (type) {
    case 'integer':
      // Только безопасные целые: 2^53 + 1 после JSON.parse уже не то число, что прислал клиент
      return Number.isSafeInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'object':
      return isJsonObject(value);
    case 'array':
      return Array.isArray(value);
    default:
      return typeof value === type;
  }
}

function typeMessage(value: unknown, type: SchemaType): string {
  if (type === 'integer' && Number.isInteger(value)) return 'must be a safe integer (|n| <= 2^53 - 1)';
  return `must be ${type}`;
}

/** Длина строки в символах Unicode, как в JSON Schema, а не в UTF-16 code units ('₿'.length = 1, '𝔹'.length = 2) */
function codePoints(text: string): number {
  let count = 0;
  for (const _char of text) count++;
  return count;
}

// RFC 3339 date-time: зона обязательна. «Голое» 2026-10-06T12:00:00 неоднозначно — чьё это 12:00?
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Проверка date-time по RFC 3339 §5.6 с проверкой календаря (31.02 — ошибка).
 * Секунда координации :60 отклоняется: JS Date её не представляет, а на входе API она не нужна.
 */
export function isDateTime(text: string): boolean {
  const match = DATE_TIME.exec(text);
  if (!match) return false;
  const part = (i: number) => Number(match[i]);
  const [year, month, day, hour, minute, second] = [part(1), part(2), part(3), part(4), part(5), part(6)];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (days === undefined || day < 1 || day > days) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[7] !== undefined && (part(7) > 23 || part(8) > 59)) return false;
  return true;
}

/**
 * Приведение строки из query/path к типу схемы (ADR 0008): "10" → 10 для integer.
 * Строгое: "010", "1e3", "+1", " 1" не приводятся и дальше не пройдут проверку типа с понятной ошибкой.
 */
export function coerce(raw: unknown, type: SchemaType | undefined): unknown {
  if (typeof raw !== 'string') return raw;
  switch (type) {
    case 'integer':
      return /^-?(0|[1-9]\d*)$/.test(raw) ? Number(raw) : raw;
    case 'number':
      return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : raw;
    default:
      return raw;
  }
}
