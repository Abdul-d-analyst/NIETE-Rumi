/**
 * bd-2417 (FEAT-106 row 13, Sidra) — a 16-min recording froze at
 * status='initiated' / AWAITING_CONFIRMATION: the "Yes, Analyze" tap never came,
 * nothing recovered (NIETE has no cron, and the sweeper only handled
 * conducting_conversation), and follow-ups got misleading "still analyzing"
 * replies.
 *
 * classifyStuckInitiatedSession() decides what to do with a session stuck at the
 * confirmation gate: proceed with the recording (auto-confirm) once she's had a
 * grace window, abandon it if the audio is too old to still exist, and skip if
 * it's too recent.
 */

const {
  classifyStuckInitiatedSession,
  STUCK_INITIATED_MIN_AGE_MS,
  STUCK_INITIATED_MAX_AGE_MS,
} = require('../../bot/shared/services/coaching/coaching-stale-recovery');

const fs = require('fs');
const path = require('path');

describe('bd-2417 — recovery is wired to actually run (source guard)', () => {
  const worker = fs.readFileSync(path.join(__dirname, '../../bot/workers/stale-session.worker.js'), 'utf8');
  const sqs = fs.readFileSync(path.join(__dirname, '../../bot/workers/sqs-worker.js'), 'utf8');

  it('the worker recovers stuck confirmation-gate sessions (auto-confirm → queue transcription)', () => {
    expect(worker).toMatch(/processStuckInitiatedSessions/);
    expect(worker).toMatch(/classifyStuckInitiatedSession/);
    expect(worker).toMatch(/queueTranscription/);
  });
  it('the worker exports a no-exit runRecovery', () => {
    expect(worker).toMatch(/runRecovery/);
    expect(worker).toMatch(/module\.exports\s*=\s*\{[^}]*runRecovery/);
  });
  it('the always-on sqs-worker calls runRecovery on an interval (NIETE has no cron)', () => {
    expect(sqs).toMatch(/runRecovery/);
    expect(sqs).toMatch(/setInterval/);
  });
});

const NOW = 1_700_000_000_000;
const iso = (ms) => new Date(ms).toISOString();

describe('bd-2417 — classifyStuckInitiatedSession', () => {
  it('skips a session still inside the grace window (teacher may yet tap)', () => {
    const s = { status: 'initiated', created_at: iso(NOW - 60_000), audio_id: 'a1' };
    expect(classifyStuckInitiatedSession(s, NOW).action).toBe('skip');
  });

  it('auto-confirms (proceeds) a stuck recording past the grace window so she still gets a report', () => {
    const s = { status: 'initiated', created_at: iso(NOW - STUCK_INITIATED_MIN_AGE_MS - 60_000), audio_id: 'a1' };
    expect(classifyStuckInitiatedSession(s, NOW).action).toBe('auto_confirm');
  });

  it('abandons a session whose audio is too old to still exist on WhatsApp', () => {
    const s = { status: 'initiated', created_at: iso(NOW - STUCK_INITIATED_MAX_AGE_MS - 60_000), audio_id: 'a1' };
    expect(classifyStuckInitiatedSession(s, NOW).action).toBe('abandon');
  });

  it('abandons a stuck session with no audio to proceed on', () => {
    const s = { status: 'initiated', created_at: iso(NOW - STUCK_INITIATED_MIN_AGE_MS - 60_000), audio_id: null };
    expect(classifyStuckInitiatedSession(s, NOW).action).toBe('abandon');
  });

  it('skips a session with an unparseable timestamp (never act blindly)', () => {
    expect(classifyStuckInitiatedSession({ status: 'initiated', created_at: null, audio_id: 'a1' }, NOW).action).toBe('skip');
  });
});
