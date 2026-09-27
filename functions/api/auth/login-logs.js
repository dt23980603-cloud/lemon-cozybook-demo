import {
  ensureAuthTables,
  json,
  publicLoginEvent,
  requireAdmin
} from '../../_shared/auth.js';

export async function onRequestGet(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  await ensureAuthTables(context.env.DB);
  const accountId = String(new URL(context.request.url).searchParams.get('accountId') || '');
  if (!accountId) return json({ error: '로그인 기록을 확인할 계정이 필요합니다.' }, 400);
  const account = await context.env.DB.prepare('SELECT account_id FROM auth_accounts WHERE account_id = ?1 LIMIT 1')
    .bind(accountId).first();
  if (!account) return json({ error: '계정을 찾을 수 없습니다.' }, 404);
  const result = await context.env.DB.prepare(`
    SELECT * FROM auth_login_events
    WHERE account_id = ?1
    ORDER BY occurred_at DESC
    LIMIT 40
  `).bind(accountId).all();
  return json({ events: (result.results || []).map(publicLoginEvent) });
}
