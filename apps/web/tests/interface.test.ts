// Чистая логика оформления: тон кружка монеты, строка состояния в футере, версия контракта.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { API_CONTRACT_VERSION } from '@/lib/bff-contract';
import { coinHue } from '@/lib/coin-hue';
import type { Degradation } from '@/lib/dashboard/degradation';
import { describeSystemStatus } from '@/lib/dashboard/system-status';

describe('[coinHue] тон кружка монеты', () => {
  it('✅ один символ — один тон; регистр не важен', () => {
    expect(coinHue('BTC')).toBe(coinHue('BTC'));
    expect(coinHue('btc')).toBe(coinHue('BTC'));
  });

  it('✅ тон — целый угол от 0 до 359 для любой строки, включая пустую', () => {
    for (const symbol of ['', 'A', 'BTC', 'ETH', '1INCH', 'A'.repeat(15), 'ё']) {
      const hue = coinHue(symbol);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('✅ похожие символы получают заметно разные тона', () => {
    const distance = (a: string, b: string) => {
      const diff = Math.abs(coinHue(a) - coinHue(b));
      return Math.min(diff, 360 - diff);
    };
    expect(distance('BTC', 'BCH')).toBeGreaterThan(20);
    expect(distance('BTC', 'ETH')).toBeGreaterThan(20);
    expect(distance('ETH', 'ETC')).toBeGreaterThan(20);
  });
});

describe('[describeSystemStatus] строка состояния в футере', () => {
  const status = (degradation: Degradation | null, hasData = true, isError = false) =>
    describeSystemStatus({ hasData, isError, degradation });

  it('✅ данных ещё нет — «проверка», а не «в норме»', () => {
    expect(status(null, false)).toEqual({ tone: 'unknown', text: 'Проверка состояния…' });
  });

  it('❌ первая загрузка не удалась — нет связи', () => {
    expect(status(null, false, true)).toEqual({ tone: 'down', text: 'Нет связи с API' });
  });

  it('✅ замечаний нет — в норме', () => {
    expect(status(null)).toEqual({ tone: 'ok', text: 'Система в норме' });
  });

  it.each<[Degradation, string, string]>([
    [{ kind: 'api-unavailable', shownAt: 0, requestId: null }, 'down', 'Нет связи с API'],
    [{ kind: 'stale', staleCount: 1, all: true, sourceFailed: false, lastFetchedAt: null }, 'warn', 'Цены устарели'],
    [{ kind: 'partial', staleCount: 1 }, 'warn', 'Синхронизация прошла частично'],
    [
      { kind: 'sync-failed', status: 'failed', finishedAt: null, lastFetchedAt: null },
      'warn',
      'Последняя синхронизация не удалась',
    ],
    [{ kind: 'stream-offline' }, 'warn', 'Нет обновлений в реальном времени'],
  ])('❌ деградация %j → %s', (degradation, tone, text) => {
    expect(status(degradation)).toEqual({ tone, text });
  });
});

describe('[contract] версия api в футере', () => {
  it('✅ совпадает с info.version спецификации', () => {
    const spec = parse(readFileSync(join(__dirname, '../../api/openapi/openapi.yaml'), 'utf8')) as {
      info: { version: string };
    };
    expect(API_CONTRACT_VERSION).toBe(spec.info.version);
  });
});
