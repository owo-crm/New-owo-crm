import "server-only";
import { one, type Queryable } from "@/lib/db";
import { readFileSync } from "node:fs";
import path from "node:path";
import { docxToPdf, fillDocxTemplate } from "./docx-template";
import { contractSnapshot, contractTemplateValues, type ContractValues } from "./barowo/contract";
import { barowoSchedule, listPayments, savePaymentPlan } from "@/lib/finance/payments";
import {
  barowoEngine,
  legacyLeadRow,
  type GuestMenuSnapshot,
  type OfferSnapshot,
  type PackageKey,
} from "./barowo/engine";

/** Ошибка, которую можно показать пользователю как есть (польский текст из правил бота). */
export class DocumentInputError extends Error {}

type LeadForDocs = {
  id: string;
  updated_at: string;
  client_name: string;
  client_full_name: string | null;
  client_address: string | null;
  event_type: string | null;
  event_date: string | null;
  event_city: string | null;
  venue: string | null;
  guests: number | null;
  package_name: string | null;
  service_hours: string | null;
};

const LEAD_COLUMNS =
  "id,updated_at,client_name,client_full_name,client_address,event_type,event_date,event_city,venue,guests,package_name,service_hours";

export async function loadLeadForDocs(tx: Queryable, orgId: string, leadId: string) {
  const lead = await one<LeadForDocs & { stage_kind: string }>(
    tx,
    `select ${LEAD_COLUMNS.split(",")
      .map((c) => "l." + c)
      .join(",")}, s.kind as stage_kind
     from public.leads l join public.pipeline_stages s on s.organization_id=l.organization_id and s.key=l.stage_key
     where l.organization_id=$1 and l.id=$2 and l.deleted_at is null`,
    [orgId, leadId],
  );
  if (!lead) throw new DocumentInputError("Lead nie znaleziony. Odśwież kartę klienta.");
  return lead;
}

/** Ошибки из кода бота приходят из другого realm (vm), поэтому проверяем по форме, а не instanceof. */
function userError(error: unknown): never {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "Błąd danych.";
  throw new DocumentInputError(message);
}

function isoFromPl(date: string) {
  const [d, m, y] = date.split(".");
  return `${y}-${m}-${d}`;
}

async function latestSnapshot<T>(tx: Queryable, orgId: string, leadId: string, kind: string) {
  const row = await one<{ snapshot: T }>(
    tx,
    "select snapshot from public.documents where organization_id=$1 and lead_id=$2 and kind=$3 and status<>'cancelled' order by created_at desc limit 1",
    [orgId, leadId, kind],
  );
  return row?.snapshot ?? null;
}

export type OfferFormValues = Record<
  | "date"
  | "guests"
  | "venue"
  | "hours"
  | "price"
  | "listPrice"
  | "message"
  | "service"
  | "alcohol"
  | "softs"
  | "ice"
  | "additions"
  | "menu",
  string
>;

/** Значения формы как в боте: каталог пакета + данные лида + прошлая оферта того же пакета. */
export async function offerFormDefaults(
  tx: Queryable,
  orgId: string,
  leadId: string,
  pkg: PackageKey,
): Promise<OfferFormValues> {
  const e = barowoEngine();
  const lead = await loadLeadForDocs(tx, orgId, leadId);
  const values = e.defaultOfferValues_(pkg) as unknown as OfferFormValues;
  values.date = lead.event_date ? lead.event_date.split("-").reverse().join(".") : "";
  values.guests = lead.guests ? String(lead.guests) : "";
  values.venue = lead.venue || lead.event_city || "";
  values.hours = lead.service_hours ?? "";
  values.price = String(e.suggestedOfferPrice_(pkg, values.guests));
  values.listPrice = "";
  const previous = await latestSnapshot<OfferSnapshot>(tx, orgId, leadId, "offer");
  if (previous && previous.packageName === e.BAROWO_OFFER_CATALOG[pkg].name) {
    for (const key of [
      "venue",
      "hours",
      "service",
      "alcohol",
      "softs",
      "ice",
      "additions",
      "message",
    ] as const)
      values[key] = String(previous[key] ?? "");
    values.menu = previous.menu.map((d) => d.join(" | ")).join("\n");
  }
  return values;
}

type Actor = { userId: string; orgId: string };

async function saveDocument(
  tx: Queryable,
  actor: Actor,
  leadId: string,
  kind: "offer" | "menu" | "contract",
  snapshot: object,
  render: (
    number: string,
  ) =>
    | { pdf: Uint8Array; docx: Uint8Array; base: string }
    | Promise<{ pdf: Uint8Array; docx: Uint8Array; base: string }>,
) {
  const number = (await one<{ n: string }>(tx, "select public.next_document_number($1,$2) as n", [
    actor.orgId,
    kind,
  ]))!.n;
  const files = await render(number);
  const doc = (await one<{ id: string }>(
    tx,
    `insert into public.documents (organization_id, lead_id, kind, number, snapshot, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [actor.orgId, leadId, kind, number, snapshot, actor.userId],
  ))!;
  for (const [format, bytes] of [
    ["pdf", files.pdf],
    ["docx", files.docx],
  ] as const) {
    await tx.query(
      "insert into public.document_files (organization_id, document_id, format, filename, content) values ($1,$2,$3,$4,$5)",
      [actor.orgId, doc.id, format, `${files.base}.${format}`, Buffer.from(bytes)],
    );
  }
  await tx.query(
    "insert into public.lead_events (organization_id, lead_id, type, actor_user_id, payload) values ($1,$2,'document_generated',$3,$4)",
    [actor.orgId, leadId, actor.userId, { kind, number, document_id: doc.id }],
  );
  return { id: doc.id, number };
}

/** Данные из документа переносятся в карточку (как в боте), через change_lead → история. */
async function syncLead(
  tx: Queryable,
  actor: Actor,
  lead: LeadForDocs,
  patch: Record<string, string | number | null>,
) {
  const changed = Object.fromEntries(
    Object.entries(patch).filter(
      ([k, v]) => v !== "" && v !== null && (lead as Record<string, unknown>)[k] !== v,
    ),
  );
  if (!Object.keys(changed).length) return;
  await tx.query("select public.change_lead($1,$2,$3,$4)", [
    actor.orgId,
    lead.id,
    lead.updated_at,
    changed,
  ]);
}

function fileBase(kind: string, brand: string, number: string) {
  const label = kind === "contract" ? "Umowa" : kind === "menu" ? "Menu" : "Oferta";
  return `${label}_${brand}_${number.replace(/[^\w-]/g, "_")}`.replace(/_+/g, "_");
}

export async function generateOffer(
  tx: Queryable,
  actor: Actor,
  leadId: string,
  pkg: PackageKey,
  input: OfferFormValues,
  contact: string,
) {
  const e = barowoEngine();
  const lead = await loadLeadForDocs(tx, actor.orgId, leadId);
  if (lead.stage_kind === "lost")
    throw new DocumentInputError("Przywróć leada przed generowaniem dokumentu.");
  let snapshot: OfferSnapshot;
  try {
    const row = legacyLeadRow(lead);
    const date = e.formatDate(e.parseDocumentDate_(input.date));
    row[e.COL.DATE - 1] = date;
    snapshot = e.offerSnapshot_(row, pkg, {
      ...input,
      listPrice: input.listPrice?.trim() || input.price,
    });
    snapshot.brandLayoutVersion = 1;
    snapshot.contact = contact;
  } catch (error) {
    userError(error);
  }
  const saved = await saveDocument(tx, actor, leadId, "offer", snapshot, (number) => {
    const base = fileBase("offer", "BAROWO", number);
    return {
      base,
      pdf: e.brandedOfferPdf_(snapshot, number, base + ".pdf").bytes,
      docx: e.brandedOfferDocx_(snapshot, number, base + ".docx").bytes,
    };
  });
  await syncLead(tx, actor, lead, {
    event_date: isoFromPl(snapshot.eventDate),
    guests: snapshot.guests,
    venue: snapshot.venue,
    service_hours: snapshot.hours,
    package_name: snapshot.packageName,
  });
  return saved;
}

export async function guestMenuDefaults(
  tx: Queryable,
  orgId: string,
  leadId: string,
  pkg?: PackageKey,
) {
  const e = barowoEngine();
  const lead = await loadLeadForDocs(tx, orgId, leadId);
  const previous = await latestSnapshot<OfferSnapshot>(tx, orgId, leadId, "offer");
  const key =
    pkg ??
    (Object.keys(e.BAROWO_OFFER_CATALOG).find(
      (k) =>
        e.BAROWO_OFFER_CATALOG[k].name.toLowerCase() === (lead.package_name ?? "").toLowerCase(),
    ) as PackageKey | undefined);
  const basis = !pkg && previous ? previous.menu : key ? e.BAROWO_OFFER_CATALOG[key].menu : null;
  return { menu: basis ? basis.map((d) => d.join(" | ")).join("\n") : "", needsPackage: !basis };
}

export async function generateGuestMenu(tx: Queryable, actor: Actor, leadId: string, menu: string) {
  const e = barowoEngine();
  const lead = await loadLeadForDocs(tx, actor.orgId, leadId);
  let snapshot: GuestMenuSnapshot;
  try {
    snapshot = e.guestMenuSnapshot_({ menu }, legacyLeadRow(lead));
  } catch (error) {
    userError(error);
  }
  return saveDocument(tx, actor, leadId, "menu", snapshot, (number) => {
    const base = fileBase("menu", "BAROWO", number);
    return {
      base,
      pdf: e.guestMenuPdf_(snapshot, base + ".pdf").bytes,
      docx: e.guestMenuDocx_(snapshot, base + ".docx").bytes,
    };
  });
}

export type DocumentRow = {
  id: string;
  kind: "offer" | "menu" | "contract";
  number: string;
  status: string;
  created_at: string;
  price: number | null;
  package_name: string | null;
  files: { id: string; format: "pdf" | "docx" }[];
};

export function leadPayments(tx: Queryable, orgId: string, leadId: string) {
  return listPayments(tx, orgId, leadId);
}

export async function listDocuments(tx: Queryable, orgId: string, leadId: string) {
  const { rows } = await tx.query<DocumentRow>(
    `select d.id, d.kind, d.number, d.status, d.created_at,
       (d.snapshot->>'price')::numeric::float8 as price, d.snapshot->>'packageName' as package_name,
       coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'format', f.format) order by f.format desc)
         from public.document_files f where f.organization_id=d.organization_id and f.document_id=d.id), '[]') as files
     from public.documents d where d.organization_id=$1 and d.lead_id=$2 order by d.created_at desc limit 50`,
    [orgId, leadId],
  );
  return rows;
}

// ───────── Договор ─────────

export async function contractFormDefaults(
  tx: Queryable,
  orgId: string,
  leadId: string,
): Promise<ContractValues & { pkg: string }> {
  const lead = await loadLeadForDocs(tx, orgId, leadId);
  const offer = await latestSnapshot<OfferSnapshot>(tx, orgId, leadId, "offer");
  return {
    date: lead.event_date ? lead.event_date.split("-").reverse().join(".") : "",
    city: lead.event_city ?? "",
    guests: lead.guests ? String(lead.guests) : "",
    hours: lead.service_hours ?? "",
    clientName: lead.client_full_name || lead.client_name,
    address: lead.client_address ?? "",
    price: offer ? String(offer.price) : "",
    pkg: lead.package_name || offer?.packageName || "",
  };
}

/** Этап двигаем только вперёд (как updateDocumentLeadStage_ в боте), закрытые/спам не трогаем. */
async function stageForward(tx: Queryable, orgId: string, leadId: string, target: string) {
  const row = await one<{ forward: boolean; updated_at: string }>(
    tx,
    `select (cur.kind = 'open' and cur.position < tgt.position) as forward, l.updated_at
     from public.leads l
     join public.pipeline_stages cur on cur.organization_id=l.organization_id and cur.key=l.stage_key
     join public.pipeline_stages tgt on tgt.organization_id=l.organization_id and tgt.key=$3
     where l.organization_id=$1 and l.id=$2`,
    [orgId, leadId, target],
  );
  if (row?.forward)
    await tx.query("select public.change_lead($1,$2,$3,$4)", [
      orgId,
      leadId,
      row.updated_at,
      { stage_key: target },
    ]);
}

// Встроенный шаблон читаем один раз; шаблон фирмы берём из базы на каждую генерацию,
// иначе загруженный файл начал бы действовать только после перезапуска.
let builtInTemplate: Uint8Array | null = null;

export async function generateContract(
  tx: Queryable,
  actor: Actor,
  leadId: string,
  pkg: string,
  values: ContractValues,
) {
  const e = barowoEngine();
  const lead = await loadLeadForDocs(tx, actor.orgId, leadId);
  if (lead.stage_kind === "lost")
    throw new DocumentInputError("Przywróć leada przed generowaniem dokumentu.");
  const packageName = e.BAROWO_OFFER_CATALOG[pkg]?.name;
  if (!packageName) throw new DocumentInputError("Wybierz pakiet: Simple, Standard lub Premium.");
  let snapshot: ReturnType<typeof contractSnapshot>;
  try {
    snapshot = contractSnapshot(e, packageName, values);
  } catch (error) {
    userError(error);
  }
  const { rows: own } = await tx.query<{ content: Buffer }>(
    "select content from public.organization_templates where organization_id=$1 and kind='contract'",
    [actor.orgId],
  );
  builtInTemplate ??= new Uint8Array(
    readFileSync(path.join(process.cwd(), "lib/documents/barowo/umowa-template.docx")),
  );
  const template = own[0] ? new Uint8Array(own[0].content) : builtInTemplate;
  const saved = await saveDocument(tx, actor, leadId, "contract", snapshot, async (number) => {
    const base = fileBase("contract", "BAROWO", number);
    const docx = fillDocxTemplate(template, contractTemplateValues(e, snapshot, number));
    return { base, docx, pdf: await docxToPdf(docx) };
  });
  await syncLead(tx, actor, lead, {
    event_date: isoFromPl(snapshot.eventDate),
    event_city: snapshot.city,
    guests: snapshot.guests,
    service_hours: snapshot.hours,
    package_name: snapshot.packageName,
    client_full_name: snapshot.clientName,
    client_address: snapshot.address,
  });
  // План платежей из договора: 500 при подписании, 1000 за 7 дней, остаток в день события.
  const iso = (pl: string) => pl.split(".").reverse().join("-");
  await savePaymentPlan(
    tx,
    actor.orgId,
    leadId,
    barowoSchedule({
      priceGrosze: Math.round(snapshot.price * 100),
      depositGrosze: Math.round(snapshot.deposit * 100),
      depositDate: iso(snapshot.depositDate),
      eventDate: iso(snapshot.eventDate),
      today: iso(snapshot.today),
    }),
  );
  await stageForward(tx, actor.orgId, leadId, "contract_sent");
  return saved;
}
