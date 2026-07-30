/**
 * bd-2342 — port GPT5MiniService.completeJson to NIETE.
 *
 * The observe debrief stack (observe-debrief.service.js, observe-send.service.js)
 * calls GPT5MiniService.completeJson(prompt, { maxTokens, label }) → { result }.
 * That method existed in the main bot (FEAT-053 bd-22) but was NEVER ported to
 * NIETE — so every debrief-guide, coach-feedback, and teacher-notes call threw
 * "completeJson is not a function", and 0 of 48 HITL debriefs ever completed.
 *
 * This pins the contract the three call sites depend on.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const GPT5MiniService = require('../../shared/services/gpt5-mini.service');

let lastArgs;
function stubClient(content, finishReason = 'stop') {
  lastArgs = null;
  GPT5MiniService.openai = {
    chat: { completions: { create: async (args) => {
      lastArgs = args;
      return {
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: { total_tokens: 42 },
      };
    } } },
  };
}

describe('bd-2342 — GPT5MiniService.completeJson', () => {
  test('exists as a static method', () => {
    expect(typeof GPT5MiniService.completeJson).toBe('function');
  });

  test('returns parsed result + usage; json_object mode; passes maxTokens + model', async () => {
    stubClient('{"a":1,"b":"x"}');
    const { result, usage } = await GPT5MiniService.completeJson('give me JSON', { maxTokens: 1234, label: 't' });
    expect(result).toEqual({ a: 1, b: 'x' });
    expect(usage.total_tokens).toBe(42);
    expect(lastArgs.response_format).toEqual({ type: 'json_object' });
    expect(lastArgs.max_completion_tokens).toBe(1234);
    expect(lastArgs.model).toBe('gpt-5-mini-2025-08-07');
    // GPT-5 mini only supports the default temperature — must NOT be set
    expect(lastArgs.temperature).toBeUndefined();
  });

  test('defaults maxTokens to 4000 when unspecified', async () => {
    stubClient('{}');
    await GPT5MiniService.completeJson('JSON');
    expect(lastArgs.max_completion_tokens).toBe(4000);
  });

  test('repairs slightly-malformed JSON via jsonrepair (trailing comma)', async () => {
    stubClient('{"a":1,}');
    const { result } = await GPT5MiniService.completeJson('JSON pls');
    expect(result).toEqual({ a: 1 });
  });

  test('rethrows on API error so callers fall back (never silently returns bad data)', async () => {
    GPT5MiniService.openai = { chat: { completions: { create: async () => { throw new Error('boom'); } } } };
    await expect(GPT5MiniService.completeJson('JSON')).rejects.toThrow('boom');
  });
});
