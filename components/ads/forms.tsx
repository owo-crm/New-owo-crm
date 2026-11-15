"use client";

import { useState, useTransition } from "react";
import { Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import {
  addAdAccountAction,
  addManualSpendAction,
  deleteAdAccountAction,
  syncNowAction,
  toggleAdAccountAction,
} from "@/lib/ads/actions";
import { parseMoneyField } from "@/lib/agency/schemas";
import { t } from "@/lib/i18n";

const input =
  "border-line-strong bg-surface h-10 w-full rounded-lg border px-3 text-[14px] lg:h-9 lg:text-[13.5px]";

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ error?: string }>, ok?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      if (!r.error) ok?.();
    });
  return { pending, error, run };
}

export function AddAccountForm() {
  const [platform, setPlatform] = useState("meta");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const { pending, error, run } = useRun();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => addAdAccountAction({ platform, externalId: id, name }),
          () => {
            setId("");
            setName("");
          },
        );
      }}
    >
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <Picker
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Platforma"
        >
          <option value="meta">{t("ads.platform.meta")}</option>
          <option value="google">{t("ads.platform.google")}</option>
        </Picker>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t("ads.accountIdHint")}
          aria-label={t("ads.accountId")}
          className={input}
        />
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("ads.accountName")}
        aria-label={t("ads.accountName")}
        className={input}
      />
      <Button type="submit" variant="secondary" disabled={pending || !id || !name}>
        <Plus />
        {t("ads.addAccount")}
      </Button>
      {error ? <p className="text-urgent text-[13px]">{error}</p> : null}
    </form>
  );
}

export function SyncNowButton() {
  const { pending, run } = useRun();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => run(() => syncNowAction())}
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {t(pending ? "ads.syncing" : "ads.syncNow")}
    </Button>
  );
}

export function AccountButtons({ id, active }: { id: string; active: boolean }) {
  const { pending, run } = useRun();
  return (
    <span className="flex shrink-0 items-center">
      <Button
        size="icon"
        variant="ghost"
        disabled={pending}
        aria-label={t(active ? "ads.pause" : "ads.resume")}
        onClick={() => run(() => toggleAdAccountAction(id, !active))}
      >
        {active ? <Pause /> : <Play />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={pending}
        aria-label={t("ads.remove")}
        onClick={() => run(() => deleteAdAccountAction(id))}
      >
        <Trash2 />
      </Button>
    </span>
  );
}

export function ManualSpendForm({ month }: { month: string }) {
  const [campaign, setCampaign] = useState("");
  const [m, setM] = useState(month);
  const [amount, setAmount] = useState("");
  const [clicks, setClicks] = useState("");
  const { pending, error, run } = useRun();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            addManualSpendAction({
              campaign,
              month: m,
              spendGrosze: parseMoneyField(amount),
              clicks: Number(clicks) || 0,
            }),
          () => {
            setCampaign("");
            setAmount("");
            setClicks("");
          },
        );
      }}
    >
      <input
        value={campaign}
        onChange={(e) => setCampaign(e.target.value)}
        placeholder={t("ads.campaignName")}
        aria-label={t("ads.campaignName")}
        className={input}
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          type="month"
          value={m}
          onChange={(e) => setM(e.target.value)}
          aria-label={t("ads.month")}
          className={input}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={t("ads.amount")}
          aria-label={t("ads.amount")}
          className={`${input} text-right`}
        />
        <input
          value={clicks}
          onChange={(e) => setClicks(e.target.value)}
          inputMode="numeric"
          placeholder={t("ads.clicks")}
          aria-label={t("ads.clicks")}
          className={`${input} text-right`}
        />
      </div>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || !campaign || !(parseMoneyField(amount) > 0)}
      >
        <Plus />
        {t("ads.addSpend")}
      </Button>
      {error ? <p className="text-urgent text-[13px]">{error}</p> : null}
    </form>
  );
}
