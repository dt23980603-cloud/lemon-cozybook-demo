const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const ZODIAC_KEYS = new Set([
  'aquarius','pisces','aries','taurus','gemini','cancer',
  'leo','virgo','libra','scorpio','sagittarius','capricorn'
]);

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validFlowerKey(value) {
  return /^(?:base_[a-z0-9_-]+|flw_[a-z0-9_-]+)$/i.test(String(value || '')) && String(value).length <= 100;
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS star_soul_zodiac_settings (
      zodiac_key TEXT PRIMARY KEY,
      released INTEGER NOT NULL DEFAULT 0,
      flower_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )
  `).run();
}

function rowToSetting(row) {
  return {
    zodiacKey: row.zodiac_key,
    released: Number(row.released || 0) === 1,
    flowerKey: row.flower_key || '',
    updatedAt: Number(row.updated_at || 0)
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  await ensureTable(env.DB);
  const result = await env.DB.prepare(`
    SELECT zodiac_key, released, flower_key, updated_at
    FROM star_soul_zodiac_settings
    ORDER BY zodiac_key ASC
  `).all();
  return new Response(JSON.stringify({ settings: (result.results || []).map(rowToSetting) }), { headers: JSON_HEADERS });
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

  const zodiacKey = cleanText(body?.zodiacKey, 20);
  const released = body?.released === true;
  const flowerKey = cleanText(body?.flowerKey, 100);
  if (!ZODIAC_KEYS.has(zodiacKey) || (flowerKey && !validFlowerKey(flowerKey))) {
    return new Response(JSON.stringify({ error: '별자리 설정을 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }

  if (flowerKey) {
    const flowersTable = await env.DB.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'flowers'
    `).first();
    if (!flowersTable) {
      return new Response(JSON.stringify({ error: '전체 꽃 도감 데이터를 먼저 준비해주세요.' }), { status: 400, headers: JSON_HEADERS });
    }
    const flower = await env.DB.prepare(`SELECT flower_key FROM flowers WHERE flower_key = ?1`).bind(flowerKey).first();
    if (!flower) {
      return new Response(JSON.stringify({ error: '연결할 꽃을 전체 꽃 도감에서 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
    }
  }

  await ensureTable(env.DB);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO star_soul_zodiac_settings (zodiac_key, released, flower_key, updated_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(zodiac_key) DO UPDATE SET
      released = excluded.released,
      flower_key = excluded.flower_key,
      updated_at = excluded.updated_at
  `).bind(zodiacKey, released ? 1 : 0, flowerKey, now).run();

  const row = await env.DB.prepare(`
    SELECT zodiac_key, released, flower_key, updated_at
    FROM star_soul_zodiac_settings WHERE zodiac_key = ?1
  `).bind(zodiacKey).first();
  return new Response(JSON.stringify({ ok: true, setting: rowToSetting(row) }), { headers: JSON_HEADERS });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  const zodiacKey = cleanText(new URL(request.url).searchParams.get('zodiacKey'), 20);
  if (!ZODIAC_KEYS.has(zodiacKey)) {
    return new Response(JSON.stringify({ error: '초기화할 별자리를 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }
  await ensureTable(env.DB);
  await env.DB.prepare(`DELETE FROM star_soul_zodiac_settings WHERE zodiac_key = ?1`).bind(zodiacKey).run();
  return new Response(JSON.stringify({ ok: true, zodiacKey }), { headers: JSON_HEADERS });
}
