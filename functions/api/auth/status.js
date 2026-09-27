import { ensureAuthTables, getAuthSession, json } from '../../_shared/auth.js';

export async function onRequestGet(context) {
  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured.' }, 500);
  await ensureAuthTables(context.env.DB);
  const admin = await context.env.DB.prepare(`
    SELECT account_id, last_login_at FROM auth_accounts WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1
  `).first();
  const sessions = admin
    ? await context.env.DB.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE account_id = ?1').bind(admin.account_id).first()
    : null;
  const initialized = Boolean(admin) && (Number(admin.last_login_at || 0) > 0 || Number(sessions?.count || 0) > 0);
  const auth = context.data?.auth || await getAuthSession(context.env, context.request);
  return json({
    initialized,
    setupConfigured: Boolean(context.env.LEMON_AUTH_SETUP_KEY),
    authenticated: Boolean(auth),
    role: auth?.role || '',
    mustChangePin: Boolean(auth?.mustChangePin)
  });
}
