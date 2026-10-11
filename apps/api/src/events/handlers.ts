// HTTP-хендлер потока событий: отправляет заголовки text/event-stream и передаёт соединение хабу.
import type { Handlers } from '../http/router.ts';
import { RESPONDED } from '../http/router.ts';
import type { SseHub } from './sse-hub.ts';

export type StreamHandlersDeps = { sse: SseHub };

export function streamHandlers({ sse }: StreamHandlersDeps): Pick<Handlers, 'streamEvents'> {
  return {
    streamEvents: ({ res }) => {
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform: прокси не сжимает и не склеивает кадры; X-Accel-Buffering — то же для nginx
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      // Без этого заголовки ушли бы только с первым событием, а клиент ждал бы «открытия» потока
      res.flushHeaders();
      sse.add(res);
      return RESPONDED;
    },
  };
}
