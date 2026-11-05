"use strict";
// Shared fake Gemini for tests: records each request body and returns a canned reply.
function fakeGemini(replyText = "**Recommendation**\nOK.") {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    const text = typeof replyText === "function" ? replyText(calls.length) : replyText;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
  return calls;
}
const post = (body, headers = {}) => ({ httpMethod: "POST", headers: { host: "civil-expert-vijay.netlify.app", ...headers }, body: JSON.stringify(body) });
module.exports = { fakeGemini, post };
