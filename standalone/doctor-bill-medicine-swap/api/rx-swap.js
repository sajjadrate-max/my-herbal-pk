// Vercel Serverless Function — Route: POST /api/rx-swap
// «ڈاکٹر کے بل میں دوائی کی تبدیلی»: نسخے/بل کی تصویروں سے ہر دوا پڑھ کر لوکل کمپنی کی جگہ اچھی کمپنی کی وہی دوا۔
// ضرورت: Vercel کے Environment Variables میں OPENAI_API_KEY (اختیاری: OPENAI_VISION_MODEL، پہلے سے gpt-4o)
// اہم: OPENAI_API_KEY کبھی براؤزر کوڈ میں نہ لکھیں۔

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } }, maxDuration: 60 };
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔' });
  try {
    return await handleRx(req.body || {}, apiKey, res);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}

// ---------------------------------------------------------------------------
// ڈاکٹر کے نسخے/بل کی تصویر → ہر دوا: لکھا ہوا برانڈ، کمپنی، اصل دوا (generic) + طاقت + شکل،
// کمپنی معیاری ہے یا لوکل، اور لوکل ہو تو اچھی کمپنیوں کے وہی دوا والے برانڈ۔
// درخواست: { action:'rx', images:[dataURL] }  (زیادہ سے زیادہ 3 تصویریں)
// جواب: { medicines:[{ written, company, generic, strength, form, dose, status:'good'|'local'|'unknown'|'unclear', reason, alternatives:[{brand, company}] }], note }
const RX_SYSTEM = `You read doctors' prescriptions and pharmacy bills from Pakistan (printed or handwritten, English/Urdu).
For EACH medicine line you can see, return:
- "written": the brand/name exactly as written (keep spelling)
- "company": manufacturer if printed or if you reliably know this Pakistani brand's maker, else ""
- "country": the country the company is from, in Urdu (e.g. "پاکستان", "فرانس", "امریکہ", "برطانیہ", "سوئٹزرلینڈ", "جرمنی", "بھارت", "چین"), "" if not known
- "generic": the active ingredient(s) (salt). If you cannot tell with confidence, return "" — never guess.
- "strength": e.g. "500 mg", "250 mg/5 ml"; "" if not visible and not certain
- "form": tablet / capsule / syrup / suspension / injection / drops / cream / ointment / inhaler / sachet / other
- "dose": dosing instructions exactly as written (e.g. "1+0+1 x 5 days"), else ""
- "uses": 2 to 4 short Urdu points on what this generic medicine is used for / its benefits (e.g. "بخار کم کرتی ہے"), from standard medical knowledge of the generic; [] if the generic is not known
- "status": "good" if the maker is a multinational or a large reputable Pakistani manufacturer (e.g. GSK, Abbott, Pfizer, Sanofi, Novartis, Bayer, Roche, AstraZeneca, MSD, Getz Pharma, Searle, Sami, Hilton, Martin Dow, Ferozsons, Highnoon, AGP, CCL, Bosch, PharmEvo, Barrett Hodgson, Atco, Platinum, Nabiqasim, Macter, OBS, Genix, Tabros, Wilson's, Indus, Medisure, Zafa); "local" if it is a small/local or little-known maker; "unknown" if you cannot tell the maker; "unclear" if the line itself cannot be read.
- "reason": one short Urdu sentence why (e.g. "یہ ایک چھوٹی مقامی کمپنی کا برانڈ ہے")
- "alternatives": ONLY when status is "local" or "unknown" AND generic is known: up to 3 brands sold in Pakistan by the reputable makers above that contain EXACTLY the same generic(s), same strength and same form. Each {"brand","company","country"} where country is the company's home country in Urdu (e.g. Sanofi → "فرانس", Getz Pharma → "پاکستان", GSK → "برطانیہ", Abbott → "امریکہ", Novartis → "سوئٹزرلینڈ"). Never suggest a different medicine, different strength or different form. If unsure a brand exists in that strength/form, leave it out.
Do not add, remove or change any medicine, dose or duration. Not a diagnosis.
Return JSON: {"medicines":[...], "note": short Urdu note if the image is not a prescription/bill or is hard to read, else ""}.`;

async function handleRx(body, apiKey, res) {
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 3).map(String)
    .filter(u => /^data:image\/(jpeg|png|webp);base64,/.test(u));
  if (!images.length) return res.status(400).json({ error: 'نسخے/بل کی تصویر موجود نہیں۔' });
  const content = [{ type: 'text', text: 'Doctor prescription / pharmacy bill:' }];
  images.forEach(u => content.push({ type: 'image_url', image_url: { url: u, detail: 'high' } }));
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
      messages: [{ role: 'system', content: RX_SYSTEM }, { role: 'user', content }],
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔', details: (await r.text().catch(() => '')).slice(0, 300) });
  const data = await r.json();
  const txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  let o = {};
  try { o = JSON.parse(txt || '{}'); } catch (e) { o = {}; }
  const str = (v, n) => String(v || '').trim().slice(0, n);
  const medicines = (Array.isArray(o.medicines) ? o.medicines : []).slice(0, 25).map(m => {
    const status = ['good', 'local', 'unknown', 'unclear'].includes(m && m.status) ? m.status : 'unknown';
    const generic = str(m && m.generic, 120);
    return {
      written: str(m && m.written, 80), company: str(m && m.company, 60), country: str(m && m.country, 40), generic,
      strength: str(m && m.strength, 40), form: str(m && m.form, 30), dose: str(m && m.dose, 80),
      status, reason: str(m && m.reason, 160),
      uses: generic ? (Array.isArray(m && m.uses) ? m.uses : []).map(u => str(u, 120)).filter(Boolean).slice(0, 4) : [],
      alternatives: (status === 'local' || status === 'unknown') && generic
        ? (Array.isArray(m.alternatives) ? m.alternatives : []).map(a => ({ brand: str(a && a.brand, 60), company: str(a && a.company, 60), country: str(a && a.country, 40) })).filter(a => a.brand).slice(0, 3)
        : []
    };
  }).filter(m => m.written || m.generic);
  return res.status(200).json({ medicines, note: str(o.note, 300) });
}
