// Логгер-шпион: настоящий JSON-логгер, но строки копятся в массиве — тест читает их как объекты.
import { createJsonLogger, type Logger } from '../../src/common/logger.ts';
import type { Clock } from '../../src/common/clock.ts';
import { FakeClock } from './fake-clock.ts';

export type LogEntry = { level: string; msg: string; [field: string]: unknown };

export function createSpyLogger(clock: Clock = new FakeClock()): { logger: Logger; entries: () => LogEntry[] } {
  const lines: string[] = [];
  const logger = createJsonLogger({ level: 'debug', clock, write: (line) => lines.push(line) });
  return { logger, entries: () => lines.map((line) => JSON.parse(line) as LogEntry) };
}
