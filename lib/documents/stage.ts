import { one, type Queryable } from "../db/core.ts";

/**
 * Сдвиг этапа лида после отправки документа клиенту (решение 053).
 *
 * D-14 утверждает смысловые роли и теги этапов, но колонки `semantic_tags` ещё нет (миграция M2).
 * Поэтому решатель ищет этап по смыслу действия в таком порядке, совместимом с обеими схемами:
 *   1) явный `stage_after` шаблона, если такой этап есть в воронке фирмы;
 *   2) этап с тегом смысла (когда появятся `semantic_tags`);
 *   3) этап с ключом, равным смыслу (`offer_sent`, `contract_sent`) — так устроены пресеты сейчас.
 * Правила: только вперёд по `position`; лиды на won/lost не трогаем; цели нет — этап не меняется,
 * а отправка всё равно считается успешной.
 */
export type StageInfo = { key: string; position: number; kind: string; tags?: string[] };
export type StageMeaning = "offer_sent" | "contract_sent";

export const MEANING_BY_KIND: Record<string, StageMeaning | null> = {
  offer: "offer_sent",
  contract: "contract_sent",
  menu: null,
  file: null,
};

export function resolveStageAfter(input: {
  stages: StageInfo[];
  current: string;
  explicit?: string | null;
  meaning?: StageMeaning | null;
}): string | null {
  const current = input.stages.find((s) => s.key === input.current);
  if (!current || current.kind === "won" || current.kind === "lost") return null;
  const byKey = (key: string | null | undefined) => input.stages.find((s) => s.key === key);
  const target =
    byKey(input.explicit) ??
    (input.meaning
      ? (input.stages.find((s) => s.tags?.includes(input.meaning!)) ?? byKey(input.meaning))
      : undefined);
  if (!target || target.kind === "lost") return null;
  return target.position > current.position ? target.key : null;
}

/** Применить сдвиг через change_lead (история «stage_changed»). Возвращает новый ключ или null. */
export async function applyStageAfter(
  tx: Queryable,
  orgId: string,
  leadId: string,
  explicit: string | null,
  meaning: StageMeaning | null,
) {
  const lead = await one<{ stage_key: string; updated_at: string }>(
    tx,
    "select stage_key, updated_at from public.leads where organization_id=$1 and id=$2 and deleted_at is null",
    [orgId, leadId],
  );
  if (!lead) return null;
  const { rows: stages } = await tx.query<StageInfo>(
    "select key, position, kind from public.pipeline_stages where organization_id=$1",
    [orgId],
  );
  const target = resolveStageAfter({ stages, current: lead.stage_key, explicit, meaning });
  if (!target) return null;
  await tx.query("select public.change_lead($1,$2,$3,$4)", [
    orgId,
    leadId,
    lead.updated_at,
    { stage_key: target },
  ]);
  return { from: lead.stage_key, to: target };
}
