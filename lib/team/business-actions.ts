"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  const color = z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .catch("#e8000d")
    .parse(form.get("color"));
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
      await tx.query("update public.organizations set brand_color=$1 where id=$2", [
        color,
        row!.id,
      ]);
      // Участие OWO Ads помечаем обслуживающим: клиент его видит, но убрать не может.
      // Кабинет самого агентства — своя фирма, там участие обычное.
      if (preset !== "agency")
        await tx.query("select public.mark_service_membership($1)", [row!.id]);
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
