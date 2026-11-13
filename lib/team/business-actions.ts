"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, getDb, one } from "@/lib/db";
import { requireUser, ORG_COOKIE } from "@/lib/auth/session";
import { slugify } from "@/lib/organizations/slug";
import { isPresetKey } from "@/lib/presets";

export type BusinessState = { error?: string; name?: string };

/** Новый бизнес с нуля. Только админ платформы (OWO Ads). Создатель становится владельцем. */
export async function createBusinessAction(
  _prev: BusinessState,
  form: FormData,
): Promise<BusinessState> {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  if (!user.isPlatformAdmin) return { error: "Nowe biznesy tworzy administrator OWO Ads.", name };
  // Пресет: обычный бизнес клиента или кабинет самого агентства (agency, решение 021).
  const rawPreset = String(form.get("preset") ?? "event-services");
  const preset = isPresetKey(rawPreset) ? rawPreset : "event-services";
  if (name.length < 2 || name.length > 120)
    return { error: "Podaj nazwę biznesu (2–120 znaków).", name };
  let id: string;
  try {
    id = await asUser(getDb(), user.id, async (tx) => {
      const row = await one<{ id: string }>(
        tx,
        "select public.create_organization($1,$2,$3) as id",
        [name, slugify(name), preset],
      );
      // Участие OWO Ads помечаем обслуживающим: клиент его видит, но убрать не может.
      // Кабинет самого агентства — своя фирма, там участие обычное.
      // Кабинет агентства сразу получает зашитые услуги (абонемент CRM и реклама).
      if (preset === "agency")
        await tx.query("select public.agency_ensure_system_services($1)", [row!.id]);
      if (preset !== "agency") {
        await tx.query("select public.mark_service_membership($1)", [row!.id]);
        // Новый бизнес клиента сразу появляется клиентом в кабинете OWO Ads (решение 025):
        // абонемент CRM и заказы считаются с первого дня, чек-лист настройки стартует сам.
        await tx.query(
          `insert into public.agency_clients (organization_id, name, client_org_id, status, started_at, created_by)
           select o.id, $2, $1, 'active', (now() at time zone 'Europe/Warsaw')::date, $3
           from public.organizations o
           join public.memberships m on m.organization_id = o.id and m.user_id = $3
           where o.industry_preset = 'agency'
           order by m.created_at limit 1`,
          [row!.id, name, user.id],
        );
      }
      return row!.id;
    });
  } catch (error) {
    console.error("[business]", (error as Error).message);
    return { error: "Nie udało się utworzyć biznesu.", name };
  }
  (await cookies()).set(ORG_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 31536000,
  });
  redirect("/ustawienia/zespol");
}
