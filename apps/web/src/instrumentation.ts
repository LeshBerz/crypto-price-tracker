// Выполняется один раз при старте сервера Next. Открывает БД сразу (ошибка конфига или миграции видна при запуске,
// а не на первом входе) и раз в час удаляет истёкшие сессии и старые записи о неудачных входах (ADR 0016).
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getServices } = await import('./server/container');
  let services: ReturnType<typeof getServices>;
  try {
    services = getServices();
  } catch (error) {
    // Next после ошибки в register() продолжает слушать порт и отвечает 500 на каждый запрос (проверено на
    // standalone-сервере). Явный выход — чтобы ошибка конфига или миграции останавливала старт, а не пряталась в логе
    console.error(`web не запущен: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const cleanup = () => {
    services.sessions.purgeExpired();
    services.throttle.purgeStale(services.now());
  };
  cleanup();
  // unref: таймер не удерживает процесс при остановке
  setInterval(cleanup, CLEANUP_INTERVAL_MS).unref();
}
