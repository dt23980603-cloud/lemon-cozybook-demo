import {
  getAuthSession,
  json,
  refreshSession,
  sessionCookie
} from './_shared/auth.js';

const PUBLIC_PATHS = new Set([
  '/auth.css',
  '/manifest.webmanifest',
  '/sw.js',
  '/favicon.ico',
  '/images/branding/lemon-favicon.png',
  '/icons/icon-v4.12-192.png',
  '/icons/icon-v4.12-512.png'
]);

const PUBLIC_AUTH_PAGES = new Set([
  '/login.html',
  '/auth-setup.html'
]);

const PUBLIC_API_PATHS = new Set([
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/bootstrap'
]);

const ADMIN_PAGES = new Set([
  '/page7.html',
  '/page8.html',
  '/page10.html',
  '/admin-accounts.html'
]);

function isAdminMutation(pathname, method) {
  if (method === 'GET' || method === 'HEAD') return false;
  if (pathname === '/api/flowers') return true;
  if (pathname === '/api/flower-options') return true;
  if (pathname === '/api/updates') return true;
  if (pathname === '/api/web-updates') return true;
  if (pathname === '/api/star-soul-settings') return true;
  if (pathname === '/api/upgrade-efficiency') return true;
  if (pathname === '/api/guild-state' && method === 'PUT') return true;
  return false;
}

function loginRedirect(request, destination = '/login.html') {
  const url = new URL(request.url);
  const next = `${url.pathname}${url.search}`;
  const target = new URL(destination, url.origin);
  if (destination === '/login.html' && next !== '/index.html' && next !== '/') {
    target.searchParams.set('next', next);
  }
  return Response.redirect(target.toString(), 302);
}

async function withSessionRefresh(context, auth) {
  const response = await context.next();
  if (!auth?.shouldRefresh) return response;
  await refreshSession(context.env, auth);
  const headers = new Headers(response.headers);
  headers.append('set-cookie', sessionCookie(auth.rawToken));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return context.next();
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/icons/')) return context.next();

  const auth = await getAuthSession(context.env, request);
  context.data.auth = auth;

  if (PUBLIC_API_PATHS.has(pathname)) return context.next();

  if (PUBLIC_AUTH_PAGES.has(pathname)) {
    if (auth) return Response.redirect(new URL(auth.mustChangePin ? '/change-pin.html' : '/index.html', request.url).toString(), 302);
    return context.next();
  }

  if (!auth) {
    if (pathname.startsWith('/api/')) return json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, 401);
    return loginRedirect(request);
  }

  if (auth.mustChangePin) {
    const allowed = pathname === '/change-pin.html' || pathname === '/auth.css' ||
      pathname === '/auth-client.js' || pathname === '/api/auth/me' ||
      pathname === '/api/auth/logout' || pathname === '/api/auth/change-pin';
    if (!allowed) {
      if (pathname.startsWith('/api/')) return json({ error: 'PIN 변경이 필요합니다.', code: 'PIN_CHANGE_REQUIRED' }, 403);
      return loginRedirect(request, '/change-pin.html');
    }
  }

  if (ADMIN_PAGES.has(pathname) && auth.role !== 'admin') {
    return Response.redirect(new URL('/index.html', request.url).toString(), 302);
  }

  if (isAdminMutation(pathname, method) && auth.role !== 'admin') {
    return json({ error: '관리자 권한이 필요합니다.', code: 'ADMIN_REQUIRED' }, 403);
  }

  return withSessionRefresh(context, auth);
}
