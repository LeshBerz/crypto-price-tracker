// Точка входа стаба CoinMarketCap для docker compose (ADR 0009): node cmc-stub-server.ts.
// Сам стаб — cmc-stub.ts; он же используется в тестах, поэтому запуск вынесен в отдельный файл.
import { startCmcStub, STUB_API_KEY } from './cmc-stub.ts';

const port = Number(process.env['PORT'] ?? 4010);
const stub = await startCmcStub({ port, host: '0.0.0.0', apiKey: process.env['CMC_API_KEY'] ?? STUB_API_KEY });
process.stdout.write(`cmc-stub listening on ${port}\n`);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void stub.close().then(() => process.exit(0));
  });
}
