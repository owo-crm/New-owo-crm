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
