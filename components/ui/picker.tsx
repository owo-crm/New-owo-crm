"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Свой выпадающий список вместо системного <select> (решение 029): единый вид в обеих темах,
 * поиск при длинном списке, клавиатура (стрелки, Enter, Esc, ввод букв).
 * API совместим с <select>: те же <option> внутри, value/defaultValue, name (скрытое поле
 * для форм), onChange получает { target: { value } } — замена без переписывания логики.
 *
 * Список рисуется порталом в <body> и позиционируется по месту кнопки. Иначе его режут
 * карточки и правило overflow у страницы, и он прячется под соседними блоками.
 */
type Option = { value: string; label: string; disabled?: boolean };

type PickerProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (event: { target: { value: string } }) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** Свой вид кнопки (например, переключатель бизнеса). */
  trigger?: ReactNode;
  /** Меню на всю ширину кнопки или шире. */
  menuClassName?: string;
};

/**
 * Классы оформления старого <select> (рамка, фон, высота) к обёртке не применяем —
 * у списка своё оформление; оставляем только раскладку (ширина, flex, отступы снаружи).
 */
function layoutOnly(className?: string) {
  return className
    ?.split(/\s+/)
    .filter(
      (c) =>
        !/^(lg:)?(border|bg-|h-\d|rounded|px-|py-|text-|placeholder|hover:|focus:|aria-)/.test(c),
    )
    .join(" ");
}

function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string; children?: ReactNode; disabled?: boolean }>;
    if (el.type === "option") {
      const label = Children.toArray(el.props.children).join("");
      out.push({ value: String(el.props.value ?? label), label, disabled: el.props.disabled });
    } else if (el.props.children) out.push(...readOptions(el.props.children));
  });
  return out;
}

export function Picker({
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  required,
  id,
  className,
  children,
  trigger,
  menuClassName,
  ...aria
}: PickerProps) {
  const options = useMemo(() => readOptions(children), [children]);
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  const selected = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  // Кнопка у правого края — меню раскрывается влево, чтобы не уйти за экран.
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const searchable = options.length > 6;
  // Координаты списка: считаем по кнопке, потому что список живёт в <body>.
  const [box, setBox] = useState<{ top: number; left: number; width: number; up: boolean }>();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Клик вне списка закрывает его.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Пересчёт положения: при открытии, при прокрутке страницы и при смене размера окна.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 192);
      const below = window.innerHeight - r.bottom;
      // Не хватает места снизу, а сверху больше — раскрываем вверх.
      const up = below < 240 && r.top > below;
      setBox({
        top: up ? r.top - 4 : r.bottom + 4,
        left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
        width,
        up,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (searchable ? search.current : list.current)?.focus();
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, searchable]);

  function show() {
    if (disabled) return;
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === current),
      ),
    );
    setOpen(true);
  }

  function choose(o: Option | undefined) {
    if (!o || o.disabled) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value } });
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[active]);
    }
  }

  return (
    <div ref={root} className={cn("relative min-w-0", layoutOnly(className))}>
      {name ? <input type="hidden" name={name} value={current} required={required} /> : null}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        {...aria}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            show();
          }
        }}
        className={cn(
          trigger
            ? "w-full text-left"
            : "border-line-strong bg-surface text-ink hover:border-ink-faint flex h-10 w-full items-center gap-2 rounded-lg border px-3 text-left text-[14px] transition-colors duration-150 lg:h-9 lg:text-[13.5px]",
          "aria-invalid:border-urgent disabled:pointer-events-none disabled:opacity-50",
          open && !trigger && "border-ink",
        )}
      >
        {trigger ?? (
          <>
            <span className={cn("min-w-0 flex-1 truncate", !selected && "text-ink-faint")}>
              {selected?.label ?? "—"}
            </span>
            <ChevronsUpDown className="text-ink-faint size-4 shrink-0" aria-hidden />
          </>
        )}
      </button>

      {open && box
        ? createPortal(
            <div
              ref={menu}
              style={{
                position: "fixed",
                top: box.up ? undefined : box.top,
                bottom: box.up ? window.innerHeight - box.top : undefined,
                left: box.left,
                width: box.width,
              }}
              className={cn(
                "bg-surface pop-shadow z-[70] overflow-hidden rounded-lg",
                menuClassName,
              )}
              onKeyDown={onKey}
            >
              {searchable ? (
                <div className="border-line flex items-center gap-2 border-b px-3">
                  <Search className="text-ink-faint size-4 shrink-0" aria-hidden />
                  <input
                    ref={search}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    placeholder={t("picker.search")}
                    aria-label={t("picker.search")}
                    aria-controls={listId}
                    className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none focus-visible:outline-none lg:h-9 lg:text-[13.5px]"
                  />
                </div>
              ) : null}
              <ul
                ref={list}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-label={aria["aria-label"]}
                className="max-h-64 overflow-y-auto p-1 outline-none"
              >
                {shown.length === 0 ? (
                  <li className="text-ink-soft px-3 py-3 text-center text-[13px]">
                    {t("command.empty")}
                  </li>
                ) : (
                  shown.map((o, i) => (
                    <li
                      key={o.value}
                      role="option"
                      aria-selected={o.value === current}
                      aria-disabled={o.disabled || undefined}
                      onMouseMove={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cn(
                        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px]",
                        i === active && "bg-surface-2",
                        o.disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="min-w-0 flex-1">{o.label}</span>
                      {o.value === current ? (
                        <Check className="text-accent size-4 shrink-0" aria-hidden />
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
