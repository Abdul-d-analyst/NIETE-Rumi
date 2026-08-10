/**
 * bd-2529 / BUG-141 port — the text handler must actually REACH the fixes.
 *
 * Patches 2 and 8 of the main bot's bd-2340 bundle. The service-layer fixes are
 * inert unless the handler routes to them:
 *
 *  - #12: replying "2" during voice roll call must call switchToTapFromVoice().
 *    The old call went to handleMarkingMethodSelection(), whose guard requires
 *    AWAITING_MARKING_METHOD — from AWAITING_VOICE_INPUT it returned
 *    INVALID_STATE and re-prompted "reply 2", forever.
 *  - #9: AWAITING_OVERWRITE_CONFIRM needs a case, or the overwrite reply falls
 *    into the "unknown state" branch and the session is cleared.
 *  - #15: the edit-class picker built interactive buttons from classes.slice(0,3).
 *    WhatsApp caps buttons at 3, so a teacher with 4+ classes could not reach
 *    the 4th — it must fall back to a list.
 */

const fs = require('fs');
const path = require('path');

const handlerSource = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/handlers/text-message.handler.js'),
  'utf8'
);

describe('bd-2529 — text handler wiring', () => {
  describe('voice → tap escape (#12)', () => {
    it('routes the "2" reply to switchToTapFromVoice, not the wrong-state guard', () => {
      const voiceCase = handlerSource
        .split('STATES.AWAITING_VOICE_INPUT:')[1]
        .slice(0, 900);
      expect(voiceCase).toContain('switchToTapFromVoice');
    });

    it('no longer re-enters handleMarkingMethodSelection from the voice state', () => {
      // Scope to THIS case body only — up to its `break;` — otherwise the
      // window spills into the neighbouring AWAITING_MARKING_METHOD case,
      // which legitimately does call handleMarkingMethodSelection.
      const voiceCase = handlerSource
        .split('STATES.AWAITING_VOICE_INPUT:')[1]
        .split('break;')[0]
        // Strip comments — the fix's own explanation names the old method.
        .replace(/\/\/.*$/gm, '');
      expect(voiceCase).not.toContain('handleMarkingMethodSelection(');
    });
  });

  describe('overwrite confirm (#9)', () => {
    it('has a case for AWAITING_OVERWRITE_CONFIRM', () => {
      expect(handlerSource).toContain('STATES.AWAITING_OVERWRITE_CONFIRM:');
    });

    it('routes it to handleOverwriteConfirm', () => {
      const overwriteCase = handlerSource
        .split('STATES.AWAITING_OVERWRITE_CONFIRM:')[1]
        .slice(0, 400);
      expect(overwriteCase).toContain('handleOverwriteConfirm');
    });
  });

  describe('edit-class picker for 4+ classes (#15)', () => {
    it('does not silently truncate the class list to the first 3', () => {
      // The bug: classes.slice(0, 3) fed straight into sendInteractiveButtons,
      // with no branch for a longer list.
      const editClassBlock = handlerSource
        .split('detectEditClassIntent(messageBody)')[1]
        .slice(0, 3000);
      const truncatesWithoutFallback =
        editClassBlock.includes('slice(0, 3)') && !editClassBlock.includes('sendInteractiveMessage');
      expect(truncatesWithoutFallback).toBe(false);
    });

    it('sends an interactive list when the teacher has more classes than fit in buttons', () => {
      const editClassBlock = handlerSource
        .split('detectEditClassIntent(messageBody)')[1]
        .slice(0, 3000);
      expect(editClassBlock).toContain('sendInteractiveMessage');
    });

    it('shows up to 10 classes, not 3', () => {
      const editClassBlock = handlerSource
        .split('detectEditClassIntent(messageBody)')[1]
        .slice(0, 3000);
      expect(editClassBlock).toContain('slice(0, 10)');
    });
  });

  describe('the list selection is actually routed (#15, second half)', () => {
    // Switching buttons → list moves the reply from the button_reply branch to
    // the list_reply branch. Emitting the new id without a consumer there would
    // mean tapping a class does nothing — the exact class of bug the pre-merge
    // checklist calls out.
    const botSource = fs.readFileSync(
      path.join(__dirname, '../../bot/whatsapp-bot.js'),
      'utf8'
    );

    it('routes edit_class_ ids in the list_reply branch too', () => {
      const listBranch = botSource.split("interactive?.type === 'list_reply'")[1] || '';
      expect(listBranch).toContain("startsWith('edit_class_')");
    });

    it('opens the edit-class Flow from a list selection', () => {
      const listBranch = botSource.split("interactive?.type === 'list_reply'")[1] || '';
      const editRoute = listBranch.split("startsWith('edit_class_')")[1].slice(0, 1200);
      expect(editRoute).toContain('EDIT_CLASS_FLOW_ID');
      expect(editRoute).toContain('sendFlow');
    });

    it('still scopes the lookup to the teacher who owns the class', () => {
      const listBranch = botSource.split("interactive?.type === 'list_reply'")[1] || '';
      const editRoute = listBranch.split("startsWith('edit_class_')")[1].slice(0, 1200);
      expect(editRoute).toContain("eq('user_id', user.id)");
      expect(editRoute).toContain("eq('is_active', true)");
    });
  });
});
