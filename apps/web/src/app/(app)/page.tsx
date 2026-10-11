import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Дашборд' };

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Дашборд</h1>
      <Card>
        <CardHeader>
          <CardTitle>Цены пока не подключены</CardTitle>
          <CardDescription>
            Вход и сессии работают. Таблица цен, графики и обновление в реальном времени появятся здесь после
            подключения к API.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Источник данных — CoinMarketCap, валюта — USD, синхронизация раз в 5 минут.
        </CardContent>
      </Card>
    </div>
  );
}
