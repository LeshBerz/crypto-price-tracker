// Строка «состояние системы» в футере: итог одним словом, подробности — на дашборде и в разделе «Система».
import type { Degradation } from './degradation';

export type SystemTone = 'ok' | 'warn' | 'down' | 'unknown';
export type SystemStatus = { tone: SystemTone; text: string };

/**
 * Состояние выводится из тех же данных, что и баннер дашборда (`detectDegradation`): отдельного запроса нет,
 * поэтому строка доступна любой роли — у Viewer нет прав на `/system/cmc` и `/health/ready` (ADR 0017).
 */
export function describeSystemStatus(input: {
  hasData: boolean;
  isError: boolean;
  degradation: Degradation | null;
}): SystemStatus {
  if (!input.hasData) {
    return input.isError ? { tone: 'down', text: 'Нет связи с API' } : { tone: 'unknown', text: 'Проверка состояния…' };
  }
  switch (input.degradation?.kind) {
    case undefined:
      return { tone: 'ok', text: 'Система в норме' };
    case 'api-unavailable':
      return { tone: 'down', text: 'Нет связи с API' };
    case 'stale':
      return { tone: 'warn', text: 'Цены устарели' };
    case 'partial':
      return { tone: 'warn', text: 'Синхронизация прошла частично' };
    case 'sync-failed':
      return { tone: 'warn', text: 'Последняя синхронизация не удалась' };
    case 'stream-offline':
      return { tone: 'warn', text: 'Нет обновлений в реальном времени' };
  }
}
