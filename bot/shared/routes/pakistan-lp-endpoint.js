/**
 * Pakistan Lesson Plan Flow Endpoint (FEAT-059 / FEAT-109)
 *
 * v2 screens: SELECT_GRADE → SELECT_SUBJECT → SELECT_CHAPTER → SELECT_TOPIC → SUCCESS
 * (v1's SPEC welcome screen was removed for FEAT-109; teachers land directly
 *  on the grade picker.)
 *
 * Delivery uses the Palestine pattern (bd-2054):
 *   sendDocumentByLink(phone, getPresignedUrl(buildR2PublicUrl(key)))
 * NOT the download → tmpfile → sendDocument(path) pattern which silently
 * failed in prior versions.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
const WhatsAppService = require('../services/whatsapp.service');

const CURRICULUM_TAG = 'pakistan';

const gradeRank = (g) => {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) ? n : 99;
};
const gradeTitle = (g) => `Grade ${g}`;

async function fetchRows(filter = {}) {
  let q = supabase
    .from('pre_generated_lps')
    .select('id,grade,subject,chapter_number,chapter_title,pdf_r2_key_en,pdf_r2_key_ur,generation_status')
    .eq('curriculum', CURRICULUM_TAG)
    .eq('is_current', true);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) {
    logToFile('Pakistan LP: supabase error', { error: error.message, filter });
    return [];
  }
  return (data || []).filter((r) => r.generation_status === 'completed' && (r.pdf_r2_key_en || r.pdf_r2_key_ur));
}

function distinct(rows, key) {
  return [...new Set(rows.map((r) => r[key]).filter((v) => v != null && v !== ''))];
}

async function getPhoneForUser(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('users')
    .select('phone_number,preferred_language')
    .eq('id', userId)
    .single();
  return data || null;
}

// ---------- INIT ----------
// v2: INIT returns SELECT_GRADE directly (SPEC removed).
async function handlePakistanLpInit(flowToken) {
  logToFile('Pakistan LP Flow INIT', { flowToken });
  return openGradePicker();
}

// ---------- DATA EXCHANGE ----------
async function handlePakistanLpDataExchange(flowToken, screen, screenData) {
  logToFile('Pakistan LP data_exchange', { flowToken, screen, screenData });
  if (screen === 'SELECT_GRADE')    return selectGrade(screenData);
  if (screen === 'SELECT_SUBJECT')  return selectSubject(screenData);
  if (screen === 'SELECT_CHAPTER')  return selectChapter(screenData);
  if (screen === 'SELECT_TOPIC')    return selectTopic(flowToken, screenData);
  logToFile('Pakistan LP: unknown screen', { screen });
  return { data: { error: { message: 'Something went wrong.' } } };
}

// INIT / re-entry — build the grade dropdown from live rows.
async function openGradePicker() {
  const rows = await fetchRows();
  const grades = distinct(rows, 'grade')
    .sort((a, b) => gradeRank(a) - gradeRank(b))
    .map((g) => ({ id: String(g), title: gradeTitle(g) }));
  if (grades.length === 0) {
    return {
      screen: 'SELECT_GRADE',
      data: {
        grades: [],
        error: { message: 'The lesson plan library is being prepared. Please try again later.' },
      },
    };
  }
  return { screen: 'SELECT_GRADE', data: { grades } };
}

// SELECT_GRADE → SELECT_SUBJECT
async function selectGrade(screenData) {
  const grade = screenData && screenData.grade;
  if (!grade) return { data: { error: { message: 'Please select a class.' } } };
  const rows = await fetchRows({ grade: parseInt(grade, 10) });
  const subjects = distinct(rows, 'subject')
    .sort()
    .map((s) => ({ id: s, title: s }));
  if (subjects.length === 0) {
    return { data: { error: { message: `No lesson plans available for ${gradeTitle(grade)} yet.` } } };
  }
  return {
    screen: 'SELECT_SUBJECT',
    data: { subjects, grade_value: String(grade), grade_display: gradeTitle(grade) },
  };
}

// SELECT_SUBJECT → SELECT_CHAPTER
async function selectSubject(screenData) {
  const grade = screenData && screenData.grade;
  const subject = screenData && screenData.subject;
  if (!grade || !subject) return { data: { error: { message: 'Please select a subject.' } } };
  const rows = await fetchRows({ grade: parseInt(grade, 10), subject });
  if (rows.length === 0) {
    return { data: { error: { message: `No ${subject} lesson plans for ${gradeTitle(grade)} yet.` } } };
  }
  // Chapters — one entry per distinct chapter_number in this (grade, subject).
  const seen = new Set();
  const chapters = [];
  rows
    .sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0))
    .forEach((r) => {
      const key = String(r.chapter_number);
      if (seen.has(key)) return;
      seen.add(key);
      chapters.push({
        id: key,
        title: r.chapter_title
          ? `Ch ${r.chapter_number}: ${r.chapter_title.replace(/\s*\(chapter reading — full LP pending\)\s*$/, '')}`
          : `Chapter ${r.chapter_number}`,
      });
    });
  return {
    screen: 'SELECT_CHAPTER',
    data: {
      chapters,
      grade_value: String(grade),
      subject_value: subject,
      header_text: `${gradeTitle(grade)} — ${subject}`,
    },
  };
}

// SELECT_CHAPTER → SELECT_TOPIC
// Topics under a chapter are today either (a) additional rows in
// pre_generated_lps sharing the same (grade, subject, chapter_number),
// or (b) a single synthetic "Full Chapter Lesson Plan" option when
// only one row exists. Selection payload carries the row UUID so the
// SELECT_TOPIC → SUCCESS handler can look up + deliver.
async function selectChapter(screenData) {
  const grade = screenData && screenData.grade;
  const subject = screenData && screenData.subject;
  const chapter = screenData && screenData.chapter;
  if (!grade || !subject || !chapter) {
    return { data: { error: { message: 'Please pick a chapter.' } } };
  }
  const rows = await fetchRows({ grade: parseInt(grade, 10), subject, chapter_number: parseInt(chapter, 10) });
  if (rows.length === 0) {
    return { data: { error: { message: 'No lesson plan for that chapter yet.' } } };
  }
  const chapterTitle = (rows[0].chapter_title || `Chapter ${chapter}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
  const topics = rows.map((r) => ({
    id: String(r.id),
    title: rows.length === 1 ? 'Full Chapter Lesson Plan' : (r.chapter_title || `Chapter ${r.chapter_number}`),
  }));
  return {
    screen: 'SELECT_TOPIC',
    data: {
      topics,
      grade_value: String(grade),
      subject_value: subject,
      chapter_value: String(chapter),
      header_text: `${gradeTitle(grade)} ${subject} · Ch ${chapter}: ${chapterTitle}`,
    },
  };
}

// SELECT_TOPIC → SUCCESS (delivers PDF asynchronously)
async function selectTopic(flowToken, screenData) {
  const topicId = screenData && screenData.topic;
  if (!topicId) {
    return { data: { error: { message: 'Please pick a topic.' } } };
  }
  const { data: row, error } = await supabase
    .from('pre_generated_lps')
    .select('id,grade,subject,chapter_number,chapter_title,pdf_r2_key_en,pdf_r2_key_ur')
    .eq('id', topicId)
    .single();
  if (error || !row || (!row.pdf_r2_key_en && !row.pdf_r2_key_ur)) {
    logToFile('Pakistan LP: row lookup failed', { topicId, error: error?.message });
    return { data: { error: { message: 'That lesson plan is not available right now.' } } };
  }

  logToFile('Pakistan LP: topic selected, initiating delivery', {
    flowToken, topicId, chapter: row.chapter_number, subject: row.subject, grade: row.grade,
  });

  await sendPreDeliveryAck(flowToken, row);
  deliverLpAsync(flowToken, row);

  return {
    screen: 'SUCCESS',
    data: {
      message: `Your lesson plan "${(row.chapter_title || `Chapter ${row.chapter_number}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '')}" (${gradeTitle(row.grade)} ${row.subject}) is on its way!`,
    },
  };
}

// Immediate chat ack while the R2 fetch + Meta send happens.
async function sendPreDeliveryAck(flowToken, row) {
  const userId = (flowToken || '').split(':')[0];
  try {
    const user = await getPhoneForUser(userId);
    if (!user?.phone_number) {
      logToFile('Pakistan LP: ack skipped — no phone for user', { userId });
      return;
    }
    const clean = (row.chapter_title || `Chapter ${row.chapter_number}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
    await WhatsAppService.sendMessage(
      user.phone_number,
      `📘 Sending your lesson plan: ${gradeTitle(row.grade)} ${row.subject} — ${clean}…`
    );
    logToFile('Pakistan LP: ack sent', { userId, phone: user.phone_number, topicId: row.id });
  } catch (err) {
    logToFile('Pakistan LP: pre-delivery ack failed', { error: err.message, stack: err.stack });
  }
}

// Fire-and-forget deliver — Palestine pattern (bd-2054):
// presigned R2 URL + sendDocumentByLink, no tmpfile, no buffer-as-path bug.
function deliverLpAsync(flowToken, row) {
  const userId = (flowToken || '').split(':')[0];
  (async () => {
    let phone;
    try {
      const user = await getPhoneForUser(userId);
      phone = user?.phone_number;
      if (!phone) {
        logToFile('Pakistan LP: no phone for user', { userId });
        return;
      }
      const language = user?.preferred_language === 'ur' ? 'ur' : 'en';
      const r2Key = (language === 'ur' && row.pdf_r2_key_ur)
        ? row.pdf_r2_key_ur
        : (row.pdf_r2_key_en || row.pdf_r2_key_ur);
      const cleanTitle = (row.chapter_title || `Chapter ${row.chapter_number}`).replace(/\s*\(chapter reading — full LP pending\)\s*$/, '');
      const filename = `${cleanTitle} — ${row.subject}.pdf`.replace(/["<>?*|\\/]/g, '');

      logToFile('Pakistan LP: building presigned URL', { userId, phone, r2Key });
      const presigned = await getPresignedUrl(buildR2PublicUrl(r2Key));
      logToFile('Pakistan LP: sending PDF via sendDocumentByLink', { userId, phone, filename, r2Key });

      const sendResp = await WhatsAppService.sendDocumentByLink(phone, presigned, filename);
      if (!sendResp) {
        throw new Error('sendDocumentByLink returned falsy');
      }
      logToFile('Pakistan LP: PDF delivered', { userId, topicId: row.id, r2Key, phone });

      // Optional voicenote at convention path <same-stem>.ogg
      const voicenoteKey = r2Key.replace(/\.pdf$/i, '.ogg');
      try {
        if (typeof WhatsAppService.sendVoicenoteFromR2Key === 'function') {
          await WhatsAppService.sendVoicenoteFromR2Key(phone, voicenoteKey);
        }
      } catch (vnErr) {
        logToFile('Pakistan LP: voicenote skip (non-fatal)', { userId, voicenoteKey, error: vnErr.message });
      }
    } catch (err) {
      logToFile('Pakistan LP: delivery failed', { userId, topicId: row.id, error: err.message, stack: err.stack });
    }
  })();
}

async function handlePakistanLpBack(flowToken, screen) {
  return openGradePicker();
}

module.exports = {
  handlePakistanLpInit,
  handlePakistanLpDataExchange,
  handlePakistanLpBack,
  gradeTitle,
  gradeRank,
  CURRICULUM_TAG,
};
