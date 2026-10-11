// Лог серверной части web: одна JSON-строка на событие, как в api. Ключи api и токены сессий сюда не передаются.

export type LogLevel = 'info' | 'warn' | 'error';
export type Log = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void;

export const consoleLog: Log = (level, msg, fields = {}) => {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
};
