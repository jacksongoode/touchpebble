# Touchpebble

Pebble watchapp that shows your Touchstone Climbing check-in QR on your
watch, so you don't have to pull out your phone.

## Setup

1. Log in to `portal.touchstoneclimbing.com`, open DevTools (`F12`) →
   **Network** → reload, copy the `Cookie:` value from any request's
   **Request Headers**, and send it to your phone.
2. In the Pebble app, open **Settings** for the Touchpebble watchapp, paste the cookies,
   and tap **Save**.

The QR refreshes every 8 seconds while the app is open. The `remember_web_*`
cookie keeps you signed in indefinitely; re-paste only if you're logged out.

## Development

```sh
pebble build && pebble install --phone <phone-ip>
cd worker && wrangler deploy
```

<details>
<summary><b>How it works</b></summary>

Pebble → Pebble app (PKJS) → Cloudflare Worker → Touchstone GraphQL

The PKJS stores your session cookies and calls the worker, which proxies to
Touchstone. Touchstone rotates `rphq_session` every request via `Set-Cookie`;
PebbleKit JS can't read response headers, so the worker echoes the rotation
back in `X-Updated-Cookies`. The worker is stateless — no KV, no D1, no logs.

A direct call from the watch to Touchstone isn't possible: browsers can't set
the `Cookie` header or read `Set-Cookie` (and Touchstone CORS is
non-credentialed), so the worker passes cookies via `X-Cookies` instead.

</details>

<details>
<summary><b>Security</b></summary>

The worker is stateless — cookies pass through in flight only. Verify the
deployed code matches this repo with:

```sh
curl -s https://touchpebble.jacksongoode.workers.dev/source
curl -s https://touchpebble.jacksongoode.workers.dev/version
```

`/source` returns the proxy source for diffing; `/version` the Cloudflare
Version ID. Since both are the worker reporting on itself, a malicious
deployer could lie — self-host `worker/` if you don't trust it, and point
the app's **Proxy URL** setting at your own worker.

</details>
