"use client";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
export default function LeadsError({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="border-line bg-surface rounded-xl border p-6">
      <h1 className="text-2xl">{t("leads.loadError")}</h1>
      <p className="text-ink-soft my-4">{t("leads.retryHint")}</p>
      <Button onClick={reset}>{t("leads.refresh")}</Button>
    </section>
  );
}
