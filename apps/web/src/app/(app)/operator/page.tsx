import { redirect } from 'next/navigation';

/** У панели нет своего экрана: пункт меню «Оператор» ведёт в первый раздел */
export default function OperatorPage() {
  redirect('/operator/watchlist');
}
