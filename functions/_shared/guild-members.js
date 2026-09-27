const GUILD_ROLES = new Set(['길드장', '부길드장', '임원', '정예', '멤버']);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeMemberName(value) {
  return String(value ?? '').trim().slice(0, 40);
}

export function normalizeGuildRole(value) {
  const role = String(value || '멤버');
  return GUILD_ROLES.has(role) ? role : '멤버';
}

export function hasDuplicateMemberName(members, name, exceptId = '') {
  const normalized = normalizeMemberName(name).toLocaleLowerCase('ko-KR');
  return members.some(member => String(member?.id || '') !== exceptId &&
    normalizeMemberName(member?.name).toLocaleLowerCase('ko-KR') === normalized);
}

export async function readGuildState(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_state (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  const row = await db.prepare("SELECT state_json FROM guild_state WHERE id = 'main'").first();
  if (!row?.state_json) return {};
  try {
    const state = JSON.parse(row.state_json);
    return isPlainObject(state) ? state : {};
  } catch (_) {
    return {};
  }
}

export function guildStateUpsert(db, state, updatedAt = Date.now()) {
  return db.prepare(`
    INSERT INTO guild_state (id, state_json, updated_at)
    VALUES ('main', ?1, ?2)
    ON CONFLICT(id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).bind(JSON.stringify(state), updatedAt);
}

function belongsToMember(key, memberId) {
  const value = String(key || '');
  return value.endsWith(`::${memberId}`) || value.endsWith(`_${memberId}`);
}

function withoutMemberKeys(source, memberId) {
  if (!isPlainObject(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => !belongsToMember(key, memberId)));
}

export function removeMemberData(state, memberId) {
  const next = { ...state };
  next.members = Array.isArray(state?.members)
    ? state.members.filter(member => String(member?.id || '') !== memberId)
    : [];
  next.checks = withoutMemberKeys(state?.checks, memberId);
  next.flowerOptions = withoutMemberKeys(state?.flowerOptions, memberId);
  next.memberBirthdays = isPlainObject(state?.memberBirthdays) ? { ...state.memberBirthdays } : {};
  delete next.memberBirthdays[memberId];
  return next;
}

export function publicMember(member) {
  return {
    id: String(member?.id || ''),
    name: normalizeMemberName(member?.name),
    role: normalizeGuildRole(member?.role)
  };
}
