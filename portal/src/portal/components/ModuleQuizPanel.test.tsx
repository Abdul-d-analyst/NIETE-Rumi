/**
 * bd-2489 — "Perfect score — great work!" is a pass-threshold claim, and since
 * bd-2483 it is often false.
 *
 * Module quizzes are graded against training_vendors.module_passing_pct — 100
 * for NIETE, 70 for Beacon House and Oxbridge. `is_passed` therefore means
 * "cleared the vendor's bar", not "got everything right", so a 7/10 pass was
 * congratulated as perfect.
 *
 * The result phase is unreachable in production today (bd-2490 returns the
 * WhatsApp redirect before questions are consulted), so this mocks the interim
 * constant off to reach the screen underneath — the copy is still what a
 * teacher will see the day the surface comes back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/assessments", () => ({
  ASSESSMENTS_ON_WHATSAPP_ONLY: false,
  WHATSAPP_TRAINING_URL: "https://example.invalid/chat",
}));
vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";
import ModuleQuizPanel from "./ModuleQuizPanel";

const QUESTIONS = [
  { id: 1, question_text: "Q1", options: ["a", "b"], order_index: 0 },
];

async function submitScoring(score: number, maxScore: number, isPassed: boolean) {
  (api.get as any).mockResolvedValue({ data: { questions: QUESTIONS } });
  (api.post as any).mockResolvedValue({
    data: { attempt: { id: "a1", score, max_score: maxScore, is_passed: isPassed, completed_at: "" } },
  });
  render(<ModuleQuizPanel moduleId="m1" hasAttempts={false} hasQuestions />);
  await userEvent.click(await screen.findByTestId("quiz-take-button"));
  await userEvent.click(await screen.findByLabelText(/A\./));
  await userEvent.click(screen.getByTestId("quiz-submit-button"));
  return screen.findByTestId("quiz-panel-result");
}

beforeEach(() => vi.clearAllMocks());

describe("bd-2489 — the module-quiz result does not call every pass perfect", () => {
  it("a 7/10 pass (vendor bar 70%) is not announced as a perfect score", async () => {
    const panel = await submitScoring(7, 10, true);
    expect(panel.textContent).not.toContain("Perfect score");
    expect(panel.textContent).toContain("7 / 10");
  });

  it("a genuine 10/10 may still be called perfect", async () => {
    const panel = await submitScoring(10, 10, true);
    expect(panel.textContent).toContain("Perfect score");
  });

  it("a failure still says the module counts as complete", async () => {
    const panel = await submitScoring(3, 10, false);
    expect(panel.textContent).not.toContain("Perfect score");
    expect(panel.textContent).toContain("still counts as complete");
  });
});
