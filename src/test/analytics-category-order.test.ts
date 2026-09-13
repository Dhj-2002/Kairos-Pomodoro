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

  it("clips overnight sessions to the requested day instead of assigning them only to their start day", async () => {
    await getCategoryBreakdown("2026-09-13", "2026-09-13");

    const [query, params] = select.mock.calls[0];
    expect(params).toEqual(["2026-09-13", "2026-09-13"]);
    expect(query).toContain("s.started_at < datetime($2, '+1 day')");
    expect(query).toContain("strftime('%s', MIN(");
    expect(query).toContain("strftime('%s', MAX(s.started_at, datetime($1)))");
    expect(query).not.toContain("date(s.started_at) >= $1");
  });
});
