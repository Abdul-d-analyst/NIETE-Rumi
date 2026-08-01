/**
 * bd-2460 — the Assessment Generator's not-yet-live state.
 *
 * The tab stays visible on purpose. Hiding it would leave a teacher who has
 * heard about the feature hunting for it and then asking support; telling them
 * plainly costs nothing and sets the expectation.
 *
 * This is advisory only. The real gate is server-side — /assessment/generate
 * and /assessment/status both return 503 while the feature is off — so a
 * teacher who reaches the form some other way still cannot start a job.
 *
 * The copy comes from the API rather than being hardcoded here, so the portal
 * and the WhatsApp bot always say the same thing.
 */
import { FileText } from 'lucide-react';

const FALLBACK =
  "The assessment generator is being prepared for you. We'll notify you when it's live.";

type Props = { message?: string | null };

const AssessmentGeneratorComingSoon = ({ message }: Props) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
    <FileText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
    <h3 className="text-lg font-medium">Assessment Generator</h3>
    <p className="max-w-md text-sm text-muted-foreground">{message || FALLBACK}</p>
  </div>
);

export default AssessmentGeneratorComingSoon;
