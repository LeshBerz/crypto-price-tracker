-- 0002: алерты и доставка (расширение, ADR 0010)
CREATE TABLE notification_channels (
  id         INTEGER PRIMARY KEY,
  type       TEXT    NOT NULL CHECK (type IN ('email', 'telegram', 'webhook')),
  name       TEXT    NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 64),
  target     TEXT    NOT NULL CHECK (length(target) BETWEEN 1 AND 2048), -- email / chat_id / https-URL
  secret_enc TEXT,                                                      -- AES-256-GCM, только для webhook
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  CHECK ((type = 'webhook') = (secret_enc IS NOT NULL))
) STRICT;

CREATE TABLE alert_rules (
  id                INTEGER PRIMARY KEY,
  cryptocurrency_id INTEGER NOT NULL REFERENCES cryptocurrencies (id) ON DELETE CASCADE,
  type              TEXT    NOT NULL CHECK (type IN ('price_above', 'price_below', 'change_pct_above')),
  threshold         TEXT    NOT NULL
                    CHECK (threshold GLOB '[0-9]*' AND threshold NOT GLOB '*[^0-9.]*'
                       AND threshold NOT GLOB '*.*.*' AND threshold NOT GLOB '*.'),
  window_minutes    INTEGER CHECK (window_minutes BETWEEN 5 AND 10080),
  cooldown_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 0 AND 10080),
  is_enabled        INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  is_condition_met  INTEGER NOT NULL DEFAULT 0 CHECK (is_condition_met IN (0, 1)),
  last_triggered_at INTEGER,
  created_at        INTEGER NOT NULL CHECK (created_at > 0),
  updated_at        INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK ((type = 'change_pct_above') = (window_minutes IS NOT NULL))
) STRICT;
CREATE INDEX alert_rules_coin ON alert_rules (cryptocurrency_id) WHERE is_enabled = 1;

CREATE TABLE alert_rule_channels (
  alert_rule_id INTEGER NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  channel_id    INTEGER NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
  PRIMARY KEY (alert_rule_id, channel_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE alert_events (
  id            INTEGER PRIMARY KEY,
  alert_rule_id INTEGER NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  price         TEXT    NOT NULL,
  observed      TEXT    NOT NULL, -- значение, сравнённое с порогом: цена или % изменения
  triggered_at  INTEGER NOT NULL CHECK (triggered_at > 0)
) STRICT;
CREATE INDEX alert_events_rule_time ON alert_events (alert_rule_id, triggered_at DESC);

CREATE TABLE alert_deliveries (
  id              INTEGER PRIMARY KEY,
  alert_event_id  INTEGER NOT NULL REFERENCES alert_events (id) ON DELETE CASCADE,
  channel_id      INTEGER NOT NULL REFERENCES notification_channels (id) ON DELETE CASCADE,
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at > 0),
  last_error      TEXT,
  sent_at         INTEGER,
  created_at      INTEGER NOT NULL CHECK (created_at > 0),
  UNIQUE (alert_event_id, channel_id),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
) STRICT;
CREATE INDEX alert_deliveries_due ON alert_deliveries (next_attempt_at) WHERE status = 'pending';
