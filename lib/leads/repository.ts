import { one, type Queryable } from "../db/core.ts";
import type { IngestRepository, IngestResult } from "./ingest.ts";

/** Сохранение лида одной транзакцией (SQL ingest_lead / ingest_lead_once с submission_id). */
export function createIngestRepository(
  q: Queryable,
  submissionId?: string | null,
): IngestRepository {
  return {
    async saveLead(context, lead) {
      const row = await one<{ result: { id: string; number: number; duplicate_ids: string[] } }>(
        q,
        submissionId
          ? "select public.ingest_lead_once($1, $2, $3, $4, $5, $6) as result"
          : "select public.ingest_lead($1, $2, $3, $4, $5) as result",
        [
          context.organizationId,
          context.channelId,
          context.sourceLabel,
          context.consentAt,
          lead,
          ...(submissionId ? [submissionId] : []),
        ],
      );
      const result = row!.result;
      return {
        id: result.id,
        number: result.number,
        duplicateIds: result.duplicate_ids,
      } satisfies IngestResult;
    },
  };
}
