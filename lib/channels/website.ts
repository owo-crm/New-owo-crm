import { z } from "zod";
import { ingestLead, type IngestRepository, type IngestResult } from "../leads/ingest.ts";

export type WebsiteChannel = {
  id: string;
  organization_id: string;
  name: string;
  config: { allowedOrigins?: string[] };
};
export type IntakeDependencies = {
  findChannel(key: string): Promise<WebsiteChannel | null>;
  reserveAttempt(
    channel: WebsiteChannel,
    ipHash: string,
  ): Promise<{ id: string; allowed: boolean }>;
  finishAttempt(id: string, ok: boolean, error: string | null): Promise<void>;
  hashIp(ip: string): Promise<string>;
  /** Объект или фабрика: фабрика получает submission_id для защиты от повторной отправки. */
  repository: IngestRepository | ((submissionId: string | null) => IngestRepository);
  /** IP клиента от доверенного прокси (Railway: x-real-ip). */
  clientIp?: (request: Request) => string | null;
  now?: () => Date;
  afterIngest?: (result: IngestResult, channel: WebsiteChannel) => Promise<void>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

const knownFields = new Set([
  "name",
  "phone",
  "email",
  "event_type",
  "event_date",
  "city",
  "venue",
  "guests",
  "budget_grosze",
  "message",
  "consent",
  "website",
  "custom_fields",
  "utm",
  "page_url",
  "referrer",
  "submission_id",
]);
export function adaptWebsite(value: Record<string, unknown>) {
  const extra = Object.fromEntries(
    Object.entries(value).filter(([key]) => !knownFields.has(key) && !key.startsWith("utm_")),
  );
  const custom = z.record(z.string(), z.json()).parse(value.custom_fields ?? {});
  const utm = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.startsWith("utm_"))
      .map(([key, entry]) => [key.slice(4), entry]),
  );
  return {
    ...value,
    custom_fields: { ...extra, ...custom },
    utm: { ...utm, ...z.record(z.string(), z.string()).parse(value.utm ?? {}) },
  };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 32768;
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("body_too_large");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const type = request.headers.get("content-type") ?? "";
  const body = new Response(bytes, { headers: { "content-type": type } });
  if (type.includes("application/json"))
    return z.record(z.string(), z.unknown()).parse(await body.json());
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await body.formData();
    const result: Record<string, unknown> = {};
    for (const [key, value] of form) {
      if (typeof value !== "string" || key in result) throw new Error("invalid_body");
      result[key] = value;
    }
    return result;
  }
  throw new Error("unsupported_type");
}

/** Public website endpoint; tenant identity is always resolved from the channel, never the body. */
export function createIntakeHandler(deps: IntakeDependencies) {
  return async (request: Request): Promise<Response> => {
    let headers: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
    const reply = (status: number, error?: string) =>
      Response.json(error ? { error } : { ok: true }, { status, headers });
    let attemptId: string | undefined;
    try {
      const key = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
      if (!key || !z.uuid().safeParse(key).success) return reply(404, "channel_not_found");
      const channel = await deps.findChannel(key);
      if (!channel) return reply(404, "channel_not_found");
      const origin = request.headers.get("origin");
      const allowed = !origin || (channel.config.allowedOrigins ?? []).includes(origin);
      if (origin && allowed)
        headers = {
          ...headers,
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type, idempotency-key",
          "Access-Control-Max-Age": "600",
        };
      if (request.method === "OPTIONS")
        return allowed
          ? new Response(null, { status: 204, headers })
          : reply(403, "origin_not_allowed");
      // The platform proxy appends the client address: never trust the leftmost user-supplied value.
      const ip =
        deps.clientIp?.(request) ||
        request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        "unknown";
      const attempt = await deps.reserveAttempt(channel, await deps.hashIp(ip));
      attemptId = attempt.id;
      const finish = async (status: number, error?: string) => {
        await deps.finishAttempt(attempt.id, status === 200, error ?? null);
        return reply(status, error);
      };
      if (!attempt.allowed) {
        headers["Retry-After"] = "3600";
        return finish(429, "rate_limited");
      }
      if (!allowed) return finish(403, "origin_not_allowed");
      if (request.method !== "POST") {
        headers.Allow = "POST, OPTIONS";
        return finish(405, "method_not_allowed");
      }
      let body: Record<string, unknown>;
      try {
        body = await readBody(request);
      } catch (error) {
        return finish(
          error instanceof Error && error.message === "body_too_large" ? 413 : 400,
          "invalid_body",
        );
      }
      if (typeof body.website === "string" && body.website.trim()) return finish(200, "honeypot");
      if (![true, "true", "on", "1"].includes(body.consent as string | boolean))
        return finish(422, "consent_required");
      const rawSubmission = request.headers.get("idempotency-key") ?? body.submission_id;
      const submissionId =
        typeof rawSubmission === "string" && /^[A-Za-z0-9_.:-]{6,100}$/.test(rawSubmission)
          ? rawSubmission
          : null;
      const repository =
        typeof deps.repository === "function" ? deps.repository(submissionId) : deps.repository;
      let result: IngestResult;
      try {
        result = await ingestLead(
          adaptWebsite(body),
          {
            organizationId: channel.organization_id,
            channelId: channel.id,
            sourceLabel: channel.name,
            consentAt: (deps.now?.() ?? new Date()).toISOString(),
          },
          repository,
        );
      } catch (error) {
        if (error instanceof z.ZodError) return finish(422, "invalid_lead");
        throw error;
      }
      await deps.finishAttempt(attempt.id, true, null);
      if (deps.afterIngest) {
        const task = deps.afterIngest(result, channel).catch(() => {
          /* Delivery retry is owned by the notification queue. */
        });
        if (deps.waitUntil) deps.waitUntil(task);
        else await task;
      }
      return reply(200);
    } catch {
      if (attemptId) await deps.finishAttempt(attemptId, false, "internal_error").catch(() => {});
      return reply(503, "temporarily_unavailable");
    }
  };
}
