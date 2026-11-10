export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-[2.25rem] leading-tight font-semibold">{title}</h1>
      {subtitle ? <p className="text-ink-soft mt-2">{subtitle}</p> : null}
    </header>
  );
}
