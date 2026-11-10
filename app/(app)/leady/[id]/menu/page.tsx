import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Card, PageHeader } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import { GuestMenuForm } from "@/components/documents/forms";
import { withOrg } from "@/lib/db/user";
import { guestMenuDefaults } from "@/lib/documents/service";
import { PACKAGE_KEYS } from "@/lib/documents/barowo/engine";
import { getLead } from "@/lib/leads/queries";
import { t } from "@/lib/i18n";

export default async function GuestMenuPage({
  params,
  searchParams,
}: PageProps<"/leady/[id]/menu">) {
  const { id } = await params;
  const parsed = z.enum(PACKAGE_KEYS).safeParse((await searchParams).pakiet);
  if (!z.uuid().safeParse(id).success) notFound();
  const lead = await getLead(id);
  if (!lead) notFound();
  const defaults = await withOrg((tx, { organization }) => {
    if (organization.documentEngine !== "barowo") redirect(`/leady/${id}`);
    return guestMenuDefaults(tx, organization.id, id, parsed.success ? parsed.data : undefined);
  });
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t("docs.menuTitle")}
        subtitle={`${lead.client_name} · ${t("docs.menuIntro")}`}
      />
      {defaults.needsPackage ? (
        <Card>
          <p className="mb-4">{t("docs.choosePackage")}</p>
          <div className="flex flex-wrap gap-2">
            {PACKAGE_KEYS.map((key) => (
              <Link
                key={key}
                href={`/leady/${id}/menu?pakiet=${key}`}
                className={buttonVariants({ variant: "secondary" })}
              >
                {key[0].toUpperCase() + key.slice(1)}
              </Link>
            ))}
          </div>
        </Card>
      ) : (
        <GuestMenuForm leadId={id} menu={defaults.menu} />
      )}
    </div>
  );
}
