import {
  cleanText,
  json,
  readGuildMembers,
  requireGuildManager
} from '../_shared/auth.js';

const BUILD_STATUSES = new Set(['', 'missed', 'achieved_under70', 'achieved_70plus']);
const COMPETITION_STATUSES = new Set(['missed', 'achieved', 'missed_officer']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
let tablePromise = null;

function parseDate(value) {
  if (!DATE_PATTERN.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = typeof value === 'string' ? parseDate(value) : new Date(value.getTime());
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function mondayForDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return isoDate(date);
}

function monthRange(month) {
  const first = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const last = isoDate(new Date(Date.UTC(year, monthNumber, 0)));
  const start = mondayForDate(first);
  const lastWeekStart = mondayForDate(last);
  return { start, last, lastWeekStart, end: addDays(lastWeekStart, 6) };
}

async function createTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_management_daily (
      state_id TEXT NOT NULL DEFAULT 'main',
      month_key TEXT NOT NULL,
      week_no INTEGER NOT NULL,
      record_date TEXT NOT NULL,
      member_id TEXT NOT NULL,
      build_status TEXT NOT NULL DEFAULT '',
      absent INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (state_id, record_date, member_id)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_management_weekly (
      state_id TEXT NOT NULL DEFAULT 'main',
      month_key TEXT NOT NULL,
      week_no INTEGER NOT NULL,
      member_id TEXT NOT NULL,
      competition_status TEXT NOT NULL DEFAULT 'missed',
      extra_missions INTEGER NOT NULL DEFAULT 0,
      total_score INTEGER NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (state_id, month_key, week_no, member_id)
    )
  `).run();
  const dailyColumns = new Set(((await db.prepare('PRAGMA table_info(guild_management_daily)').all())?.results || []).map(row => String(row.name || '')));
  if (!dailyColumns.has('absent')) {
    await db.prepare('ALTER TABLE guild_management_daily ADD COLUMN absent INTEGER NOT NULL DEFAULT 0').run();
  }
  const weeklyColumns = new Set(((await db.prepare('PRAGMA table_info(guild_management_weekly)').all())?.results || []).map(row => String(row.name || '')));
  if (!weeklyColumns.has('memo')) {
    await db.prepare("ALTER TABLE guild_management_weekly ADD COLUMN memo TEXT NOT NULL DEFAULT ''").run();
  }
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_management_week_ranges (
      state_id TEXT NOT NULL DEFAULT 'main',
      week_start TEXT NOT NULL,
      member_id TEXT NOT NULL,
      competition_status TEXT NOT NULL DEFAULT 'missed',
      extra_missions INTEGER NOT NULL DEFAULT 0,
      total_score INTEGER NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (state_id, week_start, member_id)
    )
  `).run();
  await db.prepare(`
    INSERT OR IGNORE INTO guild_management_week_ranges
      (state_id, week_start, member_id, competition_status, extra_missions, total_score, memo, updated_at, updated_by)
    SELECT state_id,
      date(
        month_key || '-01',
        '-' || ((CAST(strftime('%w', month_key || '-01') AS INTEGER) + 6) % 7) || ' days',
        '+' || ((week_no - 1) * 7) || ' days'
      ),
      member_id, competition_status, extra_missions, total_score, memo, updated_at, updated_by
    FROM guild_management_weekly
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_management_attendance (
      state_id TEXT NOT NULL DEFAULT 'main',
      month_key TEXT NOT NULL,
      member_id TEXT NOT NULL,
      absent_days INTEGER NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (state_id, month_key, member_id)
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_gm_daily_date ON guild_management_daily(state_id, record_date)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_gm_week_range ON guild_management_week_ranges(state_id, week_start)').run();
}

async function ensureTables(db) {
  if (!tablePromise) {
    tablePromise = createTables(db).catch(error => {
      tablePromise = null;
      throw error;
    });
  }
  await tablePromise;
}

function monthKey(value) {
  const month = String(value || '');
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) ? month : '';
}

function boundedInteger(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(number)));
}

function stateIdFrom(request) {
  return new URL(request.url).searchParams.get('mode') === 'demo' ? 'demo' : 'main';
}

async function validMember(db, memberId) {
  const members = await readGuildMembers(db);
  return members.some(member => member.id === memberId) ? members : null;
}

function managerDenied(context) {
  if (requireGuildManager(context)) return null;
  return json({ error: '관리자 또는 부관리자 권한이 필요합니다.', code: 'GUILD_MANAGER_REQUIRED' }, 403);
}

export async function onRequestGet(context) {
  const denied = managerDenied(context);
  if (denied) return denied;
  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured.' }, 500);
  const url = new URL(context.request.url);
  const month = monthKey(url.searchParams.get('month'));
  if (!month) return json({ error: '조회할 월을 확인해주세요.' }, 400);
  await ensureTables(context.env.DB);
  const stateId = stateIdFrom(context.request);
  const range = monthRange(month);
  const [members, daily, weekly, attendance] = await Promise.all([
    readGuildMembers(context.env.DB),
    context.env.DB.prepare(`
      SELECT record_date AS recordDate, member_id AS memberId,
             build_status AS buildStatus, absent, updated_at AS updatedAt
      FROM guild_management_daily
      WHERE state_id = ?1 AND record_date BETWEEN ?2 AND ?3
      ORDER BY record_date ASC, member_id ASC
    `).bind(stateId, range.start, range.end).all(),
    context.env.DB.prepare(`
      SELECT week_start AS weekStart, member_id AS memberId, competition_status AS competitionStatus,
             extra_missions AS extraMissions, total_score AS totalScore, memo, updated_at AS updatedAt
      FROM guild_management_week_ranges
      WHERE state_id = ?1 AND week_start BETWEEN ?2 AND ?3
      ORDER BY week_start ASC, member_id ASC
    `).bind(stateId, range.start, range.lastWeekStart).all(),
    context.env.DB.prepare(`
      SELECT member_id AS memberId, absent_days AS absentDays, memo, updated_at AS updatedAt
      FROM guild_management_attendance
      WHERE state_id = ?1 AND month_key = ?2
      ORDER BY member_id ASC
    `).bind(stateId, month).all()
  ]);
  return json({
    ok: true,
    month,
    rangeStart: range.start,
    rangeEnd: range.end,
    members,
    daily: daily.results || [],
    weekly: weekly.results || [],
    attendance: attendance.results || []
  });
}

export async function onRequestPatch(context) {
  const denied = managerDenied(context);
  if (denied) return denied;
  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured.' }, 500);
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ error: '저장할 내용을 확인해주세요.' }, 400); }
  const month = monthKey(body?.month);
  const memberId = cleanText(body?.memberId, 200);
  if (!month || !memberId) return json({ error: '월과 길드원 정보를 확인해주세요.' }, 400);
  const members = await validMember(context.env.DB, memberId);
  if (!members) return json({ error: '길드원 정보를 찾을 수 없습니다.' }, 404);
  await ensureTables(context.env.DB);
  const stateId = stateIdFrom(context.request);
  const now = Date.now();
  const updatedBy = context.data?.auth?.memberId || '';
  const scope = String(body?.scope || '');

  if (scope === 'daily') {
    const date = String(body?.date || '');
    const status = String(body?.buildStatus || '');
    const absent = body?.absent === true ? 1 : 0;
    if (!parseDate(date) || date.slice(0, 7) !== month || !BUILD_STATUSES.has(status)) {
      return json({ error: '일일 건설 기록을 확인해주세요.' }, 400);
    }
    const range = monthRange(month);
    const weekStart = mondayForDate(date);
    const week = Math.floor((parseDate(weekStart).getTime() - parseDate(range.start).getTime()) / 604800000) + 1;
    if (!status && absent === 0) {
      await context.env.DB.prepare(`
        DELETE FROM guild_management_daily WHERE state_id = ?1 AND record_date = ?2 AND member_id = ?3
      `).bind(stateId, date, memberId).run();
    } else {
      await context.env.DB.prepare(`
        INSERT INTO guild_management_daily
          (state_id, month_key, week_no, record_date, member_id, build_status, absent, updated_at, updated_by)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(state_id, record_date, member_id) DO UPDATE SET
          month_key = excluded.month_key,
          week_no = excluded.week_no,
          build_status = excluded.build_status,
          absent = excluded.absent,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(stateId, month, week, date, memberId, status, absent, now, updatedBy).run();
    }
    return json({ ok: true, scope, month, weekStart, date, memberId, buildStatus: status, absent: absent === 1, updatedAt: now });
  }

  if (scope === 'weekly') {
    const weekStart = String(body?.weekStart || '');
    const competitionStatus = String(body?.competitionStatus || 'missed');
    const range = monthRange(month);
    if (!parseDate(weekStart) || mondayForDate(weekStart) !== weekStart || weekStart < range.start || weekStart > range.lastWeekStart || !COMPETITION_STATUSES.has(competitionStatus)) {
      return json({ error: '길드 경쟁전 기록을 확인해주세요.' }, 400);
    }
    const extraMissions = boundedInteger(body?.extraMissions, 999);
    const totalScore = boundedInteger(body?.totalScore, 9999999);
    const memo = cleanText(body?.memo, 500);
    await context.env.DB.prepare(`
      INSERT INTO guild_management_week_ranges
        (state_id, week_start, member_id, competition_status, extra_missions, total_score, memo, updated_at, updated_by)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(state_id, week_start, member_id) DO UPDATE SET
        competition_status = excluded.competition_status,
        extra_missions = excluded.extra_missions,
        total_score = excluded.total_score,
        memo = excluded.memo,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).bind(stateId, weekStart, memberId, competitionStatus, extraMissions, totalScore, memo, now, updatedBy).run();
    return json({ ok: true, scope, month, weekStart, memberId, competitionStatus, extraMissions, totalScore, memo, updatedAt: now });
  }

  if (scope === 'attendance') {
    const absentDays = boundedInteger(body?.absentDays, 366);
    const memo = cleanText(body?.memo, 500);
    if (absentDays === 0 && !memo) {
      await context.env.DB.prepare(`
        DELETE FROM guild_management_attendance WHERE state_id = ?1 AND month_key = ?2 AND member_id = ?3
      `).bind(stateId, month, memberId).run();
    } else {
      await context.env.DB.prepare(`
        INSERT INTO guild_management_attendance
          (state_id, month_key, member_id, absent_days, memo, updated_at, updated_by)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(state_id, month_key, member_id) DO UPDATE SET
          absent_days = excluded.absent_days,
          memo = excluded.memo,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).bind(stateId, month, memberId, absentDays, memo, now, updatedBy).run();
    }
    return json({ ok: true, scope, month, memberId, absentDays, memo, updatedAt: now });
  }

  return json({ error: '지원하지 않는 길드원 관리 항목입니다.' }, 400);
}
