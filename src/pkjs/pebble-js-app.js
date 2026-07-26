// Companion JS: reads stored cookies, fetches the check-in QR via the worker,
// rasterizes the SVG to a bitfield, and pushes it to the watch. The worker
// echoes Touchstone's rotated `rphq_session` back in `X-Updated-Cookies`.

var COOKIE_KEY = 'tp_cookies';
var WORKER_KEY = 'tp_worker_url';
var WORKER_URL = 'https://touchpebble.jacksongoode.workers.dev/graphql';
var QR_QUERY = 'query { viewer { ... on Profile { checkInQrCodes { code } } } }';

// Rasterize the first <path d="..."> into a size×size bitfield, where
// size = max coordinate (Touchstone paths end at size, not size-1).
function svgToBytes(svg) {
  var path = (svg.match(/<path[^>]*\sd="([^"]+)"/) || [, ''])[1];
  var toks = path.match(/[ML]|-?\d+(?:\.\d+)?/g) || [];

  // Single pass: build polygons, track the grid extent.
  var polys = [],
    cur = null,
    maxCoord = 0,
    i = 0;
  function pt(x, y) {
    if (x > maxCoord) maxCoord = x;
    if (y > maxCoord) maxCoord = y;
    return [x, y];
  }
  while (i < toks.length) {
    var cmd = toks[i++];
    if (cmd === 'M') {
      cur = [pt(+toks[i++], +toks[i++])];
      polys.push(cur);
    } else if (cmd === 'L' && cur) cur.push(pt(+toks[i++], +toks[i++]));
  }
  var size = Math.round(maxCoord);

  var bytes = [],
    byte = 0,
    bit = 0;
  // Even-odd ray cast: toggle `inside` on each polygon edge crossing.
  for (var row = 0; row < size; row++) {
    for (var col = 0; col < size; col++) {
      var x = col + 0.5,
        y = row + 0.5,
        inside = false;
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        for (var k = 0, j = poly.length - 1; k < poly.length; j = k++) {
          if (
            poly[k][1] > y !== poly[j][1] > y &&
            x <
              ((poly[j][0] - poly[k][0]) * (y - poly[k][1])) / (poly[j][1] - poly[k][1]) +
                poly[k][0]
          )
            inside = !inside;
        }
      }
      // Pack MSB-first per row.
      if (inside) byte |= 1 << (7 - bit);
      if (++bit === 8) {
        bytes.push(byte);
        byte = 0;
        bit = 0;
      }
    }
  }
  if (bit > 0) bytes.push(byte);
  return { size: size, bytes: bytes };
}

function gql(query, cookies, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', localStorage.getItem(WORKER_KEY) || WORKER_URL, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('X-Cookies', cookies);
  xhr.timeout = 15000;
  xhr.onload = function () {
    var updated = xhr.getResponseHeader('X-Updated-Cookies');
    if (updated)
      try {
        // Persist the rotated session for the next request.
        localStorage.setItem(COOKIE_KEY, updated);
      } catch (_) {}
    try {
      cb(null, JSON.parse(xhr.responseText));
    } catch (e) {
      cb(e);
    }
  };
  // Callers treat all failures alike.
  xhr.onerror = xhr.ontimeout = function () {
    cb(new Error('network'));
  };
  xhr.send(JSON.stringify({ query: query }));
}

function fetchQR() {
  var cookies = localStorage.getItem(COOKIE_KEY);
  if (!cookies) {
    Pebble.sendAppMessage({ NEEDS_SETUP: 1 });
    return;
  }

  gql(QR_QUERY, cookies, function (e, q) {
    if (e) return; // transient network error: keep the last QR on screen
    if (!q || !q.data || !q.data.viewer) {
      Pebble.sendAppMessage({ NEEDS_SETUP: 1 });
      return;
    }
    var codes = q.data.viewer.checkInQrCodes;
    if (!codes || !codes[0] || !codes[0].code) return;
    var qr = svgToBytes(codes[0].code);
    if (qr.bytes.length !== Math.ceil((qr.size * qr.size) / 8)) return;
    Pebble.sendAppMessage({ QR_SIZE: qr.size, QR_DATA: qr.bytes });
  });
}

Pebble.addEventListener('ready', fetchQR);
Pebble.addEventListener('apprunning', fetchQR);
setInterval(fetchQR, 8000);

// Settings page: paste the Cookie header (split on ; or newline, trimmed).
// A Clear button appears if a session is stored.
Pebble.addEventListener('showConfiguration', function () {
  var configured = !!localStorage.getItem(COOKIE_KEY);
  var currentUrl = localStorage.getItem(WORKER_KEY) || WORKER_URL;
  var statusHtml = configured
    ? '<p style="color:#30d158">Signed in.</p>'
    : '<p>Not configured.</p>';
  var clearHtml = configured
    ? '<button class="secondary" onclick="clearCookies()">Clear saved cookies</button>'
    : '';
  var html =
    '<!DOCTYPE html><html><head>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:-apple-system,sans-serif;padding:24px;' +
    'background:#1c1c1e;color:#fff;margin:0;max-width:460px}' +
    'h2{font-weight:600;margin:0 0 4px}' +
    'p{color:#a2a2a7;font-size:13px;line-height:1.45;margin:6px 0}' +
    'code{background:#3a3a3c;padding:2px 6px;border-radius:4px;' +
    'color:#fff;font-size:12px}' +
    'textarea,input{width:100%;padding:12px;box-sizing:border-box;' +
    'border:1px solid #3a3a3c;border-radius:10px;font-family:monospace;' +
    'font-size:11px;background:#2c2c2e;color:#fff;resize:none;margin-top:8px}' +
    'input{height:auto;padding:10px;font-size:12px}' +
    'button{width:100%;padding:14px;background:#0a84ff;color:#fff;' +
    'border:none;border-radius:10px;font-size:16px;font-weight:600;' +
    'cursor:pointer;margin-top:10px}' +
    'button.secondary{background:#3a3a3c;margin-top:8px}' +
    '#s{margin-top:10px;color:#0a84ff;font-size:14px}</style></head><body>' +
    '<h2>Touchstone QR</h2>' +
    statusHtml +
    '<p><b>On your computer:</b> log in to ' +
    '<code>portal.touchstoneclimbing.com</code>, press <code>F12</code>, ' +
    'open the <b>Network</b> tab, reload, click any request, and copy the ' +
    '<code>Cookie:</code> value from <b>Request Headers</b>.</p>' +
    '<textarea id="c" placeholder="rphq_session=eyJ...; remember_web_xxx=..."></textarea>' +
    '<p style="margin-top:16px"><b>Proxy URL</b> (optional)</p>' +
    '<input id="u" type="url" value="' + currentUrl +
    '" placeholder="' + WORKER_URL + '">' +
    '<button onclick="save()">Save</button>' +
    clearHtml +
    '<div id="s"></div>' +
    '<script>' +
    'function save(){' +
    '  var raw=document.getElementById("c").value.trim();' +
    '  var pairs=[];' +
    '  if(raw){var parts=raw.split(/[;\\n]+/);' +
    '  for(var i=0;i<parts.length;i++){' +
    '    var p=parts[i].trim().match(/^([^=]+)=(.+)/);' +
    '    if(p) pairs.push(p[1].trim()+"="+p[2].trim());}}' +
    '  var url=document.getElementById("u").value.trim();' +
    '  if(!pairs.length && !url){document.getElementById("s").textContent="Enter cookies or a proxy URL.";return;}' +
    '  location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify({cookies:pairs.join("; "),url:url}));}' +
    'function clearCookies(){' +
    '  location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify({action:"clear"}));}' +
    '</script></body></html>';
  Pebble.openURL('data:text/html,' + encodeURIComponent(html));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) {
    fetchQR();
    return;
  }
  var resp = e.response.charAt(0) === '#' ? e.response.substring(1) : e.response;
  try {
    var data = JSON.parse(decodeURIComponent(resp));
    if (data.action === 'clear') localStorage.removeItem(COOKIE_KEY);
    else {
      if (data.cookies) localStorage.setItem(COOKIE_KEY, data.cookies);
      if (data.url) localStorage.setItem(WORKER_KEY, data.url);
      else if (typeof data.url === 'string') localStorage.removeItem(WORKER_KEY);
    }
  } catch (_) {}
  fetchQR();
});
