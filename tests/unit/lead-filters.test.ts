import { expect, it } from "vitest";
import { leadPageUrl, parseLeadFilters } from "@/lib/leads/filters";
it("validates URL filters and resets invalid values", () => {
  const filters = parseLeadFilters({
    q: [" Anna ", "other"],
    page: "-1",
    assigned: "foreign",
    source: "invalid",
    from: "2027-02-29",
  });
  expect(filters).toMatchObject({ q: "Anna", page: 1 });
  expect(filters.assigned).toBeUndefined();
  expect(filters.from).toBeUndefined();
  expect(leadPageUrl(filters, 2)).toBe("/leady?q=Anna&view=list&page=2");
});
