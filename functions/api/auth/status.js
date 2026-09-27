import { accountCount, getAuthSession, json } from '../../_shared/auth.js';

export async function onRequestGet(context) {
  if (!context.env.DB) return json({ error: 'D1 binding DB is not configured.' }, 500);
  const admins = await accountCount(context.env.DB, 'admin');
  const auth = context.data?.auth || await getAuthSession(context.env, context.request);
  return json({
    initialized: admins > 0,
    setupConfigured: Boolean(context.env.LEMON_AUTH_SETUP_KEY),
    authenticated: Boolean(auth),
    role: auth?.role || '',
    mustChangePin: Boolean(auth?.mustChangePin)
  });
}
