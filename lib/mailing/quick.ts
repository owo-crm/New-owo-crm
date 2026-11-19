import type { Template } from "./repository";

/**
 * Кнопки «Szybkie działania» из шаблонов (решение 053): набор, подписи и порядок задаются
 * шаблонами фирмы (quick_label, quick_position), а не кодом карточки лида.
 */
export type QuickAction = { id: string; label: string; href: string; kind: string | null };

/** Куда ведёт шаблон, которому нужна полная форма документа (personalna, umowa, menu). */
export function formHref(
  template: Pick<Template, "id" | "document_kind" | "document_params">,
  leadId: string,
) {
  const tpl = `tpl=${template.id}`;
  if (template.document_kind === "contract") return `/leady/${leadId}/umowa?${tpl}`;
  if (template.document_kind === "menu") return `/leady/${leadId}/menu?${tpl}`;
  const pkg =
    typeof template.document_params.package === "string" ? template.document_params.package : "";
  return `/leady/${leadId}/oferta?personal=1&${tpl}${pkg ? `&pakiet=${pkg}` : ""}`;
}

export function quickActions(
  templates: Template[],
  leadId: string,
  org: { documentEngine: string | null; modules: string[] },
): QuickAction[] {
  const engine = org.documentEngine === "barowo" && org.modules.includes("documents");
  return templates
    .filter((x) => x.quick_label)
    .filter((x) => x.purpose === "mail" || x.document_kind === "file" || engine)
    .sort((a, b) => a.quick_position - b.quick_position)
    .map((x) => ({
      id: x.id,
      label: x.quick_label!,
      kind: x.document_kind,
      href:
        x.purpose === "document" && x.document_mode === "form"
          ? formHref(x, leadId)
          : `/poczta?lead=${leadId}&tpl=${x.id}`,
    }));
}
