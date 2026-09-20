const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function parseDate(value) {
  const text = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, value: '' };
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return { ok: valid, value: valid ? text : '' };
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS web_update_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_web_update_notices_date ON web_update_notices (notice_date DESC, updated_at DESC)`).run();
}

function rowToNotice(row) {
  return {
    id: Number(row.id),
    noticeDate: row.notice_date,
    title: row.title,
    content: row.content,
    createdAt: Number(row.created_at || 0),
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
    SELECT id, notice_date, title, content, created_at, updated_at
    FROM web_update_notices
    ORDER BY notice_date DESC, updated_at DESC, id DESC
    LIMIT 100
  `).all();
  const notices = (result.results || []).map(rowToNotice);
  const latestChangedAt = notices.reduce((latest, item) => Math.max(latest, item.updatedAt), 0);
  return new Response(JSON.stringify({ notices, latestChangedAt }), { headers: JSON_HEADERS });
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
  const noticeDate = parseDate(body?.noticeDate);
  const title = cleanText(body?.title, 120);
  const content = cleanText(body?.content, 4000);
  if (!noticeDate.ok || !title || !content) {
    return new Response(JSON.stringify({ error: '날짜, 제목, 내용을 모두 입력해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }
  await ensureTable(env.DB);
  const latest = await env.DB.prepare(`SELECT MAX(updated_at) AS latest FROM web_update_notices`).first();
  const now = Math.max(Date.now(), Number(latest?.latest || 0) + 1);
  const result = await env.DB.prepare(`
    INSERT INTO web_update_notices (notice_date, title, content, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(noticeDate.value, title, content, now, now).run();
  const id = Number(result.meta?.last_row_id || 0);
  const row = await env.DB.prepare(`
    SELECT id, notice_date, title, content, created_at, updated_at
    FROM web_update_notices WHERE id = ?1
  `).bind(id).first();
  return new Response(JSON.stringify({ ok: true, notice: rowToNotice(row) }), { status: 201, headers: JSON_HEADERS });
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
  const id = Number(body?.id);
  const noticeDate = parseDate(body?.noticeDate);
  const title = cleanText(body?.title, 120);
  const content = cleanText(body?.content, 4000);
  if (!Number.isInteger(id) || id <= 0 || !noticeDate.ok || !title || !content) {
    return new Response(JSON.stringify({ error: '수정할 공지 내용을 확인해주세요.' }), { status: 400, headers: JSON_HEADERS });
  }
  await ensureTable(env.DB);
  const existing = await env.DB.prepare(`SELECT id FROM web_update_notices WHERE id = ?1`).bind(id).first();
  if (!existing) {
    return new Response(JSON.stringify({ error: '수정할 공지를 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
  }
  const latest = await env.DB.prepare(`SELECT MAX(updated_at) AS latest FROM web_update_notices`).first();
  const now = Math.max(Date.now(), Number(latest?.latest || 0) + 1);
  await env.DB.prepare(`
    UPDATE web_update_notices
    SET notice_date = ?2, title = ?3, content = ?4, updated_at = ?5
    WHERE id = ?1
  `).bind(id, noticeDate.value, title, content, now).run();
  const row = await env.DB.prepare(`
    SELECT id, notice_date, title, content, created_at, updated_at
    FROM web_update_notices WHERE id = ?1
  `).bind(id).first();
  return new Response(JSON.stringify({ ok: true, notice: rowToNotice(row) }), { headers: JSON_HEADERS });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), { status: 500, headers: JSON_HEADERS });
  }
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: '삭제할 공지 번호가 올바르지 않습니다.' }), { status: 400, headers: JSON_HEADERS });
  }
  await ensureTable(env.DB);
  const existing = await env.DB.prepare(`SELECT id FROM web_update_notices WHERE id = ?1`).bind(id).first();
  if (!existing) {
    return new Response(JSON.stringify({ error: '삭제할 공지를 찾을 수 없습니다.' }), { status: 404, headers: JSON_HEADERS });
  }
  await env.DB.prepare(`DELETE FROM web_update_notices WHERE id = ?1`).bind(id).run();
  return new Response(JSON.stringify({ ok: true, deleted: id }), { headers: JSON_HEADERS });
}
