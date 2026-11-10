import { LogOut } from "lucide-react";
import { BottomNav, SidebarNav } from "@/components/app-shell/nav";
import { BusinessSwitcher } from "@/components/app-shell/business-switcher";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { getOrganizations, requireOrganization } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { appConfig } from "@/lib/config";
import { getWorkQueue } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";

/**
 * Оболочка приложения для вошедших пользователей.
 * Цвет фирмы (--brand) задаётся здесь и доступен всем экранам как bg-brand / text-brand.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, organization } = await requireOrganization();
  const organizations = await getOrganizations();
  const queue = await getWorkQueue();
  return (
    <div
      className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]"
      style={{ "--brand": organization.brandColor } as React.CSSProperties}
    >
      <div className="border-line bg-surface hidden border-r lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col px-4 py-6">
          <div className="grid gap-3">
            <p className="font-display px-3 text-[20px] font-semibold">
              {appConfig.productName.toLowerCase()}
            </p>
            <BusinessSwitcher
              current={organization}
              organizations={organizations}
              canCreate={user.isPlatformAdmin}
            />
          </div>

          <div className="mt-7">
            <SidebarNav waiting={queue.waiting_count} />
          </div>

          <div className="border-line mt-auto border-t px-3 pt-4">
            <p className="text-ink-soft truncate text-sm" title={user.email}>
              {user.email}
            </p>
            <div className="mt-2 grid gap-0.5">
              <ThemeToggle className="text-ink-soft hover:bg-surface-2 hover:text-ink -mx-2 flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-bold" />
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-ink-soft hover:bg-surface-2 hover:text-ink -mx-2 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-bold"
                >
                  <LogOut className="size-4" />
                  {t("auth.logout")}
                </button>
              </form>
            </div>
          </div>
        </aside>
      </div>

      <div className="min-w-0">
        <header className="border-line bg-surface sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-2.5 lg:hidden">
          <BusinessSwitcher
            current={organization}
            organizations={organizations}
            canCreate={user.isPlatformAdmin}
            className="min-w-0 flex-1"
          />
          <ThemeToggle
            className="text-ink-soft hover:text-ink flex size-10 shrink-0 items-center justify-center rounded-lg"
            iconOnly
          />
        </header>
        <main className="mx-auto w-full max-w-[76rem] px-4 pt-6 pb-28 sm:px-8 lg:px-11 lg:pt-9 lg:pb-14">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
