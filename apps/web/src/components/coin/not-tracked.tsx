import { Coins } from 'lucide-react';
import Link from 'next/link';

/** Монеты нет: неверный адрес или оператор удалил её из списка вместе с историей (ui-flows §3.3) */
export function NotTracked() {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl bg-card px-4 py-12 text-center text-sm ring-1 ring-foreground/10"
    >
      <Coins className="size-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-lg font-semibold">Монета не отслеживается</h1>
      <p className="text-muted-foreground">Возможно, оператор удалил её из списка вместе с историей цен.</p>
      <Link href="/" className="mt-2 font-medium text-primary underline underline-offset-2">
        ← К дашборду
      </Link>
    </div>
  );
}
