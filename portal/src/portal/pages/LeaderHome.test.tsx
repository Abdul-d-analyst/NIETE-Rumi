import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2434 (NIETE port of bd-2391): My Patch home GREETS THE LEADER BY NAME and
// renders the patch KPIs + focus list from GET /leader/overview.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  leader: { getOverview: vi.fn() },
}));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderHome from "./LeaderHome";

const OVERVIEW = {
  totalTeachers: 42,
  onRumi: 40,
  notOnRumi: 2,
  totalCoachingSessions: 137,
  totalLessonPlans: 512,
  scoredTeachers: 38,
  avgLastScore: 63.4,
  focus: [
    { name: "Zainab", rumiUserId: "z1", onRumi: true, coachingSessions: 5, lessonPlans: 2, lastScore: 41, lastSessionAt: "2026-07-22", phone: "923001", teacherExtId: "T1" },
    { name: "Amna", rumiUserId: "a1", onRumi: true, coachingSessions: 3, lessonPlans: 1, lastScore: 47, lastSessionAt: "2026-07-20", phone: "923002", teacherExtId: "T2" },
  ],
};

function renderHome(user: any, overview: any = OVERVIEW) {
  (useAuth as any).mockReturnValue({ user, loading: false, logout: vi.fn() });
  (leader.getOverview as any).mockResolvedValue({ success: true, overview });
  render(
    <MemoryRouter>
      <LeaderHome />
    </MemoryRouter>,
  );
}

describe("LeaderHome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("greets the leader by their first name", () => {
    renderHome({ firstName: "Noor", role: "coach" });
    expect(screen.getByRole("heading", { name: /Noor/ })).toBeInTheDocument();
  });

  it("renders the leader nav (My Patch) inside the shell — confirms branding", () => {
    renderHome({ firstName: "Noor", role: "coach" });
    expect(screen.queryAllByText("My Patch").length).toBeGreaterThan(0);
    expect(screen.getByAltText("NIETE logo")).toBeInTheDocument();
  });

  it("shows the patch KPIs from /leader/overview", async () => {
    renderHome({ firstName: "Noor", role: "coach" });
    expect(leader.getOverview).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument()); // total teachers
    expect(screen.getByText("137")).toBeInTheDocument();                     // coaching sessions
  });

  it("lists the focus teachers (lowest scores first)", async () => {
    renderHome({ firstName: "Noor", role: "coach" });
    await waitFor(() => expect(screen.getByText("Zainab")).toBeInTheDocument());
    expect(screen.getByText("Amna")).toBeInTheDocument();
  });
});
