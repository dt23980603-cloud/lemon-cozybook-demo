import {
  ensureAuthTables,
  hashPin,
  json,
  publicAccount,
  randomPin,
  readGuildMembers,
  requireAdmin,
  uniqueLoginCode
} from '../../_shared/auth.js';

export async function onRequestGet(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  await ensureAuthTables(context.env.DB);
  const members = await readGuildMembers(context.env.DB);
  const result = await context.env.DB.prepare(`
    SELECT a.*, COUNT(s.session_id) AS session_count
    FROM auth_accounts AS a
    LEFT JOIN auth_sessions AS s ON s.account_id = a.account_id AND s.expires_at > ?1
    GROUP BY a.account_id
    ORDER BY CASE WHEN a.role = 'admin' THEN 0 ELSE 1 END, a.created_at ASC
  `).bind(Date.now()).all();
  const accounts = (result.results || []).map(row => ({
    ...publicAccount(row, members),
    sessionCount: Number(row.session_count || 0)
  }));
  const assigned = new Set(accounts.map(account => account.memberId));
  const availableMembers = members
    .filter(member => !assigned.has(member.id))
    .map(member => ({ id: member.id, name: member.name || '', role: member.role || '' }));
  return json({ accounts, availableMembers });
}

export async function onRequestPost(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ error: '계정 정보를 확인해주세요.' }, 400); }
  const memberId = String(body?.memberId || '');
  const members = await readGuildMembers(context.env.DB);
  const member = members.find(item => item.id === memberId);
  if (!member) return json({ error: '계정을 만들 길드원을 선택해주세요.' }, 400);
  const duplicate = await context.env.DB.prepare('SELECT account_id FROM auth_accounts WHERE member_id = ?1').bind(memberId).first();
  if (duplicate) return json({ error: '이미 로그인 계정이 있는 길드원입니다.' }, 409);
  const loginCode = await uniqueLoginCode(context.env.DB);
  const temporaryPin = randomPin();
  const pin = await hashPin(temporaryPin);
  const accountId = crypto.randomUUID();
  const role = body?.role === 'admin' ? 'admin' : 'member';
  const now = Date.now();
  await context.env.DB.prepare(`
    INSERT INTO auth_accounts
      (account_id, member_id, login_code, pin_salt, pin_hash, pin_iterations, role, status, must_change_pin,
       failed_attempts, locked_until, last_login_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', 1, 0, 0, 0, ?8, ?8)
  `).bind(accountId, memberId, loginCode, pin.salt, pin.hash, pin.iterations, role, now).run();
  const account = await context.env.DB.prepare('SELECT * FROM auth_accounts WHERE account_id = ?1').bind(accountId).first();
  return json({ ok: true, account: publicAccount(account, members), temporaryPin }, 201);
}
