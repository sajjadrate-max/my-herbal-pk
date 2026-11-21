// آف لائن: ویب سائٹ فون میں محفوظ رہے اور انٹرنیٹ کے بغیر بھی کھلے
// صفحات: پہلے انٹرنیٹ سے تازہ، نہ ملے تو فون میں محفوظ والا۔ باقی فائلیں: محفوظ والی فوراً، پیچھے سے تازہ۔
// /api/ (AI والے حصے) ہمیشہ انٹرنیٹ سے — آف لائن ہوں تو صفحہ «No internet 🛜» دکھاتا ہے۔
const CACHE = 'myherbalpk-v1';
const PRECACHE = [
  './',
  'about.html',
  'articles/adalati-mizaj-ki-alamaat.html',
  'articles/adalati-mizaj-ki-ghizain.html',
  'articles/asabi-mizaj-ki-alamaat.html',
  'articles/asabi-mizaj-ki-ghizain.html',
  'articles/calcium-ki-kami.html',
  'articles/chay-mizaj.html',
  'articles/ghudi-mizaj-ki-alamaat.html',
  'articles/ghudi-mizaj-ki-ghizain.html',
  'articles/index.html',
  'articles/iron-ki-kami.html',
  'articles/khane-ke-usool.html',
  'articles/magnesium-ki-kami.html',
  'articles/mizaj-kaise-maloom-karein.html',
  'articles/mizaj-ke-mutabiq-qahwa.html',
  'articles/protein-ki-kami.html',
  'articles/qanoon-mufrad-aza-kya-hai.html',
  'articles/vitamin-a-ki-kami.html',
  'articles/vitamin-b-complex-ki-kami.html',
  'articles/vitamin-c-ki-kami.html',
  'articles/vitamin-d-ki-kami.html',
  'articles/vitamin-e-ki-kami.html',
  'articles/vitamin-k-ki-kami.html',
  'articles/vitamins-ki-kami-ki-alamaat.html',
  'articles/zinc-ki-kami.html',
  'contact.html',
  'disclaimer.html',
  'index.html',
  'privacy-policy.html',
  'terms.html',
  'articles/',
  'site.css',
  'ptr.js',
  'lang.js',
  'offline.js',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png'
];
// دوسری ویب سائٹس میں سے صرف یہ محفوظ ہوں: فونٹ، لائبریریاں، اور کتابوں کا متن (json)
const CROSS_OK = [/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, /^https:\/\/cdnjs\.cloudflare\.com\//,
  /^https:\/\/raw\.githubusercontent\.com\/sajjadrate-max\/[^?]*\.json$/, /^https:\/\/api\.github\.com\/repos\/sajjadrate-max\/[^/]+\/contents\/books$/];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=> Promise.all(PRECACHE.map(u=> c.add(u).catch(()=>{})))).then(()=> self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.filter(k=> k !== CACHE).map(k=> caches.delete(k)))).then(()=> self.clients.claim()));
});

function fresh(req){
  return fetch(req).then(res=>{
    if(res && (res.ok || res.type === 'opaque')){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{}); }
    return res;
  });
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if(same && (url.pathname.startsWith('/api/') || /\.apk$/i.test(url.pathname))) return;
  if(!same && !CROSS_OK.some(r=> r.test(req.url))) return;
  if(req.mode === 'navigate' || (same && /\.html?$|\/$/.test(url.pathname))){
    // صفحہ: انٹرنیٹ سے، ورنہ محفوظ والا (?query کے بغیر بھی تلاش)، ورنہ ہوم
    e.respondWith(fresh(req).catch(()=> caches.match(req, {ignoreSearch:true}).then(r=> r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit=>{
    const net = fresh(req).catch(()=> hit);
    return hit || net;
  }));
});
