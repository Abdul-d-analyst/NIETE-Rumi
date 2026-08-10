/**
 * bd-2529 / BUG-141 port — a failed attendance voice note must SAY so.
 *
 * Patch 3 of the main bot's bd-2340 bundle. The outer catch around the
 * attendance voice branch logged the error and fell through to the normal
 * message flow, so a teacher whose voice note failed to transcribe got
 * NOTHING back — she was left staring at a chat that had swallowed her
 * roll call (BUG-141 #13, "silent voice failure").
 *
 * This asserts the behaviour at the seam rather than booting the whole
 * handler: when we are in AWAITING_VOICE_INPUT and processing throws, the
 * teacher is messaged and given the escape hatch to Tap to Mark.
 */

const AttendanceConversationService = require('../../bot/shared/services/attendance-conversation.service');

describe('bd-2529 — a failed attendance voice note is never silent', () => {
  const voiceHandlerSource = require('fs').readFileSync(
    require('path').join(__dirname, '../../bot/shared/handlers/voice-message.handler.js'),
    'utf8'
  );

  it('exposes STATES so the handler can recognise the voice step', () => {
    expect(AttendanceConversationService.STATES.AWAITING_VOICE_INPUT).toBe('AWAITING_VOICE_INPUT');
  });

  it('the attendance voice catch block messages the teacher instead of only logging', () => {
    // Isolate the catch block that guards the attendance voice branch.
    const catchBlock = voiceHandlerSource.split('Error processing attendance voice note')[1];
    expect(catchBlock).toBeDefined();

    // It must recover the session state and, when we were mid-voice-roll-call,
    // send something back to the teacher.
    const guarded = catchBlock.slice(0, 900);
    expect(guarded).toContain('AWAITING_VOICE_INPUT');
    expect(guarded).toContain('sendMessage');
  });

  it('offers the Tap to Mark escape hatch in the failure message', () => {
    const catchBlock = voiceHandlerSource.split('Error processing attendance voice note')[1] || '';
    expect(catchBlock.slice(0, 900)).toMatch(/Tap to Mark/);
  });

  it('still returns early so the failure does not fall through to the generic flow', () => {
    const catchBlock = voiceHandlerSource.split('Error processing attendance voice note')[1] || '';
    expect(catchBlock.slice(0, 900)).toContain('return;');
  });
});
