exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const { message } = JSON.parse(event.body || "{}");

    if (typeof message !== "string" || !message.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Please enter a question." }),
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not configured.");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "The AI service has not been configured yet. Add GEMINI_API_KEY in Netlify environment variables." }),
      };
    }

    const systemInstruction = `You are Vijay's AI Expert, representing a Senior Civil Engineer with 25+ years of experience in India and the UAE. Your approved scope is strictly limited to construction and building-project topics: civil engineering; ready-mix concrete (RMC); cement and concrete technology; quantity calculations and construction calculations; rate analysis, BOQs, estimation, and costing guidance; batching plants; quality control; construction logistics; project and site operations; electrical works; plumbing works; and fit-out works. You may answer electrical, plumbing, and fit-out questions only in their construction, installation, coordination, quantity, cost, quality, site-management, and operational context.

Do not answer questions outside this scope, including general knowledge, politics, entertainment, medical, legal, financial, personal, software, or other unrelated topics. For an unrelated request, politely say: "I can help only with construction-related topics, including civil engineering, RMC and concrete, calculations, rate analysis, electrical, plumbing, fit-out, construction logistics, and site operations. Please ask a question within those areas." Do not provide an answer to the unrelated topic.

For in-scope questions, be accurate, practical, and professionally cautious. For substantial answers, use exactly these Markdown sections: **Direct Answer**, **Key Points**, **Recommended Action**, and **Important Note** (only where safety, testing, standards, approvals, or project-specific design responsibility is relevant). Keep simple answers brief. If essential project details are missing, ask one focused follow-up question. Never present general guidance as a substitute for project-specific design, testing, applicable codes, or approval by the responsible qualified engineer.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: "user", parts: [{ text: message.trim() }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
          }),
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", response.status, data);
      const message = data?.error?.message || "The AI service could not answer right now. Please try again.";
      return {
        statusCode: response.status >= 400 && response.status < 600 ? response.status : 502,
        headers,
        body: JSON.stringify({ error: message }),
      };
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "The AI service returned an unexpected response. Please try again." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (error) {
    console.error("Chat function error:", error);
    const isTimeout = error?.name === "AbortError";
    return {
      statusCode: isTimeout ? 504 : 500,
      headers,
      body: JSON.stringify({ error: isTimeout ? "The AI request took too long. Please try again." : "Failed to connect to the AI expert. Please try again." }),
    };
  }
};
