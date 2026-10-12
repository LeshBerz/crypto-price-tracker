// Наполнение истории цен для проверки графика карточки монеты. Только для локальной разработки.
//
// CoinMarketCap на тарифе Basic не отдаёт прошлые цены, а стаб отдаёт одну и ту же котировку: история в БД api
// не растёт, и свечи нарисовать не из чего. Скрипт дописывает перед самой ранней точкой каждой монеты случайное
// блуждание цены, которое заканчивается на её настоящей цене.
//
//   node apps/web/scripts/seed-price-history.ts --db <файл БД api> [--days 30] [--step-min 5]
//   DATABASE_PATH=<тот же файл> npm run rollups:rebuild -w @cpt/api     — пересобрать часовые свёртки
//
// Скрипт пишет в таблицу `price_history` напрямую и поэтому знает её схему: это связность с api, допустимая
// только в инструменте разработки. В образ и в CI он не входит; api на время записи лучше остановить.
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    days: { type: 'string', default: '30' },
    'step-min': { type: 'string', default: '5' },
  },
});

const days = Number(values.days);
const stepMs = Number(values['step-min']) * 60_000;
if (!values.db || !(days > 0) || !(stepMs > 0)) {
  process.stderr.write('Использование: seed-price-history.ts --db <файл БД api> [--days 30] [--step-min 5]\n');
  process.exit(1);
}

const HOUR = 3_600_000;
/** Между получением цены и временем котировки CMC — около 40 с, как в настоящих данных */
const SOURCE_LAG_MS = 41_000;

/** Генератор с зерном: повторный запуск на той же БД даёт те же точки */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Десятичная строка с 12 значащими цифрами без экспоненты — формат колонки `price` */
function toDecimal(value: number): string {
  const digits = Math.min(30, Math.max(2, 11 - Math.floor(Math.log10(value))));
  const text = value.toFixed(digits);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

type CoinRow = { id: number; symbol: string; price: string | null; earliest: number | null };

const db = new DatabaseSync(values.db);
db.exec('PRAGMA foreign_keys = ON');
const coins = db
  .prepare(
    `SELECT c.id, c.symbol,
            (SELECT h.price FROM price_history h WHERE h.cryptocurrency_id = c.id
              ORDER BY h.fetched_at DESC LIMIT 1) AS price,
            (SELECT min(h.fetched_at) FROM price_history h WHERE h.cryptocurrency_id = c.id) AS earliest
       FROM cryptocurrencies c ORDER BY c.id`,
  )
  .all() as CoinRow[];

const insert = db.prepare(
  `INSERT OR IGNORE INTO price_history (cryptocurrency_id, sync_run_id, price, source_updated_at, fetched_at)
   VALUES (?, NULL, ?, ?, ?)`,
);
const backdate = db.prepare('UPDATE cryptocurrencies SET created_at = min(created_at, ?) WHERE id = ?');

db.exec('BEGIN');
for (const coin of coins) {
  if (coin.price === null || coin.earliest === null) {
    process.stdout.write(`${coin.symbol}: цены ещё нет — пропущена (нужна хотя бы одна синхронизация)\n`);
    continue;
  }
  const random = mulberry32(coin.id);
  const count = Math.floor((days * 24 * HOUR) / stepMs);
  // Пропуск в данных: пять часов без точек трое суток назад — на графике это пустой промежуток
  const gapEnd = coin.earliest - 3 * 24 * HOUR;
  const gapStart = gapEnd - 5 * HOUR;
  let price = Number(coin.price);
  let saved = 0;
  let fetchedAt = coin.earliest;
  for (let index = 0; index < count; index += 1) {
    fetchedAt -= stepMs;
    price *= 1 + (random() - 0.5) * 0.004;
    if (fetchedAt >= gapStart && fetchedAt < gapEnd) continue;
    saved += Number(insert.run(coin.id, toDecimal(price), fetchedAt - SOURCE_LAG_MS, fetchedAt).changes);
  }
  backdate.run(fetchedAt, coin.id);
  process.stdout.write(`${coin.symbol}: добавлено точек — ${saved}\n`);
}
db.exec('COMMIT');
db.close();
process.stdout.write('Готово. Пересоберите свёртки: npm run rollups:rebuild -w @cpt/api (с тем же DATABASE_PATH)\n');
