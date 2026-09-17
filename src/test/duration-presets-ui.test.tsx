import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
vi.mock("@/lib/db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
import { getSetting, setSetting } from "@/lib/db/settings";
import { DurationPresets } from "@/components/base/duration-presets";

afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getSetting).mockResolvedValue(null); vi.mocked(setSetting).mockResolvedValue(undefined); });
describe("saved duration editor", () => {
  it("creates, selects, reloads, edits and deletes a persistent shortcut", async () => {
    const select = vi.fn();
    const props = { activeId: null, onSelect: select, onChange: vi.fn() };
    const view = render(<DurationPresets {...props} />);
    await waitFor(() => expect(screen.getByText("Manage / Add")).toBeEnabled());
    fireEvent.click(screen.getByText("Manage / Add"));
    fireEvent.change(screen.getByLabelText("Duration name"), { target: { value: "Sleep" } });
    fireEvent.change(screen.getByLabelText("Duration hours"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await screen.findByText("Sleep · 8h 30m");
    fireEvent.click(screen.getByText("Sleep · 8h 30m"));
    expect(select.mock.calls[0][0].minutes).toBe(510);
    const raw = vi.mocked(setSetting).mock.calls.at(-1)![1];
    view.unmount();
    vi.mocked(getSetting).mockResolvedValue(raw);
    render(<DurationPresets {...props} />);
    await screen.findByText("Sleep · 8h 30m");
    fireEvent.click(screen.getByText("Manage / Add"));
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Duration hours"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("Update"));
    await screen.findByText("Sleep · 9h 30m");
    fireEvent.click(screen.getByLabelText("Delete Sleep"));
    await waitFor(() => expect(screen.queryByText("Sleep · 9h 30m")).not.toBeInTheDocument());
  });
  it("does not discard the draft or claim success after a failed write", async () => {
    vi.mocked(setSetting).mockRejectedValue(new Error("database busy"));
    render(<DurationPresets activeId={null} onSelect={vi.fn()} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Manage / Add")).toBeEnabled());
    fireEvent.click(screen.getByText("Manage / Add"));
    fireEvent.change(screen.getByLabelText("Duration name"), { target: { value: "Focus" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Duration name")).toHaveValue("Focus");
    expect(screen.queryByText("Focus · 0h 30m")).not.toBeInTheDocument();
  });
});
