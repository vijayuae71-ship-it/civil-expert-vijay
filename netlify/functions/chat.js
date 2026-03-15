const fetch = require('node-fetch');

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { message } = JSON.parse(event.body);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: "You are Vijay, a Senior Civil Engineer with 25+ years of experience in India and the UAE. You are an expert in RMC (Ready-Mix Concrete), Cement, and Construction Logistics. You have been a VP and a Startup Founder. Answer questions with technical authority, precision, and professional wisdom." 
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: data.choices[0].message.content }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to connect to the AI expert." }),
    };
  }
};

