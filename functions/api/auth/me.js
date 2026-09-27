import { getAuthSession, json, readGuildMembers } from '../../_shared/auth.js';

export async function onRequestGet(context) {
  const auth = context.data?.auth || await getAuthSession(context.env, context.request);
  if (!auth) return json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, 401);
  const members = await readGuildMembers(context.env.DB);
  const member = members.find(item => item.id === auth.memberId) || null;
  return json({
    authenticated: true,
    accountId: auth.accountId,
    memberId: auth.memberId,
    memberName: member?.name || '알 수 없는 길드원',
    memberRole: member?.role || '',
    loginCode: auth.loginCode,
    role: auth.role,
    mustChangePin: auth.mustChangePin,
    expiresAt: auth.expiresAt
  });
}
