"use client";
import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import {
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileSignature,
  FileText,
  Globe,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Phone,
  Star,
  StickyNote,
  Undo2,
  User,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Picker } from "@/components/ui/picker";
import { plDateTime, timeAgo } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { addLeadNote, editLead, setChatUrl, undoLead } from "@/lib/leads/actions";
import type { EditableField } from "@/lib/leads/edit";
import type { LeadEvent } from "@/lib/leads/queries";
import { hasKnownResponse } from "@/lib/leads/response";
import type { Lead, PipelineStage } from "@/lib/leads/types";
import { cn } from "@/lib/utils";
import { stageTone } from "./lead-row";

/**
 * Карточка лида (решение 048, макет Вани): слева блоки на «холсте» — Kontakt, Wydarzenie,
 * Oferta, Dane do umowy, Wiadomość; справа «Szybkie działania»; внизу история.
 * Каждый блок правится целиком карандашом. На телефоне — верхняя панель с назад/звонок/
 * WhatsApp/e-mail, затем быстрые действия и блоки.
 */

type Block = {
  key: string;
  title: MessageKey;
  icon: LucideIcon;
  tone: string;
  fields: EditableField[];
  wide?: boolean;
};
const BLOCKS: Block[] = [
  {
    key: "contact",
    title: "leads.groupContact",
    icon: User,
    tone: "var(--accent)",
    fields: ["client_name", "phone_e164", "email"],
  },
  {
    key: "event",
    title: "leads.groupEvent",
    icon: CalendarDays,
    tone: "#5b7cfa",
    fields: ["event_type", "event_date", "event_city", "venue", "guests", "service_hours"],
  },
  {
    key: "offer",
    title: "leads.groupOffer",
    icon: Star,
    tone: "#e0567a",
    fields: ["package_name", "budget_grosze"],
  },
  {
    key: "contract",
    title: "leads.groupContract",
    icon: FileSignature,
    tone: "#8b6cf0",
    fields: ["client_full_name", "client_address"],
  },
  {
    key: "message",
    title: "leads.fields.message",
    icon: MessageSquareText,
    tone: "#7c5cff",
    fields: ["message"],
  },
];
const inputTypes: Partial<Record<EditableField, string>> = {
  event_date: "date",
  guests: "number",
  phone_e164: "tel",
  email: "email",
};
const eventLabels: Record<string, MessageKey> = {
  created: "leads.history.created",
  edited: "leads.history.edited",
  stage_changed: "leads.history.stage_changed",
  note: "leads.history.note",
  restored: "leads.history.restored",
  possible_duplicate: "leads.history.possible_duplicate",
  contacted: "leads.history.contacted",
  call: "leads.history.call",
  document_generated: "leads.history.document_generated",
};
const eventIcons: Record<string, LucideIcon> = {
  created: Globe,
  edited: Pencil,
  stage_changed: ArrowLeftRight,
  note: StickyNote,
  restored: Undo2,
  possible_duplicate: Copy,
  contacted: Phone,
  call: Phone,
  document_generated: FileText,
};
const money = (grosze: number) =>
  new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(grosze / 100);
const plDay = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : null);

/** «2026-12-03T14:00» по Варшаве из next_contact_at. */
function warsawParts(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function LeadEditor({
  lead,
  stages,
  team,
  history,
  docsBlock,
  docActions,
  attachmentsCard,
  agencyCard,
  serverNow,
}: {
  /** Время отрисовки на сервере — «2 godz. temu» без расхождения при гидратации. */
  serverNow: string;
  lead: Lead;
  stages: PipelineStage[];
  team: { id: string; name: string }[];
  history: LeadEvent[];
  /** «Dokumenty i płatności» — блок на холсте рядом с «Wydarzenie». */
  docsBlock?: React.ReactNode;
  /** Кнопки генерации оферты, договора и меню в «Szybkie działania». */
  docActions?: boolean;
  attachmentsCard?: React.ReactNode;
  agencyCard?: React.ReactNode;
}) {
  const [current, optimistic] = useOptimistic(lead, (state: Lead, patch: Partial<Lead>) => ({
    ...state,
    ...patch,
  }));
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  const [chatEditing, setChatEditing] = useState(false);
  /** «Czat»: есть ссылка — открыть; нет — сначала спросить ссылку (WhatsApp, Messenger, Instagram). */
  function openChat() {
    if (current.chat_url) window.open(current.chat_url, "_blank", "noreferrer");
    else setChatEditing(true);
  }
  const [error, setError] = useState<string>();
  const [undoEvent, setUndoEvent] = useState<string>();
  const now = Date.parse(serverNow);
  useEffect(() => {
    if (!undoEvent) return;
    const timer = setTimeout(() => setUndoEvent(undefined), 8000);
    return () => clearTimeout(timer);
  }, [undoEvent]);

  const stage = stages.find((s) => s.key === current.stage_key);
  const phone = current.phone_e164;

  /** Сохранить одно или несколько полей подряд (версия передаётся от правки к правке). */
  function save(patch: Partial<Record<EditableField, string>>, after?: () => void) {
    setError(undefined);
    const entries = Object.entries(patch) as [EditableField, string][];
    if (!entries.length) return after?.();
    startTransition(async () => {
      if (patch.stage_key) optimistic({ stage_key: patch.stage_key });
      if ("assigned_to" in patch) optimistic({ assigned_to: patch.assigned_to || null });
      let version = lead.updated_at;
      let last: string | undefined;
      for (const [field, value] of entries) {
        const result = await editLead(lead.id, version, field, value);
        if (result.error) return setError(result.error);
        version = result.updatedAt ?? version;
        last = result.eventId;
      }
      setUndoEvent(entries.length === 1 ? last : undefined);
      after?.();
    });
  }

  function valueFor(field: EditableField) {
    const value = current[field as keyof Lead];
    return field === "budget_grosze" && typeof value === "number"
      ? (value / 100).toFixed(2)
      : String(value ?? "");
  }

  function blockBody(block: Block) {
    const empty = <span className="text-ink-faint">{t("leads.notProvided")}</span>;
    const line = (Icon: LucideIcon, text: React.ReactNode) => (
      <p className="flex min-w-0 items-center gap-2.5 text-[14px]">
        <Icon className="text-ink-faint size-4 shrink-0" />
        <span className="min-w-0 truncate">{text}</span>
      </p>
    );
    switch (block.key) {
      case "contact":
        return (
          <div className="grid gap-1.5">
            <p className="truncate text-[19px] font-bold tracking-tight">{current.client_name}</p>
            {line(Phone, phone ?? empty)}
            {line(Mail, current.email ?? empty)}
          </div>
        );
      case "event":
        return (
          <div className="grid gap-1.5">
            <p className="truncate text-[19px] font-bold tracking-tight">
              {current.event_type || t("leads.fields.event_type")}
            </p>
            {line(CalendarDays, plDay(current.event_date) ?? empty)}
            {line(MapPin, [current.event_city, current.venue].filter(Boolean).join(" · ") || empty)}
            {line(
              Users,
              current.guests ? t("leads.guestsCount", { count: current.guests }) : empty,
            )}
            {current.service_hours ? line(Clock, current.service_hours) : null}
          </div>
        );
      case "offer":
        return (
          <div className="grid gap-0.5">
            <p className="truncate text-[19px] font-bold tracking-tight">
              {current.package_name || <span className="text-ink-faint">—</span>}
            </p>
            <p className="text-[22px] font-bold tracking-tight tabular-nums">
              {current.budget_grosze !== null ? money(current.budget_grosze) : empty}
            </p>
          </div>
        );
      case "contract":
        return (
          <div className="grid gap-1.5">
            {line(User, current.client_full_name ?? empty)}
            {line(MapPin, current.client_address ?? empty)}
          </div>
        );
      default:
        return (
          <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">
            {current.message || empty}
          </p>
        );
    }
  }

  function blockForm(block: Block) {
    return (
      <form
        className="grid gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const patch: Partial<Record<EditableField, string>> = {};
          for (const field of block.fields) {
            const value = String(data.get(field) ?? "");
            if (value !== valueFor(field)) patch[field] = value;
          }
          save(patch, () => setEditing(null));
        }}
      >
        <div className={cn("grid gap-2.5", block.fields.length > 2 && "sm:grid-cols-2")}>
          {block.fields.map((field) =>
            field === "message" ? (
              <textarea
                key={field}
                name={field}
                defaultValue={valueFor(field)}
                rows={5}
                maxLength={10000}
                aria-label={t("leads.fields.message")}
                className="border-line-strong bg-surface rounded-lg border p-3 text-sm"
              />
            ) : (
              <Field
                key={field}
                name={field}
                label={t(`leads.fields.${field}`)}
                defaultValue={valueFor(field)}
                type={inputTypes[field] ?? "text"}
              />
            ),
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {t("leads.save")}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(null)}>
            {t("leads.cancel")}
          </Button>
        </div>
      </form>
    );
  }

  const next = warsawParts(current.next_contact_at);
  const shownHistory = allHistory ? history : history.slice(0, 3);
  const lastActivity = history[0]?.created_at ?? current.updated_at;

  return (
    <div className="grid gap-4">
      {/* Телефон: верхняя панель — назад и связь с клиентом в одно касание. */}
      <div className="bg-bg/90 sticky top-[3.5rem] z-10 -mx-4 -mt-5 flex items-center gap-1 px-2 py-1.5 backdrop-blur sm:-mx-6 lg:hidden">
        <Link
          href="/leady"
          aria-label={t("nav.leads")}
          className="text-ink flex size-11 items-center justify-center rounded-full"
        >
          <ChevronLeft className="size-6" />
        </Link>
        <span className="flex-1" />
        {phone ? (
          <>
            <a
              href={`tel:${phone}`}
              aria-label={t("leads.call")}
              className="text-ink flex size-11 items-center justify-center rounded-full"
            >
              <Phone className="size-5" />
            </a>
            <button
              type="button"
              onClick={openChat}
              aria-label={t("leads.chat")}
              className="text-ok flex size-11 items-center justify-center rounded-full"
            >
              <MessageCircle className="size-5" />
            </button>
          </>
        ) : null}
        {current.email ? (
          <Link
            href={`/poczta?c=${encodeURIComponent(current.email.toLowerCase())}`}
            aria-label={t("leads.email")}
            className="text-ink flex size-11 items-center justify-center rounded-full"
          >
            <Mail className="size-5" />
          </Link>
        ) : null}
      </div>

      {/* Шапка */}
      <header className="grid gap-1.5">
        <nav className="text-ink-soft hidden items-center gap-1.5 text-[13.5px] lg:flex">
          <Link href="/leady" className="hover:text-ink">
            {t("nav.leads")}
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-ink truncate font-medium">{current.client_name}</span>
        </nav>
        <div className="flex items-center gap-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 truncate text-[24px] font-bold tracking-tight lg:text-[30px]">
                {current.client_name}
              </h1>
              <Picker
                value={current.stage_key}
                disabled={pending}
                onChange={(e) => save({ stage_key: e.target.value })}
                aria-label={t("leads.fields.stage_key")}
                className="w-auto"
                menuClassName="min-w-56"
                trigger={
                  <span
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold"
                    style={{
                      color: stageTone(stage),
                      background: `color-mix(in oklab, ${stageTone(stage)} 13%, transparent)`,
                    }}
                  >
                    <span className="size-2 rounded-full bg-current" aria-hidden />
                    {stage?.label_pl ?? current.stage_key}
                    <ChevronDown className="size-3.5" />
                  </span>
                }
              >
                {stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label_pl}
                  </option>
                ))}
              </Picker>
            </div>
            <p className="text-ink-soft mt-1 flex flex-wrap items-center gap-x-2 text-[13px]">
              <span>
                #{current.number} · {current.source_label}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" />
                {t("leads.lastActivity")}: {timeAgo(lastActivity, now)}
              </span>
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-urgent">
          {error}
        </p>
      ) : null}
      {undoEvent ? (
        <div
          role="status"
          className="border-line-strong bg-surface-2 flex items-center justify-between gap-3 rounded-[14px] border px-4 py-2"
        >
          <span>{t("leads.saved")}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await undoLead(lead.id, undoEvent);
                setUndoEvent(undefined);
                if (result.error) setError(result.error);
              })
            }
          >
            {t("leads.undo")}
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Холст с блоками */}
        <div className="grid gap-4">
          <section
            aria-label={t("leads.tabData")}
            className="border-line rounded-2xl border bg-[radial-gradient(var(--line-strong)_1px,transparent_1px)] [background-size:18px_18px] p-3 sm:p-4"
          >
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {BLOCKS.flatMap((block) => [
                <article
                  key={block.key}
                  className={cn(
                    "bg-surface group rounded-2xl border p-4 shadow-[var(--shadow)] transition-[border-color,box-shadow] duration-150",
                    editing === block.key
                      ? "border-accent ring-accent/15 ring-4"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <header className="mb-2.5 flex items-center gap-2.5">
                    <span
                      className="flex size-8 items-center justify-center rounded-full"
                      style={{
                        color: block.tone,
                        background: `color-mix(in oklab, ${block.tone} 14%, transparent)`,
                      }}
                    >
                      <block.icon className="size-4" />
                    </span>
                    <h2 className="flex-1 text-[15px] font-semibold">{t(block.title)}</h2>
                    {editing !== block.key ? (
                      <button
                        type="button"
                        onClick={() => setEditing(block.key)}
                        aria-label={t("leads.editField", { field: t(block.title) })}
                        className="text-ink-faint hover:text-ink hover:bg-surface-2 flex size-8 items-center justify-center rounded-lg transition-colors"
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                  </header>
                  {editing === block.key ? blockForm(block) : blockBody(block)}
                </article>,
                // «Dokumenty i płatności» — сразу после «Wydarzenie», того же размера.
                block.key === "event" && docsBlock ? (
                  <article
                    key="docs"
                    className="bg-surface border-line hover:border-line-strong rounded-2xl border p-4 shadow-[var(--shadow)] transition-colors"
                  >
                    <header className="mb-2.5 flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-[var(--ok)]">
                        <Wallet className="size-4" />
                      </span>
                      <h2 className="flex-1 text-[15px] font-semibold">
                        {t("leads.docsPayments")}
                      </h2>
                    </header>
                    {docsBlock}
                  </article>
                ) : null,
              ])}
            </div>
          </section>
          {agencyCard || attachmentsCard ? (
            <div className="grid items-start gap-4 2xl:grid-cols-2">
              {agencyCard}
              {attachmentsCard}
            </div>
          ) : null}
        </div>

        {/* Szybkie działania — на телефоне идут первыми. */}
        <aside className="border-line bg-surface order-first grid gap-4 rounded-2xl border p-4 shadow-[var(--shadow)] xl:sticky xl:top-[4.5rem] xl:order-none">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Zap className="text-accent size-5" />
            {t("leads.quickActions")}
          </h2>
          <div className="grid gap-1.5">
            <p className="text-[13px] font-semibold">{t("leads.fields.stage_key")}</p>
            <Picker
              value={current.stage_key}
              disabled={pending}
              onChange={(e) => save({ stage_key: e.target.value })}
              aria-label={t("leads.fields.stage_key")}
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label_pl}
                </option>
              ))}
            </Picker>
          </div>
          {!hasKnownResponse(current) && current.stage_key === "new" ? (
            <Button disabled={pending} onClick={() => save({ stage_key: "contacted" })}>
              <Check />
              {t("leads.markContacted")}
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            {phone ? (
              <a
                href={`tel:${phone}`}
                className={cn(buttonVariants({ variant: "soft", size: "sm" }), "text-[12.5px]")}
              >
                <Phone />
                {t("leads.phoneShort")}
              </a>
            ) : null}
            <span className="flex min-w-0">
              <button
                type="button"
                onClick={openChat}
                className={cn(
                  buttonVariants({ variant: "success", size: "sm" }),
                  "min-w-0 flex-1 text-[12.5px]",
                  current.chat_url && "rounded-r-none",
                )}
              >
                <MessageCircle />
                {t("leads.chat")}
              </button>
              {current.chat_url ? (
                <button
                  type="button"
                  onClick={() => setChatEditing(true)}
                  aria-label={t("leads.chatEdit")}
                  className={cn(
                    buttonVariants({ variant: "success", size: "sm" }),
                    "border-l-ok/30 rounded-l-none border-l px-2",
                  )}
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
            </span>
            {current.email ? (
              <Link
                href={`/poczta?c=${encodeURIComponent(current.email.toLowerCase())}`}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "col-span-2 text-[12.5px]",
                )}
              >
                <Mail />
                {t("leads.emailTemplates")}
              </Link>
            ) : null}
          </div>
          {chatEditing ? (
            <form
              className="border-line bg-surface-2/60 grid gap-2 rounded-xl border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const url = String(new FormData(e.currentTarget).get("chat") ?? "");
                startTransition(async () => {
                  const result = await setChatUrl(lead.id, url);
                  if (result.error) setError(result.error);
                  else {
                    setChatEditing(false);
                    if (url && !current.chat_url) window.open(url, "_blank", "noreferrer");
                  }
                });
              }}
            >
              <label className="grid gap-1.5 text-[12.5px] font-semibold">
                {t("leads.chatLink")}
                <input
                  name="chat"
                  type="url"
                  autoFocus
                  defaultValue={current.chat_url ?? ""}
                  placeholder="https://m.me/… · instagram.com/… · wa.me/…"
                  className="border-line-strong bg-surface h-9 rounded-lg border px-2.5 text-[13px] font-normal"
                />
              </label>
              <p className="text-ink-faint text-[11.5px]">{t("leads.chatHint")}</p>
              <div className="flex flex-wrap gap-1.5">
                <Button type="submit" size="sm" disabled={pending}>
                  {t("leads.save")}
                </Button>
                {phone && !current.chat_url ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      const input = e.currentTarget.form?.elements.namedItem("chat");
                      if (input instanceof HTMLInputElement)
                        input.value = `https://wa.me/${phone.slice(1)}`;
                    }}
                  >
                    WhatsApp
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setChatEditing(false)}
                >
                  {t("leads.cancel")}
                </Button>
              </div>
            </form>
          ) : null}
          {docActions ? (
            <div className="grid gap-1.5">
              <p className="text-[13px] font-semibold">{t("leads.generate")}</p>
              <div className="grid grid-cols-3 gap-1.5">
                <Link
                  href={`/leady/${lead.id}/oferta?pakiet=${(current.package_name ?? "standard").toLowerCase()}`}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "px-1 text-[12.5px]",
                  )}
                >
                  <Star />
                  {t("leads.genOffer")}
                </Link>
                <Link
                  href={`/leady/${lead.id}/umowa`}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "px-1 text-[12.5px]",
                  )}
                >
                  <FileSignature />
                  {t("leads.genContract")}
                </Link>
                <Link
                  href={`/leady/${lead.id}/menu`}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "px-1 text-[12.5px]",
                  )}
                >
                  <FileText />
                  {t("leads.genMenu")}
                </Link>
              </div>
            </div>
          ) : null}

          <div className="border-line grid gap-2 border-t pt-4">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <CalendarClock className="text-ink-soft size-4" />
              {t("leads.nextContact")}
            </p>
            <form
              key={current.next_contact_at ?? "none"}
              className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2"
              onChange={(e) => {
                const data = new FormData(e.currentTarget);
                const date = String(data.get("date") ?? "");
                const time = String(data.get("time") ?? "") || "09:00";
                const value = date ? `${date}T${time}` : "";
                const was = next.date ? `${next.date}T${next.time}` : "";
                if (value !== was) save({ next_contact_at: value });
              }}
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                type="date"
                name="date"
                defaultValue={next.date}
                aria-label={t("leads.nextContactDate")}
                className="border-line-strong bg-surface h-10 min-w-0 rounded-lg border px-2.5 text-[14px]"
              />
              <input
                type="time"
                name="time"
                defaultValue={next.time}
                aria-label={t("leads.nextContactTime")}
                className="border-line-strong bg-surface h-10 min-w-0 rounded-lg border px-2.5 text-[14px]"
              />
            </form>
            {current.next_contact_at ? (
              <button
                type="button"
                onClick={() => save({ next_contact_at: "" })}
                className="text-ink-faint hover:text-ink justify-self-start text-[12.5px]"
              >
                {t("leads.nextContactClear")}
              </button>
            ) : null}
          </div>

          {team.length > 1 ? (
            <div className="grid gap-1.5">
              <p className="text-[13px] font-semibold">{t("leads.fields.assigned_to")}</p>
              <div className="flex flex-wrap gap-1.5">
                {team.map((member) => (
                  <Button
                    key={member.id}
                    size="sm"
                    variant={current.assigned_to === member.id ? "dark" : "secondary"}
                    disabled={pending}
                    aria-pressed={current.assigned_to === member.id}
                    onClick={() =>
                      save({ assigned_to: current.assigned_to === member.id ? "" : member.id })
                    }
                  >
                    {member.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const text = String(new FormData(form).get("note") ?? "");
              startTransition(async () => {
                const result = await addLeadNote(lead.id, text);
                if (result.error) setError(result.error);
                else form.reset();
              });
            }}
          >
            <label className="grid gap-1.5 text-[13px] font-semibold">
              {t("leads.note")}
              <textarea
                name="note"
                required
                maxLength={5000}
                rows={3}
                placeholder={t("leads.notePlaceholder")}
                className="border-line-strong bg-surface rounded-lg border p-3 text-sm font-normal"
              />
            </label>
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              {t("leads.addNote")}
            </Button>
          </form>
        </aside>
      </div>

      {/* Historia aktywności */}
      <section className="border-line bg-surface rounded-2xl border p-4 shadow-[var(--shadow)]">
        <header className="mb-2 flex items-center gap-2">
          <Clock className="text-ink-soft size-4" />
          <h2 className="flex-1 text-[15px] font-semibold">{t("leads.historyTitle")}</h2>
          {history.length > 3 ? (
            <button
              type="button"
              onClick={() => setAllHistory(!allHistory)}
              className="text-accent inline-flex items-center gap-1 text-[13px] font-medium"
            >
              {allHistory
                ? t("leads.historyLess")
                : t("leads.historyAll", { count: history.length })}
              <ChevronRight
                className={cn("size-3.5 transition-transform", allHistory && "rotate-90")}
              />
            </button>
          ) : null}
        </header>
        <ol className="relative grid">
          {shownHistory.map((event, i) => {
            const Icon = eventIcons[event.type] ?? StickyNote;
            return (
              <li key={event.id} className="relative flex gap-3 py-2 pl-5">
                <span
                  className={cn(
                    "absolute top-[15px] left-0 size-2.5 rounded-full",
                    i === 0 ? "bg-accent" : "bg-line-strong",
                  )}
                  aria-hidden
                />
                {i < shownHistory.length - 1 ? (
                  <span
                    className="bg-line absolute top-6 bottom-[-8px] left-[4.5px] w-px"
                    aria-hidden
                  />
                ) : null}
                <span className="text-ink-faint w-28 shrink-0 text-[12.5px] tabular-nums sm:w-32">
                  {plDateTime(event.created_at)}
                </span>
                <Icon className="text-ink-soft mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1 text-[13.5px]">
                  <span className="font-medium">
                    {t(eventLabels[event.type] ?? "leads.history.other")}
                  </span>
                  {event.type === "document_generated" &&
                  typeof event.payload.number === "string" ? (
                    <span className="text-ink-soft">
                      {" "}
                      · {t(`docs.kind_${String(event.payload.kind)}` as MessageKey)}{" "}
                      {event.payload.number}
                    </span>
                  ) : null}
                  {typeof event.payload.text === "string" ? (
                    <span className="text-ink-soft block break-words whitespace-pre-wrap">
                      „{event.payload.text}”
                    </span>
                  ) : null}
                  {event.type === "possible_duplicate" &&
                  typeof event.payload.lead_id === "string" ? (
                    <Link
                      href={`/leady/${event.payload.lead_id}`}
                      className="text-accent block text-[13px] underline"
                    >
                      {t("leads.openDuplicate")}
                    </Link>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
