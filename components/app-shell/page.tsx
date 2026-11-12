import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  aside,
  back,
}: {
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
  /** Вложенный экран: ссылка «назад» над заголовком (решение 024). */
  back?: { href: string; label: string };
}) {
  // Название раздела уже видно в меню, поэтому вверху его не повторяем: заголовок
  // остаётся только у вложенных экранов, где он говорит, что именно открыто.
  if (!back)
    return aside ? (
      <header className="mb-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
        {aside}
      </header>
    ) : null;

  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="max-w-full min-w-0">
        <nav aria-label="breadcrumb" className="text-ink-faint mb-1 text-[13px]">
          <Link
            href={back.href}
            className="hover:text-ink inline-flex items-center gap-1 transition-colors"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        </nav>
        <h1 className="text-[24px] leading-8 font-bold tracking-[-0.02em] break-words">{title}</h1>
      </div>
      {aside}
    </header>
  );
}

/** Крупная цифра с подписью (показатели вверху экрана). */
export function Stat({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[22px] leading-none font-semibold tabular-nums">{value}</p>
      <p className="text-ink-soft mt-1.5 text-[13px]">{label}</p>
    </div>
  );
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-line bg-surface rounded-2xl border px-4 py-4 shadow-[var(--shadow)] sm:px-5",
        className,
      )}
    >
      {title ? <h2 className="mb-3 text-[15px] font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Пустой экран: что здесь будет и что сделать сейчас. */
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-line rounded-xl border border-dashed px-6 py-12 text-center sm:px-10",
        className,
      )}
    >
      <Icon className="text-ink-faint mx-auto size-6" />
      <h2 className="mt-3 text-[13.5px] font-semibold">{title}</h2>
      <p className="text-ink-soft mx-auto mt-1 max-w-[30rem] text-[13.5px]">{text}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}
