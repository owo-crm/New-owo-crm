import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 lg:mb-7">
      <div className="max-w-full min-w-0">
        <h1 className="font-display text-[clamp(2.1rem,4.5vw,2.75rem)] leading-none font-semibold tracking-[-0.01em] break-words">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-ink-soft mt-2.5 max-w-[40rem] text-base">{subtitle}</p>
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
      <p className="font-display text-[clamp(1.5rem,3vw,1.9rem)] leading-none font-semibold">
        {value}
      </p>
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
      className={cn("border-line bg-surface rounded-[22px] border px-5 py-5 sm:px-6", className)}
    >
      {title ? <h2 className="font-display mb-2 text-xl font-medium">{title}</h2> : null}
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
        "border-line-strong rounded-[22px] border border-dashed px-6 py-14 text-center sm:px-10",
        className,
      )}
    >
      <Icon className="text-ink-soft mx-auto size-9" />
      <h2 className="font-display mt-4 text-2xl font-medium">{title}</h2>
      <p className="text-ink-soft mx-auto mt-2 max-w-[30rem]">{text}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </section>
  );
}
