import Link from "next/link";
import { ArrowLeft, Paperclip, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { ThreadMessage } from "@/lib/mail/inbox-read";
import type { Template } from "@/lib/mailing/repository";
import { stripQuote } from "@/lib/mail/inbound";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Переписка с одним клиентом в виде чата: клиент слева, фирма справа. */
export function ThreadView({
  counterpart,
  messages,
  lead,
  name,
  templates,
  mailReady,
}: {
  counterpart: string;
  messages: ThreadMessage[];
  lead: { id: string; client_name: string } | null;
  /** Имя из заголовка From, если лида нет. */
  name: string | null;
  templates: Template[];
  mailReady: boolean;
}) {
  const title = lead?.client_name || name || counterpart;
  // Тему показываем над сообщением, только когда она сменилась.
  const clean = (x: string) => x.replace(/^\s*((re|odp|aw|fwd?)\s*:\s*)+/i, "").trim();
  const subjects = messages.map((m, i) => {
    const subject = clean(m.subject);
    const before = messages
      .slice(0, i)
      .map((x) => clean(x.subject))
      .filter(Boolean)
      .at(-1);
    return subject && subject !== before ? subject : "";
  });
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-line flex items-center gap-3 border-b px-4 py-3">
        <Link
          href="/poczta"
          aria-label={t("inbox.back")}
          className="text-ink-soft hover:text-ink -ml-1 rounded-lg p-1 md:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <Avatar name={title} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-ink-faint truncate text-[12.5px]">{counterpart}</p>
        </div>
        {lead ? (
          <Link
            href={`/leady/${lead.id}`}
            className="border-line-strong hover:bg-surface-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold"
          >
            <UserRound className="size-3.5" />
            {t("inbox.openLead")}
          </Link>
        ) : null}
      </header>

      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5">
        {messages.length === 0 ? (
          <li className="text-ink-soft m-auto max-w-xs text-center text-sm">
            {t("inbox.firstMessage")}
          </li>
        ) : null}
        {messages.map((m, i) => {
          const mine = m.direction === "out";
          const subject = subjects[i];
          const showSubject = Boolean(subject);
          const body = m.body_pending
            ? t("inbox.loading")
            : mine
              ? m.body_text
              : stripQuote(m.body_text);
          return (
            <li
              key={m.id}
              className={cn(
                "flex max-w-[min(36rem,88%)] flex-col gap-1",
                mine ? "items-end self-end" : "items-start self-start",
              )}
            >
              {showSubject ? (
                <span className="text-ink-faint px-1 text-[11.5px] font-semibold tracking-wide uppercase">
                  {subject}
                </span>
              ) : null}
              <div
                className={cn(
                  "rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap",
                  mine
                    ? "bg-accent text-accent-ink rounded-br-md"
                    : "bg-surface border-line rounded-bl-md border",
                  m.body_pending && "italic opacity-70",
                )}
              >
                {body || t("inbox.emptyBody")}
              </div>
              {m.attachments.length ? (
                <span className="text-ink-soft flex flex-wrap gap-1.5 px-1 text-[12px]">
                  {m.attachments.map((a, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <Paperclip className="size-3" />
                      {a.filename}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="text-ink-faint px-1 text-[11px]">
                {mine && m.sender ? `${m.sender} · ` : ""}
                {stamp(m.created_at)}
              </span>
            </li>
          );
        })}
      </ol>

      <Composer to={counterpart} templates={templates} mailReady={mailReady} />
    </section>
  );
}
