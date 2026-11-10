import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatWaiting, HOT_AFTER_MINUTES } from "@/lib/season";

export type LeadTicketProps = {
  waitingMinutes: number;
  source: string;
  name: string;
  details: string;
  eventDate?: string; // уже отформатированная дата, напр. «sob 14.06.2027»
  dateStatus?: "free" | "busy";
  actions?: React.ReactNode;
  className?: string;
};

/**
 * «Бон» нового лида: сколько ждёт ответа (красный — дольше 10 минут), кто, что, дата
 * и свободна ли она. Нижний край зубчиками — как чек с барного принтера.
 */
export function LeadTicket({
  waitingMinutes,
  source,
  name,
  details,
  eventDate,
  dateStatus,
  actions,
  className,
}: LeadTicketProps) {
  const hot = waitingMinutes >= HOT_AFTER_MINUTES;
  return (
    <article
      className={cn(
        "ticket-edge bg-surface-2 relative rounded-t-[14px] px-[18px] pt-[18px] pb-[26px]",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={cn(
            "font-display text-[34px] leading-none font-semibold",
            hot && "text-urgent",
          )}
        >
          {formatWaiting(waitingMinutes)}
        </p>
        <p className="text-ink-soft max-w-[55%] text-right text-xs font-bold break-words">
          {source}
        </p>
      </div>
      <h3 className="mt-3.5 text-[19px] font-bold break-words">{name}</h3>
      <p className="text-ink-soft mt-1 text-sm leading-relaxed">{details}</p>
      {eventDate ? (
        <p className="border-line-strong mt-3.5 flex justify-between border-y-[1.5px] border-dashed py-2.5 text-[15px] font-bold">
          <span>{eventDate}</span>
          {dateStatus ? (
            <span className={dateStatus === "free" ? "text-ok" : "text-urgent"}>
              {t(dateStatus === "free" ? "season.dateFree" : "season.dateBusy")}
            </span>
          ) : null}
        </p>
      ) : null}
      {actions ? <div className="mt-4 flex gap-2">{actions}</div> : null}
    </article>
  );
}

/** Пустой «бон»: что здесь появится. */
export function EmptyTicket({ title, text }: { title: string; text: string }) {
  return (
    <div className="border-line-strong text-ink-soft rounded-t-[14px] border-[1.5px] border-dashed px-[18px] py-6">
      <p className="font-display text-ink text-[34px] leading-none font-semibold">
        {formatWaiting(0)}
      </p>
      <p className="text-ink mt-3.5 text-[19px] font-bold break-words">{title}</p>
      <p className="mt-1 text-sm leading-relaxed">{text}</p>
    </div>
  );
}
