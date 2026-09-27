import { ensureAuthTables, json, requireAdmin } from '../../../_shared/auth.js';
import {
  guildStateUpsert,
  hasDuplicateMemberName,
  normalizeGuildRole,
  normalizeMemberName,
  publicMember,
  readGuildState,
  removeMemberData
} from '../../../_shared/guild-members.js';

export async function onRequestPatch(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  const memberId = String(context.params.id || '');
  let body;
  try { body = await context.request.json(); } catch (_) { return json({ error: '길드원 정보를 확인해주세요.' }, 400); }
  const memberName = normalizeMemberName(body?.memberName);
  const memberRole = normalizeGuildRole(body?.memberRole);
  if (!memberName) return json({ error: '길드원 닉네임을 입력해주세요.' }, 400);

  const state = await readGuildState(context.env.DB);
  const members = Array.isArray(state.members) ? state.members.map(publicMember).filter(member => member.id) : [];
  const existing = members.find(member => member.id === memberId);
  if (!existing) return json({ error: '길드원을 찾을 수 없습니다.' }, 404);
  if (hasDuplicateMemberName(members, memberName, memberId)) return json({ error: '이미 사용 중인 길드원 닉네임입니다.' }, 409);
  const updatedMember = { ...existing, name: memberName, role: memberRole };
  const nextState = {
    ...state,
    members: members.map(member => member.id === memberId ? updatedMember : member)
  };
  await guildStateUpsert(context.env.DB, nextState, Date.now()).run();
  return json({ ok: true, member: updatedMember });
}

export async function onRequestDelete(context) {
  if (!requireAdmin(context)) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  await ensureAuthTables(context.env.DB);
  const memberId = String(context.params.id || '');
  const state = await readGuildState(context.env.DB);
  const members = Array.isArray(state.members) ? state.members.map(publicMember).filter(member => member.id) : [];
  const member = members.find(item => item.id === memberId);
  if (!member) return json({ error: '길드원을 찾을 수 없습니다.' }, 404);

  const account = await context.env.DB.prepare('SELECT * FROM auth_accounts WHERE member_id = ?1 LIMIT 1')
    .bind(memberId).first();
  if (account?.account_id === context.data?.auth?.accountId) {
    return json({ error: '현재 로그인 중인 본인 계정과 길드원 정보는 삭제할 수 없습니다.' }, 400);
  }
  if (account?.role === 'admin' && account?.status === 'active') {
    const otherAdmins = await context.env.DB.prepare(`
      SELECT COUNT(*) AS count FROM auth_accounts
      WHERE role = 'admin' AND status = 'active' AND account_id <> ?1
    `).bind(account.account_id).first();
    if (Number(otherAdmins?.count || 0) < 1) {
      return json({ error: '마지막 활성 관리자 계정은 삭제할 수 없습니다.' }, 400);
    }
  }

  const now = Date.now();
  const nextState = removeMemberData(state, memberId);
  const statements = [guildStateUpsert(context.env.DB, nextState, now)];
  if (account) {
    statements.push(
      context.env.DB.prepare('DELETE FROM auth_sessions WHERE account_id = ?1').bind(account.account_id),
      context.env.DB.prepare('DELETE FROM auth_login_events WHERE account_id = ?1').bind(account.account_id),
      context.env.DB.prepare('DELETE FROM auth_trusted_devices WHERE account_id = ?1').bind(account.account_id),
      context.env.DB.prepare('DELETE FROM auth_trusted_locations WHERE account_id = ?1').bind(account.account_id),
      context.env.DB.prepare('DELETE FROM auth_accounts WHERE account_id = ?1').bind(account.account_id)
    );
  }
  await context.env.DB.batch(statements);
  return json({ ok: true, deleted: true, memberId, memberName: member.name });
}
