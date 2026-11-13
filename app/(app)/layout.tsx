import Link from "next/link";
import { cookies } from "next/headers";
import { LogOut, Plus } from "lucide-react";
import { BottomNav, GroupedNav } from "@/components/app-shell/nav";
import { navItems } from "@/components/app-shell/nav-items";
import { BusinessSwitcher } from "@/components/app-shell/business-switcher";
import { CommandButton, CommandMenu } from "@/components/app-shell/command-menu";
import { NavToggle } from "@/components/app-shell/nav-toggle";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { avatarUrl } from "@/lib/avatars/image";
import { buttonVariants } from "@/components/ui/button";
import { getOrganizations, requireOrganization } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { appConfig } from "@/lib/config";
import { getWorkQueue } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";
import { isAgency } from "@/lib/presets";

/**
 * Оболочка (решение 032): слева — логотип, бизнес, меню группами и карточка пользователя;
 * сверху — поиск и главное действие. Без лишних подписей; белые блоки на светлом фоне.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, organization } = await requireOrganization();
  const organizations = await getOrganizations();
  const queue = await getWorkQueue();
  const ctx = {
    agency: isAgency(organization.industryPreset),
    modules: organization.modules,
    admin: organization.role !== "member",
  };
  const links = navItems(ctx).map(({ href, label }) => ({ href, label }));
  const name = user.fullName || user.email;
  // Меню: cookie owo_nav = wide | rail. Состояние зафиксировано кнопкой, а не наведением.
  const nav = (await cookies()).get("owo_nav")?.value === "rail" ? "rail" : "wide";
  return (
    <div
      id="shell"
      data-nav={nav}
      className="group/shell min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:data-[nav=rail]:grid-cols-[4.25rem_minmax(0,1fr)]"
    >
      {/*
        Решение 038: меню сворачивается в полоску с иконками по кнопке в верхней полосе.
        Состояние живёт в cookie owo_nav, поэтому страница открывается сразу в нужном виде.
        Подписи прячутся обрезкой: ширина меняется плавно, текст не переносится.
      */}
      {/*
        Меню прибито к окну (sticky + высота экрана): при прокрутке страницы оно остаётся на месте,
        а длинный список пунктов прокручивается внутри. В свёрнутом виде подписи не обрезаются,
        а убираются целиком — видны только иконки, название пункта всплывает в подсказке.
      */}
      <aside
        id="nav"
        className="bg-surface border-line hidden border-r lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start lg:overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 py-5 group-data-[nav=rail]/shell:px-2.5">
          <div className="flex items-center gap-2 group-data-[nav=rail]/shell:flex-col">
            <Link
              href="/dzisiaj"
              title={appConfig.productName}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-1 group-data-[nav=rail]/shell:flex-none group-data-[nav=rail]/shell:px-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- статичный логотип */}
              <img
                src="/icons/mark.png"
                alt=""
                width={32}
                height={32}
                className="size-8 shrink-0 rounded-lg"
              />
              <span className="truncate text-[17px] font-bold tracking-tight group-data-[nav=rail]/shell:hidden">
                {appConfig.productName}
              </span>
            </Link>
            <NavToggle className="text-ink-faint hover:text-ink hover:bg-surface-2 flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors" />
          </div>
          <BusinessSwitcher
            current={organization}
            organizations={organizations}
            canCreate={user.isPlatformAdmin}
            className="border-line rounded-xl border"
          />
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <GroupedNav ctx={ctx} waiting={queue.waiting_count} />
          </div>
          <div className="border-line flex items-center gap-3 border-t px-1 pt-4 group-data-[nav=rail]/shell:px-0">
            <Link
              href="/ustawienia"
              title={name}
              className="shrink-0 group-data-[nav=rail]/shell:mx-auto"
            >
              <Avatar name={name} src={avatarUrl("u", user.id, user.avatarVersion)} size={36} />
            </Link>
            <div className="min-w-0 flex-1 group-data-[nav=rail]/shell:hidden">
              <p className="truncate text-[13.5px] font-semibold">{name}</p>
              <p className="text-ink-faint truncate text-[12px]">{user.email}</p>
            </div>
            <form action={signOut} className="group-data-[nav=rail]/shell:hidden">
              <button
                type="submit"
                aria-label={t("auth.logout")}
                title={t("auth.logout")}
                className="text-ink-faint hover:text-urgent hover:bg-urgent/10 flex size-9 items-center justify-center rounded-lg transition-colors"
              >
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Верхняя полоса: поиск ⌘K, тема, новый лид (компьютер). */}
        <div className="bg-bg/90 sticky top-0 z-20 hidden items-center gap-3 px-10 py-3 backdrop-blur lg:flex">
          <CommandButton className="bg-surface border-line h-10 max-w-sm rounded-xl border px-3.5" />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle
              className="bg-surface border-line text-ink-soft hover:text-ink flex size-10 items-center justify-center rounded-xl border"
              iconOnly
            />
            <Link href="/leady/nowy" className={buttonVariants({ variant: "primary", size: "lg" })}>
              <Plus />
              {t("nav.newLead")}
            </Link>
          </div>
        </div>
        <header className="border-line bg-surface/95 sticky top-0 z-20 flex items-center gap-2 border-b px-3 py-2 backdrop-blur lg:hidden">
          <BusinessSwitcher
            current={organization}
            organizations={organizations}
            canCreate={user.isPlatformAdmin}
            className="min-w-0 flex-1"
          />
          <CommandButton className="w-10 justify-center px-0 [&>kbd]:hidden [&>span]:hidden" />
          <ThemeToggle
            className="text-ink-soft hover:text-ink flex size-10 shrink-0 items-center justify-center rounded-lg"
            iconOnly
          />
        </header>
        <main className="mx-auto w-full max-w-[80rem] px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-4 lg:pb-12">
          {children}
        </main>
      </div>

      <BottomNav ctx={ctx} waiting={queue.waiting_count} />
      <CommandMenu links={links} organizations={organizations} currentOrgId={organization.id} />
    </div>
  );
}
