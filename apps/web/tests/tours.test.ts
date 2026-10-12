// Отметки гида по экранам: миграция 0004, репозиторий и маршруты /api/me/tours (ADR 0018).
import { createAccountClient } from '@/lib/account/client';
import { TOUR_IDS, TOUR_ROLE } from '@/lib/account/contract';
import { handleCompleteTour, handleResetTours } from '@/server/account-http';
import { migrate, MIGRATIONS, openDatabase } from '@/server/db';
import { isTourId } from '@/server/tours';
import { createTestContext, START, type TestContext } from './helpers';

const ORIGIN = 'http://localhost:3001';
const PASSWORD = 'correct horse battery';
const META = { ip: null, userAgent: null };

type Init = { token?: string; origin?: string | null };

function request(method: string, path: string, { token, origin = ORIGIN }: Init = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      host: 'localhost:3001',
      ...(origin ? { origin } : {}),
      ...(token ? { cookie: `cpt_session=${token}` } : {}),
    },
  });
}

const slug = async (response: Response) =>
  ((await response.json()) as { type: string }).type.replace('urn:cpt:web:problem:', '');

describe('отметки гида', () => {
  let ctx: TestContext;
  let operatorId: number;
  let viewerId: number;
  let operator: string;
  let viewer: string;

  beforeEach(async () => {
    ctx = createTestContext();
    operatorId = await ctx.addUser('alice', PASSWORD, 'operator');
    viewerId = await ctx.addUser('bob', PASSWORD, 'viewer');
    operator = ctx.sessions.create(operatorId, META).token;
    viewer = ctx.sessions.create(viewerId, META).token;
  });

  const complete = (tour: string, init?: Init) =>
    handleCompleteTour(request('PUT', `/api/me/tours/${tour}`, init), ctx, tour);
  const reset = (init?: Init) => handleResetTours(request('DELETE', '/api/me/tours', init), ctx);

  describe('[TourRepository] хранение', () => {
    it('✅ у нового пользователя отметок нет', () => {
      expect(ctx.tours.completed(viewerId)).toEqual([]);
    });

    it('✅ отметка идемпотентна: повтор не меняет время первой', () => {
      ctx.tours.complete(viewerId, 'dashboard', START);
      ctx.tours.complete(viewerId, 'dashboard', START + 5000);
      expect(ctx.db.prepare('SELECT tour, completed_at FROM user_tours').all()).toEqual([
        { tour: 'dashboard', completed_at: START },
      ]);
    });

    it('✅ отметки разных пользователей не пересекаются; сброс снимает только свои', () => {
      ctx.tours.complete(viewerId, 'dashboard', START);
      ctx.tours.complete(viewerId, 'coin', START);
      ctx.tours.complete(operatorId, 'operator', START);
      expect(ctx.tours.completed(viewerId)).toEqual(['coin', 'dashboard']);

      expect(ctx.tours.reset(viewerId)).toBe(2);
      expect(ctx.tours.completed(viewerId)).toEqual([]);
      expect(ctx.tours.completed(operatorId)).toEqual(['operator']);
    });

    it('✅ отметки удаляются вместе с пользователем (ON DELETE CASCADE)', () => {
      ctx.tours.complete(viewerId, 'dashboard', START);
      ctx.db.prepare('DELETE FROM users WHERE id = ?').run(viewerId);
      expect(ctx.db.prepare('SELECT count(*) AS n FROM user_tours').get()).toEqual({ n: 0 });
    });

    it('❌ неизвестный тур отклоняет схема, даже если код его пропустил', () => {
      expect(() =>
        ctx.db
          .prepare("INSERT INTO user_tours (user_id, tour, completed_at) VALUES (?, 'login', ?)")
          .run(viewerId, START),
      ).toThrow(/CHECK/);
    });

    it('✅ список туров в коде совпадает с CHECK в схеме', () => {
      for (const tour of TOUR_IDS) ctx.tours.complete(operatorId, tour, START);
      expect(ctx.tours.completed(operatorId)).toEqual([...TOUR_IDS].sort());
      expect(Object.keys(TOUR_ROLE).sort()).toEqual([...TOUR_IDS].sort());
      expect(isTourId('login')).toBe(false);
    });
  });

  describe('[completeTour] PUT /api/me/tours/{tour}', () => {
    it('✅ 204: отметка записана временем сервера, повтор — тот же ответ', () => {
      const first = complete('dashboard', { token: viewer });
      expect(first.status).toBe(204);
      expect(first.headers.get('cache-control')).toBe('no-store');
      ctx.advance(1000);
      expect(complete('dashboard', { token: viewer }).status).toBe(204);
      expect(ctx.db.prepare('SELECT user_id, tour, completed_at FROM user_tours').all()).toEqual([
        { user_id: viewerId, tour: 'dashboard', completed_at: START },
      ]);
    });

    it('✅ оператор отмечает тур панели оператора', () => {
      expect(complete('operator', { token: operator }).status).toBe(204);
      expect(ctx.tours.completed(operatorId)).toEqual(['operator']);
    });

    it('❌ 401 без сессии — раньше проверки имени тура', async () => {
      const response = complete('no-such-tour');
      expect(response.status).toBe(401);
      expect(await slug(response)).toBe('unauthorized');
    });

    it('❌ 404: тура с таким именем нет', async () => {
      for (const tour of ['login', 'DASHBOARD', '', 'dashboard/coin']) {
        const response = complete(tour, { token: viewer });
        expect(response.status).toBe(404);
        expect(await slug(response)).toBe('not-found');
      }
      expect(ctx.tours.completed(viewerId)).toEqual([]);
    });

    it('❌ 403 forbidden: Viewer не отмечает тур панели оператора', async () => {
      const response = complete('operator', { token: viewer });
      expect(response.status).toBe(403);
      expect(await slug(response)).toBe('forbidden');
      expect(ctx.tours.completed(viewerId)).toEqual([]);
    });

    it('❌ 403 forbidden-origin: запрос с чужого сайта отметку не ставит', async () => {
      for (const origin of ['https://evil.example', null]) {
        const response = complete('dashboard', { token: viewer, origin });
        expect(response.status).toBe(403);
        expect(await slug(response)).toBe('forbidden-origin');
      }
      expect(ctx.tours.completed(viewerId)).toEqual([]);
    });

    it('❌ 403 password-change-required: с временным паролем гид не отмечается', async () => {
      ctx.db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(viewerId);
      const response = complete('dashboard', { token: viewer });
      expect(response.status).toBe(403);
      expect(await slug(response)).toBe('password-change-required');
    });
  });

  describe('[resetTours] DELETE /api/me/tours', () => {
    it('✅ 204: сняты все отметки пользователя, чужие не тронуты', () => {
      complete('dashboard', { token: viewer });
      complete('coin', { token: viewer });
      complete('dashboard', { token: operator });

      expect(reset({ token: viewer }).status).toBe(204);
      expect(ctx.tours.completed(viewerId)).toEqual([]);
      expect(ctx.tours.completed(operatorId)).toEqual(['dashboard']);
    });

    it('✅ 204 и без отметок: сброс идемпотентен', () => {
      expect(reset({ token: viewer }).status).toBe(204);
    });

    it('❌ 401 без сессии, 403 с чужого сайта', async () => {
      expect(reset().status).toBe(401);
      const response = reset({ token: viewer, origin: 'https://evil.example' });
      expect(await slug(response)).toBe('forbidden-origin');
    });
  });
});

describe('[account-client] маршруты отметок', () => {
  it('✅ PUT с именем тура в пути и DELETE списка', async () => {
    const calls: { url: string; method?: string }[] = [];
    const client = createAccountClient({
      fetch: (input, init) => {
        calls.push({ url: String(input), method: init?.method });
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      onUnauthorized: () => undefined,
    });

    await client.completeTour('coin');
    await client.resetTours();
    expect(calls).toEqual([
      { url: '/api/me/tours/coin', method: 'PUT' },
      { url: '/api/me/tours', method: 'DELETE' },
    ]);
  });
});

describe('[migrations] 0004: отметки гида', () => {
  it('✅ таблица создана, неиспользуемая колонка users удалена, строки пользователей целы', () => {
    const db = openDatabase(':memory:');
    migrate(db, START, MIGRATIONS.slice(0, 3));
    db.prepare(
      `INSERT INTO users (login, password_hash, role, created_at, updated_at, password_changed_at)
       VALUES ('alice', ?, 'viewer', ?, ?, ?)`,
    ).run(`scrypt$10$8$1$${'A'.repeat(22)}$${'A'.repeat(43)}`, START, START, START);

    expect(migrate(db, START)).toEqual([4]);
    const columns = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((column) => column.name);
    expect(columns).not.toContain('onboarding_completed_at');
    expect(columns).toContain('must_change_password');
    expect(db.prepare('SELECT login, role FROM users').all()).toEqual([{ login: 'alice', role: 'viewer' }]);
    expect(db.prepare('SELECT count(*) AS n FROM user_tours').get()).toEqual({ n: 0 });
  });
});
