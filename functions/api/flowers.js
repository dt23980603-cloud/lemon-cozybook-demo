const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const GRADES = new Set(['N', 'R', 'SR', 'SSR', 'UR']);
const BASE_SEED_VERSION = 'demo_v33_base_356';

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
      image_key TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  const info = await db.prepare(`PRAGMA table_info(flowers)`).all();
  const columns = new Set((info.results || []).map(row => String(row.name || '')));
  if (!columns.has('image_path')) {
    await db.prepare(`ALTER TABLE flowers ADD COLUMN image_path TEXT NOT NULL DEFAULT ''`).run();
  }

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
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_update_logs_created_at ON update_logs (created_at DESC)`).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validFlowerKey(value) {
  return /^(?:base_[a-z0-9_-]+|flw_[a-z0-9_-]+)$/i.test(String(value || '')) && String(value).length <= 100;
}

function parseGuildScore(value) {
  const text = cleanText(value, 10);
  if (text === '') return { ok: true, value: null };
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 9999) return { ok: false, value: null };
  return { ok: true, value: Math.round(parsed) };
}

function rowToFlower(row) {
  const updatedAt = Number(row.updated_at || 0);
  const imageKey = row.image_key || '';
  const imagePath = row.image_path || '';
  return {
    key: row.flower_key,
    grade: row.grade,
    category: row.category,
    name: row.name,
    listName: row.category ? `[${row.category}] ${row.name}` : row.name,
    guildScore: row.guild_score == null ? null : Number(row.guild_score),
    acquire: row.acquire || '',
    note: row.note || '',
    image: imageKey
      ? `/api/flower-image/${encodeURIComponent(row.flower_key)}?v=${updatedAt}`
      : imagePath,
    createdAt: Number(row.created_at || 0),
    updatedAt,
    isRemote: true,
    hasR2Image: Boolean(imageKey)
  };
}

async function readFlower(db, key) {
  return db.prepare(`
    SELECT flower_key, grade, category, name, guild_score, acquire, note,
           image_key, image_path, created_at, updated_at
    FROM flowers WHERE flower_key = ?1
  `).bind(key).first();
}

async function seedBaseFlowers(env, request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON seed body.' }), { status: 400, headers: JSON_HEADERS });
  }

  const version = cleanText(body?.seedVersion, 80);
  const flowers = Array.isArray(body?.flowers) ? body.flowers : [];
  if (version !== BASE_SEED_VERSION || flowers.length < 300 || flowers.length > 500) {
    return new Response(JSON.stringify({ error: 'Seed payload is not valid.' }), { status: 400, headers: JSON_HEADERS });
  }

  await ensureTables(env.DB);
  const current = await env.DB.prepare(`SELECT meta_value FROM app_meta WHERE meta_key = 'flower_seed_version'`).first();
  if (current?.meta_value === BASE_SEED_VERSION) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM flowers`).first();
    return new Response(JSON.stringify({ ok: true, seeded: false, count: Number(count?.count || 0) }), { headers: JSON_HEADERS });
  }

  const now = Date.now();
  const statements = [];
  flowers.forEach((item, index) => {
    const key = cleanText(item?.key, 100);
    const grade = cleanText(item?.grade, 3).toUpperCase();
    const category = cleanText(item?.category, 80);
    const name = cleanText(item?.name, 120);
    const acquire = cleanText(item?.acquire, 200);
    const note = cleanText(item?.note, 500);
    const imagePath = cleanText(item?.image, 300);
    const score = item?.guildScore == null || item?.guildScore === '' ? null : Number(item.guildScore);

    if (!validFlowerKey(key) || !key.startsWith('base_') || !GRADES.has(grade) || !category || !name || !imagePath.startsWith('images/flowers/')) return;

    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO flowers
        (flower_key, grade, category, name, guild_score, acquire, note, image_key, image_path, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, ?9, ?10)
    `).bind(
      key, grade, category, name,
      Number.isFinite(score) ? Math.round(score) : null,
      acquire, note, imagePath, index + 1, now
    ));
  });

  if (statements.length < 300) {
    return new Response(JSON.stringify({ error: 'Seed data contains too many invalid rows.' }), { status: 400, headers: JSON_HEADERS });
  }

  for (let i = 0; i < statements.length; i += 40) {
    await env.DB.batch(statements.slice(i, i + 40));
  }

  await env.DB.prepare(`
    INSERT INTO app_meta (meta_key, meta_value, updated_at)
    VALUES ('flower_seed_version', ?1, ?2)
    ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value, updated_at = excluded.updated_at
  `).bind(BASE_SEED_VERSION, now).run();

  const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM flowers`).first();
  return new Response(JSON.stringify({ ok: true, seeded: true, count: Number(count?.count || 0) }), { headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  await ensureTables(env.DB);
  const result = await env.DB.prepare(`
    SELECT flower_key, grade, category, name, guild_score, acquire, note,
           image_key, image_path, created_at, updated_at
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

  const url = new URL(request.url);
  if (url.searchParams.get('seed') === '1') {
    return seedBaseFlowers(env, request);
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
  const score = parseGuildScore(form.get('guildScore'));
  const image = form.get('image');

  if (!GRADES.has(grade) || !category || !name) {
    return new Response(JSON.stringify({ error: '등급, 분류, 꽃 이름을 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }
  if (!score.ok) {
    return new Response(JSON.stringify({ error: '길드전 점수를 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
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
  const now = Date.now();
  const imageKey = `flowers/${flowerKey}-${now}.webp`;
  const bytes = await image.arrayBuffer();

  try {
    await env.FLOWER_IMAGES.put(imageKey, bytes, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }
    });

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO flowers
          (flower_key, grade, category, name, guild_score, acquire, note, image_key, image_path, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', ?9, ?10)
      `).bind(flowerKey, grade, category, name, score.value, acquire, note, imageKey, now, now),
      env.DB.prepare(`
        INSERT INTO update_logs (flower_key, action, category, name, grade, guild_score, created_at)
        VALUES (?1, 'add', ?2, ?3, ?4, ?5, ?6)
      `).bind(flowerKey, category, name, grade, score.value, now)
    ]);
  } catch (error) {
    try { await env.FLOWER_IMAGES.delete(imageKey); } catch (_) {}
    return new Response(JSON.stringify({ error: '꽃 저장 중 오류가 발생했습니다.', detail: String(error?.message || error) }), { status: 500, headers: JSON_HEADERS });
  }

  const row = await readFlower(env.DB, flowerKey);
  return new Response(JSON.stringify({ ok: true, flower: rowToFlower(row) }), { status: 201, headers: JSON_HEADERS });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid multipart form data.' }), { status: 400, headers: JSON_HEADERS });
  }

  const key = cleanText(form.get('key'), 100);
  const grade = cleanText(form.get('grade'), 3).toUpperCase();
  const category = cleanText(form.get('category'), 80);
  const name = cleanText(form.get('name'), 120);
  const acquire = cleanText(form.get('acquire'), 200);
  const note = cleanText(form.get('note'), 500);
  const score = parseGuildScore(form.get('guildScore'));
  const image = form.get('image');

  if (!validFlowerKey(key) || !GRADES.has(grade) || !category || !name) {
    return new Response(JSON.stringify({ error: '수정할 꽃 정보가 올바르지 않습니다.' }), { status: 400, headers: JSON_HEADERS });
  }
  if (!score.ok) {
    return new Response(JSON.stringify({ error: '길드전 점수를 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }

  await ensureTables(env.DB);
  const current = await readFlower(env.DB, key);
  if (!current) {
    return new Response(JSON.stringify({ error: '수정할 꽃을 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
  }

  const duplicate = await env.DB.prepare(`
    SELECT flower_key FROM flowers
    WHERE grade = ?1 AND category = ?2 AND name = ?3 AND flower_key <> ?4
    LIMIT 1
  `).bind(grade, category, name, key).first();
  if (duplicate) {
    return new Response(JSON.stringify({ error: '같은 등급에 동일한 [분류] 꽃 이름이 이미 있습니다.' }), { status: 409, headers: JSON_HEADERS });
  }

  const hasNewImage = image instanceof File && image.size > 0;
  if (hasNewImage && image.size > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '이미지는 10MB 이하로 등록해주세요.' }), { status: 413, headers: JSON_HEADERS });
  }
  if (hasNewImage && !env.FLOWER_IMAGES) {
    return new Response(JSON.stringify({ error: 'R2 binding FLOWER_IMAGES is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }

  const now = Date.now();
  let newImageKey = current.image_key || '';
  let uploadedImageKey = '';

  if (hasNewImage) {
    uploadedImageKey = `flowers/${key}-${now}.webp`;
    const bytes = await image.arrayBuffer();
    try {
      await env.FLOWER_IMAGES.put(uploadedImageKey, bytes, {
        httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }
      });
      newImageKey = uploadedImageKey;
    } catch (error) {
      return new Response(JSON.stringify({ error: '새 이미지 저장에 실패했습니다.', detail: String(error?.message || error) }), { status: 500, headers: JSON_HEADERS });
    }
  }

  try {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE flowers
        SET grade = ?2,
            category = ?3,
            name = ?4,
            guild_score = ?5,
            acquire = ?6,
            note = ?7,
            image_key = ?8,
            updated_at = ?9
        WHERE flower_key = ?1
      `).bind(key, grade, category, name, score.value, acquire, note, newImageKey, now),
      env.DB.prepare(`
        INSERT INTO update_logs (flower_key, action, category, name, grade, guild_score, created_at)
        VALUES (?1, 'edit', ?2, ?3, ?4, ?5, ?6)
      `).bind(key, category, name, grade, score.value, now)
    ]);
  } catch (error) {
    if (uploadedImageKey && env.FLOWER_IMAGES) {
      try { await env.FLOWER_IMAGES.delete(uploadedImageKey); } catch (_) {}
    }
    return new Response(JSON.stringify({ error: '꽃 정보 수정 중 오류가 발생했습니다.', detail: String(error?.message || error) }), { status: 500, headers: JSON_HEADERS });
  }

  if (uploadedImageKey && current.image_key && current.image_key !== uploadedImageKey && env.FLOWER_IMAGES) {
    try { await env.FLOWER_IMAGES.delete(current.image_key); } catch (_) {}
  }

  const row = await readFlower(env.DB, key);
  return new Response(JSON.stringify({ ok: true, flower: rowToFlower(row) }), { headers: JSON_HEADERS });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  const url = new URL(request.url);
  const key = cleanText(url.searchParams.get('key'), 100);
  if (!validFlowerKey(key)) {
    return new Response(JSON.stringify({ error: '삭제할 꽃 key가 올바르지 않습니다.' }), { status: 400, headers: JSON_HEADERS });
  }
  await ensureTables(env.DB);
  const row = await env.DB.prepare(`SELECT image_key FROM flowers WHERE flower_key = ?1`).bind(key).first();
  if (!row) {
    return new Response(JSON.stringify({ error: '등록된 꽃을 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
  }
  await env.DB.prepare(`DELETE FROM flowers WHERE flower_key = ?1`).bind(key).run();
  if (env.FLOWER_IMAGES && row.image_key) {
    try { await env.FLOWER_IMAGES.delete(row.image_key); } catch (_) {}
  }
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}
