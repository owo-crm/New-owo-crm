import "server-only";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";

/** Данные фирмы: шапка умовы, реквизиты для счетов, подпись в письмах. */
export type OrganizationProfile = {
  name: string;
  legal_name: string | null;
  nip: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bank_account: string | null;
  brand_color: string;
};

export function getOrganizationProfile() {
  return withOrg(async (tx, { organization }) => {
    const { rows } = await tx.query<OrganizationProfile>(
      `select name, legal_name, nip, address, phone, website, email, bank_account, brand_color
         from public.organizations where id = $1`,
      [organization.id],
    );
    return rows[0]!;
  });
}

const empty = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legal_name: empty.pipe(z.string().max(200).nullable()),
  nip: empty.pipe(
    z
      .string()
      .regex(/^[0-9]{10}$/)
      .nullable(),
  ),
  address: empty.pipe(z.string().max(300).nullable()),
  phone: empty.pipe(z.string().max(40).nullable()),
  email: empty.pipe(z.string().email().max(160).nullable()),
  website: empty.pipe(z.string().max(200).nullable()),
  bank_account: empty.pipe(z.string().max(60).nullable()),
  brand_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
});

export function saveOrganizationProfile(data: z.infer<typeof profileSchema>) {
  return withOrg((tx, { organization }) =>
    tx.query(
      `update public.organizations set
         name = $2, legal_name = $3, nip = $4, address = $5, phone = $6,
         email = $7, website = $8, bank_account = $9, brand_color = $10, updated_at = now()
       where id = $1`,
      [
        organization.id,
        data.name,
        data.legal_name,
        data.nip,
        data.address,
        data.phone,
        data.email,
        data.website,
        data.bank_account,
        data.brand_color,
      ],
    ),
  );
}
