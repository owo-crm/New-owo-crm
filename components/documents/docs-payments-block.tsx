import { PaymentRoadmap } from "@/components/finance/payment-roadmap";
import type { Attachment } from "@/lib/documents/attachments";
import { LeadFiles } from "./lead-files";
import type { DocumentRow } from "@/lib/documents/service";
import type { Payment } from "@/lib/finance/money";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Блок «Dokumenty i płatności» на холсте лида (решение 049): последние документы
 * с PDF/Word и платежи «змейкой». Кнопки генерации — в «Szybkie działania».
 */
export function DocsPaymentsBlock({
  leadId,
  files,
  documents,
  payments,
  plan,
  totalGrosze,
  showDocs,
  showPayments,
  flash,
}: {
  leadId: string;
  files: Attachment[];
  documents: DocumentRow[];
  payments: Payment[];
  plan: number[];
  totalGrosze: number | null;
  showDocs: boolean;
  showPayments: boolean;
  flash?: string;
}) {
  return (
    <div className="grid gap-3">
      <div id="dokumenty" className="-mt-2 scroll-mt-24" />
      {flash ? (
        <p className="border-ok/40 text-ok rounded-lg border px-3 py-2 text-[13px]" role="status">
          {t("docs.generated", { name: flash })}
        </p>
      ) : null}
      {showDocs ? (
        documents.length ? (
          <ul className="grid gap-1">
            {documents.slice(0, 4).map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{t(`docs.kind_${doc.kind}` as MessageKey)}</span>{" "}
                  <span className="text-ink-faint">{doc.number}</span>
                </span>
                {doc.files.map((file) => (
                  <a
                    key={file.id}
                    href={`/api/documents/${file.id}${file.format === "pdf" ? "?podglad=1" : ""}`}
                    target={file.format === "pdf" ? "_blank" : undefined}
                    rel="noreferrer"
                    className="border-line hover:border-line-strong rounded-md border px-1.5 text-[11.5px] leading-6 font-semibold"
                  >
                    {t(file.format === "pdf" ? "docs.pdf" : "docs.docx")}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-faint text-[13px]">{t("docs.emptyShort")}</p>
        )
      ) : null}
      <LeadFiles leadId={leadId} files={files} />
      {showPayments ? (
        <div className="border-line border-t pt-3">
          <PaymentRoadmap payments={payments} plan={plan} totalGrosze={totalGrosze} />
        </div>
      ) : null}
    </div>
  );
}
