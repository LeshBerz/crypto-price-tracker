'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Coins, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CoinAvatar } from '@/components/coin-avatar';
import { LoadError } from '@/components/load-error';
import { Timestamp } from '@/components/timestamp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { EmptyState, Panel, PanelHeader, ROW, TD, TH } from '@/components/ui/panel';
import { TableSkeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { bff } from '@/lib/bff-client';
import type { Cryptocurrency } from '@/lib/coin/queries';
import { coinsQuery } from '@/lib/dashboard/queries';
import { useNow } from '@/lib/dashboard/use-price-stream';
import { plural } from '@/lib/format';
import { applyCoinDeleted, applyCoinSaved, describeFailure } from '@/lib/operator/watchlist';
import { AddCoinForm } from './add-coin-form';
import { DeleteDialog, RenameDialog } from './coin-dialogs';

const COINS = ['монета', 'монеты', 'монет'] as const;
const COIN_LINK = 'group flex items-center gap-3 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const COLUMNS = [
  { width: 'w-36' },
  { width: 'w-8', right: true },
  { width: 'w-20' },
  { width: 'w-20' },
  { width: 'w-20' },
  { width: 'w-64', right: true },
];

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
  return <Timestamp iso={coin.lastUpdatedAt} format="relative" now={now} className="text-muted-foreground" />;
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
        data-tour="coin-pause"
        aria-label={`${coin.isPaused ? 'Возобновить' : 'Приостановить'} ${coin.symbol}`}
      >
        {coin.isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {coin.isPaused ? 'Возобновить' : 'Пауза'}
      </Button>
      <Button
        variant="destructive"
        size="sm"
        disabled={busy}
        onClick={onDelete}
        data-tour="coin-delete"
        aria-label={`Удалить ${coin.symbol}`}
      >
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
      <Panel data-tour="add-coin" aria-labelledby="add-title" className="flex flex-col gap-3 p-4">
        <h2 id="add-title" className="font-semibold">
          Добавить монету
        </h2>
        <AddCoinForm />
      </Panel>

      <Panel aria-labelledby="coins-title">
        <PanelHeader
          title="Отслеживаемые монеты"
          titleId="coins-title"
          meta={
            <>
              {items && (
                <Badge variant="secondary">
                  {items.length} из 100 {plural(100, COINS)}
                </Badge>
              )}
              <InfoHint label="Почему лимит 100 монет">
                Одна синхронизация запрашивает цены всех монет одним обращением к CoinMarketCap; кредиты списываются за
                каждые 100 монет в запросе. Лимит держит синхронизацию в одном кредите.
              </InfoHint>
            </>
          }
        />

        {!items && coins.isError && (
          <LoadError
            title="Не удалось загрузить список монет"
            error={coins.error}
            onRetry={() => void coins.refetch()}
          />
        )}
        {!items && !coins.isError && <TableSkeleton label="Загрузка списка монет" columns={COLUMNS} />}
        {items?.length === 0 && (
          <EmptyState Icon={Coins} title="Список пуст">
            Добавьте первую монету в форме выше — цена появится после ближайшей синхронизации.
          </EmptyState>
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
                    <tr key={coin.id} className={ROW}>
                      <td className={TD}>
                        <Link href={`/coins/${coin.id}`} className={COIN_LINK}>
                          <CoinAvatar symbol={coin.symbol} />
                          <span>
                            <span className="font-semibold group-hover:underline">{coin.symbol}</span>{' '}
                            <span className="text-muted-foreground">{coin.name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={`${TD} text-right font-mono tabular-nums`}>{coin.cmcId}</td>
                      <td className={TD}>
                        <StatusBadge paused={coin.isPaused} />
                      </td>
                      <td className={TD}>
                        <LastPrice coin={coin} now={now} />
                      </td>
                      <td className={`${TD} text-muted-foreground`}>
                        <Timestamp iso={coin.createdAt} format="date" />
                      </td>
                      <td className={TD}>{actions(coin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y md:hidden" aria-label="Отслеживаемые монеты">
              {items.map((coin) => (
                <li key={coin.id} className="flex animate-row-in flex-col gap-2 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/coins/${coin.id}`} className={COIN_LINK}>
                      <CoinAvatar symbol={coin.symbol} />
                      <span>
                        <span className="block font-semibold group-hover:underline">{coin.symbol}</span>
                        <span className="block text-muted-foreground">
                          {coin.name} · CMC #{coin.cmcId}
                        </span>
                      </span>
                    </Link>
                    <StatusBadge paused={coin.isPaused} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Последняя цена: <LastPrice coin={coin} now={now} /> · добавлена{' '}
                    <Timestamp iso={coin.createdAt} format="date" />
                  </div>
                  {actions(coin)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

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
