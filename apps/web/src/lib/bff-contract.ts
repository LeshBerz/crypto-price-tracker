// Договорённости между браузером и BFF, общие для клиента и сервера.

/** Путь BFF = префикс + путь api: /api/bff/api/v1/prices (ADR 0016, поправка 11) */
export const BFF_PREFIX = '/api/bff';

/**
 * Признак фонового запроса: за ним нет действия пользователя (перезапрос по событию потока или после
 * переподключения). BFF отвечает как обычно, но срок бездействия сессии не продлевает (ADR 0016, поправка 26).
 */
export const BACKGROUND_HEADER = 'x-cpt-background';

export const STREAM_URL = '/api/stream';

export const SESSION_EXPIRED_URL = '/login?reason=expired';

/** Версия контракта api, под которую сгенерированы типы. Совпадение с `info.version` спеки проверяет тест */
export const API_CONTRACT_VERSION = '1.1.0';
