'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleX, LoaderCircle, Plus, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Collapsible } from '@/components/ui/collapsible';
import { Field, FIELD_LABEL_OFFSET, fieldDescribedBy } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { bff } from '@/lib/bff-client';
import {
  applyCoinSaved,
  describeAddFailure,
  parseAddForm,
  type AddFailure,
  type AddFields,
  type AddRequest,
} from '@/lib/operator/watchlist';

/** Обратный отсчёт до повтора после 503: api сам говорит, сколько ждать (`Retry-After`) */
function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, setLeft];
}

/**
 * Добавление монеты (ui-flows §3.5, §4.3). Символ проверяется дважды: в форме — чтобы не тратить запрос,
 * в api — потому что формы может и не быть. Какую монету выбрал сервис, видно из уведомления: символы
 * в CoinMarketCap не уникальны.
 */
export function AddCoinForm() {
  const queryClient = useQueryClient();
  const id = useId();
  const [symbol, setSymbol] = useState('');
  const [cmcId, setCmcId] = useState('');
  const [fields, setFields] = useState<AddFields>({});
  const [failure, setFailure] = useState<AddFailure | null>(null);
  const [retryIn, setRetryIn] = useCountdown();
  const [extraOpen, setExtraOpen] = useState(false);

  const add = useMutation({
    mutationFn: (request: AddRequest) => bff.send('post', '/api/v1/cryptocurrencies', { body: request }),
    onSuccess: (coin) => {
      applyCoinSaved(queryClient, coin);
      setSymbol('');
      setCmcId('');
      toast.success(`Добавлен ${coin.name} (CMC #${coin.cmcId})`, 'Цена появится после ближайшей синхронизации.');
    },
    onError: (error, request) => {
      const described = describeAddFailure(error, request);
      setFailure(described);
      setFields(described.fields);
      if (described.retryAfterSeconds !== null) setRetryIn(described.retryAfterSeconds);
    },
  });

  const reset = () => {
    setFields({});
    setFailure(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (add.isPending || retryIn > 0) return;
    reset();
    const parsed = parseAddForm({ symbol, cmcId });
    if (!parsed.ok) {
      setFields(parsed.fields);
      return;
    }
    add.mutate(parsed.request);
  };

  const alert = failure?.alert;
  const symbolId = `${id}-symbol`;
  const cmcFieldId = `${id}-cmc`;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-3">
        <Field
          id={symbolId}
          label="Символ"
          className="min-w-56 flex-1"
          info={{
            label: 'Как ищется монета',
            text: 'Монета ищется в CoinMarketCap по символу. Символы там не уникальны: без CMC ID выбирается активная монета с лучшим рангом. Какая монета выбрана, видно в уведомлении после добавления.',
          }}
          hint="Латинские буквы и цифры, до 15 символов"
          error={
            fields.symbol && (
              <>
                {fields.symbol}
                {typeof failure?.conflictingId === 'number' && (
                  <>
                    {'. '}
                    <Link href={`/coins/${failure.conflictingId}`} className="font-medium underline underline-offset-2">
                      Открыть карточку
                    </Link>
                  </>
                )}
              </>
            )
          }
        >
          <Input
            id={symbolId}
            name="symbol"
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value.toUpperCase());
              reset();
            }}
            autoComplete="off"
            spellCheck={false}
            maxLength={15}
            placeholder="например, AVAX"
            aria-invalid={fields.symbol ? true : undefined}
            aria-describedby={fieldDescribedBy(symbolId)}
            className="font-mono uppercase placeholder:normal-case"
          />
        </Field>
        <Button type="submit" className={FIELD_LABEL_OFFSET} disabled={add.isPending || retryIn > 0}>
          {add.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {add.isPending ? 'Проверка в CoinMarketCap…' : retryIn > 0 ? `Повторить через ${retryIn} с` : 'Добавить'}
        </Button>
      </div>

      {/* Открыт, если в поле есть значение или ошибка: иначе сообщение осталось бы под свёрнутым блоком */}
      <Collapsible
        label="Дополнительно"
        open={extraOpen || cmcId !== '' || Boolean(fields.cmcId)}
        onOpenChange={setExtraOpen}
      >
        <Field
          id={cmcFieldId}
          label="CMC ID"
          optional
          className="max-w-xs"
          info={{
            label: 'Зачем указывать CMC ID',
            text: 'Идентификатор монеты в CoinMarketCap — число из адреса её страницы или из ответа API. Нужен, когда один символ носят несколько монет и требуется не та, у которой лучший ранг.',
          }}
          hint="Целое положительное число"
          error={fields.cmcId}
        >
          <Input
            id={cmcFieldId}
            name="cmcId"
            value={cmcId}
            onChange={(event) => {
              setCmcId(event.target.value);
              reset();
            }}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={fields.cmcId ? true : undefined}
            aria-describedby={fieldDescribedBy(cmcFieldId)}
            className="font-mono"
          />
        </Field>
      </Collapsible>

      <div role="alert" className="empty:hidden">
        {alert && (
          <Notice tone={alert.tone} Icon={alert.tone === 'warn' ? TriangleAlert : CircleX} title={alert.title}>
            <span>
              {alert.text}
              {retryIn > 0 && ` Повторите через ${retryIn} с.`}
            </span>
            {failure?.requestId && (
              <span className="text-xs">
                Идентификатор запроса: <code className="font-mono break-all">{failure.requestId}</code>
              </span>
            )}
          </Notice>
        )}
      </div>
    </form>
  );
}
