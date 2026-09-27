import {
  createSession,
  ensureAuthTables,
  hashPin,
  json,
  normalizeLoginCode,
  normalizePin,
  publicAccount,
  readGuildMembers,
  safeEqual,
  sessionCookie
} from '../../_shared/auth.js';

async function readBody(request) {
  try { return await request.json(); } catch (_) { return null; }
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    if (!env.DB) return json({ error: 'D1 binding DB가 연결되지 않았습니다.' }, 500);
    await ensureAuthTables(env.DB);
    if (!env.LEMON_AUTH_SETUP_KEY) return json({ error: 'Cloudflare에 LEMON_AUTH_SETUP_KEY를 먼저 등록해주세요.' }, 503);

    const body = await readBody(request);
    if (!body) return json({ error: '요청 내용을 확인해주세요.' }, 400);
    const setupKey = String(body.setupKey || '');
    if (!safeEqual(setupKey, String(env.LEMON_AUTH_SETUP_KEY))) return json({ error: '1회 설정키가 올바르지 않습니다.' }, 403);

    const existingAdmin = await env.DB.prepare(`
      SELECT * FROM auth_accounts WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1
    `).first();
    let recoverableAdmin = null;
    if (existingAdmin) {
      const sessionRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?1')
        .bind(existingAdmin.account_id).first();
      const hasUsedAccount = Number(existingAdmin.last_login_at || 0) > 0 || Number(sessionRow?.count || 0) > 0;
      if (hasUsedAccount) return json({ error: '최초 관리자 설정이 이미 완료되었습니다.' }, 409);
      recoverableAdmin = existingAdmin;
    }

    const members = await readGuildMembers(env.DB);
    if (body.action === 'members') {
      return json({
        members: members.map(member => ({ id: member.id, name: member.name || '', role: member.role || '' })),
        recovery: Boolean(recoverableAdmin)
      });
    }

    const memberId = String(body.memberId || '');
    const member = members.find(item => item.id === memberId);
    const loginCode = normalizeLoginCode(body.loginCode);
    const pin = normalizePin(body.pin);
    if (!member) return json({ error: '관리자로 연결할 길드원을 선택해주세요.' }, 400);
    if (!loginCode) return json({ error: '로그인 코드는 영문·숫자·하이픈 4~32자로 입력해주세요.' }, 400);
    if (!pin) return json({ error: 'PIN은 숫자 6~12자리로 입력해주세요.' }, 400);
    if (pin !== String(body.pinConfirm || '')) return json({ error: 'PIN 확인 값이 일치하지 않습니다.' }, 400);

    const duplicate = await env.DB.prepare('SELECT account_id FROM auth_accounts WHERE login_code = ?1 OR member_id = ?2')
      .bind(loginCode, memberId).first();
    if (duplicate && duplicate.account_id !== recoverableAdmin?.account_id) {
      return json({ error: '이미 사용 중인 길드원 또는 로그인 코드입니다.' }, 409);
    }

    const now = Date.now();
    const accountId = recoverableAdmin?.account_id || crypto.randomUUID();
    const pinResult = await hashPin(pin);
    let insertedNewAccount = false;
    if (recoverableAdmin) {
      await env.DB.prepare(`
        UPDATE auth_accounts
        SET member_id = ?2, login_code = ?3, pin_salt = ?4, pin_hash = ?5, pin_iterations = ?6,
            role = 'admin', status = 'active', must_change_pin = 0, failed_attempts = 0,
            locked_until = 0, last_login_at = 0, updated_at = ?7
        WHERE account_id = ?1
      `).bind(accountId, memberId, loginCode, pinResult.salt, pinResult.hash, pinResult.iterations, now).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO auth_accounts
          (account_id, member_id, login_code, pin_salt, pin_hash, pin_iterations, role, status, must_change_pin,
           failed_attempts, locked_until, last_login_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'admin', 'active', 0, 0, 0, 0, ?7, ?7)
      `).bind(accountId, memberId, loginCode, pinResult.salt, pinResult.hash, pinResult.iterations, now).run();
      insertedNewAccount = true;
    }

    let session;
    try {
      session = await createSession(env, accountId, request);
    } catch (error) {
      if (insertedNewAccount) {
        await env.DB.prepare('DELETE FROM auth_accounts WHERE account_id = ?1').bind(accountId).run();
      }
      throw error;
    }
    const account = await env.DB.prepare('SELECT * FROM auth_accounts WHERE account_id = ?1').bind(accountId).first();
    return json({ ok: true, account: publicAccount(account, members) }, 201, {
      'set-cookie': sessionCookie(session.token)
    });
  } catch (error) {
    console.error('auth bootstrap failed', error);
    return json({ error: '관리자 계정을 만드는 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }
}
