import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "../db/core.ts";
import type { FileStorage } from "../platform/files/storage.ts";

/**
 * Nieruchomości (ADR 2026-11-25): typowana tabela `properties`, zdjęcia `property_media` → `files` (tylko s3).
 * Funkcje przyjmują transakcję z ustawionym użytkownikiem (asUser/withOrg) — RLS i funkcje SQL
 * pilnują organizacji i ról; organization_id nigdy nie pochodzi z formularza.
 */

export const PROPERTY_FEATURES = [
  "balcony",
  "terrace",
  "garden",
  "parking",
  "garage",
  "elevator",
  "basement",
  "furnished",
  "sea_view",
  "air_conditioning",
] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const propertyInput = z.object({
  title: z.string().trim().min(3).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .min(3)
    .max(120),
  excerpt: text(300),
  description: text(20000),
  property_type: z.enum(["apartment", "house", "land", "commercial", "other"]).default("apartment"),
  city: text(120),
  district: text(120),
  voivodeship: text(60),
  public_address: text(200),
  street_address_private: text(200),
  address_visibility: z.enum(["full", "district_only", "hidden"]).default("district_only"),
  price_grosze: z.number().int().positive().max(100_000_000_000).nullable().optional(),
  area_m2: z.number().positive().max(100000).nullable().optional(),
  rooms: z.number().int().min(0).max(50).nullable().optional(),
  floor: z.number().int().min(-5).max(200).nullable().optional(),
  building_floors: z.number().int().min(0).max(200).nullable().optional(),
  market_type: z.enum(["primary", "secondary"]).nullable().optional(),
  build_year: z.number().int().min(1800).max(2100).nullable().optional(),
  features: z.array(z.enum(PROPERTY_FEATURES)).max(PROPERTY_FEATURES.length).default([]),
  listing_status: z.enum(["active", "reserved", "sold", "withdrawn"]).default("active"),
  seo_title: text(70),
  seo_description: text(170),
});
export type PropertyInput = z.input<typeof propertyInput>;

type Parsed = z.infer<typeof propertyInput>;
const COLUMNS = Object.keys(propertyInput.shape) as (keyof Parsed)[];

export async function createProperty(
  tx: Queryable,
  orgId: string,
  userId: string,
  input: PropertyInput,
) {
  const v = propertyInput.parse(input);
  const cols = COLUMNS.filter((c) => v[c] !== undefined);
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.properties (organization_id, created_by, updated_by, ${cols.join(",")})
     values ($1,$2,$2,${cols.map((_, i) => `$${i + 3}`).join(",")}) returning id`,
    [orgId, userId, ...cols.map((c) => v[c])],
  );
  return rows[0].id;
}

export async function updateProperty(
  tx: Queryable,
  orgId: string,
  userId: string,
  id: string,
  input: Partial<PropertyInput>,
) {
  const v = propertyInput.partial().parse(input) as Partial<Parsed>;
  const cols = COLUMNS.filter((c) => v[c] !== undefined);
  if (!cols.length) return;
  const { rows } = await tx.query(
    `update public.properties set ${cols.map((c, i) => `${c}=$${i + 4}`).join(",")}, updated_by=$3
      where organization_id=$1 and id=$2 and deleted_at is null returning id`,
    [orgId, id, userId, ...cols.map((c) => v[c])],
  );
  if (!rows.length) throw new Error("property_not_found");
}

export const listFilters = z.object({
  q: z.string().trim().max(80).optional(),
  publication: z.enum(["draft", "published", "unpublished"]).optional(),
  listing: z.enum(["active", "reserved", "sold", "withdrawn"]).optional(),
  city: z.string().trim().max(120).optional(),
  type: z.enum(["apartment", "house", "land", "commercial", "other"]).optional(),
  sort: z.enum(["updated", "price", "area"]).default("updated"),
  page: z.number().int().min(1).max(1000).default(1),
});

const ORDER = {
  updated: "p.updated_at desc",
  price: "p.price_grosze asc nulls last",
  area: "p.area_m2 desc nulls last",
} as const;

export async function listProperties(
  tx: Queryable,
  orgId: string,
  raw: z.input<typeof listFilters> = {},
) {
  const f = listFilters.parse(raw);
  const { rows } = await tx.query<{
    id: string;
    slug: string;
    title: string;
    city: string | null;
    district: string | null;
    price_grosze: string | null;
    area_m2: string | null;
    rooms: number | null;
    property_type: string;
    listing_status: string;
    publication_status: string;
    updated_at: Date;
    cover_media_id: string | null;
  }>(
    `select p.id, p.slug, p.title, p.city, p.district, p.price_grosze, p.area_m2, p.rooms, p.property_type,
            p.listing_status, p.publication_status, p.updated_at,
            (select m.id from public.property_media m
              where m.organization_id=p.organization_id and m.property_id=p.id and m.is_cover) as cover_media_id
       from public.properties p
      where p.organization_id=$1 and p.deleted_at is null
        and ($2::text is null or p.title ilike '%'||$2||'%' or p.slug ilike '%'||$2||'%')
        and ($3::text is null or p.publication_status=$3) and ($4::text is null or p.listing_status=$4)
        and ($5::text is null or p.city=$5) and ($6::text is null or p.property_type=$6)
      order by ${ORDER[f.sort]} limit 25 offset $7`,
    [
      orgId,
      f.q ?? null,
      f.publication ?? null,
      f.listing ?? null,
      f.city ?? null,
      f.type ?? null,
      (f.page - 1) * 25,
    ],
  );
  return rows;
}

export async function setPublication(
  tx: Queryable,
  orgId: string,
  id: string,
  status: "draft" | "published" | "unpublished",
) {
  await tx.query("select public.property_set_publication($1,$2,$3)", [orgId, id, status]);
}

export async function archiveProperty(tx: Queryable, orgId: string, id: string) {
  await tx.query("select public.property_archive($1,$2)", [orgId, id]);
}

// ───────────────────────── Zdjęcia ─────────────────────────
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Typ obrazu po sygnaturze (magic bytes), nie po nazwie pliku ani nagłówku przeglądarki. */
export function detectImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function safeFilename(name: string, type: ImageType) {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
  const base = name
    .normalize("NFKD")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "zdjecie"}.${ext}`;
}

export class PhotoError extends Error {}

/**
 * Wgrywa zdjęcie: walidacja → put do prywatnego bucketu (sha256 w metadanych) → rejestracja w `files`
 * → `property_media`. Gdy zapis w bazie się nie uda, obiekt w bucket jest wycofywany (bez sierot).
 */
export async function addPropertyPhoto(
  tx: Queryable,
  storage: FileStorage | null,
  orgId: string,
  propertyId: string,
  photo: { filename: string; bytes: Uint8Array; alt?: string; cover?: boolean },
) {
  if (!storage) throw new PhotoError("storage_not_configured");
  if (photo.bytes.byteLength === 0 || photo.bytes.byteLength > MAX_PHOTO_BYTES)
    throw new PhotoError("invalid_size");
  const type = detectImage(photo.bytes);
  if (!type) throw new PhotoError("invalid_type");
  const fileId = randomUUID();
  const key = `org/${orgId}/${fileId}`;
  const { sha256 } = await storage.put(key, photo.bytes, { contentType: type });
  try {
    await tx.query("select public.file_register_s3($1,$2,$3,$4,$5,$6,'property_media')", [
      orgId,
      fileId,
      safeFilename(photo.filename, type),
      type,
      photo.bytes.byteLength,
      sha256,
    ]);
    const { rows } = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.property_media where organization_id=$1 and property_id=$2",
      [orgId, propertyId],
    );
    const cover = photo.cover ?? rows[0].n === 0;
    if (cover)
      await tx.query(
        "update public.property_media set is_cover=false where organization_id=$1 and property_id=$2 and is_cover",
        [orgId, propertyId],
      );
    const { rows: media } = await tx.query<{ id: string }>(
      `insert into public.property_media (organization_id, property_id, file_id, alt_text, position, is_cover)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgId, propertyId, fileId, photo.alt?.trim().slice(0, 200) || null, rows[0].n, cover],
    );
    return media[0].id;
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

/** Kolejność zdjęć (id mediów w nowym porządku) i okładka. */
export async function reorderPhotos(
  tx: Queryable,
  orgId: string,
  propertyId: string,
  mediaIds: string[],
  coverId?: string,
) {
  for (const [i, id] of mediaIds.entries())
    await tx.query(
      "update public.property_media set position=$4 where organization_id=$1 and property_id=$2 and id=$3",
      [orgId, propertyId, id, i],
    );
  if (coverId) {
    await tx.query(
      "update public.property_media set is_cover=false where organization_id=$1 and property_id=$2 and is_cover and id<>$3",
      [orgId, propertyId, coverId],
    );
    await tx.query(
      "update public.property_media set is_cover=true where organization_id=$1 and property_id=$2 and id=$3",
      [orgId, propertyId, coverId],
    );
  }
}

/** Odpina zdjęcie od obiektu. Plik zostaje w rejestrze; sprzątanie obiektów — osobnym zadaniem. */
export async function detachPhoto(tx: Queryable, orgId: string, mediaId: string) {
  await tx.query("delete from public.property_media where organization_id=$1 and id=$2", [
    orgId,
    mediaId,
  ]);
}

/**
 * Formularz ze strony obiektu: lead ↔ nieruchomość po slugu. Tylko opublikowany obiekt tej samej
 * organizacji; nieznany slug nie blokuje zgłoszenia (zwraca false).
 */
export async function linkLeadToPropertySlug(
  db: Queryable,
  orgId: string,
  leadId: string,
  slug: string,
) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return false;
  const { rows } = await db.query<{ ok: boolean }>(
    "select public.link_lead_property($1,$2,$3) as ok",
    [orgId, leadId, slug],
  );
  return rows[0]?.ok ?? false;
}
