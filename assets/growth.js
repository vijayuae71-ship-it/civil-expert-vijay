/* Growth: where users come from, and every shared file bringing the next user.
 *  - Remembers how this phone first found the site (a ?r= / ?ref= / utm_source link, or the site it
 *    came from), and once a day tells the owner dashboard about the visit: a random device code, that
 *    source, the page and whether the device is new. No names, numbers or questions.
 *  - Growth.link(code) / Growth.madeWith(code): the site link (tagged with where it was shared from)
 *    for the "Made with Construction AI Expert" line on PDFs, Excel files and WhatsApp messages.
 *  - Buttons with data-share-app share the app with a ready message in the person's language.
 */
(function (root) {
  "use strict";
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
  };
  const cfg = root.SITE_CONFIG || {};
  const live = typeof location !== "undefined" && /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname);
  const BASE = String(live ? location.origin : cfg.siteUrl || "https://civilengineervijay.netlify.app").replace(/\/$/, "");
  const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  // Where a visit came from: a tagged link first, else the site that sent it.
  function sourceOf(search, referrer, ownHost) {
    const p = new URLSearchParams(search || "");
    const tagged = clean(p.get("r") || p.get("ref") || p.get("utm_source"));
    if (tagged) return tagged;
    let host = "";
    try { host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : ""; } catch {}
    if (!host || host === ownHost) return "";
    const known = [[/google\./, "google"], [/bing\.com|duckduckgo|yahoo\./, "search-other"], [/whatsapp/, "whatsapp"], [/facebook\.com|fb\.|instagram\.com/, "facebook-instagram"],
      [/youtube\.com|youtu\.be/, "youtube"], [/linkedin\.com|lnkd\.in/, "linkedin"], [/t\.co$|twitter\.com|x\.com/, "x"], [/t\.me|telegram/, "telegram"]];
    const k = known.find(([re]) => re.test(host));
    return k ? k[1] : clean(`site-${host}`);
  }
  const pageOf = (path) => clean(String(path || "/").replace(/\.html$/, "").replace(/^\/+|\/+$/g, "")) || "home";

  const link = (code) => `${BASE}/?r=${clean(code) || "share"}`;
  const madeWith = (code) => `Made with Construction AI Expert (free construction AI) · ${link(code).replace(/^https?:\/\//, "")}`;

  // The share message, in the language the person chose on the Ask AI page (else the phone's).
  const MSG = {
    en: "Try Construction AI Expert — free AI for construction: ask any site question, get a BOQ and quotation from a tender, a bar bending schedule, or a snag list from site photos.",
    hi: "Construction AI Expert आज़माइए — निर्माण के लिए मुफ़्त AI: साइट का कोई भी सवाल पूछें, टेंडर से BOQ और कोटेशन, बार बेंडिंग शेड्यूल, साइट फ़ोटो से स्नैग लिस्ट।",
    kn: "Construction AI Expert ಬಳಸಿ ನೋಡಿ — ನಿರ್ಮಾಣಕ್ಕೆ ಉಚಿತ AI: ಸೈಟ್‌ನ ಯಾವುದೇ ಪ್ರಶ್ನೆ ಕೇಳಿ, ಟೆಂಡರ್‌ನಿಂದ BOQ ಮತ್ತು ಕೊಟೇಶನ್, ಬಾರ್ ಬೆಂಡಿಂಗ್ ಶೆಡ್ಯೂಲ್, ಸೈಟ್ ಫೋಟೋದಿಂದ ಸ್ನ್ಯಾಗ್ ಲಿಸ್ಟ್.",
    ta: "Construction AI Expert-ஐ பயன்படுத்திப் பாருங்கள் — கட்டுமானத்திற்கான இலவச AI: சைட் கேள்விகள், டெண்டரிலிருந்து BOQ மற்றும் கொட்டேஷன், பார் பெண்டிங் ஷெட்யூல், சைட் போட்டோவிலிருந்து ஸ்னாக் லிஸ்ட்.",
    te: "Construction AI Expert ఉపయోగించి చూడండి — నిర్మాణానికి ఉచిత AI: సైట్ ప్రశ్నలు, టెండర్ నుండి BOQ మరియు కొటేషన్, బార్ బెండింగ్ షెడ్యూల్, సైట్ ఫోటో నుండి స్నాగ్ లిస్ట్.",
    ml: "Construction AI Expert ഉപയോഗിച്ചു നോക്കൂ — നിർമ്മാണത്തിനുള്ള സൗജന്യ AI: സൈറ്റ് ചോദ്യങ്ങൾ, ടെൻഡറിൽ നിന്ന് BOQ, ക്വട്ടേഷൻ, ബാർ ബെൻഡിംഗ് ഷെഡ്യൂൾ, സൈറ്റ് ഫോട്ടോയിൽ നിന്ന് സ്നാഗ് ലിസ്റ്റ്.",
    mr: "Construction AI Expert वापरून पहा — बांधकामासाठी मोफत AI: साइटवरील कोणताही प्रश्न, टेंडरमधून BOQ आणि कोटेशन, बार बेंडिंग शेड्यूल, साइट फोटोवरून स्नॅग लिस्ट.",
    bn: "Construction AI Expert ব্যবহার করে দেখুন — নির্মাণের জন্য বিনামূল্যে AI: সাইটের যেকোনো প্রশ্ন, টেন্ডার থেকে BOQ ও কোটেশন, বার বেন্ডিং শিডিউল, সাইটের ছবি থেকে স্ন্যাগ লিস্ট।",
    pa: "Construction AI Expert ਵਰਤ ਕੇ ਦੇਖੋ — ਉਸਾਰੀ ਲਈ ਮੁਫ਼ਤ AI: ਸਾਈਟ ਦਾ ਕੋਈ ਵੀ ਸਵਾਲ, ਟੈਂਡਰ ਤੋਂ BOQ ਅਤੇ ਕੋਟੇਸ਼ਨ, ਬਾਰ ਬੈਂਡਿੰਗ ਸ਼ਡਿਊਲ, ਸਾਈਟ ਫੋਟੋ ਤੋਂ ਸਨੈਗ ਲਿਸਟ।",
    ur: "Construction AI Expert استعمال کر کے دیکھیں — تعمیرات کے لیے مفت AI: سائٹ کا کوئی بھی سوال، ٹینڈر سے BOQ اور کوٹیشن، بار بینڈنگ شیڈول، سائٹ کی تصویر سے اسنیگ لسٹ۔",
    ar: "جرّب Construction AI Expert — ذكاء اصطناعي مجاني للبناء: اسأل أي سؤال عن الموقع، واحصل على جدول كميات وعرض سعر من المناقصة، وجدول تفريد حديد التسليح، وقائمة ملاحظات من صور الموقع."
  };
  function userLang() {
    let pref = "";
    try { pref = (JSON.parse(ls.get("vijay-expert-prefs") || "{}") || {}).language || ""; } catch {}
    const nav = typeof navigator !== "undefined" ? String(navigator.language || "") : "";
    return [pref, nav, nav.slice(0, 2)].find((c) => MSG[c]) || "en";
  }
  const shareText = (lang = userLang()) => `${MSG[lang] || MSG.en}\n${link("share")}`;
  async function shareApp() {
    const text = shareText();
    try { if (navigator.share) { await navigator.share({ text }); return "shared"; } } catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    return "whatsapp";
  }

  // Once a day per device: one anonymous visit record for the owner dashboard.
  function track() {
    if (typeof location === "undefined" || /^\/owner/.test(location.pathname)) return;
    const found = sourceOf(location.search, document.referrer, location.hostname);
    if (!ls.get("cae-src") && !ls.set("cae-src", found || "direct")) return;   // storage blocked: don't count
    let vid = ls.get("cae-vid"), isNew = false;
    if (!/^[a-f0-9]{16,32}$/.test(vid || "")) {
      const b = new Uint8Array(12); (root.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
      vid = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); isNew = true;
      if (!ls.set("cae-vid", vid)) return;
    }
    const d = new Date(), today = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    if (ls.get("cae-visit-day") === today) return;
    ls.set("cae-visit-day", today);
    const body = JSON.stringify({ vid, isNew, ref: ls.get("cae-src") || "direct", page: pageOf(location.pathname), via: found && !isNew ? found : undefined });
    try { fetch("/.netlify/functions/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {}); } catch {}
  }

  if (typeof document !== "undefined") {
    track();
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-share-app]");
      if (b) { e.preventDefault(); shareApp(); }
    });
  }

  const api = { link, madeWith, shareApp, shareText, sourceOf, pageOf, clean, MSG, BASE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Growth = api;
})(typeof self !== "undefined" ? self : this);
