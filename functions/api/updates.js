const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS update_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flower_key TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'add',
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      grade TEXT NOT NULL,
      guild_score INTEGER,
      created_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_update_logs_created_at ON update_logs (created_at DESC)`).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS featured_new_flowers (
      flower_key TEXT PRIMARY KEY,
      selected_at INTEGER NOT NULL
    )
  `).run();
}

function validFlowerKey(value) {
  return /^(?:base_[a-z0-9_-]+|flw_[a-z0-9_-]+)$/i.test(String(value || '')) && String(value).length <= 100;
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  await ensureTable(env.DB);
  const result = await env.DB.prepare(`
    SELECT id, flower_key, action, category, name, grade, guild_score, created_at
    FROM update_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 300
  `).all();
  const updates = (result.results || []).map(row => ({
    id: Number(row.id),
    flowerKey: row.flower_key,
    action: row.action,
    category: row.category,
    name: row.name,
    grade: row.grade,
    guildScore: row.guild_score == null ? null : Number(row.guild_score),
    createdAt: Number(row.created_at || 0)
  }));
  const featuredResult = await env.DB.prepare(`
    SELECT flower_key, selected_at
    FROM featured_new_flowers
    ORDER BY selected_at DESC, flower_key ASC
  `).all();
  const featuredFlowers = (featuredResult.results || []).map(row => ({
    flowerKey: row.flower_key,
    selectedAt: Number(row.selected_at || 0)
  }));
  return new Response(JSON.stringify({ updates, featuredFlowers }), { headers: JSON_HEADERS });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), { status: 400, headers: JSON_HEADERS });
  }

  const incoming = Array.isArray(body?.featuredFlowerKeys) ? body.featuredFlowerKeys : null;
  if (!incoming || incoming.length > 100) {
    return new Response(JSON.stringify({ error: '신규 꽃 선택 목록을 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }
  const flowerKeys = [...new Set(incoming.map(value => String(value || '').trim()).filter(Boolean))];
  if (flowerKeys.some(key => !validFlowerKey(key))) {
    return new Response(JSON.stringify({ error: '선택한 꽃 정보가 올바르지 않습니다.' }), { status: 400, headers: JSON_HEADERS });
  }

  await ensureTable(env.DB);
  if (flowerKeys.length) {
    const flowersTable = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'flowers'`).first();
    if (!flowersTable) {
      return new Response(JSON.stringify({ error: '전체 꽃 도감 데이터를 먼저 준비해주세요.' }), { status: 400, headers: JSON_HEADERS });
    }
    const placeholders = flowerKeys.map((_, index) => `?${index + 1}`).join(',');
    const existing = await env.DB.prepare(`SELECT flower_key FROM flowers WHERE flower_key IN (${placeholders})`).bind(...flowerKeys).all();
    const existingKeys = new Set((existing.results || []).map(row => row.flower_key));
    const missing = flowerKeys.filter(key => !existingKeys.has(key));
    if (missing.length) {
      return new Response(JSON.stringify({ error: '선택한 꽃 중 전체 꽃 도감에서 찾을 수 없는 항목이 있습니다.' }), { status: 404, headers: JSON_HEADERS });
    }
  }

  const now = Date.now();
  const statements = [env.DB.prepare(`DELETE FROM featured_new_flowers`)];
  flowerKeys.forEach((key, index) => {
    statements.push(env.DB.prepare(`
      INSERT INTO featured_new_flowers (flower_key, selected_at)
      VALUES (?1, ?2)
    `).bind(key, now - index));
  });
  await env.DB.batch(statements);

  return new Response(JSON.stringify({
    ok: true,
    featuredFlowers: flowerKeys.map((flowerKey, index) => ({ flowerKey, selectedAt: now - index }))
  }), { headers: JSON_HEADERS });
}


export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }

  await ensureTable(env.DB);
  const url = new URL(request.url);
  const clearAll = url.searchParams.get('all') === '1';

  if (clearAll) {
    const result = await env.DB.prepare('DELETE FROM update_logs').run();
    return new Response(JSON.stringify({ ok: true, cleared: true, changes: Number(result.meta?.changes || 0) }), { headers: JSON_HEADERS });
  }

  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'A valid update id is required.' }), { status: 400, headers: JSON_HEADERS });
  }

  const result = await env.DB.prepare('DELETE FROM update_logs WHERE id = ?1').bind(id).run();
  return new Response(JSON.stringify({ ok: true, deleted: id, changes: Number(result.meta?.changes || 0) }), { headers: JSON_HEADERS });
}
