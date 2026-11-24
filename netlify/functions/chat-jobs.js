"use strict";
// Results of long answers (full BOQs) made by chat-background.js, read by chat-status.js.
// Netlify Blobs store "chat-jobs"; each result is deleted once the page has read it.

const STORE_NAME = "chat-jobs";
const MAX_AGE_MS = 30 * 60 * 1000;
const requestKey = (id) => `req/${id}`;   // the stored question, read once by chat-background.js
const isJobId = (id) => typeof id === "string" && /^[a-f0-9-]{32,40}$/i.test(id);

function openJobStore(event) {
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return getStore(STORE_NAME);
  } catch {
    return null;
  }
}

module.exports = { STORE_NAME, MAX_AGE_MS, isJobId, requestKey, openJobStore };
