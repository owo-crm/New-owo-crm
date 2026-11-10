/**
 * Минимальный слой доступа к Postgres, общий для продакшена (pg) и тестов (PGlite).
 * Без ORM: вся бизнес-логика базы — в SQL-функциях из db/migrations.
 */
export type Queryable = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Несколько SQL-команд без параметров (миграции). У pg это делает обычный query. */
  exec?(sql: string): Promise<unknown>;
};
export type Database = Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
};

/** Ошибка Postgres с SQLSTATE-кодом (40001 = конфликт версии, 42501 = нет прав и т.д.). */
export function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Postgres отдаёт `2026-11-10 17:09:00.123456+00` → ISO с микросекундами (важно для версий лида). */
export function normalizeTimestamp(value: string) {
  return value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
}

/** Типы, которые читаем строками/числами — одинаково в pg и PGlite. */
export const TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  20: (v) => Number(v), // int8 (count(*), leads.number)
  1082: (v) => v, // date → 'YYYY-MM-DD'
  1114: (v) => normalizeTimestamp(v), // timestamp
  1184: (v) => normalizeTimestamp(v), // timestamptz
};

/**
 * Запрос от имени вошедшего пользователя: роль `authenticated` + его id → работают RLS-политики
 * из миграций. Даже если в коде забыть фильтр по фирме, база не отдаст чужие данные.
 */
export function asUser<T>(db: Database, userId: string, fn: (tx: Queryable) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.query("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

/** Серверные операции без пользователя (приём заявок, вебхуки, очередь): владелец базы, без RLS. */
export function asService<T>(db: Database, fn: (tx: Queryable) => Promise<T>) {
  return db.transaction(fn);
}

/** Как asService, но SQL-функции видят auth.uid() = actor (история «кто сделал»). */
export function asActor<T>(db: Database, actorId: string, fn: (tx: Queryable) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    return fn(tx);
  });
}

export async function one<T>(q: Queryable, sql: string, params?: unknown[]) {
  const { rows } = await q.query<T>(sql, params);
  return rows[0] ?? null;
}
