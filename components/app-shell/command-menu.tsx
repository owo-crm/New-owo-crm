"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Plus, Search, User } from "lucide-react";
import { switchOrganization } from "@/lib/auth/actions";
import { quickSearchAction } from "@/lib/leads/quick-search";
import { plDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

/**
 * ⌘K / Ctrl+K: одно место, чтобы найти лида, создать нового, перейти в раздел
 * или переключить бизнес — с любого экрана. Стрелки + Enter, Esc закрывает.
 */
export function CommandMenu({
  links,
  organizations,
  currentOrgId,
}: {
  links: { href: string; label: MessageKey }[];
  organizations: { id: string; name: string }[];
  currentOrgId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [leads, setLeads] = useState<Awaited<ReturnType<typeof quickSearchAction>>>([]);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Каждое открытие — с чистого листа.
    const show = () => {
      setQuery("");
      setLeads([]);
      setActive(0);
      setOpen(true);
      requestAnimationFrame(() => input.current?.focus());
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        show();
      }
    };
    const onOpen = show;
    window.addEventListener("keydown", onKey);
    window.addEventListener("owo:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("owo:command", onOpen);
    };
  }, []);

  // Поиск лидов с небольшой задержкой, чтобы не спрашивать базу на каждую букву.
  useEffect(() => {
    if (query.trim().length < 2) return;
    const id = setTimeout(() => start(async () => setLeads(await quickSearchAction(query))), 150);
    return () => clearTimeout(id);
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const list: Item[] = [
      ...(q.length < 2 ? [] : leads).map((l) => ({
        id: `lead-${l.id}`,
        label: l.client_name,
        hint: [l.stage, l.event_date ? plDate(l.event_date) : null].filter(Boolean).join(", "),
        icon: User,
        run: go(`/leady/${l.id}`),
      })),
    ];
    if (match(t("nav.newLead")))
      list.push({ id: "new-lead", label: t("nav.newLead"), icon: Plus, run: go("/leady/nowy") });
    for (const l of links)
      if (match(t(l.label)))
        list.push({ id: l.href, label: t(l.label), icon: ArrowRight, run: go(l.href) });
    for (const o of organizations)
      if (o.id !== currentOrgId && match(o.name))
        list.push({
          id: `org-${o.id}`,
          label: o.name,
          hint: t("business.switch"),
          icon: Building2,
          run: () => {
            setOpen(false);
            start(() => switchOrganization(o.id));
          },
        });
    return list;
  }, [leads, links, organizations, currentOrgId, query, router]);

  if (!open) return null;
  const current = Math.min(active, Math.max(0, items.length - 1));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("command.title")}
        className="bg-surface pop-shadow w-full max-w-lg overflow-hidden rounded-xl"
      >
        <div className="border-line flex items-center gap-2.5 border-b px-4">
          <Search className="text-ink-faint size-4 shrink-0" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((current + 1) % Math.max(1, items.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((current - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === "Enter") items[current]?.run();
            }}
            placeholder={t("command.placeholder")}
            aria-label={t("command.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
          <kbd className="text-ink-faint border-line rounded border px-1.5 text-[11px]">Esc</kbd>
        </div>
        <ul id="command-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <li className="text-ink-soft px-3 py-6 text-center text-[13.5px]">
              {t("command.empty")}
            </li>
          ) : (
            items.map((item, i) => (
              <li
                key={item.id}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => setActive(i)}
                onClick={item.run}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-[13.5px]",
                  i === current && "bg-surface-2",
                )}
              >
                <item.icon className="text-ink-faint size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint ? (
                  <span className="text-ink-faint truncate text-[12px]">{item.hint}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/** Кнопка «Szukaj» в меню: открывает ⌘K (на телефоне — единственный способ). */
export function CommandButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Щелчок мышью не должен оставлять рамку фокуса на «поле поиска».
        e.currentTarget.blur();
        window.dispatchEvent(new Event("owo:command"));
      }}
      className={cn(
        "text-ink-soft hover:bg-surface-2 hover:text-ink flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
        className,
      )}
    >
      <Search className="size-4" aria-hidden />
      <span className="flex-1 text-left">{t("command.search")}</span>
      <kbd className="text-ink-faint text-[11px]">⌘K</kbd>
    </button>
  );
}
