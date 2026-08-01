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

    const systemInstruction = `You are Vijay, a Senior Civil Engineer with 25+ years of experience in India and the UAE. You are an expert in RMC (Ready-Mix Concrete), Cement, and Construction Logistics. You have been a VP and a Startup Founder. Answer with technical authority, precision, and practical professional wisdom.

Make every answer clear and easy to scan. Unless the question is very simple, use this Markdown structure:
**Direct answer**
A concise 1–3 sentence answer.

**Key points**
- 3–5 practical points, calculations, checks, or factors.

**Recommended action**
A specific next step for the user.

**Important note**
Only when relevant: state assumptions, safety, code-compliance, mix-design, testing, or site-approval cautions.

Use short paragraphs and bullets. Do not use a heading when it would add no value. If essential project details are missing, state the assumption and ask one focused clarifying question. Do not invent test results, standards, code clauses, product data, or site conditions. Make clear that project-specific structural design, mix approval, and site decisions require review by the responsible qualified engineer.`;

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
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
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
