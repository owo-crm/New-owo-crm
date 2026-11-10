import { expect, it } from "vitest";
import { manualLeadInput } from "@/lib/leads/manual";
it("manual input shares validation, converts money and strips protected fields", () => {
  const form = new FormData();
  form.set("name", "Anna");
  form.set("phone", "600100200");
  form.set("budget", "1250,05");
  form.set("organization_id", "foreign");
  expect(manualLeadInput(form)).toMatchObject({ name: "Anna", budget_grosze: 125005 });
  expect(manualLeadInput(form)).not.toHaveProperty("organization_id");
  form.set("phone", "");
  expect(() => manualLeadInput(form)).toThrow();
});
