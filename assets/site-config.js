// Site-wide settings. Fill these in to switch on the matching buttons.
window.SITE_CONFIG = {
  // Product name used by page scripts (exports, share text). Page text uses the same name.
  brandName: "Construction AI Expert",
  // WhatsApp number for expert-review requests, international format, digits only,
  // e.g. "9715XXXXXXXX". Leave empty to hide the "WhatsApp us" buttons.
  whatsappNumber: "",
  // The AI expert's WhatsApp Business number (the bot). Leave empty to hide "Ask on WhatsApp".
  whatsappBotNumber: "",
  siteUrl: "https://civil-expert-vijay.netlify.app"
};

// Shows "Ask on WhatsApp" links (elements with data-wa-bot) once the bot number is set.
document.addEventListener("DOMContentLoaded", () => {
  const n = String(window.SITE_CONFIG.whatsappBotNumber || "").replace(/\D/g, "");
  if (!n) return;
  document.querySelectorAll("[data-wa-bot]").forEach((el) => {
    el.href = `https://wa.me/${n}?text=${encodeURIComponent("Hi")}`;
    el.target = "_blank"; el.rel = "noopener";
    el.classList.remove("hidden");
  });
});
