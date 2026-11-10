import { LogOut } from "lucide-react";
import { BottomNav, SidebarNav } from "@/components/app-shell/nav";
import { requireOrganization } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { appConfig } from "@/lib/config";
import { getTodayData } from "@/lib/leads/dashboard";
import { t } from "@/lib/i18n";

/**
 * Оболочка приложения для вошедших пользователей.
 * Цвет фирмы (--brand) задаётся здесь и доступен всем экранам как bg-brand / text-brand.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, organization } = await requireOrganization();

  const today = await getTodayData();
  return (
    <div
      className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]"
      style={{ "--brand": organization.brandColor } as React.CSSProperties}
    >
      <div className="border-line bg-surface hidden border-r lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col px-4 py-6">
          <div className="px-3">
            <p className="font-display text-[22px] font-semibold">
              {appConfig.productName.toLowerCase()}
            </p>
            <p className="text-ink-soft mt-1.5 flex items-center gap-2 text-sm font-medium">
              <span className="bg-brand size-2 shrink-0 rounded-full" aria-hidden />
              <span className="truncate">{organization.name}</span>
            </p>
          </div>

          <div className="mt-7">
            <SidebarNav waiting={today.waiting_count} />
          </div>

          <div className="border-line mt-auto border-t px-3 pt-4">
            <p className="text-ink-soft truncate text-sm" title={user.email}>
              {user.email}
            </p>
            <form action={signOut} className="mt-2">
              <button
                type="submit"
                className="text-ink-soft hover:bg-surface-2 hover:text-ink -mx-2 flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-bold"
              >
                <LogOut className="size-4" />
                {t("auth.logout")}
              </button>
            </form>
          </div>
        </aside>
      </div>

      <div className="min-w-0">
        <header className="border-line flex items-center justify-between border-b px-4 py-3 lg:hidden">
          <span className="font-display text-lg font-semibold">
            {appConfig.productName.toLowerCase()}
          </span>
          <span className="text-ink-soft flex items-center gap-2 text-sm font-medium">
            <span className="bg-brand size-2 rounded-full" aria-hidden />
            <span className="max-w-[45vw] truncate">{organization.name}</span>
          </span>
        </header>
        <main className="mx-auto w-full max-w-[76rem] px-4 pt-6 pb-28 sm:px-8 lg:px-11 lg:pt-9 lg:pb-14">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
