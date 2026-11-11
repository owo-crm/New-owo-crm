"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requestModuleAction } from "@/lib/billing/actions";
import { t } from "@/lib/i18n";

/** «Poproś o moduł»: заявка уходит в кабинет агентства (блок «Wymaga uwagi»). */
export function RequestModuleButton({ module, requested }: { module: string; requested: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(requested);
  const [error, setError] = useState<string>();
  if (done)
    return (
      <p role="status" className="text-ok text-sm font-semibold">
        {t("billing.locked.requested")}
      </p>
    );
  return (
    <div className="grid justify-items-center gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await requestModuleAction(module);
            if (r.ok) setDone(true);
            else setError(r.error);
          })
        }
      >
        {t("billing.locked.request")}
      </Button>
      {error ? <p className="text-urgent text-sm">{error}</p> : null}
    </div>
  );
}
