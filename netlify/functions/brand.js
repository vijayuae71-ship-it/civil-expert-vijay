"use strict";
// The product name used in AI answers and WhatsApp messages.
// Change it here (or with the EXPERT_BRAND_NAME setting in Netlify). The website's
// static text uses the same name; page scripts read assets/site-config.js → brandName.
const BRAND_NAME = process.env.EXPERT_BRAND_NAME || "Construction AI Expert";
module.exports = { BRAND_NAME };
