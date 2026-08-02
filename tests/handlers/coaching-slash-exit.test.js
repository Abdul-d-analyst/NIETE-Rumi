/**
 * bd-2508 — any slash command ends a coaching conversation and runs.
 *
 * `conducting_conversation` was the only waiting state with no way out. The
 * interceptor in text-message.handler grabbed EVERY message and returned early,
 * so:
 *   - free text went to the coach (correct — that is the whole point), but
 *   - `/menu`, `/training`, everything else went to the coach too.
 *
 * The bot's own escape-path map tells teachers to "type /menu" to get out of
 * AWAITING_MENU_CHOICE, AWAITING_VIDEO_TOPIC, AWAITING_LESSON_PLAN and
 * AWAITING_CLASSROOM_AUDIO. CONDUCTING_CONVERSATION was never added to that
 * map — so the one escape the product teaches was the one that did not work,
 * in the one state with no alternative.
 *
 * Exempting commands is not enough on its own: the session would stay open and
 * swallow the next free-text message, so the teacher escapes and is
 * immediately recaptured. The session must END.
 *
 * Found live: one teacher held for 269 hours.
 *
 * NOTE ON TEST SHAPE. text-message.handler requires ~40 services at module load
 * and cannot be booted in this suite, so these are source contracts, not
 * behavioural tests. They pin ORDER and PRESENCE, which is exactly what broke.
 * A behavioural test needs the handler decomposed first — out of scope here.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'), 'utf8');

/** The coaching interceptor block. */
function interceptor() {
  const anchor = SRC.indexOf('CHECK FOR ACTIVE COACHING SESSION');
  expect(anchor).toBeGreaterThan(-1);
  return SRC.slice(anchor, SRC.indexOf('PAUSE-AND-RESUME', anchor));
}

describe('bd-2508 — a slash command escapes coaching', () => {
  it('the interceptor checks for a slash command', () => {
    expect(interceptor()).toMatch(/startsWith\('\/'\)/);
  });

  it('it checks BEFORE routing the message to the coach', () => {
    const b = interceptor();
    const guard = b.indexOf("startsWith('/')");
    const route = b.indexOf('handleReflectiveResponse');
    // Both must EXIST first — indexOf returns -1 when absent, and -1 is less
    // than any real index, so a naive ordering assertion passes vacuously.
    expect(guard).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(route);
  });

  it('ending the session is not optional — the status is written', () => {
    // Without this the teacher escapes once and the next free-text message is
    // recaptured by the same still-open session.
    expect(interceptor()).toMatch(/status:\s*'abandoned'/);
  });

  it('free text still reaches the coach — the flow itself is untouched', () => {
    expect(interceptor()).toMatch(/handleReflectiveResponse/);
  });
});

describe('bd-2508 — the escape is discoverable', () => {
  it('CONDUCTING_CONVERSATION has an escape-path message like every other waiting state', () => {
    const helper = fs.readFileSync(
      path.join(__dirname, '../../bot/shared/services/helper-agent.service.js'), 'utf8');
    expect(helper).toMatch(/CONDUCTING_CONVERSATION/);
  });
});
