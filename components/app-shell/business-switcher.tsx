"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
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
    <Picker
      className={className}
      aria-label={t("business.switch")}
      value={current.id}
      disabled={pending}
      menuClassName="min-w-[15rem]"
      onChange={(e) => {
        const value = e.target.value;
        if (value === "__new") router.push("/biznes/nowy");
        else start(() => switchOrganization(value));
      }}
      trigger={
        <span
          className={cn(
            "hover:bg-surface-2 flex h-10 items-center gap-2.5 rounded-lg px-2.5 transition-colors lg:h-9",
            className,
          )}
        >
          <span
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ background: current.brandColor }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
            {current.name}
          </span>
          <ChevronsUpDown className="text-ink-faint size-4 shrink-0" />
        </span>
      }
    >
      {organizations.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
      {canCreate ? <option value="__new">＋ {t("business.new")}</option> : null}
    </Picker>
  );
}
