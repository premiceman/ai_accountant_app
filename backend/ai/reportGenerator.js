const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generates a financial insight report using GPT
 * @param {Object} userData - The user's financial profile and transactions
 * @returns {Promise<string>} - A natural language summary
 */
async function generateReport(userData) {
  console.log('🚀 Calling OpenAI with this data:', JSON.stringify(userData, null, 2));
  console.log('🔑 Key present?', !!process.env.OPENAI_API_KEY);

  const prompt = `
You are a UK-based personal accountant. Analyze the user's financial profile and recommend:

1. Any missing or underutilized tax allowances  
2. Summary of income and expenses  
3. Suggestions to improve financial health

User Data:
${JSON.stringify(userData, null, 2)}

Respond in clear, helpful English.
  `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are an expert UK personal accountant.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 700
  });

  console.log('✅ Got OpenAI response!');
  return completion.choices[0].message.content;
}

module.exports = generateReport;
