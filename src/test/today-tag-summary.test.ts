import { describe, expect, it } from "vitest";
import { buildTodayTagRows } from "@/components/schedule/today-tag-summary";
import { UNTAGGED_BLOCK_COLOR } from "@/lib/constants";

describe("buildTodayTagRows", () => {
  it("reports today's canonical tag shares and keeps untagged time neutral", () => {
    const rows = buildTodayTagRows([
      {
        category_id: 1,
        intention: null,
        category_name: "Research",
        category_color: "#ff0000",
        total_seconds: 5400,
        session_count: 2,
      },
      {
        category_id: null,
        intention: null,
        category_name: null,
        category_color: null,
        total_seconds: 1800,
        session_count: 1,
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ name: "Research", percentage: 75 }),
      expect.objectContaining({
        name: "Uncategorized",
        color: UNTAGGED_BLOCK_COLOR,
        percentage: 25,
      }),
    ]);
  });
});
