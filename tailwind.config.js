/** Classes are scanned from every page, including class strings inside page scripts. */
module.exports = {
  content: ["./*.html", "./for/*.html", "./assets/*.js", "./scripts/build-trade-pages.js"],
  theme: { extend: {} },
  plugins: []
};
