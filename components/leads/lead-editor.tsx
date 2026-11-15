"use client";
import { Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasKnownResponse } from "@/lib/leads/response";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/app-shell/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { t, type MessageKey } from "@/lib/i18n";
import { editLead, undoLead, addLeadNote } from "@/lib/leads/actions";
import type { EditableField } from "@/lib/leads/edit";
import type { Lead, PipelineStage } from "@/lib/leads/types";
import type { LeadEvent } from "@/lib/leads/queries";
import { eventDateLabel } from "./lead-list";
/** Поля сгруппированы по смыслу: контакт, мероприятие, данные для договора. */
// У каждой группы свой цвет метки: иначе четыре одинаковые белые карточки сливаются.
const GROUPS: { title: MessageKey; tone: string; fields: EditableField[] }[] = [
  {
    title: "leads.groupContact",
    tone: "var(--accent)",
    fields: ["client_name", "phone_e164", "email", "assigned_to"],
  },
  {
    title: "leads.groupEvent",
    tone: "var(--ok)",
    fields: [
      "event_date",
      "event_type",
      "event_city",
      "venue",
      "guests",
      "service_hours",
      "package_name",
      "budget_grosze",
    ],
  },
  {
    title: "leads.groupContract",
    tone: "#8b6cf0",
    fields: ["client_full_name", "client_address"],
  },
];
const inputTypes: Partial<Record<EditableField, string>> = {
  event_date: "date",
  guests: "number",
  budget_grosze: "text",
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
export function LeadEditor({
  lead,
  stages,
  team,
  history,
  documentsCard,
  attachmentsCard,
  paymentsCard,
  agencyCard,
}: {
  lead: Lead;
  stages: PipelineStage[];
  team: { id: string; name: string }[];
  history: LeadEvent[];
  documentsCard?: React.ReactNode;
  attachmentsCard?: React.ReactNode;
  paymentsCard?: React.ReactNode;
  agencyCard?: React.ReactNode;
}) {
  const [current, optimistic] = useOptimistic(lead, (state: Lead, patch: Partial<Lead>) => ({
    ...state,
    ...patch,
  }));
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [tab, setTab] = useState<"lead" | "history">("lead");
  const [error, setError] = useState<string>();
  const [undoEvent, setUndoEvent] = useState<string>();
  useEffect(() => {
    if (!undoEvent) return;
    const timer = setTimeout(() => setUndoEvent(undefined), 8000);
    return () => clearTimeout(timer);
  }, [undoEvent]);
  function change(field: EditableField, value: string) {
    setError(undefined);
    startTransition(async () => {
      if (field === "stage_key") optimistic({ stage_key: value });
      if (field === "assigned_to") optimistic({ assigned_to: value || null });
      const result = await editLead(lead.id, lead.updated_at, field, value);
      if (result.error) setError(result.error);
      else {
        setEditing(null);
        setUndoEvent(result.eventId);
      }
    });
  }
  function valueFor(field: EditableField) {
    const value = current[field];
    return field === "budget_grosze" && typeof value === "number"
      ? (value / 100).toFixed(2)
      : String(value ?? "");
  }
  function labelFor(field: EditableField) {
    return t(`leads.fields.${field}`);
  }
  function displayFor(field: EditableField) {
    if (field === "event_date") return eventDateLabel(current.event_date);
    if (field === "assigned_to")
      return (
        team.find((member) => member.id === current.assigned_to)?.name ?? t("leads.unassigned")
      );
    if (field === "budget_grosze" && current.budget_grosze !== null)
      return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(
        current.budget_grosze / 100,
      );
    return String(current[field] ?? "") || t("leads.notProvided");
  }
  return (
    <>
      <PageHeader title={current.client_name} back={{ href: "/leady", label: t("nav.leads") }} />
      <div className="-mt-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="text-ink-soft">
          #{current.number} · {current.source_label}
        </span>
        {/* Последнее событие истории — сразу видно, что с лидом происходило в последний раз. */}
        {history[0] ? (
          <button
            type="button"
            onClick={() => setTab("history")}
            className="text-ink-soft hover:text-ink inline-flex min-w-0 items-center gap-1.5"
          >
            <span className="bg-info size-1.5 shrink-0 rounded-full" aria-hidden />
            <span className="truncate">
              {t("leads.lastEvent")}: {t(eventLabels[history[0].type] ?? "leads.history.other")} ·{" "}
              {new Intl.DateTimeFormat("pl-PL", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Europe/Warsaw",
              }).format(new Date(history[0].created_at))}
            </span>
          </button>
        ) : null}
      </div>
      <div className="border-line mb-4 flex gap-1 border-b" role="tablist">
        {(["lead", "history"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 pt-1 pb-2 text-[13.5px] font-medium",
              tab === key
                ? "border-accent text-accent"
                : "text-ink-soft hover:text-ink border-transparent",
            )}
          >
            {t(key === "lead" ? "leads.tabLead" : "leads.tabHistory")}
            {key === "history" && history.length ? (
              <span className="bg-surface-2 text-ink-faint rounded-full px-1.5 text-[11px] leading-5 font-semibold">
                {history.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-urgent mb-4">
          {error}
        </p>
      ) : null}
      {undoEvent ? (
        <div
          role="status"
          className="border-line-strong bg-surface-2 mb-4 flex items-center justify-between gap-3 rounded-[14px] border px-4 py-2"
        >
          <span>{t("leads.saved")}</span>
          <Button
            variant="secondary"
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
      {tab === "history" ? (
        <Card title={t("leads.historyTitle")}>
          <ol className="grid gap-4">
            {history.map((event) => (
              <li key={event.id} className="border-line border-b pb-4 last:border-0">
                <p className="text-ink-soft text-xs">
                  {new Intl.DateTimeFormat("pl-PL", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Europe/Warsaw",
                  }).format(new Date(event.created_at))}
                </p>
                <p className="mt-1 font-semibold">
                  {t(eventLabels[event.type] ?? "leads.history.other")}
                </p>
                {event.type === "document_generated" && typeof event.payload.number === "string" ? (
                  <p className="text-ink-soft mt-1 text-sm">
                    {t(`docs.kind_${String(event.payload.kind)}` as MessageKey)}{" "}
                    {event.payload.number}
                  </p>
                ) : null}
                {typeof event.payload.text === "string" ? (
                  <p className="text-ink-soft mt-1 text-sm break-words whitespace-pre-wrap">
                    {event.payload.text}
                  </p>
                ) : null}
                {event.type === "possible_duplicate" &&
                typeof event.payload.lead_id === "string" ? (
                  <Link
                    href={`/leady/${event.payload.lead_id}`}
                    className="inline-flex min-h-11 items-center text-sm underline"
                  >
                    {t("leads.openDuplicate")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-ink-soft mt-3 text-xs">{t("leads.historyLimit")}</p>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Слева — всё о лиде. */}
          <div className="grid gap-4">
            <Card>
              <div className="grid gap-4">
                {GROUPS.map((group) => (
                  <section key={group.title}>
                    <h3
                      className="mb-0.5 flex items-center gap-2 text-[11.5px] font-semibold tracking-wide uppercase"
                      style={{ color: group.tone }}
                    >
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      {t(group.title)}
                    </h3>
                    <dl className="grid grid-cols-2 gap-x-5 xl:grid-cols-3">
                      {group.fields.map((field) => (
                        <div key={field} className="border-line min-w-0 border-b py-1.5">
                          <dt className="text-ink-faint text-[11.5px] font-semibold">
                            {labelFor(field)}
                          </dt>
                          <dd>
                            {editing === field ? (
                              <form
                                className="mt-2 grid gap-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  change(
                                    field,
                                    String(new FormData(e.currentTarget).get("value") ?? ""),
                                  );
                                }}
                              >
                                {field === "assigned_to" ? (
                                  <Select
                                    name="value"
                                    label={labelFor(field)}
                                    defaultValue={valueFor(field)}
                                  >
                                    <option value="">{t("leads.unassigned")}</option>
                                    {team.map((member) => (
                                      <option key={member.id} value={member.id}>
                                        {member.name}
                                      </option>
                                    ))}
                                  </Select>
                                ) : (
                                  <Field
                                    name="value"
                                    label={labelFor(field)}
                                    defaultValue={valueFor(field)}
                                    type={inputTypes[field] ?? "text"}
                                    autoFocus
                                  />
                                )}
                                <div className="flex gap-2">
                                  <Button type="submit" size="sm" disabled={pending}>
                                    {t("leads.save")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    onClick={() => setEditing(null)}
                                  >
                                    {t("leads.cancel")}
                                  </Button>
                                </div>
                              </form>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => setEditing(field)}
                                aria-label={t("leads.editField", { field: labelFor(field) })}
                                className="group hover:bg-surface-2 -mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left text-[14px]"
                              >
                                <span className="min-w-0 truncate">{displayFor(field)}</span>
                                <Pencil
                                  aria-hidden
                                  className="text-ink-faint size-3.5 shrink-0 opacity-0 group-hover:opacity-100"
                                />
                              </button>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
                <section>
                  <h3 className="text-hold mb-0.5 flex items-center gap-2 text-[11.5px] font-semibold tracking-wide uppercase">
                    <span className="size-1.5 rounded-full bg-current" aria-hidden />
                    {t("leads.fields.message")}
                  </h3>
                  {editing === "message" ? (
                    <form
                      className="grid gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        change("message", String(new FormData(e.currentTarget).get("value") ?? ""));
                      }}
                    >
                      <textarea
                        name="value"
                        defaultValue={valueFor("message")}
                        rows={6}
                        maxLength={10000}
                        className="border-line-strong bg-surface rounded-lg border p-3 text-sm"
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={pending}>
                          {t("leads.save")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          {t("leads.cancel")}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing("message")}
                      className="hover:bg-surface-2 -mx-2 block w-full rounded-lg px-2 py-1 text-left break-words whitespace-pre-wrap"
                    >
                      {current.message || (
                        <span className="text-ink-faint">{t("leads.notProvided")}</span>
                      )}
                    </button>
                  )}
                </section>
              </div>
            </Card>
            {paymentsCard}
            {attachmentsCard}
            {agencyCard}
          </div>
          {/* Справа — все действия. На телефоне блок действий идёт первым (звонок под пальцем). */}
          <aside className="contents lg:sticky lg:top-4 lg:grid lg:gap-4">
            <Card title={t("leads.actions")} className="order-first lg:order-none">
              <div className="grid gap-3">
                <Select
                  label={t("leads.fields.stage_key")}
                  value={current.stage_key}
                  disabled={pending}
                  onChange={(e) => change("stage_key", e.target.value)}
                >
                  {stages.map((stage) => (
                    <option key={stage.key} value={stage.key}>
                      {stage.label_pl}
                    </option>
                  ))}
                </Select>
                {!hasKnownResponse(current) && current.stage_key === "new" ? (
                  <Button disabled={pending} onClick={() => change("stage_key", "contacted")}>
                    {t("leads.contacted")}
                  </Button>
                ) : null}
                <div className="grid grid-cols-3 gap-1.5 [&>a]:px-1 [&>a]:text-[12.5px]">
                  {current.phone_e164 ? (
                    <>
                      <a
                        href={`tel:${current.phone_e164}`}
                        className={buttonVariants({ variant: "soft", size: "sm" })}
                      >
                        <Phone />
                        {t("leads.callShort")}
                      </a>
                      <a
                        href={`https://wa.me/${current.phone_e164.slice(1)}`}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: "success", size: "sm" })}
                      >
                        <MessageCircle />
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                  {current.email ? (
                    <a
                      href={`mailto:${current.email}`}
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                    >
                      <Mail />
                      E-mail
                    </a>
                  ) : null}
                </div>
                {team.length > 1 ? (
                  <div>
                    <p className="text-ink-soft mb-1.5 text-[13px] font-medium">
                      {t("leads.fields.assigned_to")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {team.map((member) => (
                        <Button
                          key={member.id}
                          size="sm"
                          variant={current.assigned_to === member.id ? "dark" : "secondary"}
                          disabled={pending}
                          aria-pressed={current.assigned_to === member.id}
                          onClick={() =>
                            change(
                              "assigned_to",
                              current.assigned_to === member.id ? "" : member.id,
                            )
                          }
                        >
                          {member.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
            {documentsCard}
            <Card title={t("leads.note")}>
              <form
                className="grid gap-3"
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
                <label className="grid gap-2 text-sm">
                  {t("leads.noteText")}
                  <textarea
                    name="note"
                    required
                    maxLength={5000}
                    rows={3}
                    className="border-line-strong bg-surface rounded-lg border p-3 text-sm"
                  />
                </label>
                <Button type="submit" disabled={pending}>
                  {t("leads.addNote")}
                </Button>
              </form>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
