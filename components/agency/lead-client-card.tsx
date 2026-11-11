"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Briefcase } from "lucide-react";
import { Card } from "@/components/app-shell/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { clientFromLeadAction } from "@/lib/agency/actions";
import { t } from "@/lib/i18n";

/**
 * Карточка лида агентства на этапе «Klient»: «Dodaj klienta agencji» создаёт клиента из лида
 * и связывает их. Если клиент уже есть — ссылка на него.
 */
export function LeadClientCard({ leadId, clientId }: { leadId: string; clientId: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <Card>
      {clientId ? (
        <Link
          href={`/agencja/klienci/${clientId}`}
          className={buttonVariants({ variant: "secondary" })}
        >
          <Briefcase />
          {t("agency.fromLead.open")}
        </Link>
      ) : (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await clientFromLeadAction(leadId);
              if (r?.error) setError(r.error);
            })
          }
        >
          <Briefcase />
          {t("agency.fromLead.button")}
        </Button>
      )}
      {error ? <p className="text-urgent mt-2 text-sm">{error}</p> : null}
    </Card>
  );
}
