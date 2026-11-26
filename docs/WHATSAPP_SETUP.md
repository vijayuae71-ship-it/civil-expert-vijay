# WhatsApp setup (Meta WhatsApp Business Cloud API)

The code is ready: `netlify/functions/whatsapp.js` answers WhatsApp messages with the same expert as the website (same knowledge, safety rules, rate limits and saved answers). Nothing happens until the settings below are added. Steps 1–5 are easiest on a computer.

## What you need
- A **phone number for the bot** that can receive an SMS or call for verification. It should not be in use on the normal WhatsApp or WhatsApp Business app, unless Meta offers you the *coexistence* option during setup.
- A Facebook account, and about 30–45 minutes.

## 1. Meta Business account
Go to **business.facebook.com** and create a business portfolio in your company's legal name if you don't have one.

## 2. Create the app
1. Go to **developers.facebook.com → My Apps → Create app**.
2. Choose the **Business** type (or the "Connect with customers through WhatsApp" use case), name it, for example "Construction AI Expert", and link it to your business portfolio.
3. In the app, add the **WhatsApp** product.

## 3. Add the phone number
1. Open **WhatsApp → API Setup**.
2. Meta gives you a free **test number** first. You can test with it straight away by adding your own phone under "To" as a recipient.
3. For the real bot, choose **Add phone number**. Enter the display name ("Construction AI Expert"), the category (Professional services) and the number, then verify it by SMS or call.
4. Copy the **Phone number ID**. It's a long number shown on the API Setup page.

## 4. Permanent access token
The token shown on the API Setup page expires after 24 hours, so create a permanent one:
1. Open **business.facebook.com → Settings → Users → System users → Add**. Name it, for example "whatsapp-bot", with the role **Admin**.
2. **Assign assets** → your app (full control) and your WhatsApp account (full control).
3. **Generate token**:
   - App: your app
   - Expiry: **Never**
   - Permissions: `whatsapp_business_messaging` and `whatsapp_business_management`
4. Copy the token. It's shown only once.

## 5. App secret
In the app, open **App settings → Basic → App secret → Show**, and copy it.

## 6. Add the settings in Netlify
Go to **Project configuration → Environment variables**. Tick **Contains secret values** for the token and the secret.

| Key | Value |
|---|---|
| `WHATSAPP_TOKEN` | the permanent token from step 4 |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID from step 3 |
| `WHATSAPP_APP_SECRET` | the App secret from step 5 |
| `WHATSAPP_VERIFY_TOKEN` | any long password you make up, e.g. `site-bot-7f3k9q2m` |

Then **redeploy**: Deploys → Trigger deploy → Deploy site. Functions only pick up new settings after a deploy.

## 7. Connect the webhook
1. In the app, open **WhatsApp → Configuration → Webhook → Edit**.
2. Enter:
   - Callback URL: `https://civilengineervijay.netlify.app/.netlify/functions/whatsapp`
   - Verify token: the same value as `WHATSAPP_VERIFY_TOKEN`
3. Tap **Verify and save**.
4. Under **Webhook fields**, tap **Subscribe** next to **messages**.

## 8. Test
Send **hi** to the bot number. You should get the welcome guide. Then try:
- `Cement for 100 sq ft plaster?`
- a photo of a crack
- `detailed`, then `M25 rate analysis`
- `new`
- forward a tender PDF with the caption `tender`: you should get a link that opens it in the Quotation page

If nothing comes back, open **Netlify → Logs → Functions → whatsapp**:
- `Invalid signature`: `WHATSAPP_APP_SECRET` is wrong.
- `WhatsApp is not configured`: the token or phone number ID is missing.
- `WhatsApp send failed: 401`: the token has expired or lacks permissions.

## 9. Go live
- Complete **Business verification** in Meta Business settings, if asked. Until then, sending limits are low.
- Once you're happy with it, put the bot number in `assets/site-config.js` under `whatsappBotNumber`, for example `"9715XXXXXXXX"`. The green **Ask on WhatsApp** buttons then appear on the website.

## How it behaves
- **Answers:** simple steps by default, in the language the user writes in.
- **Photos and files:** photos (JPEG/PNG/WebP) and PDFs, up to 4 MB, are answered like questions. PowerPoint isn't supported; ask for a PDF or a screenshot instead.
- **Tenders and price lists:** a tender/BOQ or supplier price list (PDF, Excel or photos) sent with the caption `tender` or `prices` (or `BOQ`, `price list`, `rate list`, `catalogue`) isn't answered in chat. The bot replies with a link that opens it in the Quotation page: a tender goes into the Quotation tools, a price list into 📦 Material prices. A file sent without a caption can be linked afterwards by replying `tender` or `prices`. Excel files without a caption get that question straight away. The file is kept in the Netlify Blobs store `wa-imports` for 7 days under a secret link (served by the `wa-import` function), then deleted.
- **Voice notes:** not supported yet. Users get a tip to use the phone keyboard's mic to type.
- **Commands:**
  - `hi` – the welcome guide
  - `new` – start fresh
  - `detailed` / `simple` – change the answer style
  - `consult` – a link to the expert-review form
  - `tender` / `prices` – open the last file sent in the Quotation tools
- **Memory:** the last 8 messages per user, for 24 hours. Numbers are stored only as a keyed hash.
- **Limits:** the same as the website (30 questions per hour per user and the site-wide daily cap). Saved answers apply too.

## Costs
- Claude: the same as the website, about 2–3 US cents per answer.
- Meta: under Meta's current pricing, replies within 24 hours of a user's message ("service" messages) are free. Messages the business starts (templates) are charged. The bot only replies, so it shouldn't create template charges. Check Meta's WhatsApp pricing page for your country.

## Long answers
The webhook (`whatsapp` function) only checks the message and hands it to `whatsapp-background`, a Netlify background function that may run for up to 15 minutes, so Meta gets its reply at once and long answers (detailed BOQs, PDFs, photos) are not cut off. Only a random job id is passed between the two (the message waits in the Blobs store `wa-jobs`), so the background function can't be used to send messages. While an answer is prepared the bot keeps the "typing…" indicator on; if it takes more than 15 seconds it sends one "⏳ Working on your answer — this can take 1–2 minutes." (WhatsApp messages can't be edited, so there is no running percentage). If the hand-over ever fails, the message is answered in the webhook as before.


## Trade links (plumbers, painters, contractors …)

Every trade has its own page — `/for/plumber`, `/for/electrician`, `/for/mason`, `/for/painter`, `/for/tiler`, `/for/carpenter`, `/for/bar-bender`, `/for/waterproofing`, `/for/ac-technician`, `/for/site-engineer`, `/for/contractor`, `/for/consultant` (all listed at `/for/`). Once the bot number is set in `assets/site-config.js`, each page shows **Ask on WhatsApp**, which opens the chat with a greeting such as *"Hi! I am a plumber 🔧"*.

The bot recognises that first message: it remembers the trade (even after `new`), sends a welcome with example questions and the link to that trade's page, and pitches every later answer at that trade. To share in a trade's WhatsApp group, send the trade page link (e.g. `https://civilengineervijay.netlify.app/for/plumber?r=plumbers-group`), or the direct chat link `https://wa.me/<bot number>?text=Hi!%20I%20am%20a%20plumber%20%F0%9F%94%A7`. The `?r=…` tag shows up on the owner dashboard under *Where new users came from*.

## Capacity, limits and the daily AI budget

Website and WhatsApp share the same limits, set on the owner dashboard (`/owner`) → **Limits & budget** (or, as defaults, the Netlify variables `CHAT_LIMIT_SITE_DAY`, `CHAT_LIMIT_PER_IP_HOUR`, `CHAT_LIMIT_PER_IP_DAY`, `CHAT_DAILY_BUDGET_USD`):

- Questions per day for the whole site (default 2,000 ≈ 400–650 people asking on the same day).
- Per person: 30 an hour, 120 a day (on WhatsApp a person = a phone number).
- Daily AI budget in US$ (0 = off): the app adds each answer's estimated AI cost to today's total; once it is reached, new questions get "try again tomorrow" until midnight UTC.

The dashboard shows today's questions and estimated spend against these limits. Keep a monthly spending limit in the Anthropic console as well — it is the hard stop.
