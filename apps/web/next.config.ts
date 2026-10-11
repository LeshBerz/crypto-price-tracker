import type { NextConfig } from 'next';

const config: NextConfig = {
  // Самодостаточный сервер в .next/standalone: в образ не нужно копировать node_modules всего монорепо
  output: 'standalone',
  poweredByHeader: false,
};

export default config;
