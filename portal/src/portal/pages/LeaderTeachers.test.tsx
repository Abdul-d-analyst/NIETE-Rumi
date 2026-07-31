import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// bd-2434 (NIETE port of bd-2392): the Teachers roster — the leader's whole
// patch, each teacher with their Rumi activity; teachers not yet on Rumi are
// shown too.

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getTeachers: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderTeachers from "./LeaderTeachers";

const TEACHERS = {
  success: true,
  total: 3,
  onRumi: 2,
  teachers: [
    { name: "Ayesha", rumiUserId: "u1", onRumi: true, coachingSessions: 4, lessonPlans: 9, lastScore: 71, lastSessionAt: "2026-07-20", phone: "923001", teacherExtId: "T1" },
    { name: "Zainab", rumiUserId: "u2", onRumi: true, coachingSessions: 2, lessonPlans: 3, lastScore: 48, lastSessionAt: "2026-07-22", phone: "923002", teacherExtId: "T2" },
    { name: "Sana", rumiUserId: null, onRumi: false, coachingSessions: 0, lessonPlans: 0, lastScore: null, lastSessionAt: null, phone: "923003", teacherExtId: "T3" },
  ],
};

function renderRoster() {
  (useAuth as any).mockReturnValue({ user: { firstName: "Noor", role: "coach" }, loading: false, logout: vi.fn() });
  (leader.getTeachers as any).mockResolvedValue(TEACHERS);
  render(
    <MemoryRouter>
      <LeaderTeachers />
    </MemoryRouter>,
  );
}

describe("LeaderTeachers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders every patch teacher, on-Rumi and not", async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText("Ayesha")).toBeInTheDocument());
    expect(screen.getByText("Zainab")).toBeInTheDocument();
    expect(screen.getByText("Sana")).toBeInTheDocument();
  });

  it("shows the patch summary (on-Rumi count)", async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText(/2\s*\/\s*3/)).toBeInTheDocument());
  });
});
