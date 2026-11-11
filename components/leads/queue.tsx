"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Phone } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { markContacted } from "@/lib/leads/actions";
import { formatWaiting, HOT_AFTER_MINUTES, plDate } from "@/lib/format";
import type { WaitingLead } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Очередь: лид, который дольше всех без ответа, стоит первым. Таймер слева —
 * главная величина экрана, поэтому он крупный и становится красным через 10 минут.
 */
export function QueueRow({ lead, now }: { lead: WaitingLead; now: string }) {
  const [pending, start] = useTransition();
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(lead.created_at)) / 60000));
  const hot = minutes >= HOT_AFTER_MINUTES;
  const details = [
    plDate(lead.event_date),
    lead.event_type,
    lead.event_city,
    lead.guests ? t("leads.guestCount", { count: lead.guests }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="border-line grid gap-x-4 gap-y-2 border-b py-3.5 last:border-0 sm:grid-cols-[4.75rem_minmax(0,1fr)_auto] sm:items-center">
      <p
        className={cn(
          "text-xl leading-none font-semibold tabular-nums",
          hot ? "text-urgent" : "text-ink-soft",
        )}
      >
        {formatWaiting(minutes)}
      </p>
      <div className="min-w-0">
        <Link href={`/leady/${lead.id}`} className="truncate font-semibold hover:underline">
          {lead.client_name}
        </Link>
        <p className="text-ink-soft text-[13px]">
          {lead.phone_e164 || lead.email || t("leads.noContact")} · {lead.source_label}
        </p>
        {details ? <p className="text-ink-soft text-[13px]">{details}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {lead.phone_e164 ? (
          <a
            href={`tel:${lead.phone_e164}`}
            className={buttonVariants({ variant: "soft", size: "sm" })}
            aria-label={`${t("today.call")} ${lead.client_name}`}
          >
            <Phone className="size-4" />
            {t("today.call")}
          </a>
        ) : null}
        <Button
          size="sm"
          disabled={pending}
          onClick={() => start(() => markContacted(lead.id).then(() => {}))}
        >
          {t("today.contacted")}
        </Button>
      </div>
    </li>
  );
}
