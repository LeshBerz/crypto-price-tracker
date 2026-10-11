// Выполняется один раз при старте сервера Next. Код старта лежит в отдельном модуле и подключается только в рантайме
// Node.js: сборка проверяет этот файл и для Edge, где нет ни process.exit, ни node:sqlite.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startServer } = await import('./server/startup');
  startServer();
}
