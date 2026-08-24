export async function onRequestGet(context) {
  const { env, params } = context;
  if (!env.FLOWER_IMAGES) {
    return new Response('R2 binding FLOWER_IMAGES is not configured.', { status: 500 });
  }
  const key = String(params.key || '');
  if (!key.startsWith('flw_') || key.length > 100) return new Response('Not found', { status: 404 });
  const object = await env.FLOWER_IMAGES.get(`flowers/${key}.webp`);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', headers.get('content-type') || 'image/webp');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}
