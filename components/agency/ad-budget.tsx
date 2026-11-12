"use client";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { removeAdAccountAction, saveAdAccountAction } from "@/lib/agency/actions";
import { formatMoney } from "@/lib/finance/money";
import { plDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Рекламный бюджет клиента и подключённые кабинеты.
 * Пока импорта статистики нет, расход не выдумывается: пишем, что данных нет.
 */

type Account = {
  id: string;
  platform: "google" | "meta";
  external_id: string;
  label: string | null;
  spend_mtd_grosze: number | null;
  spend_synced_at: string | null;
};

const input =
  "border-line-strong bg-surface h-10 min-w-0 rounded-lg border px-3 text-[13.5px] lg:h-9";

export function AdBudgetCard({
  clientId,
  budgetGrosze,
  accounts,
}: {
  clientId: string;
  budgetGrosze: number | null;
  accounts: Account[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [platform, setPlatform] = useState<"google" | "meta">("google");
  const [externalId, setExternalId] = useState("");

  const synced = accounts.filter((a) => a.spend_synced_at !== null);
  const spent = synced.reduce((sum, a) => sum + (a.spend_mtd_grosze ?? 0), 0);
  const left = budgetGrosze === null ? null : budgetGrosze - spent;
  const free = (["google", "meta"] as const).filter((p) => !accounts.some((a) => a.platform === p));
  // После подключения выбранная платформа может исчезнуть из списка — берём первую свободную.
  const pick = free.includes(platform) ? platform : (free[0] ?? platform);

  const run = (fn: () => Promise<{ error?: string }>, ok?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      if (!r.error) ok?.();
    });

  return (
    <div className="grid gap-4" data-testid="ad-budget">
      <div className="grid gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ink-soft text-[13px]">{t("agency.ads.budget")}</span>
          <span className="text-[15px] font-semibold tabular-nums">
            {budgetGrosze === null ? "—" : formatMoney(budgetGrosze)}
          </span>
        </div>
        {budgetGrosze === null ? (
          <p className="text-ink-faint text-[12.5px]">{t("agency.ads.noBudget")}</p>
        ) : null}
      </div>

      {synced.length > 0 ? (
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ink-soft text-[13px]">{t("agency.ads.spent")}</span>
            <span className="text-[15px] font-semibold tabular-nums">{formatMoney(spent)}</span>
          </div>
          {left !== null ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-soft text-[13px]">
                {left >= 0 ? t("agency.ads.left") : t("agency.ads.over", { sum: "" }).trim()}
              </span>
              <span
                className={`text-[13.5px] font-semibold tabular-nums ${left < 0 ? "text-urgent" : ""}`}
              >
                {formatMoney(Math.abs(left))}
              </span>
            </div>
          ) : null}
          {budgetGrosze ? (
            <div
              className="bg-surface-2 mt-1 h-1.5 overflow-hidden rounded-full"
              role="img"
              aria-label={`${t("agency.ads.spent")}: ${formatMoney(spent)} / ${formatMoney(budgetGrosze)}`}
            >
              <div
                className={left !== null && left < 0 ? "bg-urgent h-full" : "bg-accent h-full"}
                style={{ width: `${Math.min(100, (spent / budgetGrosze) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-line divide-y">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-2 first:pt-0">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">
                {t(`agency.ads.${a.platform}`)}
              </span>
              <span className="text-ink-faint text-[12px]">
                {a.external_id}
                {a.spend_synced_at
                  ? ` · ${t("agency.ads.syncedAt", { date: plDate(a.spend_synced_at) })}`
                  : ` · ${t("agency.ads.noData")}`}
              </span>
            </span>
            <Button
              size="icon"
              variant="ghost"
              disabled={pending}
              aria-label={`${t("agency.ads.disconnect")}: ${t(`agency.ads.${a.platform}`)}`}
              onClick={() => run(() => removeAdAccountAction(clientId, a.id))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {accounts.length === 0 ? (
          <li className="text-ink-soft py-1 text-[13.5px]">{t("agency.ads.notConnected")}</li>
        ) : null}
      </ul>

      {free.length > 0 ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveAdAccountAction({
                  clientId,
                  platform: pick,
                  externalId,
                  label: null,
                }),
              () => setExternalId(""),
            );
          }}
        >
          <Picker
            value={pick}
            onChange={(e) => setPlatform(e.target.value as "google" | "meta")}
            aria-label={t("agency.ads.title")}
            className={`${input} w-32`}
          >
            {free.map((p) => (
              <option key={p} value={p}>
                {t(`agency.ads.${p}`)}
              </option>
            ))}
          </Picker>
          <input
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder={t("agency.ads.accountId")}
            aria-label={t("agency.ads.accountId")}
            className={`${input} flex-1`}
            required
          />
          <Button type="submit" variant="secondary" size="sm" disabled={pending || !externalId}>
            {t("agency.ads.connect")}
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-urgent text-[12.5px]">{error}</p> : null}
      <p className="text-ink-faint text-[12.5px]">{t("agency.ads.hint")}</p>
    </div>
  );
}
