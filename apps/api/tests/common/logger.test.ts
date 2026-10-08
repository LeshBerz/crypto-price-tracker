import { createJsonLogger, REDACTED, silentLogger, type LogLevel } from '../../src/common/logger.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

function setup(level: LogLevel = 'debug') {
  const lines: string[] = [];
  const logger = createJsonLogger({ level, clock: new FakeClock(), write: (line) => lines.push(line) });
  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, entries };
}

const KEY = 'cpt_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

describe('createJsonLogger', () => {
  it('пишет одну JSON-строку: время из Clock, уровень, сообщение и поля', () => {
    const { logger, entries } = setup();
    logger.info('sync finished', { syncRunId: 7, pricesSaved: 3 });
    expect(entries()).toEqual([
      { time: '2026-10-07T12:00:00.000Z', level: 'info', msg: 'sync finished', syncRunId: 7, pricesSaved: 3 },
    ]);
  });

  it('отбрасывает записи ниже порога', () => {
    const { logger, entries } = setup('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(entries().map((e) => e.level)).toEqual(['warn', 'error']);
  });

  it('child добавляет поля ко всем записям, вложенный child их дополняет', () => {
    const { logger, entries } = setup();
    const request = logger.child({ requestId: 'r-1' });
    request.child({ operationId: 'getLiveness' }).debug('handled', { status: 200 });
    logger.info('root');
    const [first, second] = entries();
    expect(first).toMatchObject({ requestId: 'r-1', operationId: 'getLiveness', status: 200 });
    expect(second).not.toHaveProperty('requestId');
  });

  it('поле не может подменить time, level и msg', () => {
    const { logger, entries } = setup();
    logger.info('real', { msg: 'fake', level: 'error', time: 'never' });
    expect(entries()[0]).toMatchObject({ msg: 'real', level: 'info', _msg: 'fake', _level: 'error', _time: 'never' });
  });

  it('маскирует секреты по имени поля на любой глубине', () => {
    const { logger, lines } = setup();
    logger.info('request', {
      headers: { authorization: 'Bearer x', Cookie: 'sid=1' },
      cmc: { apiKey: 'b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c', baseUrl: 'https://pro-api.coinmarketcap.com' },
      'x-cmc_pro_api_key': 'k',
      password: 'p',
    });
    const entry = JSON.parse(String(lines[0]));
    expect(entry.headers).toEqual({ authorization: REDACTED, Cookie: REDACTED });
    expect(entry.cmc).toEqual({ apiKey: REDACTED, baseUrl: 'https://pro-api.coinmarketcap.com' });
    expect(entry['x-cmc_pro_api_key']).toBe(REDACTED);
    expect(lines[0]).not.toContain('b54bcf4d');
  });

  it('маскирует наш API-ключ по значению, даже в сообщении ошибки', () => {
    const { logger, lines } = setup();
    logger.warn('bad key', { bootstrap: { viewer: KEY }, error: new Error(`rejected ${KEY}`) });
    expect(lines[0]).not.toContain(KEY.slice(4));
    expect(lines[0]).toContain(`cpt_${REDACTED}`);
  });

  it('раскрывает Error с причиной, BigInt — строкой', () => {
    const { logger, entries } = setup();
    const error = new Error('outer', { cause: new TypeError('inner') });
    logger.error('failed', { error, id: 10n });
    const [entry = {}] = entries();
    expect(entry.id).toBe('10');
    expect(entry.error).toMatchObject({
      name: 'Error',
      message: 'outer',
      stack: expect.stringContaining('outer'),
      cause: { name: 'TypeError', message: 'inner' },
    });
  });

  it('не падает на циклах и слишком глубоких объектах; общий объект в двух полях — не цикл', () => {
    const { logger, entries } = setup();
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    const shared = { n: 1 };
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    logger.info('odd', { loop, list: [shared, shared], deep });
    const [entry = {}] = entries();
    expect(entry.loop).toEqual({ name: 'loop', self: '[Circular]' });
    expect(entry.list).toEqual([{ n: 1 }, { n: 1 }]);
    expect(JSON.stringify(entry.deep)).toContain('[Truncated]');
  });

  it('по умолчанию пишет в stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      createJsonLogger({ level: 'info', clock: new FakeClock() }).info('hello');
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^\{.*"msg":"hello".*\}\n$/));
    } finally {
      spy.mockRestore();
    }
  });
});

describe('silentLogger', () => {
  it('ничего не делает и возвращает себя из child', () => {
    expect(() => {
      silentLogger.debug('d');
      silentLogger.info('i');
      silentLogger.warn('w');
      silentLogger.error('e');
    }).not.toThrow();
    expect(silentLogger.child({ a: 1 })).toBe(silentLogger);
  });
});
