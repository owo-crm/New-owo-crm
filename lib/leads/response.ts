/** Historical stages prove contact happened, even when the old CRM did not store its timestamp. */
export function hasKnownResponse(lead: {
  first_response_at: string | null;
  stage_key: string;
  legacy_uid?: string | null;
}) {
  return Boolean(
    lead.first_response_at ||
    (lead.legacy_uid?.startsWith("apps-script:") && lead.stage_key !== "new"),
  );
}
