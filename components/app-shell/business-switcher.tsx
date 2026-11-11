"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { switchOrganization } from "@/lib/auth/actions";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Выбор бизнеса: у одного аккаунта их может быть несколько (Barowo, OWO Ads, клиенты). */
export function BusinessSwitcher({
  current,
  organizations,
  canCreate,
  className,
}: {
  current: { id: string; name: string; brandColor: string };
  organizations: { id: string; name: string }[];
  canCreate?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  // У клиента бизнес один: показываем название, а не выпадающий список из одного пункта.
  if (organizations.length < 2 && !canCreate)
    return (
      <p
        className={cn(
          "flex h-9 min-w-0 items-center gap-2.5 px-2.5 text-[13.5px] font-semibold",
          className,
        )}
      >
        <span
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ background: current.brandColor }}
          aria-hidden
        />
        <span className="truncate">{current.name}</span>
      </p>
    );

  return (
    <label
      className={cn(
        "hover:bg-surface-2 relative flex h-10 items-center gap-2.5 rounded-lg px-2.5 transition-colors lg:h-9",
        className,
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-[3px]"
        style={{ background: current.brandColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{current.name}</span>
      <ChevronsUpDown className="text-ink-faint size-4 shrink-0" />
      <span className="sr-only">{t("business.switch")}</span>
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={current.id}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "__new") router.push("/biznes/nowy");
          else start(() => switchOrganization(value));
        }}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        {canCreate ? <option value="__new">＋ {t("business.new")}</option> : null}
      </select>
    </label>
  );
}
