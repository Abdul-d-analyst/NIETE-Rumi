/**
 * FEAT-106 #1 part 2 (bd-2377) — Soniox model cascade → v5 primary / v4 backup.
 *
 * The code used stt-async-v3 as PRIMARY — but Soniox RETIRED stt-async-v3 on
 * 2026-02-28. The current recommended async model is stt-async-v5 (released
 * 2026-06-11); stt-async-v4 aliases to v5. The cascade now runs v5 (advanced
 * features) → v4 (basic) → Whisper (chunked, part 1), with the model IDs
 * env-overridable so a naming change is a config fix, not a redeploy.
 */

describe('FEAT-106 #1 — Soniox model constants', () => {
  const saved = {};
  beforeEach(() => { for (const k of ['SONIOX_PRIMARY_MODEL', 'SONIOX_BACKUP_MODEL']) saved[k] = process.env[k]; jest.resetModules(); });
  afterEach(() => {
    for (const k of ['SONIOX_PRIMARY_MODEL', 'SONIOX_BACKUP_MODEL']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    jest.resetModules();
  });

  it('defaults to v5 primary / v4 backup', () => {
    delete process.env.SONIOX_PRIMARY_MODEL;
    delete process.env.SONIOX_BACKUP_MODEL;
    const c = require('../../bot/shared/utils/constants');
    expect(c.SONIOX_PRIMARY_MODEL).toBe('stt-async-v5');
    expect(c.SONIOX_BACKUP_MODEL).toBe('stt-async-v4');
  });

  it('is env-overridable (so a Soniox model rename is a config fix)', () => {
    process.env.SONIOX_PRIMARY_MODEL = 'stt-async-v6';
    process.env.SONIOX_BACKUP_MODEL = 'stt-async-v5';
    const c = require('../../bot/shared/utils/constants');
    expect(c.SONIOX_PRIMARY_MODEL).toBe('stt-async-v6');
    expect(c.SONIOX_BACKUP_MODEL).toBe('stt-async-v5');
  });
});

describe('FEAT-106 #1 — Soniox request-body builder', () => {
  const AudioService = require('../../bot/shared/services/audio.service');

  it('gives the PRIMARY model the advanced features (language-id, context, diarization)', () => {
    const body = AudioService._buildSonioxRequestBody({
      fileId: 'f1', modelVersion: 'stt-async-v5', isPrimary: true, enableDiarization: true, language: null,
    });
    expect(body.model).toBe('stt-async-v5');
    expect(body.enable_language_identification).toBe(true);
    expect(body.enable_speaker_diarization).toBe(true);
    expect(body.context).toBeTruthy();
    expect(Array.isArray(body.language_hints)).toBe(true);
  });

  it('keeps the BACKUP model basic (no context / no language-id)', () => {
    const body = AudioService._buildSonioxRequestBody({
      fileId: 'f1', modelVersion: 'stt-async-v4', isPrimary: false, enableDiarization: true, language: null,
    });
    expect(body.model).toBe('stt-async-v4');
    expect(body.context).toBeUndefined();
    expect(body.enable_language_identification).toBeUndefined();
  });

  it('uses a single language hint when a specific language is given (reading assessment)', () => {
    const body = AudioService._buildSonioxRequestBody({
      fileId: 'f1', modelVersion: 'stt-async-v5', isPrimary: true, enableDiarization: false, language: 'ur-PK',
    });
    expect(body.language_hints).toEqual(['ur']); // region suffix stripped for Soniox
  });
});
