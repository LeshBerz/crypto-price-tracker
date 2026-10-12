'use client';

import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bff } from '@/lib/bff-client';
import type { Cryptocurrency } from '@/lib/coin/queries';
import { formatCount, plural } from '@/lib/format';
import { NAME_MAX_LENGTH, parseName, pricePointsQuery } from '@/lib/operator/watchlist';

/**
 * Диалоги монтируются с `key={coin.id}`: состояние полей живёт ровно столько, сколько открыт диалог одной
 * монеты, и сбрасывать его эффектом не нужно. `pending` — запрос идёт: кнопки заблокированы, диалог не
 * закрывается, пока api не ответит.
 */
export function RenameDialog({
  coin,
  pending,
  onSave,
  onClose,
}: {
  coin: Cryptocurrency;
  pending: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(coin.name);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseName(name);
    if (!parsed.ok) return setError(parsed.message);
    // Имя не изменилось — запрос не нужен: api всё равно ответил бы тем же объектом
    if (parsed.name === coin.name) return onClose();
    onSave(parsed.name);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogTitle>Переименовать {coin.symbol}</DialogTitle>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Отображаемое имя</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-hint ${id}-error`}
            />
            <DialogDescription id={`${id}-hint`} className="text-xs">
              Символ и CMC ID не меняются: это идентичность монеты.
            </DialogDescription>
            <span id={`${id}-error`} role="alert" className="text-xs text-destructive empty:hidden">
              {error}
            </span>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Отмена</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Удаление стирает историю цен и свёртки (ADR 0013), поэтому подтверждается вводом символа, а рядом
 * предлагается пауза — действие, которое историю сохраняет (ui-flows §3.5, §5).
 */
const POINTS = ['точка', 'точки', 'точек'] as const;

export function DeleteDialog({
  coin,
  pending,
  onDelete,
  onPause,
  onClose,
}: {
  coin: Cryptocurrency;
  pending: boolean;
  onDelete: () => void;
  onPause: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim().toUpperCase() === coin.symbol;
  // Число — уточнение, а не условие: пока оно грузится или не получено, диалог говорит «вся история»
  const points = useQuery(pricePointsQuery(bff, coin)).data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (confirmed && !pending) onDelete();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogTitle>Удалить {coin.symbol} из watchlist?</DialogTitle>
          <DialogDescription>
            Будет удалена{' '}
            <strong className="text-foreground">
              вся история цен {coin.symbol}
              {points !== undefined && ` — ${formatCount(points)} ${plural(points, POINTS)}`}
            </strong>{' '}
            и её свёртки. Действие необратимо.{' '}
            {coin.isPaused
              ? 'Монета уже на паузе: пока она в списке, история сохраняется.'
              : 'Чтобы сохранить историю, поставьте монету на паузу.'}
          </DialogDescription>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-confirm`}>Введите {coin.symbol}, чтобы подтвердить</Label>
            <Input
              id={`${id}-confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase"
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Отмена</DialogClose>
            {!coin.isPaused && (
              <Button type="button" variant="outline" disabled={pending} onClick={onPause}>
                Поставить на паузу
              </Button>
            )}
            <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
              {pending ? 'Удаление…' : 'Удалить навсегда'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
