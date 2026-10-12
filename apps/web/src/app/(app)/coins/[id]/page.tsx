import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CoinCard } from '@/components/coin/coin-card';

export const metadata: Metadata = { title: 'Монета' };

/** Внутренний id монеты — положительное целое без ведущих нулей: всё остальное до api не доходит */
const ID = /^[1-9]\d{0,14}$/;

/** Данные карточка запрашивает из браузера через BFF, как и дашборд; сервер только проверяет форму адреса */
export default async function CoinPage({ params }: PageProps<'/coins/[id]'>) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  return <CoinCard id={Number(id)} />;
}
