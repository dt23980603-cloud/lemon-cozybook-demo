import {
  accountCount,
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
  const { env, request } = context;
  if (!env.DB) return json({ error: 'D1 binding DB is not configured.' }, 500);
  await ensureAuthTables(env.DB);
  if (await accountCount(env.DB, 'admin') > 0) return json({ error: '최초 관리자 설정이 이미 완료되었습니다.' }, 409);
  if (!env.LEMON_AUTH_SETUP_KEY) return json({ error: 'Cloudflare에 LEMON_AUTH_SETUP_KEY를 먼저 등록해주세요.' }, 503);

  const body = await readBody(request);
  if (!body) return json({ error: '요청 내용을 확인해주세요.' }, 400);
  const setupKey = String(body.setupKey || '');
  if (!safeEqual(setupKey, String(env.LEMON_AUTH_SETUP_KEY))) return json({ error: '1회 설정키가 올바르지 않습니다.' }, 403);

  const members = await readGuildMembers(env.DB);
  if (body.action === 'members') {
    return json({ members: members.map(member => ({ id: member.id, name: member.name || '', role: member.role || '' })) });
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
  if (duplicate) return json({ error: '이미 사용 중인 길드원 또는 로그인 코드입니다.' }, 409);

  const now = Date.now();
  const accountId = crypto.randomUUID();
  const pinResult = await hashPin(pin);
  await env.DB.prepare(`
    INSERT INTO auth_accounts
      (account_id, member_id, login_code, pin_salt, pin_hash, role, status, must_change_pin,
       failed_attempts, locked_until, last_login_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 'admin', 'active', 0, 0, 0, ?6, ?6, ?6)
  `).bind(accountId, memberId, loginCode, pinResult.salt, pinResult.hash, now).run();
  const session = await createSession(env, accountId, request);
  const account = await env.DB.prepare('SELECT * FROM auth_accounts WHERE account_id = ?1').bind(accountId).first();
  return json({ ok: true, account: publicAccount(account, members) }, 201, {
    'set-cookie': sessionCookie(session.token)
  });
}
