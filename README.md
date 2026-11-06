# civil-expert-vijay
**Construction AI Expert**: AI construction answers for site workers and engineers, built on 25+ years of concrete, materials and site experience. The name is set in `netlify/functions/brand.js` (AI and WhatsApp), `assets/site-config.js` (page scripts) and the pages' text.

Static pages (`index`, `expert`, `calculators`, `construction-faq`) + Netlify Functions:

| Function | Purpose |
|---|---|
| `chat` | Claude answers (Anthropic API, `@anthropic-ai/sdk`). Adds code-sourced context (`site-engineering-reference.js`, `mix-design-guidance.js`, `cpwd-civil-catalogue.js`, `dubai-rmc-costing.js`, FAQ) when a question matches. Rate limited (`rate-limit.js`). |
| `feedback` | 👍/👎 on answers, stored in Netlify Blobs store `answer-feedback`. |
| `whatsapp` | The same expert on WhatsApp (Meta WhatsApp Business Cloud API). Setup: [docs/WHATSAPP_SETUP.md](docs/WHATSAPP_SETUP.md). Inactive until the `WHATSAPP_*` settings are added. |

### Saved answers (repeat questions cost nothing)
`answer-cache.js` stores each complete answer in the Netlify Blobs store `answer-cache`. The same question asked again is answered from there without calling Claude.
- Reused only for a **first question with no attachment**, with the **same wording** once case, spacing and punctuation are ignored. **Numbers and units must match exactly** ("100 sq ft" ≠ "1000 sq ft", "M25" ≠ "M30"), along with the same language, answer style, quote mode and model.
- Editing the prompt or any knowledge file automatically starts a fresh cache: the key includes the exact text sent to Claude.
- A 👎 deletes that saved answer. Entries expire after 30 days (`ANSWER_CACHE_TTL_DAYS`). Set `ANSWER_CACHE=off` to disable.
- Hits appear in the `chat` function log as `"type":"cache_hit"`.

## One-time Netlify setup
1. **Environment variable** `ANTHROPIC_API_KEY` — create a key at console.anthropic.com → API keys, and add billing credit there. `GEMINI_API_KEY` is no longer used and can be deleted.
   Optional: `EXPERT_MODEL` (default `claude-opus-5-5`; `claude-sonnet-5-5` is about half the cost, `claude-haiku-5-5` about 1/40th), `EXPERT_EFFORT` (default `low` — fastest; `medium` thinks more but is slower), `EXPERT_TIMEOUT_MS` (default 25000).
   Netlify ends a function that runs too long; if answers time out, raise the function timeout in Netlify or switch `EXPERT_MODEL` to Sonnet/Haiku.
2. **Forms → Enable form detection**, then redeploy. The "Expert review" form (`consultation`) needs this. Add an email notification under Forms → Form notifications so requests reach you. (Free plan: 100 submissions/month.)
3. **WhatsApp button**: put your number in `assets/site-config.js` (`whatsappNumber: "9715XXXXXXXX"`).
4. Optional limits (defaults in brackets): `CHAT_LIMIT_PER_IP_HOUR` (30), `CHAT_LIMIT_PER_IP_DAY` (120), `CHAT_LIMIT_SITE_DAY` (2000). `ALLOWED_ORIGINS` for a custom domain, e.g. `www.example.com`.

## Where to see usage
- **Questions asked**: Netlify → Logs → Functions → `chat` (lines with `"type":"question"`). Token use per answer is in `"type":"usage"` lines; spend is in console.anthropic.com → Usage.
- **Answer feedback**: Netlify → Blobs → `answer-feedback` (and `"type":"feedback"` lines in the `feedback` function log).
- **Consultation requests**: Netlify → Forms → `consultation`.

## Adding verified knowledge
- **CPWD DSR items**: `netlify/functions/cpwd-civil-catalogue.js` → `verifiedItems` (template in the file). Only add items checked against the printed page; the AI shows them as verified.
- **Engineering rules**: `netlify/functions/site-engineering-reference.js` — each entry has keywords, a source and short lines.
- **Mix design ranges**: `netlify/functions/mix-design-guidance.js`.
- **Client rates**: follow the pattern of `dubai-rmc-costing.js`.

## Development
```
npm install
npm run build      # builds assets/site.css (Tailwind) — Netlify runs this on deploy
npm test           # unit tests, no network
ANTHROPIC_API_KEY=... npm run eval   # checks real answers (M100 mix, Dubai quote, follow-ups …)
```
Run `npm test` after any change and `npm run eval` after changing prompts or knowledge files.

**From a phone:** GitHub → **Actions → Answer check → Run workflow** runs the same real-Claude checks (group `mep` by default; leave it empty for all). It needs the repository secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions). The full answers appear on the run's summary page.
