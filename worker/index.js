// Touchpebble proxy worker.
//
// Stateless (no KV/D1/cache/logs); cookies pass through in flight only.
//
// GET /source and /version let you verify the deployed code: /source returns
// this function's source for diffing, /version the Cloudflare Version ID.
//
// Touchstone rotates `rphq_session` every request via Set-Cookie. PebbleKit JS
// can't read response headers, so the worker echoes the rotation back in
// `X-Updated-Cookies`. Other cookies pass through unchanged.

async function proxy(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/graphql') {
    return new Response('Not found', { status: 404 });
  }

  const cookies = request.headers.get('X-Cookies');
  if (!cookies) {
    return new Response('Missing X-Cookies header', { status: 400 });
  }

  const upstream = await fetch(env.TOUCHSTONE_ORIGIN + '/graphql-public', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-redpoint-hq-client': '1.3.660',
      'rphq-facility': 'RmFjaWxpdHk6MTI4OQ==',
      Cookie: cookies,
    },
    body: await request.text(),
  });

  const setCookie = upstream.headers.get('set-cookie');
  let updatedCookies = cookies;
  if (setCookie) {
    const m = setCookie.match(/(?:^|, )\s*rphq_session=([^;]+)/);
    if (m) {
      updatedCookies = cookies.includes('rphq_session=')
        ? cookies.replace(/rphq_session=[^;]+/, 'rphq_session=' + m[1])
        : cookies + '; rphq_session=' + m[1];
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json',
      'X-Updated-Cookies': updatedCookies,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Updated-Cookies',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/source') {
      return new Response(proxy.toString(), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Worker-Version': env.CF_VERSION || 'unset',
        },
      });
    }
    if (url.pathname === '/version') {
      return new Response(env.CF_VERSION || 'unset', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return proxy(request, env);
  },
};
