"use client";
import { MessageCircle, Phone } from "lucide-react";
import { hasKnownResponse } from "@/lib/leads/response";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/app-shell/page";
import { StageBar } from "./stage-bar";
import { LeadTabs } from "./lead-tabs";
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
  documentsCount,
  initialTab,
}: {
  lead: Lead;
  stages: PipelineStage[];
  team: { id: string; name: string }[];
  history: LeadEvent[];
  documentsCard?: React.ReactNode;
  attachmentsCard?: React.ReactNode;
  paymentsCard?: React.ReactNode;
  agencyCard?: React.ReactNode;
  documentsCount?: number;
  initialTab?: string;
}) {
  const [current, optimistic] = useOptimistic(lead, (state: Lead, patch: Partial<Lead>) => ({
    ...state,
    ...patch,
  }));
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<EditableField | null>(null);
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
      <p className="text-ink-soft -mt-3 mb-4 text-[13px]">
        #{current.number} · {current.source_label}
      </p>
      <div className="border-line bg-surface mb-5 rounded-2xl border px-3 py-2.5 shadow-[var(--shadow)]">
        <StageBar
          stages={stages}
          current={current.stage_key}
          disabled={pending}
          onChange={(key) => change("stage_key", key)}
        />
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {current.phone_e164 ? (
          <>
            <a href={`tel:${current.phone_e164}`} className={buttonVariants({ variant: "soft" })}>
              <Phone />
              {t("leads.call")}
            </a>
            <a
              href={`https://wa.me/${current.phone_e164.slice(1)}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "success" })}
            >
              <MessageCircle />
              {t("leads.whatsapp")}
            </a>
          </>
        ) : null}
        {current.email ? (
          <a href={`mailto:${current.email}`} className={buttonVariants({ variant: "secondary" })}>
            {t("leads.email")}
          </a>
        ) : null}
        {/* Кнопка нужна только на первом этапе: дальше этап меняют дорожкой выше. */}
        {!hasKnownResponse(current) && current.stage_key === "new" ? (
          <Button disabled={pending} onClick={() => change("stage_key", "contacted")}>
            {t("leads.contacted")}
          </Button>
        ) : null}
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
      <LeadTabs
        initial={initialTab}
        tabs={[
          {
            key: "data",
            label: "leads.tabData",
            content: (
              <div className="gap-5 lg:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
                {GROUPS.map((group) => (
                  <Card key={group.title} title={t(group.title)} tone={group.tone}>
                    <dl className="grid gap-x-6 sm:grid-cols-2">
                      {group.fields.map((field) => (
                        <div
                          key={field}
                          className="border-line border-b py-2.5 last:border-0 sm:[&:nth-last-child(2)]:border-0"
                        >
                          <dt className="text-ink-faint text-xs font-semibold">
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
                                className="hover:bg-surface-2 -mx-2 mt-0.5 flex min-h-8 w-full items-center justify-between gap-3 rounded-lg px-2 py-1 text-left"
                              >
                                <span className="min-w-0 break-words">{displayFor(field)}</span>
                                <span className="text-ink-faint shrink-0 text-xs">
                                  {t("leads.edit")}
                                </span>
                              </button>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                ))}
                <Card title={t("leads.fields.message")} tone="var(--hold)">
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
                </Card>
                <Card title={t("leads.note")} tone="var(--info)">
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
              </div>
            ),
          },
          {
            key: "docs",
            label: "leads.tabDocs",
            count: documentsCount,
            content: (
              <div className="gap-5 lg:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
                {agencyCard}
                {documentsCard}
                {attachmentsCard}
              </div>
            ),
          },
          { key: "money", label: "leads.tabMoney", content: paymentsCard },
          {
            key: "history",
            label: "leads.tabHistory",
            content: (
              <div className="grid items-start gap-5">
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
                        {event.type === "document_generated" &&
                        typeof event.payload.number === "string" ? (
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
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
