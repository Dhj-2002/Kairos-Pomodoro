import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@/lib/db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
import { getSetting, setSetting } from "@/lib/db/settings";
import { DurationPresets } from "@/components/base/duration-presets";

afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getSetting).mockResolvedValue(null); vi.mocked(setSetting).mockResolvedValue(undefined); });
describe("saved duration editor", () => {
  it("persists the reordered list and restores its order on remount", async () => {
    vi.mocked(getSetting).mockResolvedValue(JSON.stringify({ version:1, items:[
      { id:"sleep", name:"Sleep", minutes:510 }, { id:"focus", name:"Focus", minutes:90 },
    ] }));
    const props = { activeId:null, onSelect:vi.fn(), onChange:vi.fn() };
    const view = render(<DurationPresets {...props} />);
    await screen.findByRole("button", { name:"Sleep 8h 30m" });
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.click(screen.getByLabelText("Move Focus up"));
    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1));
    const raw = vi.mocked(setSetting).mock.calls[0][1];
    expect(JSON.parse(raw).items.map((p:{id:string})=>p.id)).toEqual(["focus","sleep"]);
    view.unmount();
    vi.mocked(getSetting).mockResolvedValue(raw);
    const restored = render(<DurationPresets {...props} />);
    await screen.findByRole("button", {name:"Focus 1h 30m"});
    expect([...restored.container.querySelectorAll(".duration-cards button")].map(b=>b.getAttribute("aria-label"))).toEqual(["Focus 1h 30m","Sleep 8h 30m"]);
  });
  it("creates, selects, reloads, edits and deletes a persistent shortcut", async () => {
    const select = vi.fn();
    const props = { activeId: null, onSelect: select, onChange: vi.fn() };
    const view = render(<DurationPresets {...props} />);
    await waitFor(() => expect(screen.getByText("Manage")).toBeEnabled());
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.change(screen.getByLabelText("Duration name"), { target: { value: "Sleep" } });
    fireEvent.change(screen.getByLabelText("Duration hours"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await screen.findByRole("button", { name: "Sleep 8h 30m" });
    fireEvent.click(screen.getByRole("button", { name: "Sleep 8h 30m" }));
    expect(select.mock.calls[0][0].minutes).toBe(510);
    const raw = vi.mocked(setSetting).mock.calls.at(-1)![1];
    view.unmount();
    vi.mocked(getSetting).mockResolvedValue(raw);
    render(<DurationPresets {...props} />);
    await screen.findByRole("button", { name: "Sleep 8h 30m" });
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.click(screen.getByLabelText("Edit Sleep"));
    fireEvent.change(screen.getByLabelText("Duration hours"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("Update"));
    await screen.findByRole("button", { name: "Sleep 9h 30m" });
    fireEvent.click(screen.getByLabelText("Delete Sleep"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sleep 9h 30m" })).not.toBeInTheDocument());
  });
  it("does not discard the draft or claim success after a failed write", async () => {
    vi.mocked(setSetting).mockRejectedValue(new Error("database busy"));
    render(<DurationPresets activeId={null} onSelect={vi.fn()} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Manage")).toBeEnabled());
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.change(screen.getByLabelText("Duration name"), { target: { value: "Focus" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Duration name")).toHaveValue("Focus");
    expect(screen.queryByRole("button", { name: "Focus 30m" })).not.toBeInTheDocument();
  });
});
