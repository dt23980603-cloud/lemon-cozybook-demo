export const AUTH_COOKIE = 'lemon_demo_session';
export const AUTH_DEVICE_COOKIE = 'lemon_demo_device';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SESSION_TOUCH_INTERVAL = 60 * 60 * 24 * 7;
const LOGIN_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// Cloudflare Workers Free는 요청당 CPU 시간이 짧으므로 Web Crypto 연산을
// 그 범위 안에서 끝낼 수 있게 조정한다. 계정별 반복 횟수를 DB에 함께
// 저장해 이후 값을 바꾸더라도 기존 계정을 검증할 수 있게 한다.
const PIN_ITERATIONS = 10000;
const LEGACY_PIN_ITERATIONS = 120000;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

let schemaPromise = null;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

export function cleanText(value, maxLength = 120) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function normalizeLoginCode(value) {
  const code = cleanText(value, 32).toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9][A-Z0-9-]{3,31}$/.test(code) ? code : '';
}

export function normalizePin(value) {
  const pin = cleanText(value, 12);
  return /^\d{6,12}$/.test(pin) ? pin : '';
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function randomPin() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

export function randomLoginCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
  return `LM-${body.slice(0, 4)}-${body.slice(4)}`;
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPin(pin, salt = randomHex(16), iterations = PIN_ITERATIONS) {
  const safeIterations = Math.max(1000, Math.min(200000, Number(iterations) || PIN_ITERATIONS));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: hexToBytes(salt),
    iterations: safeIterations
  }, key, 256);
  return { salt, hash: bytesToHex(new Uint8Array(bits)), iterations: safeIterations };
}

export function safeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export async function verifyPin(pin, salt, expectedHash, iterations = PIN_ITERATIONS) {
  const result = await hashPin(pin, salt, iterations);
  return safeEqual(result.hash, expectedHash);
}

async function createSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      account_id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL UNIQUE,
      login_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pin_salt TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_iterations INTEGER NOT NULL DEFAULT 10000,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      must_change_pin INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  const tableInfo = await db.prepare('PRAGMA table_info(auth_accounts)').all();
  const columns = new Set((tableInfo?.results || []).map(row => String(row.name || '')));
  if (!columns.has('pin_iterations')) {
    await db.prepare(`ALTER TABLE auth_accounts ADD COLUMN pin_iterations INTEGER NOT NULL DEFAULT ${LEGACY_PIN_ITERATIONS}`).run();
  }
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT ''
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)').run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_trusted_devices (
      account_id TEXT NOT NULL,
      device_hash TEXT NOT NULL,
      device_label TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, device_hash)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_trusted_locations (
      account_id TEXT NOT NULL,
      location_key TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, location_key)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auth_login_events (
      event_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      occurred_at INTEGER NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      location_key TEXT NOT NULL DEFAULT '',
      device_hash TEXT NOT NULL DEFAULT '',
      device_label TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      ip_masked TEXT NOT NULL DEFAULT '',
      new_device INTEGER NOT NULL DEFAULT 0,
      new_location INTEGER NOT NULL DEFAULT 0,
      baseline_created INTEGER NOT NULL DEFAULT 0,
      suspicious INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'normal',
      reviewed_at INTEGER NOT NULL DEFAULT 0
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_login_events_account ON auth_login_events(account_id, occurred_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_login_events_pending ON auth_login_events(account_id, suspicious, review_status)').run();
}

export async function ensureAuthTables(db) {
  if (!schemaPromise) {
    schemaPromise = createSchema(db).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export function parseCookies(request) {
  const cookies = {};
  const raw = request.headers.get('cookie') || '';
  raw.split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index < 0) return;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
  });
  return cookies;
}

export function sessionCookie(token, maxAge = SESSION_MAX_AGE_SECONDS) {
  const expires = new Date(Date.now() + Math.max(0, maxAge) * 1000).toUTCString();
  return `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${Math.max(0, maxAge)}; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

export function deviceCookie(token) {
  const expires = new Date(Date.now() + DEVICE_MAX_AGE_SECONDS * 1000).toUTCString();
  return `${AUTH_DEVICE_COOKIE}=${token}; Path=/; Max-Age=${DEVICE_MAX_AGE_SECONDS}; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

function locationPart(value, maxLength = 80) {
  return cleanText(value, maxLength).replace(/[|\n\r]/g, ' ');
}

function requestLocation(request) {
  const cf = request.cf || {};
  const city = locationPart(cf.city);
  const region = locationPart(cf.region || cf.regionCode);
  const country = locationPart(cf.country || request.headers.get('cf-ipcountry'), 8).toUpperCase();
  const locationKey = [country, region, city].filter(Boolean).join('|').toLocaleLowerCase('en-US');
  return { city, region, country, locationKey };
}

function maskIp(value) {
  const ip = cleanText(value, 90);
  if (!ip) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
  }
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}:…`;
  }
  return '확인 불가';
}

function deviceLabelFromUserAgent(userAgent) {
  const ua = String(userAgent || '');
  let os = '알 수 없는 기기';
  if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = '';
  if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS|Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  return browser ? `${os} · ${browser}` : os;
}

export async function recordSuccessfulLogin(env, accountId, sessionId, request) {
  await ensureAuthTables(env.DB);
  const now = Date.now();
  const cookieToken = cleanText(parseCookies(request)[AUTH_DEVICE_COOKIE], 128);
  const deviceToken = /^[a-f0-9]{32,128}$/i.test(cookieToken) ? cookieToken : randomHex(24);
  const deviceHash = await sha256(deviceToken);
  const userAgent = cleanText(request.headers.get('user-agent'), 300);
  const deviceLabel = deviceLabelFromUserAgent(userAgent);
  const { city, region, country, locationKey } = requestLocation(request);
  const ipMasked = maskIp(request.headers.get('cf-connecting-ip'));

  const deviceCountRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM auth_trusted_devices WHERE account_id = ?1').bind(accountId).first();
  const locationCountRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM auth_trusted_locations WHERE account_id = ?1').bind(accountId).first();
  const trustedDevice = await env.DB.prepare('SELECT device_hash FROM auth_trusted_devices WHERE account_id = ?1 AND device_hash = ?2 LIMIT 1').bind(accountId, deviceHash).first();
  const trustedLocation = locationKey
    ? await env.DB.prepare('SELECT location_key FROM auth_trusted_locations WHERE account_id = ?1 AND location_key = ?2 LIMIT 1').bind(accountId, locationKey).first()
    : null;
  const hasDeviceBaseline = Number(deviceCountRow?.count || 0) > 0;
  const hasLocationBaseline = Number(locationCountRow?.count || 0) > 0;
  const unknownDevice = !trustedDevice;
  const unknownLocation = Boolean(locationKey) && !trustedLocation;
  const newDevice = hasDeviceBaseline && unknownDevice;
  const newLocation = hasLocationBaseline && unknownLocation;
  const baselineCreated = !hasDeviceBaseline && !hasLocationBaseline;
  const suspicious = newDevice && newLocation;
  const eventId = crypto.randomUUID();
  const statements = [];

  if (!suspicious) {
    statements.push(env.DB.prepare(`
      INSERT INTO auth_trusted_devices (account_id, device_hash, device_label, user_agent, first_seen_at, last_seen_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(account_id, device_hash) DO UPDATE SET
        device_label = excluded.device_label, user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at
    `).bind(accountId, deviceHash, deviceLabel, userAgent, now));
    if (locationKey) {
      statements.push(env.DB.prepare(`
        INSERT INTO auth_trusted_locations (account_id, location_key, city, region, country, first_seen_at, last_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ON CONFLICT(account_id, location_key) DO UPDATE SET
          city = excluded.city, region = excluded.region, country = excluded.country, last_seen_at = excluded.last_seen_at
      `).bind(accountId, locationKey, city, region, country, now));
    }
  }
  statements.push(env.DB.prepare(`
    INSERT INTO auth_login_events
      (event_id, account_id, session_id, occurred_at, city, region, country, location_key,
       device_hash, device_label, user_agent, ip_masked, new_device, new_location,
       baseline_created, suspicious, review_status, reviewed_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 0)
  `).bind(eventId, accountId, sessionId || '', now, city, region, country, locationKey,
    deviceHash, deviceLabel, userAgent, ipMasked, unknownDevice ? 1 : 0, unknownLocation ? 1 : 0,
    baselineCreated ? 1 : 0, suspicious ? 1 : 0, suspicious ? 'pending' : 'normal'));
  statements.push(env.DB.prepare('DELETE FROM auth_login_events WHERE occurred_at < ?1').bind(now - LOGIN_LOG_RETENTION_MS));
  await env.DB.batch(statements);
  return { deviceToken, eventId, suspicious };
}

export function publicLoginEvent(row) {
  return {
    eventId: String(row.event_id || ''),
    accountId: String(row.account_id || ''),
    occurredAt: Number(row.occurred_at || 0),
    city: String(row.city || ''),
    region: String(row.region || ''),
    country: String(row.country || ''),
    deviceLabel: String(row.device_label || '알 수 없는 기기'),
    ipMasked: String(row.ip_masked || ''),
    newDevice: Number(row.new_device || 0) === 1,
    newLocation: Number(row.new_location || 0) === 1,
    baselineCreated: Number(row.baseline_created || 0) === 1,
    suspicious: Number(row.suspicious || 0) === 1,
    reviewStatus: String(row.review_status || 'normal'),
    reviewedAt: Number(row.reviewed_at || 0)
  };
}

export async function readGuildMembers(db) {
  try {
    const row = await db.prepare("SELECT state_json FROM guild_state WHERE id = 'main'").first();
    if (!row?.state_json) return [];
    const parsed = JSON.parse(row.state_json);
    return Array.isArray(parsed?.members)
      ? parsed.members.filter(item => item && typeof item.id === 'string' && item.id)
      : [];
  } catch (_) {
    return [];
  }
}

export function publicAccount(account, members = []) {
  const member = members.find(item => item.id === account.member_id) || null;
  return {
    accountId: account.account_id,
    memberId: account.member_id,
    memberName: member?.name || '알 수 없는 길드원',
    memberRole: member?.role || '',
    loginCode: account.login_code,
    role: account.role === 'admin' ? 'admin' : 'member',
    status: account.status === 'active' ? 'active' : 'inactive',
    mustChangePin: Number(account.must_change_pin || 0) === 1,
    lockedUntil: Number(account.locked_until || 0),
    lastLoginAt: Number(account.last_login_at || 0),
    createdAt: Number(account.created_at || 0),
    updatedAt: Number(account.updated_at || 0)
  };
}

export async function getAuthSession(env, request) {
  if (!env.DB) return null;
  await ensureAuthTables(env.DB);
  const token = parseCookies(request)[AUTH_COOKIE] || '';
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare(`
    SELECT s.session_id, s.account_id, s.expires_at, s.last_seen_at,
           a.member_id, a.login_code, a.role, a.status, a.must_change_pin
    FROM auth_sessions AS s
    JOIN auth_accounts AS a ON a.account_id = s.account_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND a.status = 'active'
    LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row) return null;
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    memberId: row.member_id,
    loginCode: row.login_code,
    role: row.role === 'admin' ? 'admin' : 'member',
    mustChangePin: Number(row.must_change_pin || 0) === 1,
    expiresAt: Number(row.expires_at || 0),
    lastSeenAt: Number(row.last_seen_at || 0),
    rawToken: token,
    shouldRefresh: now - Number(row.last_seen_at || 0) >= SESSION_TOUCH_INTERVAL * 1000
  };
}

export async function createSession(env, accountId, request) {
  await ensureAuthTables(env.DB);
  const now = Date.now();
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const userAgent = cleanText(request.headers.get('user-agent'), 300);
  await env.DB.prepare(`
    INSERT INTO auth_sessions
      (session_id, account_id, token_hash, created_at, expires_at, last_seen_at, user_agent)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(sessionId, accountId, tokenHash, now, expiresAt, now, userAgent).run();
  return { token, sessionId, expiresAt };
}

export async function refreshSession(env, auth) {
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  await env.DB.prepare(`
    UPDATE auth_sessions SET expires_at = ?2, last_seen_at = ?3 WHERE session_id = ?1
  `).bind(auth.sessionId, expiresAt, now).run();
  return expiresAt;
}

export async function revokeSession(env, auth) {
  if (!auth?.sessionId) return;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE session_id = ?1').bind(auth.sessionId).run();
}

export async function accountCount(db, role = '') {
  await ensureAuthTables(db);
  const row = role
    ? await db.prepare('SELECT COUNT(*) AS count FROM auth_accounts WHERE role = ?1').bind(role).first()
    : await db.prepare('SELECT COUNT(*) AS count FROM auth_accounts').first();
  return Number(row?.count || 0);
}

export async function uniqueLoginCode(db) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomLoginCode();
    const row = await db.prepare('SELECT account_id FROM auth_accounts WHERE login_code = ?1').bind(code).first();
    if (!row) return code;
  }
  throw new Error('로그인 코드를 생성하지 못했습니다. 다시 시도해주세요.');
}

export function requireAdmin(context) {
  return context.data?.auth?.role === 'admin';
}
