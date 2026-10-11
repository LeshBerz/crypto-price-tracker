-- web 0001: пользователи и серверные сессии (ADR 0016). Отдельная БД web (web.db), не api.
CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  login               TEXT    NOT NULL UNIQUE
                      CHECK (length(login) BETWEEN 3 AND 32 AND login NOT GLOB '*[^a-z0-9._-]*'),
  password_hash       TEXT    NOT NULL CHECK (password_hash GLOB 'scrypt$*'),
  role                TEXT    NOT NULL CHECK (role IN ('viewer', 'operator')),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          INTEGER NOT NULL CHECK (created_at > 0),
  updated_at          INTEGER NOT NULL CHECK (updated_at >= created_at),
  password_changed_at INTEGER NOT NULL CHECK (password_changed_at > 0),
  last_login_at       INTEGER,
  -- гид по интерфейсу пройден: отметка на пользователя, а не на браузер (ADR 0018)
  onboarding_completed_at INTEGER CHECK (onboarding_completed_at > 0)
) STRICT;

CREATE TABLE sessions (
  token_hash       TEXT    PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  user_id          INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at       INTEGER NOT NULL CHECK (created_at > 0),
  last_seen_at     INTEGER NOT NULL CHECK (last_seen_at >= created_at),
  idle_expires_at  INTEGER NOT NULL CHECK (idle_expires_at > last_seen_at),
  absolute_expires_at INTEGER NOT NULL CHECK (absolute_expires_at > created_at),
  revoked_at       INTEGER CHECK (revoked_at >= created_at),
  revoke_reason    TEXT    CHECK (revoke_reason IN ('logout', 'logout_all', 'admin', 'password_changed', 'user_disabled')),
  ip               TEXT    CHECK (length(ip) <= 45),
  user_agent       TEXT    CHECK (length(user_agent) <= 512),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
) STRICT, WITHOUT ROWID;
CREATE INDEX sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;

-- неудачные попытки входа: прогрессивная задержка по (login, ip), а не блокировка аккаунта
CREATE TABLE login_attempts (
  login        TEXT    NOT NULL,
  ip           TEXT    NOT NULL,
  failures     INTEGER NOT NULL CHECK (failures > 0),
  last_failure INTEGER NOT NULL CHECK (last_failure > 0),
  PRIMARY KEY (login, ip)
) STRICT, WITHOUT ROWID;
