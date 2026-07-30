/**
 * bd-2404 — coach role dropped at registration.
 *
 * The PROFESSIONAL_INFO screen serves a `roles` dropdown (Teacher/Coach/
 * Principal/AEO) and the coach picks "Coach" (evidence img-013). But the
 * endpoint never reads screenData.role and the SUCCESS
 * extension_message_response.params omits `role`, so responseJson.role is
 * undefined in handleRegistrationFlow → users.role is never written → the
 * coach stays a teacher → /observe is denied (bd-2404) and the coach falls
 * into the teacher DC flow (bd-2410).
 *
 * RED-FIRST: these assert the endpoint carries the selected role into the
 * completion payload. They FAIL against current code (role is dropped).
 *
 * Created: 2026-07-30
 */

// Mock redis so we control the stored partial-registration blob.
let mockRegStore = {};
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (key, val) => { mockRegStore[key] = val; }),
  get: jest.fn(async (key) => mockRegStore[key] || null),
}));

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/config/branding', () => ({
  portalUrl: () => 'https://portal.example.com',
}));

const {
  handleRegistrationDataExchange,
} = require('../../shared/routes/registration-endpoint');

const FLOW_TOKEN = 'flow-tok-abc';

/**
 * Drive the real screen sequence: PERSONAL_INFO (non-PK to skip region) →
 * PROFESSIONAL_INFO with role=coach → assert the SUCCESS completion params
 * carry role.
 */
async function completeAsCoach({ org = 'niete', role = 'coach' } = {}) {
  mockRegStore = {};
  // PERSONAL_INFO → (non-PK) → PROFESSIONAL_INFO, stores partial to redis
  await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO', {
    full_name: 'Fakhr Coach', country: 'TZ',
  }, FLOW_TOKEN);
  // PROFESSIONAL_INFO submit with the role picked
  return handleRegistrationDataExchange('user-1', 'PROFESSIONAL_INFO', {
    organization: org,
    school_name: 'NIETE HQ',
    grade: 'grade_5',
    subjects: ['maths'],
    role,
  }, FLOW_TOKEN);
}

describe('bd-2404 registration role persistence (endpoint)', () => {
  it('carries the selected role into the SUCCESS completion params (coach)', async () => {
    const res = await completeAsCoach({ role: 'coach' });
    expect(res.screen).toBe('SUCCESS');
    const params = res.data.extension_message_response.params;
    expect(params.role).toBe('coach');
  });

  it('carries role through the org="other" → ORG_DETAILS → SUCCESS path', async () => {
    mockRegStore = {};
    await handleRegistrationDataExchange('user-2', 'PERSONAL_INFO', {
      full_name: 'Shazmina Coach', country: 'TZ',
    }, FLOW_TOKEN);
    await handleRegistrationDataExchange('user-2', 'PROFESSIONAL_INFO', {
      organization: 'other', school_name: 'X', grade: 'grade_4',
      subjects: ['english'], role: 'coach',
    }, FLOW_TOKEN);
    const res = await handleRegistrationDataExchange('user-2', 'ORG_DETAILS', {
      organization_other: 'Some Org',
    }, FLOW_TOKEN);
    expect(res.screen).toBe('SUCCESS');
    expect(res.data.extension_message_response.params.role).toBe('coach');
  });

  // The TRUE root layer: the live Flow's PROFESSIONAL_INFO data_exchange
  // payload dropped `role` (Meta never transmitted the picked value to the
  // endpoint). Guard the repo copy so a republish can't silently regress it.
  it('Flow JSON PROFESSIONAL_INFO data_exchange payload transmits role', () => {
    const fs = require('fs');
    const path = require('path');
    const flow = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../docs/flows/registration-flow.json'), 'utf8'));
    const prof = flow.screens.find(s => s.id === 'PROFESSIONAL_INFO');
    const findDataExchange = (o) => {
      if (Array.isArray(o)) { for (const v of o) { const r = findDataExchange(v); if (r) return r; } }
      else if (o && typeof o === 'object') {
        if (o.name === 'data_exchange' && o.payload) return o;
        for (const v of Object.values(o)) { const r = findDataExchange(v); if (r) return r; }
      }
      return null;
    };
    const act = findDataExchange(prof);
    expect(act).toBeTruthy();
    expect(act.payload.role).toBe('${form.role}');
    // the role Dropdown must exist with name=role
    const hasRoleField = JSON.stringify(prof).includes('"name":"role"') ||
      JSON.stringify(prof).includes('"name": "role"');
    expect(hasRoleField).toBe(true);
  });

  it('defaults to teacher when no role is picked (no downgrade of leaders happens downstream)', async () => {
    mockRegStore = {};
    await handleRegistrationDataExchange('user-3', 'PERSONAL_INFO', {
      full_name: 'Plain Teacher', country: 'TZ',
    }, FLOW_TOKEN);
    const res = await handleRegistrationDataExchange('user-3', 'PROFESSIONAL_INFO', {
      organization: 'niete', school_name: 'X', grade: 'grade_2', subjects: ['urdu'],
      // no role field submitted
    }, FLOW_TOKEN);
    const params = res.data.extension_message_response.params;
    // No role picked → null/teacher/undefined; downstream handler then leaves
    // users.role untouched (defaults to teacher). Never a stray leader value.
    expect([null, 'teacher', undefined]).toContain(params.role);
  });
});
