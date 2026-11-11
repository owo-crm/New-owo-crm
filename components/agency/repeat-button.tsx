"use client";

import { useState, useTransition } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { repeatRetainersAction } from "@/lib/agency/actions";
import { t } from "@/lib/i18n";

/** «Powtórz abonamenty»: копирует абонементы прошлого месяца черновиками в выбранный месяц. */
export function RepeatRetainersButton({ month }: { month: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string>();
  return (
    <div className="grid gap-1">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await repeatRetainersAction(month);
            setMessage(
              r.error ??
                (r.count ? t("agency.repeatDone", { count: r.count }) : t("agency.repeatNone")),
            );
          })
        }
      >
        <Repeat />
        {t("agency.repeat")}
      </Button>
      {message ? (
        <p role="status" className="text-ink-soft max-w-[22rem] text-[13px]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
