/**
 * Mock Language Cache for Testing
 *
 * Keep this in step with the real module's exports. A consumer that calls
 * something absent here fails with "not a function", which reads as a bug in the
 * code under test rather than a gap in the mock.
 */

const getUserLanguage = jest.fn().mockResolvedValue('en');
const setUserLanguage = jest.fn().mockResolvedValue(true);
const setLanguageLock = jest.fn().mockResolvedValue(true);
// Defaults to LOCKED, matching the real module's conservative direction: a caller
// asking this question is deciding whether it may overwrite a teacher's choice,
// and an unconfigured mock must not read as permission.
const isUserLanguageLocked = jest.fn().mockResolvedValue(true);
const clearUserLanguageCache = jest.fn().mockResolvedValue(true);

module.exports = {
  getUserLanguage,
  setUserLanguage,
  setLanguageLock,
  isUserLanguageLocked,
  clearUserLanguageCache,
  VALID_LANGUAGES: ['en', 'ur'],
  DEFAULT_LANGUAGE: 'en',
};
