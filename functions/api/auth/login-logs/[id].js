import { ensureAuthTables, json, requireAdmin } from '../../../_shared/auth.js';

export async function onRequestPatch(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  await ensureAuthTables(context.env.DB);
  const eventId = String(context.params.id || '');
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ error: '처리 내용을 확인해주세요.' }, 400); }
  const action = String(body?.action || '');
  const event = await context.env.DB.prepare('SELECT * FROM auth_login_events WHERE event_id = ?1 LIMIT 1')
    .bind(eventId).first();
  if (!event) return json({ error: '로그인 기록을 찾을 수 없습니다.' }, 404);
  if (Number(event.suspicious || 0) !== 1 || event.review_status !== 'pending') {
    return json({ error: '이미 처리되었거나 의심 로그인이 아닌 기록입니다.' }, 409);
  }
  const now = Date.now();
  if (action === 'trust') {
    const statements = [context.env.DB.prepare(`
      INSERT INTO auth_trusted_devices (account_id, device_hash, device_label, user_agent, first_seen_at, last_seen_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(account_id, device_hash) DO UPDATE SET
        device_label = excluded.device_label, user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at
    `).bind(event.account_id, event.device_hash, event.device_label, event.user_agent, now)];
    if (event.location_key) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO auth_trusted_locations (account_id, location_key, city, region, country, first_seen_at, last_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ON CONFLICT(account_id, location_key) DO UPDATE SET
          city = excluded.city, region = excluded.region, country = excluded.country, last_seen_at = excluded.last_seen_at
      `).bind(event.account_id, event.location_key, event.city, event.region, event.country, now));
    }
    statements.push(context.env.DB.prepare(`
      UPDATE auth_login_events SET review_status = 'trusted', reviewed_at = ?3
      WHERE account_id = ?1 AND device_hash = ?2 AND location_key = ?4
        AND suspicious = 1 AND review_status = 'pending'
    `).bind(event.account_id, event.device_hash, now, event.location_key));
    await context.env.DB.batch(statements);
    return json({ ok: true, reviewStatus: 'trusted' });
  }
  if (action === 'revoke') {
    const statements = [
      context.env.DB.prepare(`UPDATE auth_login_events SET review_status = 'blocked', reviewed_at = ?2 WHERE event_id = ?1`)
        .bind(eventId, now)
    ];
    if (event.session_id) {
      statements.push(context.env.DB.prepare('DELETE FROM auth_sessions WHERE session_id = ?1').bind(event.session_id));
    }
    await context.env.DB.batch(statements);
    return json({ ok: true, reviewStatus: 'blocked' });
  }
  return json({ error: '지원하지 않는 로그인 기록 작업입니다.' }, 400);
}
