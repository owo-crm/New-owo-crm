"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Send, TestTube } from "lucide-react";
import { Card } from "@/components/app-shell/page";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import {
  previewLetterAction,
  saveTemplateAction,
  sendTestAction,
  startCampaignAction,
} from "@/lib/mailing/actions";
import type { Campaign, Contact, Template } from "@/lib/mailing/repository";
import { plDate, plDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Панель рассылок (решение 037) — перенос из Telegram-бота.
 *
 * Порядок тот же, в котором человек думает: кому → что → как это выглядит → отправить.
 * Отписавшиеся видны, но выбрать их нельзя: это не настройка, а закон.
 */

const input =
  "border-line-strong bg-surface min-w-0 rounded-lg border px-3 py-2 text-[13.5px] w-full";

type Letter = {
  subject: string;
  body: string;
  heading1: string | null;
  heading2: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
};

const EMPTY: Letter = {
  subject: "",
  body: "",
  heading1: null,
  heading2: null,
  buttonText: null,
  buttonUrl: null,
};

export function MailingPanel({
  contacts,
  templates,
  campaigns,
  dailyLimit,
  mailReady,
}: {
  contacts: Contact[];
  templates: Template[];
  campaigns: Campaign[];
  dailyLimit: number;
  mailReady: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [letter, setLetter] = useState<Letter>(EMPTY);
  const [html, setHtml] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const [confirming, setConfirming] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (q && !`${c.name} ${c.email} ${c.event_label ?? ""}`.toLowerCase().includes(q))
        return false;
      if (filters.signed && !filters.open && !c.signed) return false;
      if (filters.open && !filters.signed && c.signed) return false;
      if (filters.past && !filters.future && !c.past) return false;
      if (filters.future && !filters.past && (c.past || !c.event_date)) return false;
      if (filters.recent && c.created_days > 90) return false;
      if (filters.consent && !c.consent) return false;
      return true;
    });
  }, [contacts, query, filters]);

  const chosen = contacts.filter((c) => picked[c.lead_id] && !c.unsubscribed);

  // Предпросмотр обновляется сам, но не на каждую букву.
  useEffect(() => {
    const empty = !letter.subject && !letter.body;
    const timer = setTimeout(
      () => {
        if (empty) return setHtml("");
        previewLetterAction(letter, chosen[0]?.name ?? "Anna").then((r) => setHtml(r.html ?? ""));
      },
      empty ? 0 : 400,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, chosen.length]);

  const set = (patch: Partial<Letter>) => setLetter({ ...letter, ...patch });
  const toggle = (key: string) => setFilters({ ...filters, [key]: !filters[key] });

  function applyTemplate(id: string) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return setLetter(EMPTY);
    setTemplateName(tpl.name);
    setLetter({
      subject: tpl.subject,
      body: tpl.body,
      heading1: tpl.heading1,
      heading2: tpl.heading2,
      buttonText: tpl.button_text,
      buttonUrl: tpl.button_url,
    });
  }

  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ? { text: r.error, bad: true } : { text: ok });
    });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      {/* ── кому ───────────────────────────────────────────────────────── */}
      <Card title={t("mailing.recipients")} tone="var(--accent)">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("mailing.search")}
          aria-label={t("mailing.search")}
          className={input}
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["signed", "open", "past", "future", "recent", "consent"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={!!filters[key]}
              onClick={() => toggle(key)}
              className={cn(
                "h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors",
                filters[key]
                  ? "bg-accent text-accent-ink"
                  : "text-ink-soft hover:bg-surface-2 hover:text-ink border-line border",
              )}
            >
              {t(`mailing.filter${key[0].toUpperCase()}${key.slice(1)}` as "mailing.filterSigned")}
            </button>
          ))}
        </div>
        <p className="text-ink-faint mt-2 text-[12.5px]">{t("mailing.filterHint")}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setPicked({
                ...picked,
                ...Object.fromEntries(
                  visible.filter((c) => !c.unsubscribed).map((c) => [c.lead_id, true]),
                ),
              })
            }
          >
            {t("mailing.selectVisible")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = { ...picked };
              for (const c of visible) delete next[c.lead_id];
              setPicked(next);
            }}
          >
            {t("mailing.unselectVisible")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked({})}>
            {t("mailing.clear")}
          </Button>
        </div>

        <p className="text-ink-soft mt-3 text-[13px] font-semibold">
          {t("mailing.selected", { n: chosen.length, all: contacts.length })}
        </p>

        <ul className="divide-line border-line mt-2 max-h-96 divide-y overflow-y-auto rounded-lg border">
          {visible.slice(0, 400).map((c) => (
            <li key={c.lead_id}>
              <label
                className={cn(
                  "flex items-start gap-2.5 px-3 py-2",
                  c.unsubscribed ? "opacity-50" : "hover:bg-surface-2 cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  disabled={c.unsubscribed}
                  checked={!!picked[c.lead_id] && !c.unsubscribed}
                  onChange={(e) => setPicked({ ...picked, [c.lead_id]: e.target.checked })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">
                    {c.name}
                    {c.signed ? (
                      <span className="badge badge-won ml-2">{t("mailing.signed")}</span>
                    ) : null}
                    {c.unsubscribed ? (
                      <span className="text-ink-faint ml-2 text-[11.5px]">
                        {t("mailing.unsubscribed")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-ink-soft block truncate text-[12.5px]">
                    {[c.email, c.event_label, c.event_date ? plDate(c.event_date) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="text-ink-soft px-3 py-6 text-center text-[13px]">
              {t("mailing.nobody")}
            </li>
          ) : null}
          {visible.length > 400 ? (
            <li className="text-ink-faint px-3 py-2 text-center text-[12.5px]">
              {t("mailing.shown", { shown: 400, all: visible.length })}
            </li>
          ) : null}
        </ul>
      </Card>

      {/* ── что ────────────────────────────────────────────────────────── */}
      <Card title={t("mailing.message")} tone="var(--hold)">
        <div className="grid gap-3">
          {templates.length ? (
            <label className="grid gap-1.5">
              <span className="text-ink-soft text-[13px] font-medium">{t("mailing.template")}</span>
              <Picker defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">{t("mailing.templateNone")}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </Picker>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("mailing.heading1")}
              value={letter.heading1 ?? ""}
              onChange={(v) => set({ heading1: v || null })}
            />
            <Field
              label={t("mailing.heading2")}
              value={letter.heading2 ?? ""}
              onChange={(v) => set({ heading2: v || null })}
            />
          </div>
          <Field
            label={t("mailing.subject")}
            value={letter.subject}
            onChange={(v) => set({ subject: v })}
          />
          <label className="grid gap-1.5">
            <span className="text-ink-soft text-[13px] font-medium">{t("mailing.body")}</span>
            <textarea
              value={letter.body}
              onChange={(e) => set({ body: e.target.value })}
              rows={9}
              maxLength={8000}
              className={input}
            />
            <span className="text-ink-faint text-[12.5px]">{t("mailing.bodyHint")}</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("mailing.buttonText")}
              value={letter.buttonText ?? ""}
              onChange={(v) => set({ buttonText: v || null })}
            />
            <Field
              label={t("mailing.buttonUrl")}
              value={letter.buttonUrl ?? ""}
              onChange={(v) => set({ buttonUrl: v || null })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={t("mailing.templateName")}
              value={templateName}
              onChange={setTemplateName}
              className="flex-1"
            />
            <Button
              variant="secondary"
              disabled={pending || !templateName.trim() || !letter.subject}
              onClick={() =>
                run(
                  () => saveTemplateAction({ ...letter, name: templateName }),
                  t("mailing.saveTemplate"),
                )
              }
            >
              {t("mailing.saveTemplate")}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── как выглядит ───────────────────────────────────────────────── */}
      <Card title={t("mailing.preview")} tone="var(--info)">
        {html ? (
          <iframe
            title={t("mailing.preview")}
            srcDoc={html}
            sandbox=""
            className="border-line h-[26rem] w-full rounded-lg border bg-white"
          />
        ) : (
          <p className="text-ink-soft py-10 text-center text-[13.5px]">{t("mailing.bodyHint")}</p>
        )}
      </Card>

      {/* ── отправка ───────────────────────────────────────────────────── */}
      <Card title={t("mailing.send")} tone="var(--ok)">
        <p className="border-urgent bg-urgent/8 text-ink-soft border-l-[3px] px-3 py-2 text-[12.5px]">
          {t("mailing.legal")}
        </p>
        {!mailReady ? (
          <p className="text-urgent mt-3 text-[13px] font-semibold">{t("mailing.noMail")}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={pending || !mailReady || !letter.subject}
            onClick={() => run(() => sendTestAction(letter), t("mailing.testSent"))}
          >
            <TestTube />
            {t("mailing.test")}
          </Button>
          <Button
            disabled={pending || !mailReady || !letter.subject || chosen.length === 0}
            onClick={() => setConfirming(true)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {t("mailing.start", { n: chosen.length })}
          </Button>
        </div>

        {note ? (
          <p
            role="status"
            className={cn("mt-3 text-[13px] font-semibold", note.bad ? "text-urgent" : "text-ok")}
          >
            {note.text}
          </p>
        ) : null}

        <h3 className="mt-5 mb-2 text-[13.5px] font-semibold">{t("mailing.campaigns")}</h3>
        {campaigns.length === 0 ? (
          <p className="text-ink-soft text-[13px]">{t("mailing.campaignsEmpty")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {campaigns.map((c) => (
              <li key={c.id} className="py-2 first:pt-0 last:pb-0">
                <p className="truncate text-[13.5px] font-medium">{c.subject}</p>
                <p className="text-ink-soft text-[12.5px]">
                  {plDateTime(c.created_at)} · {t("mailing.campaignSent", { n: c.sent })}
                  {c.pending ? ` · ${t("mailing.campaignPending", { n: c.pending })}` : ""}
                  {c.failed ? ` · ${t("mailing.campaignFailed", { n: c.failed })}` : ""}
                  {c.status === "done" ? ` · ${t("mailing.campaignDone")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface w-full max-w-md rounded-2xl p-5 shadow-[var(--shadow-pop)]">
            <h2 className="text-[17px] font-bold">{t("mailing.confirmTitle")}</h2>
            <p className="text-ink-soft mt-2 text-[13.5px]">
              {t("mailing.confirmText", {
                subject: letter.subject,
                n: chosen.length,
                limit: dailyLimit,
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("mailing.cancel")}
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await startCampaignAction(
                      letter,
                      chosen.map((c) => c.lead_id),
                    );
                    setConfirming(false);
                    setNote(
                      r.error
                        ? { text: r.error, bad: true }
                        : { text: t("mailing.started", { n: r.total ?? 0 }) },
                    );
                    if (!r.error) setPicked({});
                  })
                }
              >
                {t("mailing.confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-ink-soft text-[13px] font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={input} />
    </label>
  );
}
