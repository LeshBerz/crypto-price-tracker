// Порт Clock (ADR 0015): всё время и все ожидания в приложении идут через него.
// Fake timers Jest не подменяют node:timers/promises (ADR 0009), поэтому тесты подставляют FakeClock,
// а этот файл — единственное место, где разрешён Date.now (исключение в eslint.config.js).

export interface Clock {
  /** Текущее время, epoch ms UTC */
  now(): number;
  /** Ждать ms миллисекунд. Отмена через signal отклоняет промис с signal.reason */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
