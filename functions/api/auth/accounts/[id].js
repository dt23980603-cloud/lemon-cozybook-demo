import {
  hashPin,
  json,
  publicAccount,
  randomPin,
  readGuildMembers,
  requireAdmin,
  uniqueLoginCode
} from '../../../_shared/auth.js';

async function hasAnotherActiveAdmin(db, accountId) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM auth_accounts
    WHERE role = 'admin' AND status = 'active' AND account_id <> ?1
  `).bind(accountId).first();
  return Number(row?.count || 0) > 0;
}

export async function onRequestPatch(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  const accountId = String(context.params.id || '');
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ error: '변경 내용을 확인해주세요.' }, 400); }
  const account = await context.env.DB.prepare('SELECT * FROM auth_accounts WHERE account_id = ?1').bind(accountId).first();
  if (!account) return json({ error: '계정을 찾을 수 없습니다.' }, 404);
  const action = String(body?.action || '');
  const now = Date.now();
  let temporaryPin = '';
  let loginCode = account.login_code;

  if (action === 'resetPin') {
    temporaryPin = randomPin();
    const pin = await hashPin(temporaryPin);
    await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE auth_accounts SET pin_salt = ?2, pin_hash = ?3, pin_iterations = ?4, must_change_pin = 1,
        failed_attempts = 0, locked_until = 0, updated_at = ?5 WHERE account_id = ?1`)
        .bind(accountId, pin.salt, pin.hash, pin.iterations, now),
      context.env.DB.prepare('DELETE FROM auth_sessions WHERE account_id = ?1').bind(accountId)
    ]);
  } else if (action === 'regenerateCode') {
    loginCode = await uniqueLoginCode(context.env.DB);
    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE auth_accounts SET login_code = ?2, updated_at = ?3 WHERE account_id = ?1')
        .bind(accountId, loginCode, now),
      context.env.DB.prepare('DELETE FROM auth_sessions WHERE account_id = ?1').bind(accountId)
    ]);
  } else if (action === 'setStatus') {
    const status = body?.status === 'active' ? 'active' : 'inactive';
    if (accountId === context.data.auth.accountId && status !== 'active') return json({ error: '현재 로그인한 관리자 계정은 비활성화할 수 없습니다.' }, 400);
    if (account.role === 'admin' && account.status === 'active' && status !== 'active' && !(await hasAnotherActiveAdmin(context.env.DB, accountId))) {
      return json({ error: '마지막 활성 관리자 계정은 비활성화할 수 없습니다.' }, 400);
    }
    const statements = [context.env.DB.prepare('UPDATE auth_accounts SET status = ?2, updated_at = ?3 WHERE account_id = ?1').bind(accountId, status, now)];
    if (status !== 'active') statements.push(context.env.DB.prepare('DELETE FROM auth_sessions WHERE account_id = ?1').bind(accountId));
    await context.env.DB.batch(statements);
  } else if (action === 'setRole') {
    const role = body?.role === 'admin' ? 'admin' : 'member';
    if (accountId === context.data.auth.accountId && role !== 'admin') return json({ error: '현재 로그인한 관리자 권한은 해제할 수 없습니다.' }, 400);
    if (account.role === 'admin' && account.status === 'active' && role !== 'admin' && !(await hasAnotherActiveAdmin(context.env.DB, accountId))) {
      return json({ error: '마지막 활성 관리자의 권한은 해제할 수 없습니다.' }, 400);
    }
    await context.env.DB.prepare('UPDATE auth_accounts SET role = ?2, updated_at = ?3 WHERE account_id = ?1')
      .bind(accountId, role, now).run();
  } else if (action === 'revokeSessions') {
    await context.env.DB.prepare('DELETE FROM auth_sessions WHERE account_id = ?1 AND session_id <> ?2')
      .bind(accountId, accountId === context.data.auth.accountId ? context.data.auth.sessionId : '').run();
  } else {
    return json({ error: '지원하지 않는 계정 관리 작업입니다.' }, 400);
  }

  const updated = await context.env.DB.prepare('SELECT * FROM auth_accounts WHERE account_id = ?1').bind(accountId).first();
  const members = await readGuildMembers(context.env.DB);
  const count = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?1 AND expires_at > ?2')
    .bind(accountId, now).first();
  return json({
    ok: true,
    account: { ...publicAccount(updated, members), sessionCount: Number(count?.count || 0) },
    temporaryPin,
    loginCode
  });
}
