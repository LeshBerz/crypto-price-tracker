'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PriceTableSkeleton } from '@/components/dashboard/price-table';
import { LoadError } from '@/components/load-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { bff } from '@/lib/bff-client';
import type { Cryptocurrency } from '@/lib/coin/queries';
import { coinsQuery } from '@/lib/dashboard/queries';
import { useNow } from '@/lib/dashboard/use-price-stream';
import { formatDate, formatRelative, plural } from '@/lib/format';
import { applyCoinDeleted, applyCoinSaved, describeFailure } from '@/lib/operator/watchlist';
import { AddCoinForm } from './add-coin-form';
import { DeleteDialog, RenameDialog } from './coin-dialogs';

const TH = 'px-4 py-2 text-xs font-medium text-muted-foreground';
const TD = 'px-4 py-3 align-middle';
const COINS = ['монета', 'монеты', 'монет'] as const;
const COIN_LINK = 'group rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

type Patch = { coin: Cryptocurrency; body: { name: string } | { isPaused: boolean } };
type Opened = { kind: 'rename' | 'delete'; id: number };

function StatusBadge({ paused }: { paused: boolean }) {
  return paused ? (
    <Badge variant="secondary">
      <Pause aria-hidden="true" />
      на паузе
    </Badge>
  ) : (
    <Badge className="bg-up-bg text-up">
      <CircleCheck aria-hidden="true" />
      активна
    </Badge>
  );
}

function LastPrice({ coin, now }: { coin: Cryptocurrency; now: number }) {
  if (!coin.lastUpdatedAt) return <span className="text-muted-foreground">ожидает синхронизации</span>;
  return (
    <time dateTime={coin.lastUpdatedAt} title={`${coin.lastUpdatedAt} (UTC)`} className="text-muted-foreground">
      {formatRelative(coin.lastUpdatedAt, now)}
    </time>
  );
}

function Actions({
  coin,
  busy,
  onRename,
  onTogglePause,
  onDelete,
}: {
  coin: Cryptocurrency;
  busy: boolean;
  onRename: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 md:justify-end">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onRename}
        aria-label={`Переименовать ${coin.symbol}`}
      >
        <Pencil aria-hidden="true" />
        Переименовать
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onTogglePause}
        aria-label={`${coin.isPaused ? 'Возобновить' : 'Приостановить'} ${coin.symbol}`}
      >
        {coin.isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {coin.isPaused ? 'Возобновить' : 'Пауза'}
      </Button>
      <Button variant="destructive" size="sm" disabled={busy} onClick={onDelete} aria-label={`Удалить ${coin.symbol}`}>
        <Trash2 aria-hidden="true" />
        Удалить
      </Button>
    </div>
  );
}

/**
 * Watchlist оператора. Список — тот же запрос, что у дашборда (`['cryptocurrencies']`): результат мутации
 * записывается в кэш из ответа api, чужие изменения приносит событие `watchlist.changed`, а время последней
 * цены — событие `price.updated`. Сам экран на поток не подписан.
 */
export function WatchlistPanel() {
  const queryClient = useQueryClient();
  const coins = useQuery(coinsQuery(bff));
  const now = useNow();
  const [opened, setOpened] = useState<Opened | null>(null);

  const patch = useMutation({
    mutationFn: ({ coin, body }: Patch) =>
      bff.send('patch', '/api/v1/cryptocurrencies/{id}', { params: { id: coin.id }, body }),
    onSuccess: (saved, { body }) => {
      applyCoinSaved(queryClient, saved);
      setOpened(null);
      if ('name' in body) toast.success(`Имя ${saved.symbol} изменено`);
      else if (saved.isPaused)
        toast.success(`${saved.symbol} на паузе`, 'Синхронизация остановлена, история сохранена.');
      else toast.success(`${saved.symbol}: синхронизация возобновлена`);
    },
    onError: (error, { coin }) => {
      toast.error(`${coin.symbol}: изменение не сохранено`, describeFailure(error));
      // 404 — монеты уже нет: список перечитывается, чтобы строка исчезла и здесь
      void coins.refetch();
    },
  });

  const remove = useMutation({
    mutationFn: (coin: Cryptocurrency) =>
      bff.send('delete', '/api/v1/cryptocurrencies/{id}', { params: { id: coin.id } }),
    onSuccess: (_, coin) => {
      applyCoinDeleted(queryClient, coin.id);
      setOpened(null);
      toast.success(`${coin.symbol} удалена вместе с историей`);
    },
    onError: (error, coin) => {
      toast.error(`${coin.symbol}: удаление не выполнено`, describeFailure(error));
      setOpened(null);
      void coins.refetch();
    },
  });

  const items = coins.data?.items;
  const busyId = patch.isPending ? patch.variables.coin.id : remove.isPending ? remove.variables.id : null;
  const openedCoin = opened ? items?.find((coin) => coin.id === opened.id) : undefined;
  const actions = (coin: Cryptocurrency) => (
    <Actions
      coin={coin}
      busy={busyId === coin.id}
      onRename={() => setOpened({ kind: 'rename', id: coin.id })}
      onTogglePause={() => patch.mutate({ coin, body: { isPaused: !coin.isPaused } })}
      onDelete={() => setOpened({ kind: 'delete', id: coin.id })}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="add-title"
        className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      >
        <h2 id="add-title" className="font-semibold">
          Добавить монету
        </h2>
        <AddCoinForm />
      </section>

      <section aria-labelledby="coins-title" className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 id="coins-title" className="font-semibold">
            Отслеживаемые монеты
          </h2>
          {items && (
            <Badge variant="secondary">
              {items.length} {plural(items.length, COINS)}
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">лимит 100 (квота CoinMarketCap)</span>
        </div>

        {!items && coins.isError && (
          <LoadError
            title="Не удалось загрузить список монет"
            error={coins.error}
            onRetry={() => void coins.refetch()}
          />
        )}
        {!items && !coins.isError && <PriceTableSkeleton />}
        {items?.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Список пуст. Добавьте первую монету — цена появится после ближайшей синхронизации.
          </p>
        )}
        {items && items.length > 0 && (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Отслеживаемые монеты: идентификатор CoinMarketCap, статус, время последней цены, действия
                </caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className={TH}>
                      Монета
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      CMC ID
                    </th>
                    <th scope="col" className={TH}>
                      Статус
                    </th>
                    <th scope="col" className={TH}>
                      Последняя цена
                    </th>
                    <th scope="col" className={TH}>
                      Добавлена
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((coin) => (
                    <tr key={coin.id} className="border-b last:border-b-0">
                      <td className={TD}>
                        <Link href={`/coins/${coin.id}`} className={COIN_LINK}>
                          <span className="font-semibold group-hover:underline">{coin.symbol}</span>{' '}
                          <span className="text-muted-foreground">{coin.name}</span>
                        </Link>
                      </td>
                      <td className={`${TD} text-right font-mono tabular-nums`}>{coin.cmcId}</td>
                      <td className={TD}>
                        <StatusBadge paused={coin.isPaused} />
                      </td>
                      <td className={TD}>
                        <LastPrice coin={coin} now={now} />
                      </td>
                      <td className={`${TD} font-mono text-muted-foreground tabular-nums`}>
                        {formatDate(coin.createdAt)}
                      </td>
                      <td className={TD}>{actions(coin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden" aria-label="Отслеживаемые монеты">
              {items.map((coin) => (
                <li key={coin.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/coins/${coin.id}`} className={COIN_LINK}>
                      <div className="font-semibold group-hover:underline">{coin.symbol}</div>
                      <div className="text-muted-foreground">
                        {coin.name} · CMC #{coin.cmcId}
                      </div>
                    </Link>
                    <StatusBadge paused={coin.isPaused} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Последняя цена: <LastPrice coin={coin} now={now} /> · добавлена {formatDate(coin.createdAt)}
                  </div>
                  {actions(coin)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {opened?.kind === 'rename' && openedCoin && (
        <RenameDialog
          key={openedCoin.id}
          coin={openedCoin}
          pending={patch.isPending}
          onSave={(name) => patch.mutate({ coin: openedCoin, body: { name } })}
          onClose={() => setOpened(null)}
        />
      )}
      {opened?.kind === 'delete' && openedCoin && (
        <DeleteDialog
          key={openedCoin.id}
          coin={openedCoin}
          pending={remove.isPending || patch.isPending}
          onDelete={() => remove.mutate(openedCoin)}
          onPause={() => patch.mutate({ coin: openedCoin, body: { isPaused: true } })}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}
