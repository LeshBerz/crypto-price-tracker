// SSE-хаб (ADR 0015 §3, §5): подписчик шины, который рассылает события всем открытым потокам /stream.
// Хаб знает только про Writable — про Express и HTTP он не знает, поэтому тестируется на обычном потоке.
// Аналог в Nest — @Sse() с Observable; здесь вместо RxJS — Set соединений и цикл heartbeat на Clock.
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { Clock } from '../common/clock.ts';
import type { Logger } from '../common/logger.ts';
import type { AppEvent, AppEventType, EventBus } from './event-bus.ts';

/** Контракт streamEvents: heartbeat каждые 25 с — прокси не закрывает «молчащее» соединение */
export const HEARTBEAT_MS = 25_000;
/** Клиент, который не читает поток, копит наши записи в памяти процесса: после порога отключаем его */
export const MAX_BUFFERED_BYTES = 1_048_576;

const STREAMED = ['price.updated', 'sync.finished', 'watchlist.changed'] as const satisfies readonly AppEventType[];

export type SseHubDeps = { events: EventBus; clock: Clock; logger: Logger };

/** Кадр SSE. JSON.stringify не даёт переводов строк, поэтому data всегда умещается в одну строку */
export function formatSse(event: string, data: unknown, id: string): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Данные события ровно по таблице контракта: syncRunId у price.updated — внутреннее поле шины */
function toStreamData(event: AppEvent): unknown {
  if (event.type !== 'price.updated') return event.payload;
  const { cryptocurrencyId, symbol, price, currency, sourceUpdatedAt, fetchedAt } = event.payload;
  return { cryptocurrencyId, symbol, price, currency, sourceUpdatedAt, fetchedAt };
}

export class SseHub {
  private readonly deps: SseHubDeps;
  private readonly clients = new Set<Writable>();
  private readonly unsubscribe: (() => void)[];
  /** Ожидание следующего heartbeat можно прервать; цикл идёт, только пока есть клиенты */
  private heartbeat: AbortController | null = null;
  private closed = false;

  constructor(deps: SseHubDeps) {
    this.deps = deps;
    this.unsubscribe = STREAMED.map((type) =>
      deps.events.subscribe(type, (event) => this.broadcast(formatSse(event.type, toStreamData(event), event.id))),
    );
  }

  get size(): number {
    return this.clients.size;
  }

  /** Заголовки ответа уже отправлены хендлером. После closeAll новый клиент сразу получает shutdown */
  add(stream: Writable): void {
    if (this.closed) {
      stream.end(formatSse('shutdown', {}, randomUUID()));
      return;
    }
    this.clients.add(stream);
    // 'close' приходит и при обрыве клиентом, и после нашего end()/destroy()
    stream.once('close', () => this.remove(stream));
    // Комментарий SSE: клиент и прокси сразу видят первые байты тела
    stream.write(': connected\n\n');
    if (!this.heartbeat) {
      this.heartbeat = new AbortController();
      void this.beat(this.heartbeat.signal);
    }
  }

  /** Остановка процесса (ADR 0015 §5, шаг 3): клиент получает shutdown и переподключается, а не ждёт таймаута */
  closeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.unsubscribe) off();
    const frame = formatSse('shutdown', {}, randomUUID());
    for (const client of [...this.clients]) {
      this.remove(client);
      client.end(frame);
    }
  }

  private remove(stream: Writable): void {
    this.clients.delete(stream);
    if (this.clients.size === 0) {
      this.heartbeat?.abort(new Error('no sse clients'));
      this.heartbeat = null;
    }
  }

  private broadcast(frame: string): void {
    for (const client of [...this.clients]) {
      if (client.writableLength > MAX_BUFFERED_BYTES) {
        this.deps.logger.warn('sse client dropped: not reading', { bufferedBytes: client.writableLength });
        this.remove(client);
        client.destroy();
        continue;
      }
      client.write(frame);
    }
  }

  private async beat(signal: AbortSignal): Promise<void> {
    for (;;) {
      try {
        await this.deps.clock.sleep(HEARTBEAT_MS, signal);
      } catch {
        return;
      }
      this.broadcast(formatSse('heartbeat', {}, randomUUID()));
    }
  }
}
