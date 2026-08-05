/**
 * bd-2504 — the /menu list shows Training first, and no longer offers Reading
 * Assessment or AI Video Generation.
 *
 * Operator decision 2026-08-02: those two are not part of what NIETE teachers
 * are being asked to do, and Training — the thing they ARE being asked to do —
 * was missing from the menu entirely.
 *
 * The ROWS are removed; the HANDLERS are deliberately kept. WhatsApp list rows
 * persist in scrollback forever, so a teacher tapping "Reading Assessment" from
 * a message sent last week must still land somewhere sensible. Removing the
 * handler would turn an old tap into an unknown-selection error — the same
 * class of bug as bd-2454.
 */
const fs = require('fs');
const path = require('path');

const WA = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/whatsapp.service.js'), 'utf8');
const MENU = fs.readFileSync(path.join(__dirname, '../../bot/shared/services/menu.service.js'), 'utf8');

/** The interactive-list rows block — the surface a teacher actually sees. */
function listRowIds() {
  const start = WA.indexOf("title: 'My Features'");
  const block = WA.slice(start, WA.indexOf(']', WA.indexOf('rows: [', start)) + 1);
  return [...block.matchAll(/id:\s*'(menu_[a-z_]+)'/g)].map(m => m[1]);
}

describe('bd-2504 — menu rows', () => {
  it('offers Training, and offers it FIRST', () => {
    const ids = listRowIds();
    expect(ids).toContain('menu_training');
    expect(ids[0]).toBe('menu_training');
  });

  it('no longer offers Reading Assessment or AI Video Generation', () => {
    const ids = listRowIds();
    expect(ids).not.toContain('menu_reading');
    expect(ids).not.toContain('menu_video');
  });

  it('keeps the surviving options', () => {
    const ids = listRowIds();
    expect(ids).toEqual(expect.arrayContaining(['menu_lesson_plan', 'menu_coaching', 'menu_other']));
  });

  it('stays within WhatsApp\'s 10-row list cap', () => {
    expect(listRowIds().length).toBeLessThanOrEqual(10);
  });
});

describe('bd-2504 — removed rows keep their handlers', () => {
  it('still handles a menu_reading tap from scrollback', () => {
    expect(MENU).toMatch(/case 'menu_reading'/);
  });

  it('still handles a menu_video tap from scrollback', () => {
    expect(MENU).toMatch(/case 'menu_video'/);
  });

  it('handles the new menu_training selection', () => {
    expect(MENU).toMatch(/case 'menu_training'/);
  });
});
