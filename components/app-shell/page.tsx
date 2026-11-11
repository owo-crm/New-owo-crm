import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  aside,
  back,
}: {
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
  /** Вложенный экран: ссылка «назад» над заголовком (решение 024). */
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="max-w-full min-w-0">
        {back ? (
          <Link
            href={back.href}
            className="text-ink-soft hover:text-ink mb-2 -ml-1 inline-flex h-8 items-center gap-1 rounded-md pr-2 pl-1 text-[13px] font-medium transition-colors hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.015em] break-words">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-ink-soft mt-0.5 max-w-[44rem] text-[13.5px]">{subtitle}</p>
        ) : null}
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
      className={cn("border-line bg-surface rounded-xl border px-4 py-4 sm:px-5", className)}
    >
      {title ? <h2 className="mb-3 text-[13.5px] font-semibold">{title}</h2> : null}
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
