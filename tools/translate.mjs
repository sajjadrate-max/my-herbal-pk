// ہر زبان کا اپنا URL (مثلاً /en/articles/iron-ki-kami.html) — Google ہر زبان الگ انڈیکس کرے۔
// اردو صفحات سے صرف نظر آنے والا متن OpenAI سے ترجمہ ہوتا ہے، HTML ویسا ہی رہتا ہے۔
// ترجمے tools/translations-cache/<lang>.json میں محفوظ ہوتے ہیں، اس لیے دوبارہ چلانے پر صرف نیا/بدلا متن ترجمہ ہوتا ہے۔
//
// چلانا:  OPENAI_API_KEY=... node tools/translate.mjs            (سب زبانیں)
//         LANGS=en,ar node tools/translate.mjs                    (صرف یہ زبانیں)
//         TRANSLATE_MOCK=1 LANGS=en node tools/translate.mjs      (بغیر API کے جانچ)
// اختیاری: OPENAI_MODEL (پہلے سے gpt-4o-mini)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const BASE = 'https://myherbalpk.com/';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const KEY = process.env.OPENAI_API_KEY || '';
const MOCK = !!process.env.TRANSLATE_MOCK;

// ---- زبانیں: lang.js والی فہرست (motapa-calculator سے)
const langSrc = fs.readFileSync(path.join(ROOT, 'lang.js'), 'utf8');
const ALL = [...langSrc.matchAll(/\{ code: '([^']+)', name: '([^']+)' \}/g)].map(m => ({ code: m[1], name: m[2] }));
const ALIAS = { 'ar-ae': 'ar', 'ar-sa': 'ar', 'ar-bh': 'ar', 'ar-qa': 'ar', 'ar-kw': 'ar' }; // ایک ہی عربی صفحہ
const RTL = new Set(['ar', 'fa', 'ps', 'he', 'ur']);
const HREF_CODE = { he: 'he', no: 'no', zh: 'zh-Hans' };
const targets = [...new Set(ALL.map(l => ALIAS[l.code] || l.code))].filter(c => c !== 'ur');
const only = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const LANGS = only.length ? targets.filter(c => only.includes(c)) : targets;
const langName = c => (ALL.find(l => l.code === c) || { name: c }).name.replace(/^\S+\s/, '');

// ---- ترجمے والے صفحات (ہوم کا ٹول JavaScript ایپ ہے، اس کی جگہ ہر زبان کا تعارفی صفحہ بنتا ہے)
const PAGES = ['about.html', 'contact.html', 'privacy-policy.html', 'terms.html', 'disclaimer.html', 'articles/index.html',
  ...fs.readdirSync(path.join(ROOT, 'articles')).filter(f => f.endsWith('.html') && f !== 'index.html').sort().map(f => 'articles/' + f)];
const pageUrl = (lang, p) => BASE + (lang ? lang + '/' : '') + p.replace(/(^|\/)index\.html$/, '$1');

// ---- ترجمہ: cache + OpenAI (JSON array اندر، اسی ترتیب سے JSON array باہر)
const CACHE_DIR = path.join(ROOT, 'tools', 'translations-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
function loadCache(lang) { try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, lang + '.json'), 'utf8')); } catch (e) { return {}; } }
function saveCache(lang, c) { fs.writeFileSync(path.join(CACHE_DIR, lang + '.json'), JSON.stringify(c, null, 0)); }

async function callModel(lang, strings) {
  if (MOCK) return strings.map(s => '[' + lang + '] ' + s);
  const sys = `You translate a Pakistani Urdu herbal-medicine website (Qanoon-e-Mufrad Aza, Hakeem Sabir) into ${langName(lang)} (language code "${lang}").
You get a JSON array of text fragments in Urdu or English. Return {"t":[...]} with the SAME number of items, each the translation of the item at the same index.
Rules: keep numbers, units (mg, ml, IU), medicine/brand/generic names in Latin script, emoji, punctuation at the edges, and the names "My Herbal PK", "Qanoon-e-Mufrad Aza" unchanged. Translate Urdu terms like اعصابی/عضلاتی/غدی mizaj naturally and add the Urdu term in brackets the first time it appears in a fragment. Medical meaning must stay exact; do not add or drop advice. A fragment that is only a name, number or symbol is returned unchanged.`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify({ model: MODEL, temperature: 0.2, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(strings) }] })
      });
      if (r.status === 429 || r.status >= 500) throw new Error('retry ' + r.status);
      if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const d = await r.json();
      const out = JSON.parse(d.choices[0].message.content).t;
      if (!Array.isArray(out) || out.length !== strings.length) throw new Error('length mismatch');
      return out.map(String);
    } catch (e) {
      if (attempt === 4 || /^OpenAI 4/.test(e.message)) throw e;
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

async function translateAll(lang, strings, cache) {
  const need = [...new Set(strings.filter(s => !(sha(s) in cache)))];
  // ~3500 حروف کے گروپ
  const groups = []; let cur = [], len = 0;
  for (const s of need) { if (cur.length && len + s.length > 3500) { groups.push(cur); cur = []; len = 0; } cur.push(s); len += s.length; }
  if (cur.length) groups.push(cur);
  let i = 0;
  const worker = async () => { while (i < groups.length) { const g = groups[i++]; const t = await callModel(lang, g); g.forEach((s, k) => { cache[sha(s)] = t[k]; }); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  return s => cache[sha(s)] ?? s;
}

// ---- HTML: صرف متن کے ٹکڑے بدلیں
const TRANSLATABLE = s => /[\p{L}]/u.test(s.replace(/&[a-z#0-9]+;/gi, ''));
function textNodes(html) {
  const parts = html.split(/(<[^>]+>)/);
  let skip = 0;
  return parts.map((p, i) => {
    if (i % 2) { if (/^<(script|style)\b/i.test(p)) skip++; else if (/^<\/(script|style)>/i.test(p)) skip--; return null; }
    return skip ? null : p;
  });
}
function collect(html) { return textNodes(html).filter(p => p && p.trim() && TRANSLATABLE(p)).map(p => p.trim()); }
function apply(html, tr) {
  const parts = html.split(/(<[^>]+>)/);
  let skip = 0;
  return parts.map((p, i) => {
    if (i % 2) { if (/^<(script|style)\b/i.test(p)) skip++; else if (/^<\/(script|style)>/i.test(p)) skip--; return p; }
    if (skip || !p.trim() || !TRANSLATABLE(p)) return p;
    const lead = p.match(/^\s*/)[0], tail = p.match(/\s*$/)[0];
    return lead + tr(p.trim()) + tail;
  }).join('');
}
const attr = (html, re) => { const m = html.match(re); return m ? m[1] : ''; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function hreflangBlock(p, isApp, langs) {
  const lines = ['<!--hreflang-->', `<link rel="alternate" hreflang="ur" href="${isApp ? BASE : pageUrl('', p)}">`];
  for (const c of langs) lines.push(`<link rel="alternate" hreflang="${HREF_CODE[c] || c}" href="${pageUrl(c, isApp ? 'index.html' : p)}">`);
  for (const [reg, base] of Object.entries(ALIAS)) if (langs.includes(base)) lines.push(`<link rel="alternate" hreflang="${reg}" href="${pageUrl(base, isApp ? 'index.html' : p)}">`);
  lines.push(`<link rel="alternate" hreflang="x-default" href="${isApp ? BASE : pageUrl('', p)}">`, '<!--/hreflang-->');
  return lines.join('\n');
}
const putHreflang = (html, block) => html.includes('<!--hreflang-->')
  ? html.replace(/<!--hreflang-->[\s\S]*?<!--\/hreflang-->/, block)
  : html.replace(/(<link rel="canonical"[^>]*>)/, '$1\n' + block);

// ہر زبان کا تعارفی (ہوم) صفحہ: مضامین کی فہرست والا صفحہ + ٹول کا بٹن
function landingSource() {
  let s = fs.readFileSync(path.join(ROOT, 'articles/index.html'), 'utf8');
  const intro = `<div class="card"><h1>My Herbal PK</h1><p>قانونِ مفرد اعضاء — حکیم صابر رحمۃ اللہ علیہ کے قانون کے مطابق مزاج، غذا اور علاج کا مکمل نظام۔ مزاج کی تشخیص، غذائی چارٹ، نسخہ جات، وٹامن و معدنیات کی کمی اور ڈاکٹر کے بل میں دوائی کی تبدیلی — سب مفت۔</p><a class="cta" href="../">اپنے مزاج کی تشخیص کریں</a></div>`;
  s = s.replace('<main class="wrap">', '<main class="wrap">\n' + intro.replace('href="../"', 'href="/"'));
  // یہ صفحہ /xx/index.html پر ہے: مضامین articles/ میں، باقی صفحات اسی فولڈر میں
  return s.replace(/href="([^"]*)"/g, (m, h) => {
    if (/^(https?:|#|mailto:|\/)/.test(h) || /\.(css|js|png)$/.test(h)) return m;
    if (/^\.\.\/(#home)?$/.test(h)) return 'href="./"';
    if (/^\.\.\//.test(h)) return `href="${h.slice(3)}"`;
    if (/^\.\/(#home)?$/.test(h)) return 'href="./"';
    return `href="articles/${h}"`;
  });
}

function buildPage(src, lang, p, tr, isLanding) {
  const depthUp = '../';
  let html = src;
  const mainM = html.match(/<main[\s\S]*?<\/main>/);
  let main = mainM[0];
  const notice = `<p class="note" style="font-size:.85rem">${esc(tr('یہ صفحہ اردو سے خودکار (مشینی) ترجمہ ہے۔ درست اور مستند معلومات اصل اردو صفحے میں ہیں۔'))} <a href="${isLanding ? '../' : '../' + '../'.repeat(p.split('/').length - 1) + p}" lang="ur" dir="rtl">اصل اردو</a></p>`;
  main = apply(main, tr).replace(/(<main[^>]*>)/, '$1\n' + notice);
  html = html.replace(mainM[0], main);
  const title = attr(src, /<title>([^<]*)<\/title>/).replace(/ \| My Herbal PK$/, '');
  const desc = attr(src, /<meta name="description" content="([^"]*)">/);
  const tTitle = (isLanding ? 'My Herbal PK — ' + tr('قانونِ مفرد اعضاء، مزاج اور غذا') : tr(title)) + ' | My Herbal PK';
  const tDesc = tr(desc);
  const url = isLanding ? pageUrl(lang, 'index.html') : pageUrl(lang, p);
  html = html.replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${HREF_CODE[lang] || lang}" dir="${RTL.has(lang) ? 'rtl' : 'ltr'}" data-static-lang="${lang}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(tTitle)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(tDesc)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(tTitle)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(tDesc)}">`)
    .replace(/<meta property="og:locale" content="[^"]*">/, `<meta property="og:locale" content="${lang}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    // اصل اردو JSON-LD کی جگہ اس زبان کا مختصر
    .replace(/\n<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
    .replace('</head>', `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': p.startsWith('articles/') && !p.endsWith('index.html') ? 'Article' : 'WebPage', headline: tTitle.replace(/ \| My Herbal PK$/, ''), name: tTitle, description: tDesc, inLanguage: lang, url, isBasedOn: isLanding ? BASE : pageUrl('', p), publisher: { '@type': 'Organization', name: 'My Herbal PK', url: BASE } })}</script>\n` +
      `<style>body{font-family:${RTL.has(lang) ? "'Amiri','Noto Naskh Arabic',serif" : "system-ui,'Noto Sans',Roboto,Arial,sans-serif"};line-height:1.8}h1,h2,h3{line-height:1.5}</style>\n</head>`);
  // ایک درجہ گہرا: CSS/JS/آئیکن کے راستے
  html = html.replace(/(href|src)="((?:\.\.\/)*)(site\.css|ptr\.js|lang\.js|offline\.js|i18n-langs\.js|icon-[\w-]+\.png)"/g, (m, a, up, f) => `${a}="${depthUp}${up}${f}"`);
  return html;
}

// ---- چلائیں
const sources = Object.fromEntries(PAGES.map(p => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]));
const landing = landingSource();
const FIXED = ['یہ صفحہ اردو سے خودکار (مشینی) ترجمہ ہے۔ درست اور مستند معلومات اصل اردو صفحے میں ہیں۔', 'قانونِ مفرد اعضاء، مزاج اور غذا'];
if (!MOCK && !KEY) { console.error('OPENAI_API_KEY نہیں ملی'); process.exit(1); }

const done = [];
for (const lang of LANGS) {
  const cache = loadCache(lang);
  const strings = [...FIXED];
  for (const p of PAGES) { const s = sources[p]; strings.push(...collect(s.match(/<main[\s\S]*?<\/main>/)[0]), attr(s, /<title>([^<]*)<\/title>/).replace(/ \| My Herbal PK$/, ''), attr(s, /<meta name="description" content="([^"]*)">/)); }
  strings.push(...collect(landing.match(/<main[\s\S]*?<\/main>/)[0]));
  try {
    const tr = await translateAll(lang, strings.filter(Boolean), cache);
    for (const p of PAGES) {
      const out = path.join(ROOT, lang, p);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buildPage(sources[p], lang, p, tr, false));
    }
    fs.writeFileSync(path.join(ROOT, lang, 'index.html'), buildPage(landing, lang, 'articles/index.html', tr, true));
    done.push(lang);
    console.log('✅', lang, PAGES.length + 1, 'pages');
  } catch (e) {
    console.error('❌', lang, e.message);
  } finally {
    saveCache(lang, cache);
  }
}

// ---- اصل اردو صفحات اور ہوم میں hreflang، ترجمہ شدہ زبانوں کی فہرست، sitemap
const have = targets.filter(c => fs.existsSync(path.join(ROOT, c, 'index.html')));
// hreflang صرف ان زبانوں کا جن کے صفحات واقعی موجود ہیں — سب صفحات پر (پچھلی بار والے بھی) نئے سرے سے
const setH = (file, p, isApp) => { const f = path.join(ROOT, file); if (fs.existsSync(f)) fs.writeFileSync(f, putHreflang(fs.readFileSync(f, 'utf8'), hreflangBlock(p, isApp, have))); };
for (const p of PAGES) { setH(p, p, false); for (const c of have) setH(path.join(c, p), p, false); }
setH('index.html', 'index.html', true);
for (const c of have) setH(path.join(c, 'index.html'), 'index.html', true);
fs.writeFileSync(path.join(ROOT, 'i18n-langs.js'), '// tools/translate.mjs سے بنی: جن زبانوں کے الگ صفحات موجود ہیں\nwindow.HERBAL_STATIC_LANGS = ' + JSON.stringify(have) + ';\n');
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const base = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => !targets.some(c => u.startsWith(BASE + c + '/')));
const day = new Date().toISOString().slice(0, 10);
const urls = base.concat(...have.map(c => [pageUrl(c, 'index.html'), ...PAGES.map(p => pageUrl(c, p))]));
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url><loc>${u}</loc><lastmod>${day}</lastmod></url>`).join('\n') + '\n</urlset>\n');
console.log('done:', done.length, 'languages this run;', have.length, 'available;', urls.length, 'sitemap URLs');
if (LANGS.length && !done.length) process.exit(1);
