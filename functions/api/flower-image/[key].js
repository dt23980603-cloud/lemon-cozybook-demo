export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.FLOWER_IMAGES) return new Response('R2 binding FLOWER_IMAGES is not configured.', { status: 500 });
  if (!env.DB) return new Response('D1 binding DB is not configured.', { status: 500 });

  const key = String(params.key || '');
  if (!/^(?:base_[a-z0-9_-]+|flw_[a-z0-9_-]+)$/i.test(key) || key.length > 100) {
    return new Response('Not found', { status: 404 });
  }

  let row;
  try {
    row = await env.DB.prepare(`SELECT image_key FROM flowers WHERE flower_key = ?1`).bind(key).first();
  } catch (_) {
    return new Response('Not found', { status: 404 });
  }
  if (!row?.image_key) return new Response('Not found', { status: 404 });

  const object = await env.FLOWER_IMAGES.get(row.image_key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'image/webp');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}
