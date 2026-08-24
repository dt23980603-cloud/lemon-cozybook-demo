const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const GRADES = new Set(['N', 'R', 'SR', 'SSR', 'UR']);

async function ensureTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS flowers (
      flower_key TEXT PRIMARY KEY,
      grade TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      guild_score INTEGER,
      acquire TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      image_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_flowers_unique_label
    ON flowers (grade, category, name)
  `).run();
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
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_update_logs_created_at
    ON update_logs (created_at DESC)
  `).run();
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function rowToFlower(row) {
  return {
    key: row.flower_key,
    grade: row.grade,
    category: row.category,
    name: row.name,
    listName: row.category ? `[${row.category}] ${row.name}` : row.name,
    guildScore: row.guild_score == null ? null : Number(row.guild_score),
    acquire: row.acquire || '',
    note: row.note || '',
    image: `/api/flower-image/${encodeURIComponent(row.flower_key)}`,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    isRemote: true
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  await ensureTables(env.DB);
  const result = await env.DB.prepare(`
    SELECT flower_key, grade, category, name, guild_score, acquire, note, image_key, created_at, updated_at
    FROM flowers
    ORDER BY created_at ASC, flower_key ASC
  `).all();
  return new Response(JSON.stringify({ flowers: (result.results || []).map(rowToFlower) }), { headers: JSON_HEADERS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  if (!env.FLOWER_IMAGES) {
    return new Response(JSON.stringify({ error: 'R2 binding FLOWER_IMAGES is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid multipart form data.' }), { status: 400, headers: JSON_HEADERS });
  }

  const grade = cleanText(form.get('grade'), 3).toUpperCase();
  const category = cleanText(form.get('category'), 80);
  const name = cleanText(form.get('name'), 120);
  const acquire = cleanText(form.get('acquire'), 200);
  const note = cleanText(form.get('note'), 500);
  const scoreText = cleanText(form.get('guildScore'), 10);
  const image = form.get('image');

  if (!GRADES.has(grade) || !category || !name) {
    return new Response(JSON.stringify({ error: '등급, 분류, 꽃 이름을 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }

  let guildScore = null;
  if (scoreText !== '') {
    const parsed = Number(scoreText);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999) {
      return new Response(JSON.stringify({ error: '길드전 점수를 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
    }
    guildScore = Math.round(parsed);
  }

  if (!(image instanceof File) || image.size <= 0) {
    return new Response(JSON.stringify({ error: '꽃 이미지를 선택해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }
  if (image.size > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '이미지는 10MB 이하로 등록해주세요.' }), { status: 413, headers: JSON_HEADERS });
  }

  await ensureTables(env.DB);
  const duplicate = await env.DB.prepare(`
    SELECT flower_key FROM flowers WHERE grade = ?1 AND category = ?2 AND name = ?3 LIMIT 1
  `).bind(grade, category, name).first();
  if (duplicate) {
    return new Response(JSON.stringify({ error: '같은 등급에 동일한 [분류] 꽃 이름이 이미 등록되어 있습니다.' }), { status: 409, headers: JSON_HEADERS });
  }

  const flowerKey = `flw_${crypto.randomUUID()}`;
  const imageKey = `flowers/${flowerKey}.webp`;
  const now = Date.now();
  const bytes = await image.arrayBuffer();

  try {
    await env.FLOWER_IMAGES.put(imageKey, bytes, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }
    });

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO flowers (flower_key, grade, category, name, guild_score, acquire, note, image_key, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      `).bind(flowerKey, grade, category, name, guildScore, acquire, note, imageKey, now, now),
      env.DB.prepare(`
        INSERT INTO update_logs (flower_key, action, category, name, grade, guild_score, created_at)
        VALUES (?1, 'add', ?2, ?3, ?4, ?5, ?6)
      `).bind(flowerKey, category, name, grade, guildScore, now)
    ]);
  } catch (error) {
    try { await env.FLOWER_IMAGES.delete(imageKey); } catch (_) {}
    return new Response(JSON.stringify({ error: '꽃 저장 중 오류가 발생했습니다.', detail: String(error?.message || error) }), { status: 500, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({
    ok: true,
    flower: rowToFlower({
      flower_key: flowerKey, grade, category, name, guild_score: guildScore,
      acquire, note, image_key: imageKey, created_at: now, updated_at: now
    })
  }), { status: 201, headers: JSON_HEADERS });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  const url = new URL(request.url);
  const key = cleanText(url.searchParams.get('key'), 100);
  if (!key.startsWith('flw_')) {
    return new Response(JSON.stringify({ error: '삭제할 꽃 key가 올바르지 않습니다.' }), { status: 400, headers: JSON_HEADERS });
  }
  await ensureTables(env.DB);
  const row = await env.DB.prepare('SELECT image_key FROM flowers WHERE flower_key = ?1').bind(key).first();
  if (!row) {
    return new Response(JSON.stringify({ error: '등록된 꽃을 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
  }
  await env.DB.prepare('DELETE FROM flowers WHERE flower_key = ?1').bind(key).run();
  if (env.FLOWER_IMAGES && row.image_key) {
    try { await env.FLOWER_IMAGES.delete(row.image_key); } catch (_) {}
  }
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}
