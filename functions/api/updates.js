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
  return new Response(JSON.stringify({ updates }), { headers: JSON_HEADERS });
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
