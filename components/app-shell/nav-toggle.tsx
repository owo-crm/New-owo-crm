"use client";
import { PanelLeft } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * Кнопка «свернуть меню»: пишет cookie owo_nav и сразу переключает data-nav на оболочке.
 * Состояние зафиксировано — меню не ездит само от того, где оказался курсор.
 */
export function NavToggle({ className }: { className?: string }) {
  function toggle() {
    const shell = document.getElementById("shell");
    if (!shell) return;
    const next = shell.dataset.nav === "rail" ? "wide" : "rail";
    shell.dataset.nav = next;
    document.cookie = `owo_nav=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("shell.collapseNav")}
      title={t("shell.collapseNav")}
      aria-controls="nav"
      className={className}
    >
      <PanelLeft className="size-[18px]" />
    </button>
  );
}
