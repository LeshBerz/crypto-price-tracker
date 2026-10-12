// Соединение с потоком событий: статус для индикатора, переподключение с растущей задержкой, выход по отзыву сессии.

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

/** События api, на которые подписан экран. `heartbeat` браузеру не нужен: он лишь держит соединение */
export const STREAM_EVENTS = ['price.updated', 'sync.finished', 'watchlist.changed'] as const;

/** Событие от web, а не от api: сессию отозвали или она истекла (ADR 0016, поправка 19) */
export const SESSION_EXPIRED_EVENT = 'session.expired';

export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

/** Задержка перед попыткой номер `attempt` (с нуля): 1, 2, 4 … 30 с */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempt, 10));
}

/** Часть EventSource, которой пользуется соединение: в тестах её заменяет подставной объект */
export type StreamSource = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};

const CLOSED = 2;

export type StreamConnectionOptions = {
  createSource: () => StreamSource;
  onEvent: (name: string, data: string) => void;
  onStatus: (status: StreamStatus) => void;
  /** Поток открылся повторно: пропущенные события не досылаются (ADR 0014) — состояние перечитывается */
  onReopen: () => void;
  /**
   * Браузер прекратил попытки: сервер ответил не потоком (401 — сессии нет, 502 — api недоступен). Вызывающий
   * проверяет причину обычным запросом; соединение тем временем пробует снова.
   */
  onGiveUp: () => void;
  onSessionExpired: () => void;
};

/** Открывает поток и возвращает функцию остановки */
export function connectStream(options: StreamConnectionOptions): () => void {
  let source: StreamSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let openedBefore = false;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    source?.close();
    source = null;
  };

  const open = () => {
    const current = options.createSource();
    source = current;

    current.onopen = () => {
      attempt = 0;
      options.onStatus('open');
      if (openedBefore) options.onReopen();
      openedBefore = true;
    };

    current.onerror = () => {
      if (stopped) return;
      options.onStatus('reconnecting');
      // readyState CONNECTING — обрыв сети: браузер переподключается сам. CLOSED — сервер ответил ошибкой HTTP,
      // и EventSource больше не пробует: новую попытку планирует этот код
      if (current.readyState !== CLOSED) return;
      current.close();
      // После сбоя состояние перечитывается при любом следующем открытии — даже если оно станет первым удачным
      openedBefore = true;
      options.onGiveUp();
      timer = setTimeout(open, reconnectDelay(attempt));
      attempt += 1;
    };

    for (const name of STREAM_EVENTS) {
      current.addEventListener(name, (event) => options.onEvent(name, event.data));
    }
    current.addEventListener(SESSION_EXPIRED_EVENT, () => {
      stop();
      options.onSessionExpired();
    });
  };

  options.onStatus('connecting');
  open();
  return stop;
}
