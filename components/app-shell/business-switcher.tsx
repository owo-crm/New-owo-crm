"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { OrgMark } from "@/components/ui/avatar";
import { switchOrganization } from "@/lib/auth/actions";
import { avatarUrl } from "@/lib/avatars/image";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Org = { id: string; name: string; avatarVersion: number | null };

/**
 * Выбор бизнеса: у одного аккаунта их может быть несколько (Barowo, OWO Ads, клиенты).
 * Слева мини-иконка кабинета. Длинное название переносится на вторую строку, а не режется;
 * в свёрнутом меню видна только иконка (подпись — в title).
 */
export function BusinessSwitcher({
  current,
  organizations,
  canCreate,
  className,
}: {
  current: Org;
  organizations: Org[];
  canCreate?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const mark = (
    <OrgMark
      id={current.id}
      name={current.name}
      src={avatarUrl("o", current.id, current.avatarVersion)}
      size={24}
    />
  );
  const label = (
    <span className="line-clamp-2 min-w-0 flex-1 text-[13.5px] leading-tight font-semibold break-words group-data-[nav=rail]/shell:lg:hidden">
      {current.name}
    </span>
  );

  // У клиента бизнес один: показываем название, а не выпадающий список из одного пункта.
  if (organizations.length < 2 && !canCreate)
    return (
      <p
        title={current.name}
        className={cn(
          "flex min-h-10 min-w-0 items-center gap-2.5 px-2 py-1.5 group-data-[nav=rail]/shell:lg:justify-center",
          className,
        )}
      >
        {mark}
        {label}
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
          title={current.name}
          className={cn(
            "hover:bg-surface-2 flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors group-data-[nav=rail]/shell:lg:justify-center",
            className,
          )}
        >
          {mark}
          {label}
          <ChevronsUpDown className="text-ink-faint size-4 shrink-0 group-data-[nav=rail]/shell:lg:hidden" />
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
