/**
 * AssessmentGeneratorPanel — browser surface for the UG_EG-backed Assessment
 * Generator (previously WhatsApp-Flow-only). Lives as a tab on the Curriculum
 * page.
 *
 * Flow:
 *   1. Teacher picks generation type, grade, subject, page ranges, content
 *      source (Seen / Unseen), and one or more question types with per-type
 *      counts + an objective/subjective category.
 *   2. Submit → POST /assessment/generate → { jobId }.
 *   3. Poll GET /assessment/status/:jobId every ~5s with a spinner.
 *   4. On completed → Download button (PDF / Word toggle re-fetches the URL in
 *      the chosen format). On failed → error toast.
 *
 * All generation happens server-side on the existing engine; this component
 * only collects the spec and polls. No new persistence — the job link lives in
 * Redis for ~30 min server-side.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { FileText, Loader2, Download, Sparkles, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { portal } from '../services/api';
import type { AssessmentQuestionType } from '../services/api';

// Subjects per grade — mirrors the WhatsApp Flow's SUBJECTS_BY_GRADE so the
// browser offers the same set the bot does (ids are stable; only labels differ
// across grade bands).
const SUBJECTS_LOWER = [
  { id: 'Eng', label: 'English' },
  { id: 'Urdu', label: 'Urdu' },
  { id: 'Maths', label: 'Maths' },
  { id: 'Islamiat', label: 'Islamiyat' },
  { id: 'GenK', label: 'General Knowledge' },
];
const SUBJECTS_UPPER = [
  { id: 'Eng', label: 'English' },
  { id: 'Maths', label: 'Mathematics' },
  { id: 'Urdu', label: 'Urdu' },
  { id: 'Islamiat', label: 'Islamiyat' },
  { id: 'SST', label: 'Social Studies' },
  { id: 'Science', label: 'General Science' },
];
function subjectsForGrade(grade: string) {
  const g = parseInt(grade, 10);
  return g >= 4 ? SUBJECTS_UPPER : SUBJECTS_LOWER;
}

// A curated set of common UG_EG question types with their natural category.
// Teachers can add any of these; category stays editable per row. Ids match
// UG_EG's question-types-ict.md catalogue so the engine resolves them.
const QUESTION_TYPE_CATALOGUE: { id: string; category: 'objective' | 'subjective' }[] = [
  { id: 'MCQs', category: 'objective' },
  { id: 'MSQs', category: 'objective' },
  { id: 'Fill in the Blanks', category: 'objective' },
  { id: 'True/False', category: 'objective' },
  { id: 'Match the Column', category: 'objective' },
  { id: 'Short Questions', category: 'subjective' },
  { id: 'Long Question', category: 'subjective' },
  { id: 'Comprehension Passage', category: 'subjective' },
  { id: 'Word Problems', category: 'subjective' },
];

const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;
const POLL_INTERVAL_MS = 5000;

type Row = AssessmentQuestionType;

const AssessmentGeneratorPanel = () => {
  const { toast } = useToast();

  const [generationType, setGenerationType] = useState<'exam' | 'class_assessment'>('exam');
  const [grade, setGrade] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [pageRanges, setPageRanges] = useState<string>('');
  const [contentSource, setContentSource] = useState<'seen' | 'unseen'>('unseen');
  const [rows, setRows] = useState<Row[]>([{ id: 'MCQs', count: DEFAULT_COUNT, category: 'objective' }]);
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');

  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPolling(false);
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  // Reset the subject when the grade changes to an incompatible band.
  useEffect(() => {
    if (!subject) return;
    if (!subjectsForGrade(grade).some(s => s.id === subject)) setSubject('');
  }, [grade, subject]);

  const addRow = () => {
    // Pick the first catalogue type not already added; fall back to MCQs.
    const used = new Set(rows.map(r => r.id));
    const next = QUESTION_TYPE_CATALOGUE.find(t => !used.has(t.id)) || QUESTION_TYPE_CATALOGUE[0];
    setRows([...rows, { id: next.id, count: DEFAULT_COUNT, category: next.category }]);
  };
  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<Row>) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const poll = useCallback(async (id: string) => {
    try {
      const res = await portal.getAssessmentStatus(id, format);
      if (res.status === 'completed' && res.downloadUrl) {
        stopPolling();
        setDownloadUrl(res.downloadUrl);
        setFilename(res.filename || 'assessment');
        toast({ title: 'Your assessment is ready', description: 'Download it below.' });
      } else if (res.status === 'failed') {
        stopPolling();
        toast({
          title: 'Generation failed',
          description: res.error || 'Please try again in a minute.',
          variant: 'destructive',
        });
      }
      // pending / processing → keep polling
    } catch {
      stopPolling();
      toast({ title: 'Lost track of your assessment', description: 'Please try again.', variant: 'destructive' });
    }
  }, [format, stopPolling, toast]);

  const handleGenerate = useCallback(async () => {
    // Client-side validation mirrors the server's contract (fast feedback).
    if (!grade) return toast({ title: 'Pick a grade', variant: 'destructive' });
    if (!subject) return toast({ title: 'Pick a subject', variant: 'destructive' });
    if (!pageRanges.trim()) return toast({ title: 'Enter page ranges', description: 'e.g. 10-15', variant: 'destructive' });
    const questionTypes = rows.filter(r => r.id && r.count > 0);
    if (questionTypes.length === 0) return toast({ title: 'Add at least one question type', variant: 'destructive' });

    setSubmitting(true);
    setDownloadUrl(null);
    setFilename(null);
    setJobId(null);
    stopPolling();
    try {
      const res = await portal.generateAssessment({
        generationType,
        grade: parseInt(grade, 10),
        subject,
        pageRanges: pageRanges.trim(),
        contentSource,
        questionTypes,
        format,
      });
      if (!res.success || !res.jobId) {
        toast({ title: 'Could not start', description: res.error || 'Please try again.', variant: 'destructive' });
        return;
      }
      setJobId(res.jobId);
      setPolling(true);
      // Kick an immediate poll, then every POLL_INTERVAL_MS.
      poll(res.jobId);
      pollRef.current = setInterval(() => poll(res.jobId!), POLL_INTERVAL_MS);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast({ title: 'Could not start', description: msg || 'Please check your inputs and try again.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }, [generationType, grade, subject, pageRanges, contentSource, rows, format, poll, stopPolling, toast]);

  // When the teacher flips PDF/Word after completion, re-fetch the URL in the
  // new format (a fresh server render + presign).
  const handleDownload = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await portal.getAssessmentStatus(jobId, format);
      if (res.status === 'completed' && res.downloadUrl) {
        window.open(res.downloadUrl, '_blank', 'noopener');
      } else {
        toast({ title: 'Not ready yet', description: 'Please wait a moment.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Could not fetch the file', variant: 'destructive' });
    }
  }, [jobId, format, toast]);

  const busy = submitting || polling;

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-1">
        <FileText className="w-6 h-6 text-primary" />
        <h2 className="text-xl font-medium">Generate an Assessment</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Build a print-ready exam or classroom practice paper from the curriculum. Pick your options and
        we'll prepare it — usually in under a minute.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Generation type */}
        <div>
          <Label className="mb-2 block">Type</Label>
          <Select value={generationType} onValueChange={(v) => setGenerationType(v as 'exam' | 'class_assessment')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exam">Exam paper</SelectItem>
              <SelectItem value="class_assessment">Classroom practice</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Grade */}
        <div>
          <Label className="mb-2 block">Grade</Label>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger><SelectValue placeholder="Select grade..." /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map(g => (
                <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Subject */}
        <div>
          <Label className="mb-2 block">Subject</Label>
          <Select value={subject} onValueChange={setSubject} disabled={!grade}>
            <SelectTrigger>
              <SelectValue placeholder={grade ? 'Select subject...' : 'Select grade first'} />
            </SelectTrigger>
            <SelectContent>
              {subjectsForGrade(grade).map(s => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page ranges */}
        <div>
          <Label className="mb-2 block" htmlFor="page-ranges">Page ranges</Label>
          <Input
            id="page-ranges"
            placeholder="e.g. 10-15 or 10-15, 20"
            value={pageRanges}
            onChange={(e) => setPageRanges(e.target.value)}
          />
        </div>
      </div>

      {/* Content source */}
      <div className="mb-6">
        <Label className="mb-2 block">Content source</Label>
        <RadioGroup
          value={contentSource}
          onValueChange={(v) => setContentSource(v as 'seen' | 'unseen')}
          className="flex gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="seen" id="cs-seen" />
            <Label htmlFor="cs-seen" className="font-normal">Seen (from the text)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="unseen" id="cs-unseen" />
            <Label htmlFor="cs-unseen" className="font-normal">Unseen (new questions)</Label>
          </div>
        </RadioGroup>
      </div>

      {/* Question types */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Label>Question types</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addRow} className="flex items-center gap-1">
            <Plus className="w-4 h-4" /> Add type
          </Button>
        </div>
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div key={idx} className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <div className="flex-1">
                <Select value={row.id} onValueChange={(v) => {
                  const cat = QUESTION_TYPE_CATALOGUE.find(t => t.id === v)?.category || 'objective';
                  updateRow(idx, { id: v, category: cat });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPE_CATALOGUE.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-40">
                <Select
                  value={row.category || 'objective'}
                  onValueChange={(v) => updateRow(idx, { category: v as 'objective' | 'subjective' })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="objective">Objective</SelectItem>
                    <SelectItem value="subjective">Subjective</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-24">
                <Input
                  type="number"
                  min={1}
                  max={MAX_COUNT}
                  value={row.count}
                  aria-label={`${row.id} count`}
                  onChange={(e) => {
                    const n = Math.min(Math.max(1, parseInt(e.target.value, 10) || 1), MAX_COUNT);
                    updateRow(idx, { count: n });
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(idx)}
                disabled={rows.length === 1}
                aria-label="Remove question type"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Format + generate */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <Label className="mb-2 block">Format</Label>
          <RadioGroup
            value={format}
            onValueChange={(v) => setFormat(v as 'pdf' | 'docx')}
            className="flex gap-6"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="pdf" id="fmt-pdf" />
              <Label htmlFor="fmt-pdf" className="font-normal">PDF</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="docx" id="fmt-docx" />
              <Label htmlFor="fmt-docx" className="font-normal">Word</Label>
            </div>
          </RadioGroup>
        </div>
        <div className="sm:ml-auto flex items-end">
          <Button onClick={handleGenerate} disabled={busy} className="flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {submitting ? 'Starting…' : polling ? 'Preparing…' : 'Generate assessment'}
          </Button>
        </div>
      </div>

      {/* Result */}
      {polling && (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Preparing your {format === 'docx' ? 'Word' : 'PDF'} assessment… this usually takes under a minute.
        </div>
      )}
      {downloadUrl && !polling && (
        <div className="mt-6 rounded-md border bg-muted/40 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{filename || 'Your assessment'} is ready.</span>
          <Button onClick={handleDownload} className="flex items-center gap-2 ml-auto">
            <Download className="w-4 h-4" />
            Download {format === 'docx' ? 'Word' : 'PDF'}
          </Button>
        </div>
      )}
    </div>
  );
};

export default AssessmentGeneratorPanel;
