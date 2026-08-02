/**
 * bd-2489 — the capstone result card hardcoded "Below the 70% pass mark".
 *
 * 70 is the bot's capstone PASS_PCT today, so the sentence is accurate by
 * coincidence rather than by construction: it is a second copy of a number
 * owned elsewhere, and it is the copy that will go stale silently. The
 * endpoint now sends `pass_mark_pct` from the same constant the bot grades
 * with, so the two cannot drift.
 *
 * Unlike the level-exam surfaces, this card IS reachable by a teacher today —
 * it is a read-only view of a WhatsApp attempt and bd-2490 does not gate it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../services/api", () => ({
  default: { get: vi.fn() },
}));
import api from "../services/api";
import CapstoneResultCard from "./CapstoneResultCard";

function mockAttempt(over: Record<string, unknown> = {}, passMark: unknown = 70) {
  (api.get as any).mockResolvedValue({
    data: {
      attempt: {
        id: "att-1",
        status: "failed",
        is_passed: false,
        score: 20,
        total_score: 40,
        completed_at: "2026-07-01T00:00:00Z",
        ...over,
      },
      answers: [],
      pass_mark_pct: passMark,
    },
  });
}

function renderCard() {
  render(<CapstoneResultCard levelId={7} levelName="English" />);
}

beforeEach(() => vi.clearAllMocks());

describe("bd-2489 — the capstone pass mark comes from the API", () => {
  it("quotes the bar the endpoint sent", async () => {
    mockAttempt({}, 70);
    renderCard();
    const card = await screen.findByTestId("capstone-result-card");
    expect(card.textContent).toContain("70% pass mark");
  });

  it("tracks a different bar rather than repeating 70", async () => {
    // The assertion that actually bites: with the number hardcoded, this card
    // would still say 70% while the bot graded against 80%.
    mockAttempt({}, 80);
    renderCard();
    const card = await screen.findByTestId("capstone-result-card");
    expect(card.textContent).toContain("80% pass mark");
    expect(card.textContent).not.toContain("70%");
  });

  it("states no percentage at all when the endpoint sent none", async () => {
    mockAttempt({}, null);
    renderCard();
    const card = await screen.findByTestId("capstone-result-card");
    expect(card.textContent).not.toMatch(/null|undefined|NaN/);
    expect(card.textContent).not.toContain("pass mark");
    // …but the teacher is still told what to do.
    expect(card.textContent).toContain("retake it on WhatsApp");
  });

  it("says nothing about a pass mark on a passing attempt", async () => {
    mockAttempt({ is_passed: true, status: "passed", score: 32 }, 70);
    renderCard();
    const card = await screen.findByTestId("capstone-result-card");
    expect(card.textContent).toContain("Passed");
    expect(card.textContent).not.toContain("pass mark");
  });
});
