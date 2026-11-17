// Exports the web build into docs/app, adds the PWA manifest, icons and an offline service worker.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'docs', 'app');
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx expo export -p web --output-dir "${out}"`, { cwd: root, stdio: 'inherit' });

fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(out, 'icon-512.png'));

fs.writeFileSync(
  path.join(out, 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'ZeroMB',
      short_name: 'ZeroMB',
      description: 'Recharge a data pack with 0 MB left, through a normal phone call.',
      start_url: '/app/',
      scope: '/app/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#0B0F19',
      theme_color: '#0B0F19',
      icons: [
        { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/app/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ),
);

// Cache everything the page asks for on first load, so it works offline afterwards.
fs.writeFileSync(
  path.join(out, 'sw.js'),
  `const CACHE = 'zeromb-${Date.now()}';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/app/'))),
  );
});
`,
);

const htmlPath = path.join(out, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const head = `
<link rel="manifest" href="/app/manifest.webmanifest">
<link rel="apple-touch-icon" href="/app/icon-512.png">
<meta name="theme-color" content="#0B0F19">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ZeroMB">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/app/sw.js',{scope:'/app/'}).catch(function(){})})}</script>
`;
html = html.replace('</head>', head + '</head>');
fs.writeFileSync(htmlPath, html);
console.log('Web build written to docs/app');
