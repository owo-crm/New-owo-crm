"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LeadTicket, EmptyTicket } from "./lead-ticket";
import { eventDateLabel } from "./lead-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { editLead, undoLead } from "@/lib/leads/actions";
import type { Lead } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { useTransition } from "react";
export function WaitingTickets({
  leads,
  now,
  total,
}: {
  leads: Lead[];
  now: string;
  total: number;
}) {
  const [time, setTime] = useState(Date.parse(now));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [undo, setUndo] = useState<{ id: string; eventId: string }>();
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(undefined), 8000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    const initial = Date.parse(now);
    const started = performance.now();
    const tick = () => setTime(initial + performance.now() - started);
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [now]);
  return (
    <>
      {error ? (
        <p role="alert" className="text-urgent mb-3">
          {error}
        </p>
      ) : null}
      {undo ? (
        <div
          role="status"
          className="bg-surface-2 mb-4 flex items-center justify-between gap-3 rounded-[14px] px-4 py-2"
        >
          <span>{t("leads.saved")}</span>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await undoLead(undo.id, undo.eventId);
                setUndo(undefined);
                if (result.error) setError(result.error);
              })
            }
          >
            {t("leads.undo")}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(272px,1fr))]">
        {leads.length ? (
          leads.map((lead) => (
            <LeadTicket
              key={lead.id}
              waitingMinutes={(time - Date.parse(lead.created_at)) / 60000}
              source={lead.source_label}
              name={lead.client_name}
              details={
                [
                  lead.event_type,
                  lead.event_city,
                  lead.guests !== null ? t("leads.guestCount", { count: lead.guests }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || t("leads.noDetails")
              }
              eventDate={lead.event_date ? eventDateLabel(lead.event_date) : undefined}
              actions={
                <>
                  <Link
                    href={`/leady/${lead.id}`}
                    className={buttonVariants({ variant: "secondary" })}
                  >
                    {t("leads.open")}
                  </Link>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await editLead(
                          lead.id,
                          lead.updated_at,
                          "stage_key",
                          lead.stage_key === "new" ? "contacted" : lead.stage_key,
                        );
                        if (result.error) setError(result.error);
                        else if (result.eventId) setUndo({ id: lead.id, eventId: result.eventId });
                      })
                    }
                  >
                    {t("leads.contacted")}
                  </Button>
                </>
              }
            />
          ))
        ) : (
          <EmptyTicket title={t("today.emptyTicketTitle")} text={t("today.emptyTicketText")} />
        )}
      </div>
      {total > leads.length ? (
        <Link href="/leady" className="mt-4 inline-flex min-h-11 items-center underline">
          {t("today.moreWaiting", { count: total })}
        </Link>
      ) : null}
    </>
  );
}
