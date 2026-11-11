"use client";
import { SunMoon } from "lucide-react";
import { t } from "@/lib/i18n";

/** Переключатель темы: пишет cookie owo_theme и сразу меняет <html data-theme>. */
export function ThemeToggle({ className, iconOnly }: { className?: string; iconOnly?: boolean }) {
  function toggle() {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === "dark" ||
      (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    document.cookie = `owo_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("shell.theme")}
      title={t("shell.theme")}
      className={className}
    >
      <SunMoon className={iconOnly ? "size-[18px]" : "text-ink-faint size-4"} />
      {iconOnly ? null : <span>{t("shell.theme")}</span>}
    </button>
  );
}
