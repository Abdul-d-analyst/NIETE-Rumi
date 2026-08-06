/**
 * The Certificates entry point must actually be ON the Training page.
 *
 * A component that renders correctly in isolation but is never mounted is the
 * classic "defined ≠ live" gap, and it is invisible to a component test. This
 * renders the real page and looks for the button.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";

// PortalLayout pulls navigation, auth and routing; the page under test only
// needs its children rendered.
vi.mock("../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import PortalTraining from "./PortalTraining";

beforeEach(() => {
  vi.clearAllMocks();
  (api.get as any).mockImplementation((url: string) => {
    if (url === "/training/vendors") return Promise.resolve({ data: { vendors: [] } });
    if (url === "/training/levels") return Promise.resolve({ data: { levels: [] } });
    if (url === "/training/certificates") return Promise.resolve({ data: { certificates: [] } });
    return Promise.resolve({ data: {} });
  });
});

describe("PortalTraining — certificates entry point", () => {
  it("renders the My certificates button", async () => {
    render(<PortalTraining />);
    expect(await screen.findByTestId("certificates-toggle")).toBeInTheDocument();
  });

  it("does not fetch certificates until the button is clicked", async () => {
    render(<PortalTraining />);
    await screen.findByTestId("certificates-toggle");
    const urls = (api.get as any).mock.calls.map((c: unknown[]) => c[0]);
    expect(urls).not.toContain("/training/certificates");
  });
});
