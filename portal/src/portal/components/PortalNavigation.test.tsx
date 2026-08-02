import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2434 (NIETE port of bd-2389/2390): the nav is role-gated. A leader gets
// the leader nav (My Patch / Teachers) and the SAME NIETE logo/branding; a
// teacher's nav is unchanged (Dashboard / Curriculum / My Plans / …).
// Leader-family only — teachers never see the leader nav.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "../hooks/useAuth";
import PortalNavigation from "./PortalNavigation";

function renderNav(user: any) {
  (useAuth as any).mockReturnValue({ user, logout: vi.fn() });
  render(
    <MemoryRouter>
      <PortalNavigation />
    </MemoryRouter>,
  );
}

describe("PortalNavigation role gating", () => {
  it("a leader sees the leader nav (My Patch, Teachers), not the teacher nav", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Teachers").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Plans")).toBeNull();
    expect(screen.queryByText("Coaching")).toBeNull();
    expect(screen.queryByText("Curriculum")).toBeNull();
  });

  it("a teacher sees today's nav unchanged (Dashboard, My Plans), not the leader nav", () => {
    renderNav({ firstName: "Ayesha", role: "teacher" });
    expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("My Plans").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Patch")).toBeNull();
  });

  it("a user with no role is treated as a teacher (leader nav hidden)", () => {
    renderNav({ firstName: "Sana" });
    expect(screen.queryByText("My Patch")).toBeNull();
    expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("keeps the shared NIETE logo + wordmark for both roles", () => {
    renderNav({ firstName: "Noor", role: "coach" });
    expect(screen.getByAltText("NIETE logo")).toBeInTheDocument();
    expect(screen.queryAllByText("NIETE").length).toBeGreaterThan(0);
  });
});
