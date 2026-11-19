import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import type { Thread } from "@/lib/mail/inbox-read";
import { stripQuote } from "@/lib/mail/inbound";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    ...(today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }),
  });
};

/** Список переписок: кто, последнее сообщение, непрочитанные. */
export function ThreadList({ threads, active }: { threads: Thread[]; active?: string }) {
  if (!threads.length) return <p className="text-ink-soft p-5 text-sm">{t("inbox.noThreads")}</p>;
  return (
    <ul className="divide-line divide-y">
      {threads.map((th) => {
        const on = th.counterpart === active;
        const preview = stripQuote(th.last_text).replace(/\s+/g, " ") || th.last_subject;
        return (
          <li key={th.counterpart}>
            <Link
              href={`/poczta?c=${encodeURIComponent(th.counterpart)}`}
              aria-current={on ? "true" : undefined}
              className={cn(
                "flex gap-3 px-4 py-3 transition-colors",
                on ? "bg-surface-2" : "hover:bg-surface-2/60",
              )}
            >
              <Avatar name={th.name || th.counterpart} size={38} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[14px]",
                      th.unread ? "font-bold" : "font-semibold",
                    )}
                  >
                    {th.name || th.counterpart}
                  </span>
                  <span className="text-ink-faint shrink-0 text-[11.5px]">{time(th.last_at)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px]",
                      th.unread ? "text-ink" : "text-ink-soft",
                    )}
                  >
                    {th.last_direction === "out" ? `${t("inbox.you")}: ` : ""}
                    {preview}
                  </span>
                  {th.unread ? (
                    <span className="bg-accent text-accent-ink min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-bold">
                      {th.unread}
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
