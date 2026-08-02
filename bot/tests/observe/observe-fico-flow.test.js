/**
 * bd-2369 — structural contract for the generated FICO observe Flow JSON.
 *
 * The FICO observe form is GENERATED from fico-framework.js (via
 * scripts/generate-observe-flow-json.js with OBSERVE_FRAMEWORK=fico). Prod was
 * serving the OLD 26-indicator form after FICO V3 (37 indicators) shipped to the
 * analysis + report — the observer's editable form had drifted. This test pins
 * the file↔framework consistency so that drift fails CI, not the human coach's
 * review screen.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const fs = require('fs');
const path = require('path');
const fico = require('../../shared/services/coaching/frameworks/fico-framework');

const FLOW_PATH = path.join(__dirname, '../../docs/flows/observe-fico-flow.json');

describe('observe-fico-flow.json — FICO V3 (37 indicators, B/C/D/F)', () => {
  const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
  const domainScreens = flow.screens.filter(s => s.id.startsWith('DOMAIN_'));
  const { domains, totalIndicators } = fico.getScoringConstants();

  test('5 screens: 4 domain screens (B/C/D/F) + terminal SUCCESS', () => {
    expect(flow.screens).toHaveLength(5);
    expect(domainScreens.map(s => s.id)).toEqual(['DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_F']);
    expect(flow.screens.find(s => s.id === 'SUCCESS').terminal).toBe(true);
  });

  test('data_exchange endpoint flow (v3.0)', () => {
    expect(flow.data_api_version).toBe('3.0');
  });

  test('all 37 framework indicators have rating + evidence + improvement fields', () => {
    const names = new Set();
    domainScreens.forEach(s => s.layout.children[0].children.forEach(c => { if (c.name) names.add(c.name); }));
    let count = 0;
    Object.values(domains).forEach(d => d.indicators.forEach(ind => {
      const f = String(ind.id).replace(/\./g, '_');
      expect(names.has(`r_${f}`)).toBe(true);
      expect(names.has(`ev_${f}`)).toBe(true);
      expect(names.has(`imp_${f}`)).toBe(true);
      count += 1;
    }));
    expect(count).toBe(totalIndicators); // 37
    expect(count).toBe(37);
  });

  test('rating options are the FICO 1-4 scale (never 0-3)', () => {
    domainScreens.forEach(s => {
      const scale = s.data.scale.__example__;
      expect(scale.map(o => o.id)).toEqual(['1', '2', '3', '4']);
    });
  });

  test('every init-values binding is declared in its screen data object', () => {
    domainScreens.forEach(s => {
      const iv = s.layout.children[0]['init-values'];
      const declared = new Set(Object.keys(s.data));
      Object.values(iv).forEach(binding => {
        const key = binding.match(/^\$\{data\.(.+)\}$/)[1];
        expect(declared.has(key)).toBe(true);
      });
    });
  });

  test('component count per screen is under the Meta cap (50) — C is the tightest', () => {
    const counts = domainScreens.map(s => s.layout.children[0].children.length);
    counts.forEach(n => expect(n).toBeLessThanOrEqual(50));
    // C has 12 indicators → 12*3 + heading + body + footer = 39.
    const cCount = domainScreens.find(s => s.id === 'DOMAIN_C').layout.children[0].children.length;
    expect(cCount).toBe(39);
  });

  test('routing is strictly forward-only B→C→D→F→SUCCESS', () => {
    expect(flow.routing_model).toEqual({
      DOMAIN_B: ['DOMAIN_C'], DOMAIN_C: ['DOMAIN_D'],
      DOMAIN_D: ['DOMAIN_F'], DOMAIN_F: ['SUCCESS'], SUCCESS: [],
    });
  });

  test('no MEWAKA/Kiswahili leakage, no undefined interpolation', () => {
    const raw = JSON.stringify(flow);
    for (const bad of ['undefined', 'MEWAKA', 'Asante', 'Endelea', 'Wasilisha', 'Haikuonekana']) {
      expect(raw).not.toContain(bad);
    }
  });
});
