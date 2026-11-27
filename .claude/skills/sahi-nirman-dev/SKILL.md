---
name: sahi-nirman-dev
description: How to change, test and ship the Sahi Nirman app (this repository) — brand and product rules, the build and test steps, phone-size checks, and the PR and Netlify deploy routine. Use for any code, page, WhatsApp, marketplace or owner-dashboard change in this repo.
---

# Sahi Nirman — working on this repository

Sahi Nirman ("sahi jawab · sahi rate · sahi delivery") is one product with three parts:
- **Ask:** construction answers (web and WhatsApp), calculators, BOQ and quotations, tender import, consultant tools (snag list from photos, BBS, specs).
- **Mart:** material requests sent to up to 3 nearby approved suppliers (same city, serving the PIN, stocking the category), who quote by private link.
- **Deliver:** the customer chooses, the supplier confirms → dispatches → delivers, the customer rates.

Users are Indian site workers (masons, plumbers, electricians, painters…), contractors, consultants and material dealers, often on low-end Android phones and WhatsApp, in many languages.

## Product rules (do not break)

1. **Name:** always "Sahi Nirman" in full (never "Sahi" alone — a large trading app owns that). The product name lives in `netlify/functions/brand.js` (env `EXPERT_BRAND_NAME` overrides it) and `assets/site-config.js` → `brandName`.
2. **Never name the AI model or provider** (Claude, Anthropic, OpenAI, Gemini…) in anything users see: answers, pages, WhatsApp text, PDFs, Excel files.
3. **No cement in the marketplace:** cement, OPC/PPC/PSC, GGBS, RMC/ready-mix, concrete, PCC/RCC and mortar are excluded (`EXCLUDED` in `assets/leads.js`). Concrete *blocks* are allowed. This keeps the owner clear of a conflict with his employer.
4. **Customer privacy:** suppliers see only materials, area and PIN until the customer chooses them; only the chosen supplier gets name and mobile.
5. **Keep old internal ids** so saved data keeps working: backup `app: "construction-ai-expert"`, `cae-` localStorage keys, the privacy salt in `rate-limit.js`.
6. Cite sources (CPWD DSR item numbers, IS code clauses) when the reference library supplies them; never copy third-party paid content into the app without written permission.

## Stack

Static pages (Tailwind, built to `assets/site.css`) + Netlify Functions (CommonJS, esbuild) + Netlify Blobs stores (`leads`, `usage-events`, `chat-rate-limit`, …). Owner endpoints need the `x-owner-key` header. Marketplace logic: `netlify/functions/market.js`, `lead.js`, `quote.js`, `supplier-panel.js`, `owner-providers.js`, `owner-leads.js`.

## Before every push

1. `npm run build:css` when page classes changed (`npm run build` also fingerprints assets; Netlify runs it).
2. `npm test` — all tests must pass. Add tests for new functions and for new redirects in `tests/pages.test.js`.
3. If any page, script or style a phone may have cached changed, bump `VERSION` in `sw.js` (`cae-vN` → `cae-vN+1`) and add new pages/scripts to its `CORE` list.
4. **Phone-size check** with Playwright (Pixel 7, `serviceWorkers: "block"`) against `python3 -m http.server 8765`: no page errors, nothing cut off or overflowing, buttons wrap. Test real functions by routing `/.netlify/functions/*` to the handlers in Node.
5. Plain words in the UI: short labels a site worker understands; no developer terms.

## Shipping

- **Group related changes into one PR.** Each merge costs a Netlify production build (build credits are limited).
- Develop on the session's branch; never force-push.
- After the owner merges: check Netlify → Deploys. If the production deploy shows **Skipped**, the owner uses **Trigger deploy → Deploy site**. The sandbox cannot open the live site, so ask for a screenshot to confirm.
- Deploy previews share the live Blobs data, and environment variables must include the Deploy Previews context to work there.
- Mention any new Netlify environment variable, WhatsApp template or owner step in the PR body and in `docs/WHATSAPP_SETUP.md`.
