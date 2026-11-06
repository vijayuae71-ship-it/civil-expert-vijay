# WhatsApp setup (Meta WhatsApp Business Cloud API)

The code is ready: `netlify/functions/whatsapp.js` answers WhatsApp messages with the same expert as the website (same knowledge, safety rules, rate limits and saved answers). Nothing happens until the settings below are added. Steps 1–5 are easiest on a computer.

## What you need
- A **phone number for the bot** that can receive an SMS or call for verification. It should not be in use on the normal WhatsApp or WhatsApp Business app, unless Meta offers you the *coexistence* option during setup.
- A Facebook account, and about 30–45 minutes.

## 1. Meta Business account
Go to **business.facebook.com** and create a business portfolio, for example "Engineer Vijay", if you don't have one.

## 2. Create the app
1. Go to **developers.facebook.com → My Apps → Create app**.
2. Choose the **Business** type (or the "Connect with customers through WhatsApp" use case), name it, for example "Vijay AI Expert", and link it to your business portfolio.
3. In the app, add the **WhatsApp** product.

## 3. Add the phone number
1. Open **WhatsApp → API Setup**.
2. Meta gives you a free **test number** first. You can test with it straight away by adding your own phone under "To" as a recipient.
3. For the real bot, choose **Add phone number**. Enter the display name ("Vijay's AI Expert"), the category (Professional services) and the number, then verify it by SMS or call.
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
| `WHATSAPP_VERIFY_TOKEN` | any long password you make up, e.g. `vijay-bot-7f3k9q2m` |

Then **redeploy**: Deploys → Trigger deploy → Deploy site. Functions only pick up new settings after a deploy.

## 7. Connect the webhook
1. In the app, open **WhatsApp → Configuration → Webhook → Edit**.
2. Enter:
   - Callback URL: `https://civil-expert-vijay.netlify.app/.netlify/functions/whatsapp`
   - Verify token: the same value as `WHATSAPP_VERIFY_TOKEN`
3. Tap **Verify and save**.
4. Under **Webhook fields**, tap **Subscribe** next to **messages**.

## 8. Test
Send **hi** to the bot number. You should get the welcome guide. Then try:
- `Cement for 100 sq ft plaster?`
- a photo of a crack
- `detailed`, then `M25 rate analysis`
- `new`

If nothing comes back, open **Netlify → Logs → Functions → whatsapp**:
- `Invalid signature`: `WHATSAPP_APP_SECRET` is wrong.
- `WhatsApp is not configured`: the token or phone number ID is missing.
- `WhatsApp send failed: 401`: the token has expired or lacks permissions.

## 9. Go live
- Complete **Business verification** in Meta Business settings, if asked. Until then, sending limits are low.
- Once you're happy with it, put the bot number in `assets/site-config.js` under `whatsappBotNumber`, for example `"9715XXXXXXXX"`. The green **Ask on WhatsApp** buttons then appear on the website.

## How it behaves
- **Answers:** simple steps by default, in the language the user writes in.
- **Photos and files:** photos (JPEG/PNG/WebP) and PDFs, up to 4 MB. Excel and PowerPoint aren't supported on WhatsApp; ask for a PDF or a screenshot instead.
- **Voice notes:** not supported yet. Users get a tip to use the phone keyboard's mic to type.
- **Commands:**
  - `hi` – the welcome guide
  - `new` – start fresh
  - `detailed` / `simple` – change the answer style
  - `consult` – a link to the consultation form
- **Memory:** the last 8 messages per user, for 24 hours. Numbers are stored only as a keyed hash.
- **Limits:** the same as the website (30 questions per hour per user and the site-wide daily cap). Saved answers apply too.

## Costs
- Claude: the same as the website, about 2–3 US cents per answer.
- Meta: under Meta's current pricing, replies within 24 hours of a user's message ("service" messages) are free. Messages the business starts (templates) are charged. The bot only replies, so it shouldn't create template charges. Check Meta's WhatsApp pricing page for your country.

## Known limit
Each answer must finish within Netlify's function time limit. Typical answers take 10–20 seconds. If long answers time out, ask for `simple` answers, or move the reply to a Netlify background function.
