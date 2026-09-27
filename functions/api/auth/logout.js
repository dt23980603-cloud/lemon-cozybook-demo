import { clearSessionCookie, getAuthSession, json, revokeSession } from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const auth = context.data?.auth || await getAuthSession(context.env, context.request);
  if (auth) await revokeSession(context.env, auth);
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}
