"use client";

import { useState, useTransition } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPortalAction } from "@/lib/billing/actions";
import { t } from "@/lib/i18n";

/** «Faktury i karta płatnicza» → портал Stripe (карта, счета, отмена). */
export function PortalButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="grid gap-1">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await openPortalAction();
            if (r?.error) setError(r.error);
          })
        }
      >
        <CreditCard />
        {t("billing.settings.manage")}
      </Button>
      {error ? <p className="text-urgent text-sm">{error}</p> : null}
    </div>
  );
}
