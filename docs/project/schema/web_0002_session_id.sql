-- web 0002: открытый идентификатор сессии (ADR 0016, поправка 27). Первичный ключ сессии — SHA-256 токена:
-- это проверочное значение, наружу оно не выдаётся. Экранам «Сессии» нужен идентификатор, по которому сессию
-- можно отозвать, — отдельное случайное значение, никак не связанное с токеном.
ALTER TABLE sessions ADD COLUMN public_id TEXT
  CHECK (length(public_id) = 32 AND public_id NOT GLOB '*[^0-9a-f]*');
-- сессии, созданные до миграции, получают идентификатор здесь; новые — при создании
UPDATE sessions SET public_id = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX sessions_public_id ON sessions (public_id);
