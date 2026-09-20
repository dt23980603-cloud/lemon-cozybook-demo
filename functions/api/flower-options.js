const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const OPTION_TYPES = new Set(['category', 'acquire', 'guildScore']);

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeOption(type, value) {
  if (!OPTION_TYPES.has(type)) return { ok: false, value: '' };
  if (type === 'guildScore') {
    const text = cleanText(value, 10);
    const parsed = Number(text);
    if (text === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 9999) return { ok: false, value: '' };
    return { ok: true, value: String(Math.round(parsed)) };
  }
  const maxLength = type === 'category' ? 80 : 200;
  const text = cleanText(value, maxLength);
  return { ok: Boolean(text), value: text };
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS flower_field_options (
      option_type TEXT NOT NULL,
      option_value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (option_type, option_value)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS flower_field_option_deletions (
      option_type TEXT NOT NULL,
      option_value TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      PRIMARY KEY (option_type, option_value)
    )
  `).run();

  const flowersTable = await db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'flowers'
  `).first();
  if (!flowersTable) return;

  await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO flower_field_options (option_type, option_value, created_at)
      SELECT 'category', TRIM(category), MIN(created_at)
      FROM flowers AS f
      WHERE TRIM(f.category) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM flower_field_option_deletions AS d
          WHERE d.option_type = 'category' AND d.option_value = TRIM(f.category)
        )
      GROUP BY TRIM(f.category)
    `),
    db.prepare(`
      INSERT OR IGNORE INTO flower_field_options (option_type, option_value, created_at)
      SELECT 'acquire', TRIM(acquire), MIN(created_at)
      FROM flowers AS f
      WHERE TRIM(f.acquire) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM flower_field_option_deletions AS d
          WHERE d.option_type = 'acquire' AND d.option_value = TRIM(f.acquire)
        )
      GROUP BY TRIM(f.acquire)
    `),
    db.prepare(`
      INSERT OR IGNORE INTO flower_field_options (option_type, option_value, created_at)
      SELECT 'guildScore', CAST(guild_score AS TEXT), MIN(created_at)
      FROM flowers AS f
      WHERE f.guild_score IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM flower_field_option_deletions AS d
          WHERE d.option_type = 'guildScore' AND d.option_value = CAST(f.guild_score AS TEXT)
        )
      GROUP BY f.guild_score
    `)
  ]);
}

function emptyOptions() {
  return { category: [], acquire: [], guildScore: [] };
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }

  await ensureTable(env.DB);
  const result = await env.DB.prepare(`
    SELECT option_type, option_value
    FROM flower_field_options
    ORDER BY option_type ASC, option_value ASC
  `).all();

  const options = emptyOptions();
  for (const row of result.results || []) {
    if (OPTION_TYPES.has(row.option_type)) options[row.option_type].push(String(row.option_value || ''));
  }
  options.category.sort((a, b) => a.localeCompare(b, 'ko-KR'));
  options.acquire.sort((a, b) => a.localeCompare(b, 'ko-KR'));
  options.guildScore.sort((a, b) => Number(a) - Number(b));

  return new Response(JSON.stringify({ options }), { headers: JSON_HEADERS });
}

export async function onRequestPost(context) {
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

  const type = cleanText(body?.type, 20);
  const normalized = normalizeOption(type, body?.value);
  if (!normalized.ok) {
    return new Response(JSON.stringify({ error: '추가할 선택지를 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }

  await ensureTable(env.DB);
  await env.DB.prepare(`
    DELETE FROM flower_field_option_deletions
    WHERE option_type = ?1 AND option_value = ?2
  `).bind(type, normalized.value).run();
  const duplicate = await env.DB.prepare(`
    SELECT option_value FROM flower_field_options
    WHERE option_type = ?1 AND option_value = ?2
    LIMIT 1
  `).bind(type, normalized.value).first();
  if (duplicate) {
    return new Response(JSON.stringify({ error: '이미 등록된 선택 항목입니다.' }), { status: 409, headers: JSON_HEADERS });
  }
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO flower_field_options (option_type, option_value, created_at)
    VALUES (?1, ?2, ?3)
  `).bind(type, normalized.value, now).run();

  return new Response(JSON.stringify({ ok: true, type, value: normalized.value }), { status: 201, headers: JSON_HEADERS });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }

  const url = new URL(request.url);
  const type = cleanText(url.searchParams.get('type'), 20);
  const normalized = normalizeOption(type, url.searchParams.get('value'));
  if (!normalized.ok) {
    return new Response(JSON.stringify({ error: '삭제할 선택지를 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }

  await ensureTable(env.DB);
  const existing = await env.DB.prepare(`
    SELECT option_value FROM flower_field_options
    WHERE option_type = ?1 AND option_value = ?2
    LIMIT 1
  `).bind(type, normalized.value).first();
  if (!existing) {
    return new Response(JSON.stringify({ error: '삭제할 선택지를 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR REPLACE INTO flower_field_option_deletions (option_type, option_value, deleted_at)
      VALUES (?1, ?2, ?3)
    `).bind(type, normalized.value, now),
    env.DB.prepare(`
      DELETE FROM flower_field_options
      WHERE option_type = ?1 AND option_value = ?2
    `).bind(type, normalized.value)
  ]);

  return new Response(JSON.stringify({ ok: true, type, value: normalized.value }), { headers: JSON_HEADERS });
}
