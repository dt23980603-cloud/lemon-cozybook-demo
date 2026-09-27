import {
  createSession,
  ensureAuthTables,
  json,
  normalizeLoginCode,
  normalizePin,
  readGuildMembers,
  sessionCookie,
  verifyPin
} from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return json({ error: 'D1 binding DB is not configured.' }, 500);
  await ensureAuthTables(env.DB);
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: '로그인 정보를 확인해주세요.' }, 400); }
  const loginCode = normalizeLoginCode(body?.loginCode);
  const pin = normalizePin(body?.pin);
  if (!loginCode || !pin) return json({ error: '로그인 코드 또는 PIN을 확인해주세요.' }, 400);

  const account = await env.DB.prepare('SELECT * FROM auth_accounts WHERE login_code = ?1 LIMIT 1').bind(loginCode).first();
  const now = Date.now();
  if (!account || account.status !== 'active') return json({ error: '로그인 코드 또는 PIN을 확인해주세요.' }, 401);
  if (Number(account.locked_until || 0) > now) {
    return json({ error: '로그인 시도가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해주세요.', lockedUntil: Number(account.locked_until) }, 429);
  }

  const valid = await verifyPin(pin, account.pin_salt, account.pin_hash, account.pin_iterations);
  if (!valid) {
    const failed = Number(account.failed_attempts || 0) + 1;
    const lockedUntil = failed >= 5 ? now + 10 * 60 * 1000 : 0;
    await env.DB.prepare('UPDATE auth_accounts SET failed_attempts = ?2, locked_until = ?3, updated_at = ?4 WHERE account_id = ?1')
      .bind(account.account_id, failed >= 5 ? 0 : failed, lockedUntil, now).run();
    return json({ error: '로그인 코드 또는 PIN을 확인해주세요.', lockedUntil }, 401);
  }

  await env.DB.prepare(`
    UPDATE auth_accounts SET failed_attempts = 0, locked_until = 0, last_login_at = ?2, updated_at = ?2
    WHERE account_id = ?1
  `).bind(account.account_id, now).run();
  const session = await createSession(env, account.account_id, request);
  const members = await readGuildMembers(env.DB);
  const member = members.find(item => item.id === account.member_id) || null;
  return json({
    ok: true,
    role: account.role === 'admin' ? 'admin' : 'member',
    memberId: account.member_id,
    memberName: member?.name || '',
    mustChangePin: Number(account.must_change_pin || 0) === 1
  }, 200, { 'set-cookie': sessionCookie(session.token) });
}
