// آف لائن: انٹرنیٹ نہ ہو تو اوپر «No internet 🛜» کی پٹی، اور AI/سرور والے حصے صاف بتائیں کہ انٹرنیٹ چاہیے
(function(){
  var MSG = 'No internet 🛜 — یہ حصہ انٹرنیٹ سے چلتا ہے، انٹرنیٹ آنے پر دوبارہ کوشش کریں';

  // سرور (/api/) اور رابطہ فارم: انٹرنیٹ نہ ہو تو یہی پیغام والی خرابی
  var needsNet = function(u){ return /\/api\/|formspree\.io|formsubmit\.co/.test(u); };
  var realFetch = window.fetch && window.fetch.bind(window);
  if(realFetch){
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if(!needsNet(url)) return realFetch(input, init);
      if(navigator.onLine === false) return Promise.reject(new Error(MSG));
      return realFetch(input, init).catch(function(e){
        if(e && e.name === 'TypeError') throw new Error(MSG);
        throw e;
      });
    };
  }

  // اوپر پٹی
  var css = document.createElement('style');
  css.textContent = '#herbalOffline{position:fixed;top:0;left:0;right:0;z-index:9990;background:#b3261e;color:#fff;text-align:center;' +
    'font:600 .85rem Poppins,"Noto Nastaliq Urdu",sans-serif;line-height:1.8;padding:6px 10px;display:none;}' +
    'body.herbal-offline #herbalOffline{display:block;}body.herbal-offline{padding-top:36px;}';
  document.head.appendChild(css);
  function show(){
    var bar = document.getElementById('herbalOffline');
    if(!bar && document.body){
      bar = document.createElement('div');
      bar.id = 'herbalOffline';
      bar.setAttribute('role', 'status');
      bar.innerHTML = 'No internet 🛜 <span dir="rtl">— آف لائن: سائٹ چل رہی ہے، AI والے حصے انٹرنیٹ آنے پر چلیں گے</span>';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    if(document.body) document.body.classList.toggle('herbal-offline', navigator.onLine === false);
  }
  window.addEventListener('online', show);
  window.addEventListener('offline', show);
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();

  // ہر صفحے سے آف لائن والی فائل (sw.js) رجسٹر — سائٹ کی جڑ سے
  try{
    if('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/claude|anthropic|usercontent/i.test(location.hostname)){
      var base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/offline\.js(\?.*)?$/, '') : '/';
      window.addEventListener('load', function(){ navigator.serviceWorker.register(base + 'sw.js').catch(function(){}); });
    }
  }catch(e){}
})();
