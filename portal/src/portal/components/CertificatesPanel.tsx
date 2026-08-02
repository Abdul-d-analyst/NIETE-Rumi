/**
 * CertificatesPanel — the teacher's earned certificates, on the Training page.
 *
 * Collapsed until asked for: certificates are a "show me my record" errand,
 * not something to load on every visit to the page, so the list is fetched on
 * the first expand and kept for the session.
 *
 * TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT:
 *
 *  1. EVERY certificate is downloadable. `download_url` is the portal's own
 *     download route, which fetch-or-mints: it renders the PDF on the first
 *     request and serves it from R2 afterwards. That matters because all
 *     12,954 certificates in production predate PDF generation — under the
 *     old "link only if already rendered" rule, every single one of them was
 *     a dead end reading "PDF not available".
 *
 *     `has_pdf: false` therefore means "not rendered YET", and the row says so,
 *     so a teacher knows the first click may take a second rather than
 *     thinking it hung.
 *
 *  2. There is deliberately NO `download` attribute on the anchor. It is
 *     ignored cross-origin, and the route redirects to R2. The attachment
 *     disposition is SIGNED into the presigned URL by the bot instead. Adding
 *     `download` here would look like it does the work and would hide the day
 *     the signing regresses.
 */

import { useState, useCallback } from 'react';
import { Award, Download, Loader2, AlertCircle } from 'lucide-react';
import api from '../services/api';

export type PortalCertificate = {
  id: string;
  certificate_code: string;
  level_name: string | null;
  teacher_name: string | null;
  issued_at: string | null;
  /** false = not rendered yet; the download route mints it on first request. */
  has_pdf?: boolean;
  download_url: string | null;
};

function formatIssued(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CertificatesPanel() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [certificates, setCertificates] = useState<PortalCertificate[]>([]);

  const toggle = useCallback(async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (loaded || loading) return;      // fetched once per session
    setLoading(true);
    setError(false);
    try {
      const { data } = await api.get('/training/certificates');
      setCertificates(data.certificates || []);
      setLoaded(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [open, loaded, loading]);

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={toggle}
        data-testid="certificates-toggle"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-900 hover:bg-green-100 transition-colors"
      >
        <Award className="w-4 h-4 text-green-700" />
        My certificates
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-border bg-card p-4" data-testid="certificates-panel">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="certificates-loading">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your certificates…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 text-sm text-red-700" data-testid="certificates-error">
              <AlertCircle className="w-4 h-4" />
              Could not load your certificates. Please try again.
            </div>
          )}

          {!loading && !error && certificates.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="certificates-empty">
              No certificates yet. Pass a level exam on WhatsApp to earn your first one.
            </p>
          )}

          {!loading && !error && certificates.length > 0 && (
            <ul className="space-y-3">
              {certificates.map((c) => (
                <li
                  key={c.id || c.certificate_code}
                  data-testid="certificate-row"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      <Award className="w-4 h-4 text-green-700 shrink-0" />
                      <span className="truncate">{c.level_name || 'Certificate'}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs bg-muted rounded px-2 py-1 inline-block break-all">
                      {c.certificate_code}
                    </div>
                    {c.issued_at && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Issued {formatIssued(c.issued_at)}
                      </div>
                    )}
                    {c.has_pdf === false && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Your PDF will be prepared on first download.
                      </div>
                    )}
                  </div>

                  {c.download_url ? (
                    <a
                      href={c.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="certificate-download"
                      className="inline-flex items-center gap-1.5 rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-900 hover:bg-green-100 transition-colors"
                    >
                      <Download className="w-4 h-4" /> Download PDF
                    </a>
                  ) : (
                    // Defensive only: the API gives every certificate a
                    // download route, so this should never render.
                    <span className="text-xs text-muted-foreground">Download unavailable</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
