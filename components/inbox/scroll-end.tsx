"use client";
import { useEffect, useRef } from "react";

/** Переписка открывается на последнем сообщении, как в мессенджере; новые — тоже прокручиваются. */
export function ScrollEnd({ count }: { count: number }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const list = ref.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);
  return <li ref={ref} aria-hidden className="h-0 shrink-0" />;
}
