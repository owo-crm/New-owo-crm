"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { t } from "@/lib/i18n";

export type ChannelFormState = { error?: string; ok?: boolean };

const origin = z
  .string()
  .trim()
  .transform((v) => v.replace(/\/+$/, ""))
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" && u.origin === v;
    } catch {
      return false;
    }
  });

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  origins: z
    .string()
    .transform((v) => v.split(/[\s,]+/).filter(Boolean))
    .pipe(z.array(origin).min(1).max(10)),
  honeypot: z
    .string()
    .trim()
    .regex(/^([A-Za-z_][A-Za-z0-9_-]{0,40})?$/),
  forward: z
    .string()
    .trim()
    .refine((v) => !v || /^https:\/\/[^\s]+$/.test(v)),
});

/** Создать или изменить канал «формуляр сайта». Только owner/admin (и RLS в базе). */
export async function saveWebsiteChannel(
  _prev: ChannelFormState,
  form: FormData,
): Promise<ChannelFormState> {
  const parsed = schema.safeParse({
    id: form.get("id") || undefined,
    name: form.get("name"),
    origins: form.get("origins") ?? "",
    honeypot: form.get("honeypot") ?? "",
    forward: form.get("forward") ?? "",
  });
  if (!parsed.success) return { error: t("channels.invalid") };
  const { id, name, origins, honeypot, forward } = parsed.data;
  const config = {
    allowedOrigins: origins,
    ...(honeypot ? { honeypotField: honeypot } : {}),
    ...(forward ? { forwardUrl: forward } : {}),
  };
  try {
    await withOrg(async (tx, { organization }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      if (id)
        await tx.query(
          "update public.channels set name=$1, config=$2 where organization_id=$3 and id=$4 and type='website'",
          [name, config, organization.id, id],
        );
      else
        await tx.query(
          "insert into public.channels (organization_id, type, name, config) values ($1,'website',$2,$3)",
          [organization.id, name, config],
        );
    });
  } catch (error) {
    return {
      error:
        (error as Error).message === "forbidden" ? t("channels.adminOnly") : t("channels.invalid"),
    };
  }
  revalidatePath("/ustawienia/zrodla");
  return { ok: true };
}

// ───────── Вебхук и проверка каналов (решение 044) ─────────

/** Новый канал «Webhook» (Zapier, Make, Google Ads, конструкторы форм). */
export async function createWebhookChannel(
  _prev: ChannelFormState,
  form: FormData,
): Promise<ChannelFormState> {
  const name = z.string().trim().min(1).max(120).safeParse(form.get("name"));
  if (!name.success) return { error: t("channels.invalid") };
  try {
    await withOrg(async (tx, { organization }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query(
        "insert into public.channels (organization_id, type, name, config) values ($1,'webhook',$2,'{}')",
        [organization.id, name.data],
      );
    });
  } catch (error) {
    return {
      error:
        (error as Error).message === "forbidden" ? t("channels.adminOnly") : t("channels.invalid"),
    };
  }
  revalidatePath("/ustawienia/zrodla");
  return { ok: true };
}

const CRM_TARGETS = [
  "name",
  "phone",
  "email",
  "message",
  "event_date",
  "city",
  "event_type",
  "guests",
];

/** Свои названия полей вебхука: строки «pole_w_źródle = name». */
export async function saveFieldMap(id: string, text: string): Promise<ChannelFormState> {
  if (!z.uuid().safeParse(id).success) return { error: t("channels.invalid") };
  const map: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(.+?)\s*[=→>-]+\s*([a-z_]+)\s*$/);
    if (!line.trim()) continue;
    if (!m || !CRM_TARGETS.includes(m[2]))
      return { error: t("channels.mapInvalid", { line: line.trim() }) };
    map[m[1].slice(0, 100)] = m[2];
  }
  try {
    await withOrg(async (tx, { organization }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query(
        `update public.channels set config = jsonb_set(config, '{fieldMap}', $3::jsonb)
         where organization_id=$1 and id=$2 and type='webhook'`,
        [organization.id, id, JSON.stringify(map)],
      );
    });
  } catch {
    return { error: t("channels.adminOnly") };
  }
  revalidatePath("/ustawienia/zrodla");
  return { ok: true };
}

/** Wstrzymaj / włącz kanał: wstrzymany kanał odrzuca zgłoszenia (404). */
export async function setChannelStatus(id: string, active: boolean): Promise<ChannelFormState> {
  if (!z.uuid().safeParse(id).success) return { error: t("channels.invalid") };
  try {
    await withOrg(async (tx, { organization }) => {
      if (!["owner", "admin"].includes(organization.role)) throw new Error("forbidden");
      await tx.query("update public.channels set status=$3 where organization_id=$1 and id=$2", [
        organization.id,
        id,
        active ? "active" : "paused",
      ]);
    });
  } catch {
    return { error: t("channels.adminOnly") };
  }
  revalidatePath("/ustawienia/zrodla");
  return { ok: true };
}

/**
 * «Wyślij test»: тестовая заявка идёт тем же путём, что настоящая (тот же обработчик,
 * журнал, уведомления). Лид помечен как тестовый — его можно удалить.
 */
export async function sendTestLead(id: string): Promise<ChannelFormState & { leadId?: string }> {
  if (!z.uuid().safeParse(id).success) return { error: t("channels.invalid") };
  const channel = await withOrg(async (tx, { organization }) => {
    if (!["owner", "admin"].includes(organization.role)) return null;
    const { rows } = await tx.query<{ type: string; public_key: string; status: string }>(
      "select type, public_key, status from public.channels where organization_id=$1 and id=$2",
      [organization.id, id],
    );
    return rows[0] ?? null;
  }).catch(() => null);
  if (!channel) return { error: t("channels.adminOnly") };
  if (channel.status !== "active") return { error: t("channels.pausedError") };
  const { websiteHandler, webhookHandler } = await import("./handlers");
  const payload = {
    name: t("channels.testName"),
    phone: "+48500000000",
    email: "test@example.com",
    message: t("channels.testMessage"),
    consent: "1",
  };
  const base = process.env.SITE_URL || "http://localhost";
  let res: Response;
  if (channel.type === "webhook")
    res = await webhookHandler()(
      new Request(`${base}/api/hook/${channel.public_key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  else if (channel.type === "website")
    res = await websiteHandler()(
      new Request(`${base}/api/intake/${channel.public_key}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-real-ip": `crm-test-${id}`,
          [process.env.TRUSTED_IP_HEADER || "x-real-ip"]: `crm-test-${id}`,
        },
        body: JSON.stringify(payload),
      }),
    );
  else return { error: t("channels.invalid") };
  const body = (await res.json().catch(() => ({}))) as { error?: string; lead_id?: string };
  revalidatePath("/ustawienia/zrodla");
  revalidatePath("/leady");
  if (!res.ok)
    return { error: t("channels.testFailed", { code: body.error ?? String(res.status) }) };
  return { ok: true, leadId: body.lead_id };
}
