"use strict";
// Fake Claude client for tests: records each request and returns a canned reply.
// reply can be a string, a function (callNumber) => string | { stop_reason, text }, or throw.
function fakeClaude(chat, reply = "**Recommendation**\nOK.") {
  const calls = [];
  chat.setClientForTests({
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          let r = typeof reply === "function" ? reply(calls.length, params) : reply;
          if (typeof r === "string") r = { text: r };
          return {
            model: params.model,
            stop_reason: r.stop_reason || "end_turn",
            content: r.stop_reason === "refusal" ? [] : [{ type: "thinking", thinking: "" }, { type: "text", text: r.text }],
            usage: { input_tokens: 10, output_tokens: 5 }
          };
        }
      }
    }
  });
  return calls;
}
const systemText = (params) => (Array.isArray(params.system) ? params.system.map((b) => b.text).join("\n") : params.system);
const lastUserText = (params) => { const c = params.messages.at(-1).content; return Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("") : c; };
const post = (body, headers = {}) => ({ httpMethod: "POST", headers: { host: "constructionaiexpert.netlify.app", ...headers }, body: JSON.stringify(body) });
module.exports = { fakeClaude, systemText, lastUserText, post };
