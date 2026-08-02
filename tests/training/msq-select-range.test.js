/**
 * bd-2502 — the MSQ Flow told teachers to "Select 1-10" on a 5-option question.
 *
 * `max-selected-items` was hardcoded to 10 in the Flow JSON. Meta renders that
 * bound as a hint, so every multi-answer question — all of which have exactly
 * 5 options today — advertised a ceiling four higher than the number of things
 * on screen. Confirmed live 2026-08-02.
 *
 * Verified against Meta before writing this: `max-selected-items` DOES accept a
 * data binding. Three probe drafts were uploaded; the only validation errors
 * returned were about unrelated keys, and a clean probe returned none at all.
 * So the ceiling can travel with the question instead of being frozen in JSON.
 *
 * The Flow JSON must declare `max_selected`, and the endpoint must send it, or
 * the binding renders as literal text (skill rule 5).
 */
const fs = require('fs');
const path = require('path');

const FLOW = path.join(__dirname, '../../docs/flows/training-msq-flow.json');

describe('bd-2502 — the Flow JSON binds the ceiling instead of freezing it', () => {
  const flow = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
  const screen = flow.screens[0];
  const findCheckbox = (node) => {
    if (Array.isArray(node)) return node.map(findCheckbox).find(Boolean);
    if (node && typeof node === 'object') {
      if (node.type === 'CheckboxGroup') return node;
      return Object.values(node).map(findCheckbox).find(Boolean);
    }
    return undefined;
  };

  it('max-selected-items is data-bound, not a frozen number', () => {
    expect(findCheckbox(screen)['max-selected-items']).toBe('${data.max_selected}');
  });

  it('declares max_selected in the screen data, or the binding renders literally', () => {
    expect(screen.data.max_selected).toBeDefined();
    expect(screen.data.max_selected.__example__).toEqual(expect.any(Number));
  });

  it('keeps a floor of 1 — an empty submission is not an answer', () => {
    expect(findCheckbox(screen)['min-selected-items']).toBe(1);
  });
});

describe('bd-2502 — the endpoint sends a ceiling that matches what is on screen', () => {
  it('max_selected equals the number of options actually rendered', () => {
    // Asserted against the builder's own output shape rather than a fixture:
    // the ceiling must track `options.length`, which is the displayed set after
    // bd-2495's cap and shuffle — not the raw bank, and not a constant.
    const src = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'), 'utf8');
    const block = src.slice(src.indexOf('async function buildMsqFlowScreenData'));
    const ret = block.slice(block.indexOf('return {'), block.indexOf('training_msq_action'));
    expect(ret).toMatch(/max_selected:\s*options\.length/);
  });
});
