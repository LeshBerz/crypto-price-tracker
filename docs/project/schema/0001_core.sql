-- 0001: ядро ТЗ — монеты, история цен, свёртки, запуски синхронизации, ключи API
CREATE TABLE cryptocurrencies (
  id              INTEGER PRIMARY KEY,
  cmc_id          INTEGER NOT NULL UNIQUE CHECK (cmc_id > 0),
  symbol          TEXT    NOT NULL UNIQUE
                  CHECK (length(symbol) BETWEEN 1 AND 15 AND symbol NOT GLOB '*[^A-Z0-9]*'),
  name            TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  is_paused       INTEGER NOT NULL DEFAULT 0 CHECK (is_paused IN (0, 1)),
  last_updated_at INTEGER CHECK (last_updated_at > 0),
  created_at      INTEGER NOT NULL CHECK (created_at > 0),
  updated_at      INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE sync_runs (
  id              INTEGER PRIMARY KEY,
  trigger         TEXT    NOT NULL CHECK (trigger IN ('schedule', 'manual', 'startup')),
  status          TEXT    NOT NULL
                  CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'interrupted')),
  started_at      INTEGER NOT NULL CHECK (started_at > 0),
  finished_at     INTEGER CHECK (finished_at >= started_at),
  coins_requested INTEGER NOT NULL DEFAULT 0 CHECK (coins_requested >= 0),
  prices_saved    INTEGER NOT NULL DEFAULT 0 CHECK (prices_saved >= 0),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  credits_used    INTEGER CHECK (credits_used >= 0),
  error_code      TEXT,
  error_message   TEXT,
  CHECK ((status = 'running') = (finished_at IS NULL))
) STRICT;
-- не больше одного запуска одновременно: гарантия на уровне БД (D10)
CREATE UNIQUE INDEX sync_runs_one_running ON sync_runs (status) WHERE status = 'running';
CREATE INDEX sync_runs_started ON sync_runs (started_at DESC);

CREATE TABLE price_history (
  id                INTEGER PRIMARY KEY,
  cryptocurrency_id INTEGER NOT NULL REFERENCES cryptocurrencies (id) ON DELETE CASCADE,
  sync_run_id       INTEGER REFERENCES sync_runs (id) ON DELETE SET NULL,
  price             TEXT    NOT NULL
                    CHECK (price GLOB '[0-9]*' AND price NOT GLOB '*[^0-9.]*'
                       AND price NOT GLOB '*.*.*' AND price NOT GLOB '*.'
                       AND length(price) <= 40 AND CAST(price AS REAL) > 0),
  price_num         REAL    GENERATED ALWAYS AS (CAST(price AS REAL)) VIRTUAL,
  source_updated_at INTEGER NOT NULL CHECK (source_updated_at > 0), -- quote.USD.last_updated из CMC
  fetched_at        INTEGER NOT NULL CHECK (fetched_at > 0),        -- когда мы получили цену (D-2)
  UNIQUE (cryptocurrency_id, source_updated_at)
) STRICT;
CREATE INDEX price_history_coin_time ON price_history (cryptocurrency_id, fetched_at);

CREATE TABLE price_rollups_1h (
  cryptocurrency_id INTEGER NOT NULL REFERENCES cryptocurrencies (id) ON DELETE CASCADE,
  bucket_start      INTEGER NOT NULL CHECK (bucket_start % 3600000 = 0),
  points            INTEGER NOT NULL CHECK (points > 0),
  open              TEXT    NOT NULL,
  close             TEXT    NOT NULL,
  min               TEXT    NOT NULL,
  max               TEXT    NOT NULL,
  min_num           REAL    GENERATED ALWAYS AS (CAST(min AS REAL)) VIRTUAL,
  max_num           REAL    GENERATED ALWAYS AS (CAST(max AS REAL)) VIRTUAL,
  sum_num           REAL    NOT NULL,
  PRIMARY KEY (cryptocurrency_id, bucket_start)
) STRICT, WITHOUT ROWID;

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 64),
  key_prefix   TEXT    NOT NULL UNIQUE CHECK (length(key_prefix) = 12),
  key_hash     TEXT    NOT NULL UNIQUE CHECK (length(key_hash) = 64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  scopes       TEXT    NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
  created_at   INTEGER NOT NULL CHECK (created_at > 0),
  last_used_at INTEGER CHECK (last_used_at >= created_at),
  revoked_at   INTEGER CHECK (revoked_at >= created_at)
) STRICT;
