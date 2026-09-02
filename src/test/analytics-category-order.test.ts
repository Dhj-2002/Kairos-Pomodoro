import { beforeEach, describe, expect, it, vi } from "vitest";

const { select } = vi.hoisted(() => ({
  select: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db/schema", () => ({
  getDb: vi.fn().mockResolvedValue({ select }),
}));

import { getAllCategoryBreakdown, getCategoryAnalytics, getCategoryBreakdown } from "@/lib/db/analytics";

beforeEach(() => vi.clearAllMocks());

describe("analytics category ordering", () => {
  it("keeps uncategorized sessions below every named tag in all category views", async () => {
    await getCategoryBreakdown("2026-08-01", "2026-08-23");
    await getAllCategoryBreakdown();
    await getCategoryAnalytics("2026-08-01", "2026-08-23");

    for (const call of select.mock.calls) {
      expect(call[0]).toMatch(/ORDER BY CASE WHEN s\.category_id IS NULL THEN 1 ELSE 0 END/);
    }
  });
});
