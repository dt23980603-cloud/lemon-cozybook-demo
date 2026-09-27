import {
  getAuthSession,
  hashPin,
  json,
  normalizePin,
  verifyPin
} from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const auth = context.data?.auth || await getAuthSession(context.env, context.request);
  if (!auth) return json({ error: '로그인이 필요합니다.' }, 401);
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ error: 'PIN 정보를 확인해주세요.' }, 400); }
  const newPin = normalizePin(body?.newPin);
  if (!newPin || newPin !== String(body?.newPinConfirm || '')) return json({ error: '새 PIN은 동일한 숫자 6~12자리로 입력해주세요.' }, 400);
  const account = await context.env.DB.prepare('SELECT pin_salt, pin_hash, must_change_pin FROM auth_accounts WHERE account_id = ?1')
    .bind(auth.accountId).first();
  if (!account) return json({ error: '계정을 찾을 수 없습니다.' }, 404);
  if (Number(account.must_change_pin || 0) !== 1) {
    const currentPin = normalizePin(body?.currentPin);
    if (!currentPin || !(await verifyPin(currentPin, account.pin_salt, account.pin_hash))) {
      return json({ error: '현재 PIN이 올바르지 않습니다.' }, 403);
    }
  }
  const result = await hashPin(newPin);
  const now = Date.now();
  await context.env.DB.prepare(`
    UPDATE auth_accounts SET pin_salt = ?2, pin_hash = ?3, must_change_pin = 0,
      failed_attempts = 0, locked_until = 0, updated_at = ?4 WHERE account_id = ?1
  `).bind(auth.accountId, result.salt, result.hash, now).run();
  return json({ ok: true });
}
