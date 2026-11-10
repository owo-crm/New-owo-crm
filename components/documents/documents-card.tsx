import Link from "next/link";
import { Card } from "@/components/app-shell/page";
import { buttonVariants } from "@/components/ui/button";
import type { DocumentRow } from "@/lib/documents/service";
import { t, type MessageKey } from "@/lib/i18n";

const PACKAGES = [
  ["simple", "Simple"],
  ["standard", "Standard"],
  ["premium", "Premium"],
] as const;

const money = (v: number) =>
  new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(v);

/** Блок «Dokumenty» в карточке лида: кнопки генерации + все версии с PDF/Word. */
export function DocumentsCard({
  leadId,
  enabled,
  documents,
  flash,
}: {
  leadId: string;
  enabled: boolean;
  documents: DocumentRow[];
  flash?: string;
}) {
  return (
    <Card title={t("docs.title")}>
      <div id="dokumenty" className="scroll-mt-24" />
      {flash ? (
        <p className="border-ok/40 text-ok mb-4 rounded-[10px] border p-3 text-sm" role="status">
          {t("docs.generated", { name: flash })}
        </p>
      ) : null}
      {enabled ? (
        <>
          <p className="text-ink-soft text-xs font-bold">{t("docs.offerFor")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PACKAGES.map(([key, name]) => (
              <Link
                key={key}
                href={`/leady/${leadId}/oferta?pakiet=${key}`}
                className={buttonVariants({
                  variant: key === "standard" ? "primary" : "secondary",
                })}
              >
                {name}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/leady/${leadId}/menu`}
              className={buttonVariants({ variant: "secondary" })}
            >
              🍸 {t("docs.guestMenu")}
            </Link>
            <Link
              href={`/leady/${leadId}/umowa`}
              className={buttonVariants({ variant: "secondary" })}
            >
              📄 {t("docs.contract")}
            </Link>
          </div>
        </>
      ) : (
        <p className="text-ink-soft text-sm">{t("docs.notEnabled")}</p>
      )}
      <ul className="mt-5 grid gap-1">
        {documents.length === 0 ? (
          <li className="text-ink-soft text-sm">{t("docs.empty")}</li>
        ) : (
          documents.map((doc) => (
            <li
              key={doc.id}
              className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {t(`docs.kind_${doc.kind}` as MessageKey)} {doc.number}
                </p>
                <p className="text-ink-soft text-xs">
                  {new Intl.DateTimeFormat("pl-PL", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Europe/Warsaw",
                  }).format(new Date(doc.created_at))}
                  {doc.kind === "offer" && doc.package_name ? ` · ${doc.package_name}` : ""}
                  {doc.kind !== "menu" && doc.price ? ` · ${money(doc.price)}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                {doc.files.map((file) => (
                  <a
                    key={file.id}
                    href={`/api/documents/${file.id}${file.format === "pdf" ? "?podglad=1" : ""}`}
                    target={file.format === "pdf" ? "_blank" : undefined}
                    rel="noreferrer"
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    {t(file.format === "pdf" ? "docs.pdf" : "docs.docx")}
                  </a>
                ))}
              </div>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}
