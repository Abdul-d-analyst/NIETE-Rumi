/**
 * The Certificates panel on the Training page.
 *
 * Rendered, not grepped — the behaviour that matters here is what a teacher
 * sees after a click, and the one rule that is easy to get wrong is the
 * PDF-less certificate. Every certificate issued before PDF generation existed
 * has `pdf_r2_key = null`, and generation stays best-effort, so a null download
 * is permanent and valid: the certificate must still appear, with the download
 * simply absent — never a broken link, never an error row, never hidden.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import api from "../services/api";
import CertificatesPanel from "./CertificatesPanel";

const URL = "/training/certificates";

const WITH_PDF = {
  id: "cert-new",
  certificate_code: "PFX-20260802-NEW111",
  level_name: "Aspiring Teacher",
  teacher_name: "Amina Khan",
  issued_at: "2026-08-02T10:00:00Z",
  download_url: "https://r2.example.com/bucket/certs/u/PFX-20260802-NEW111.pdf?X-Amz-Signature=abc",
};

const WITHOUT_PDF = {
  id: "cert-old",
  certificate_code: "PFX-L1-20260712-OLD222",
  level_name: "Teacher Leader",
  teacher_name: "Amina Khan",
  issued_at: "2026-07-12T09:00:00Z",
  download_url: null,
};

function mockList(certificates: unknown[]) {
  (api.get as any).mockImplementation((url: string) => {
    if (url === URL) return Promise.resolve({ data: { success: true, certificates } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CertificatesPanel", () => {
  it("shows a button and fetches nothing until it is clicked", () => {
    mockList([]);
    render(<CertificatesPanel />);
    expect(screen.getByTestId("certificates-toggle")).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("lists the teacher's certificates on click", async () => {
    mockList([WITH_PDF, WITHOUT_PDF]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(URL));
    const rows = await screen.findAllByTestId("certificate-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("PFX-20260802-NEW111");
    expect(rows[0].textContent).toContain("Aspiring Teacher");
    expect(rows[1].textContent).toContain("PFX-L1-20260712-OLD222");
  });

  it("renders a download link pointing at the presigned URL", async () => {
    mockList([WITH_PDF]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    const link = await screen.findByTestId("certificate-download");
    expect(link).toHaveAttribute("href", WITH_PDF.download_url);
  });

  it("still lists a certificate with no PDF, with no link and no error", async () => {
    mockList([WITHOUT_PDF]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));

    const rows = await screen.findAllByTestId("certificate-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("PFX-L1-20260712-OLD222");
    expect(screen.queryByTestId("certificate-download")).toBeNull();
    expect(screen.queryByTestId("certificates-error")).toBeNull();
    // The absence is stated, not silent.
    expect(rows[0].textContent).toMatch(/not available/i);
  });

  it("shows an empty state when the teacher has none", async () => {
    mockList([]);
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));
    expect(await screen.findByTestId("certificates-empty")).toBeInTheDocument();
  });

  it("shows an error state when the fetch fails", async () => {
    (api.get as any).mockRejectedValue(new Error("500"));
    render(<CertificatesPanel />);
    await userEvent.click(screen.getByTestId("certificates-toggle"));
    expect(await screen.findByTestId("certificates-error")).toBeInTheDocument();
  });

  it("collapses again on a second click without refetching", async () => {
    mockList([WITH_PDF]);
    render(<CertificatesPanel />);
    const toggle = screen.getByTestId("certificates-toggle");

    await userEvent.click(toggle);
    await screen.findAllByTestId("certificate-row");
    await userEvent.click(toggle);

    await waitFor(() => expect(screen.queryAllByTestId("certificate-row")).toHaveLength(0));
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
