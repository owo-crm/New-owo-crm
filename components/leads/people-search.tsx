"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

/** Поиск по списку клиентов и умов: фильтрует по мере ввода, как в лидах. */
export function PeopleSearch({
  base,
  value,
  placeholder,
}: {
  base: string;
  value: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(value);
  const [pending, start] = useTransition();
  const first = useRef(true);
  const box = useRef<HTMLInputElement>(null);
  const lastTyped = useRef(0);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      start(() => router.replace(query ? `${base}?q=${encodeURIComponent(query)}` : base));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const el = box.current;
    if (!el || document.activeElement === el || Date.now() - lastTyped.current > 3000) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  return (
    <div className="relative mb-4 max-w-sm" role="search">
      <Search className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        ref={box}
        value={query}
        onChange={(e) => {
          lastTyped.current = Date.now();
          setQuery(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="border-line-strong bg-surface h-10 w-full rounded-lg border pr-9 pl-9 text-sm"
      />
      {pending ? (
        <Loader2 className="text-ink-faint absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
      ) : null}
    </div>
  );
}
