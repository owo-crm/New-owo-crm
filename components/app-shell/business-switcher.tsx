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
  return (
    <label
      className={cn(
        "border-line hover:border-line-strong bg-surface relative flex h-10 items-center gap-2.5 rounded-xl border px-3",
        className,
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: current.brandColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm font-bold">{current.name}</span>
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
