// Текст совпадает с docs/project/schema/web_0004_tours.sql — это проверяет тест миграций.
export const TOURS_0004 = `-- web 0004: отметки гида по экранам (ADR 0018, поправка от 12.10.2026). Строка — тур, который пользователь прошёл
-- или пропустил: при первом открытии экрана гид запускается сам, после отметки — только по кнопке.
CREATE TABLE user_tours (
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tour         TEXT    NOT NULL CHECK (tour IN ('dashboard', 'coin', 'operator')),
  completed_at INTEGER NOT NULL CHECK (completed_at > 0),
  PRIMARY KEY (user_id, tour)
) STRICT, WITHOUT ROWID;

-- одна отметка на пользователя заменена таблицей; колонка из миграции 0001 ни разу не заполнялась
ALTER TABLE users DROP COLUMN onboarding_completed_at;
`;
