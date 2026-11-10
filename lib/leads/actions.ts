"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/lib/db/user";
import { one, sqlState } from "@/lib/db";
import { getLead } from "./queries";
import { editFieldSchema, prepareLeadPatch } from "./edit";
import { t } from "@/lib/i18n";
export type LeadActionResult = { error?: string; eventId?: string; updatedAt?: string };
function refreshLead(id: string) {
  // The sidebar badge and dashboard share this layout; refresh their data after any mutation.
  revalidatePath("/", "layout");
  revalidatePath(`/leady/${id}`);
}

export async function editLead(
  id: string,
  version: string,
  field: string,
  value: string,
): Promise<LeadActionResult> {
  if (!z.uuid().safeParse(id).success) return { error: t("leads.saveError") };
  const lead = await getLead(id);
  if (!lead) return { error: t("leads.saveError") };
  let patch: Record<string, string | number | null>;
  try {
    patch = prepareLeadPatch(lead, editFieldSchema.parse(field), value);
  } catch {
    return { error: t("leads.invalidValue") };
  }
  let result: { event_id: string; updated_at: string };
  try {
    const row = await withOrg((tx, { organization }) =>
      one<{ r: typeof result }>(tx, "select public.change_lead($1,$2,$3,$4) as r", [
        organization.id,
        id,
        version,
        patch,
      ]),
    );
    result = row!.r;
  } catch (error) {
    return { error: t(sqlState(error) === "40001" ? "leads.conflict" : "leads.saveError") };
  }
  refreshLead(id);
  return { eventId: result.event_id, updatedAt: result.updated_at };
}
export async function undoLead(id: string, eventId: string): Promise<LeadActionResult> {
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(eventId).success)
    return { error: t("leads.undoError") };
  try {
    await withOrg((tx, { organization }) =>
      tx.query("select public.undo_lead_change($1,$2)", [organization.id, eventId]),
    );
  } catch {
    return { error: t("leads.undoError") };
  }
  refreshLead(id);
  return {};
}
export async function addLeadNote(id: string, text: string): Promise<LeadActionResult> {
  const note = z.string().trim().min(1).max(5000).safeParse(text);
  if (!z.uuid().safeParse(id).success || !note.success || !(await getLead(id)))
    return { error: t("leads.invalidValue") };
  try {
    await withOrg((tx, { user, organization }) =>
      tx.query(
        "insert into public.lead_events (organization_id, lead_id, type, actor_user_id, payload) values ($1,$2,'note',$3,$4)",
        [organization.id, id, user.id, { text: note.data }],
      ),
    );
  } catch {
    return { error: t("leads.saveError") };
  }
  refreshLead(id);
  return {};
}

export async function createManualLead(
  formData: FormData,
): Promise<{ id?: string; error?: string; fields?: Record<string, string> }> {
  const { manualLeadInput } = await import("./manual");
  const { ingestLead } = await import("./ingest");
  const { createIngestRepository } = await import("./repository");
  let input;
  try {
    input = manualLeadInput(formData);
  } catch (error) {
    const fields: Record<string, string> = {};
    if (error instanceof z.ZodError)
      for (const issue of error.issues)
        fields[String(issue.path[0] ?? "name")] = t("leads.invalidValue");
    else fields.budget = t("leads.invalidMoney");
    return { error: t("leads.checkForm"), fields };
  }
  try {
    const result = await withOrg(async (tx, { organization }) => {
      const channel = await one<{ id: string; name: string }>(
        tx,
        "select id,name from public.channels where organization_id=$1 and type='manual' order by created_at limit 1",
        [organization.id],
      );
      if (!channel) throw new Error("no_manual_channel");
      return ingestLead(
        input,
        {
          organizationId: organization.id,
          channelId: channel.id,
          sourceLabel: channel.name,
          consentAt: null,
        },
        createIngestRepository(tx),
      );
    });
    refreshLead(result.id);
    after(async () => {
      const { kickNotifications } = await import("@/lib/notify/kick");
      await kickNotifications(result.id);
    });
    return { id: result.id };
  } catch {
    return { error: t("leads.saveError") };
  }
}
