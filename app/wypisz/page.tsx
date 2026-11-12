import { z } from "zod";
import { getDb } from "@/lib/db";
import { checkUnsubscribeToken } from "@/lib/mailing/unsubscribe";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wypisz się", robots: { index: false } };

/**
 * Отписка от рассылки. Ссылка приходит в каждом рекламном письме.
 *
 * Отписываем по нажатию кнопки, а не по открытию ссылки: почтовые сканеры безопасности
 * ходят по ссылкам сами, и на GET мы отписывали бы людей, которые этого не просили.
 */
const query = z.object({ o: z.uuid(), e: z.string().email().max(254), t: z.string().max(64) });

async function unsubscribe(formData: FormData) {
  "use server";
  const parsed = query.safeParse({
    o: formData.get("o"),
    e: formData.get("e"),
    t: formData.get("t"),
  });
  if (!parsed.success) return;
  const { o, e, t: token } = parsed.data;
  const email = e.trim().toLowerCase();
  if (!checkUnsubscribeToken(o, email, token)) return;
  await getDb().query(
    `insert into public.mail_optouts (organization_id, email, source)
     values ($1,$2,'link') on conflict do nothing`,
    [o, email],
  );
}

export default async function UnsubscribePage({ searchParams }: PageProps<"/wypisz">) {
  const raw = await searchParams;
  const parsed = query.safeParse(raw);
  const done = raw.ok === "1";

  if (!parsed.success)
    return <Shell title={t("unsubscribe.badTitle")} text={t("unsubscribe.badText")} />;

  const { o, e, t: token } = parsed.data;
  const email = e.trim().toLowerCase();
  if (!checkUnsubscribeToken(o, email, token))
    return <Shell title={t("unsubscribe.badTitle")} text={t("unsubscribe.badText")} />;

  if (done) return <Shell title={t("unsubscribe.doneTitle")} text={t("unsubscribe.doneText")} />;

  return (
    <Shell title={t("unsubscribe.title")} text={t("unsubscribe.text", { email })}>
      <form
        action={async (formData: FormData) => {
          "use server";
          await unsubscribe(formData);
          const { redirect } = await import("next/navigation");
          redirect(`/wypisz?o=${o}&e=${encodeURIComponent(email)}&t=${token}&ok=1`);
        }}
      >
        <input type="hidden" name="o" value={o} />
        <input type="hidden" name="e" value={email} />
        <input type="hidden" name="t" value={token} />
        <button
          type="submit"
          className="bg-ink text-surface mt-6 h-11 rounded-lg px-5 text-[14px] font-semibold"
        >
          {t("unsubscribe.confirm")}
        </button>
      </form>
    </Shell>
  );
}

function Shell({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-[26px] leading-8 font-bold tracking-[-0.02em]">{title}</h1>
      <p className="text-ink-soft mt-3 text-[15px] leading-relaxed">{text}</p>
      {children}
    </main>
  );
}
