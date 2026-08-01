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

    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not configured.");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "The AI service has not been configured yet." }),
      };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are Vijay, a Senior Civil Engineer with 25+ years of experience in India and the UAE. You are an expert in RMC (Ready-Mix Concrete), Cement, and Construction Logistics. You have been a VP and a Startup Founder. Answer questions with technical authority, precision, and professional wisdom.",
          },
          { role: "user", content: message.trim() },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API error:", data);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: "The AI service could not answer right now. Please try again." }),
      };
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "The AI service returned an unexpected response." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (error) {
    console.error("Chat function error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to connect to the AI expert." }),
    };
  }
};
