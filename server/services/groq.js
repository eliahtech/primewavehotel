// server/services/groq.js
// Replaces the GAS UrlFetchApp.fetch(...) call to the Groq API.
// Node has no built-in UrlFetchApp — we use the global fetch()
// (built into Node 18+; if you're on an older Node, run
// `npm install node-fetch` and add: const fetch = require("node-fetch");
// at the top of this file).

const { GROQ_API_URL, GROQ_MODEL } = require("../config/hotelConfig");

/**
 * Calls Groq's chat completions endpoint.
 * @param {Array<{role:string, content:string}>} messages - full message list incl. system prompt
 * @returns {Promise<string|null>} the assistant's reply text, or null on failure
 */
async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.warn("[Groq] GROQ_API_KEY not set — skipping, caller should fall back.");
    return null;
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + apiKey,
      "Accept":        "application/json",
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages:    messages,
      max_tokens:  400,
      temperature: 0.4, // lower = more consistent, professional tone
      stream:      false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[Groq] API error ${response.status}: ${errText.slice(0, 200)}`);
    return null;
  }

  const data  = await response.json();
  const reply = data?.choices?.[0]?.message?.content;

  return reply && reply.trim() ? reply.trim() : null;
}

module.exports = { callGroq };
