"use client";
import { useEffect } from "react";

/**
 * На экране лида меню сворачивается в полоску с иконками (как в макете): рядом колонка лидов
 * и карточка, им нужно место. Уходя со страницы, возвращаем то, что выбрал человек.
 */
export function CompactNav() {
  useEffect(() => {
    const shell = document.getElementById("shell");
    if (!shell || shell.dataset.nav === "rail") return;
    shell.dataset.nav = "rail";
    return () => {
      shell.dataset.nav = "wide";
    };
  }, []);
  return null;
}
