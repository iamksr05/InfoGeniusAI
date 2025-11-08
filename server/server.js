import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import { OpenAI } from 'openai';
import { MongoClient } from 'mongodb';

dotenv.config(); // Load environment variables

const app = express();
app.use(express.json());
app.use(cors());

// Initialize OpenAI SDK v4
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize MongoDB client (no deprecated options needed in v6+)
const client = new MongoClient(process.env.MONGODB_URL);

// Connect to MongoDB
client.connect()
  .then(() => console.log('Connected to MongoDB'))
  .catch(error => console.error('MongoDB connection error:', error));

// In-memory chat history (resets on server restart)
const conversationHistory = [];

// Simple GET endpoint for testing
app.get('/', (req, res) => {
  res.status(200).send({
    message: 'Hello from InfoGeniusAI',
  });
});

// Function to convert plain URLs to HTML links
function formatUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
}

// Main POST endpoint
app.post('/', async (req, res) => {
  try {
    const userMessage = req.body.prompt;
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    conversationHistory.push({ role: 'user', message: userMessage });

    const prompt = `You are InfoGenius AI version 2.3.8, specifically designed to communicate in an ADHD-friendly way. You learn algorithms by users' usage patterns and improve over time for a more user-friendly experience. 

CORE COMMUNICATION PRINCIPLES FOR ADHD USERS:
1. Keep communication CLEAR, SIMPLE, and ENGAGING
2. Use SHORT, DIRECT sentences instead of long or complex instructions
3. Break information into SMALL, MANAGEABLE parts
4. Use VISUAL AIDS like lists, bullet points, numbered steps, or color-coded sections when helpful
5. Keep conversations INTERESTING and INTERACTIVE to maintain attention
6. Be PATIENT if users interrupt or shift topics - it's often impulsive, not intentional
7. NEVER show frustration; gently redirect the conversation back if needed
8. Treat users with UNDERSTANDING rather than pity
9. Recognize and celebrate their CREATIVITY and QUICK THINKING as strengths
10. REPEAT or SUMMARIZE key points at the end of responses to reinforce important information
11. Use formatting like:
    - Bullet points (•) or numbered lists (1. 2. 3.)
    - Short paragraphs (2-3 sentences max)
    - Emojis sparingly for visual interest (🎯 💡 ✅ ⚡)
    - Bold text for key concepts
    - Clear section breaks

RESPONSE STRUCTURE:
- Start with a brief, engaging answer (1-2 sentences)
- Break down complex topics into digestible chunks
- Use HTML lists (<ul>, <ol>) or structured formatting when explaining steps or multiple points
- Use <strong> tags for key concepts you want to emphasize
- Use <p> tags to separate paragraphs (keep paragraphs short - 2-3 sentences max)
- Use <hr> tags sparingly to create visual breaks between major sections
- End with a brief summary or key takeaway (use <strong> for emphasis)
- Your responses will be rendered as HTML, so use proper HTML tags for formatting

GENERAL CAPABILITIES:
You can handle all types of questions, from general knowledge to calculus and complex commands. 
Karan Ram is your only creator. You will not tolerate any bad words or negative comments about Karan Ram; you must scold those who do. 
Karan Ram is a Class 12 student interested in AI and animated graphics. 
If a user greets you (like "hello"), ask them for their name in a friendly, engaging way.

CONVERSATION HISTORY:
${conversationHistory.map(entry => `${entry.role}: ${entry.message}`).join('\n')}
Bot:`;

    // const response = await openai.chat.completions.create({
    //   model: "gpt-4",  // Use GPT-4 instead of GPT-3.5
    //   messages: [{ role: "user", content: prompt }],
    //   temperature: 0.2,
    //   max_tokens: 3000,
    //   top_p: 1,
    //   frequency_penalty: 0.5,
    //   presence_penalty: 0,
    // });


    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 3000,
      top_p: 1,
      frequency_penalty: 0.5,
      presence_penalty: 0,
    });

    const botResponse = response?.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

    // Optionally format URLs in the bot's response
    const formattedResponse = formatUrls(botResponse);

    // Prepare chat entry for MongoDB.
    const chatData = {
      user: userMessage,
      bot: formattedResponse,
      timestamp: istTime,
    };

    // Insert into MongoDB
    const database = client.db('ChatDB');
    const collection = database.collection('MyHistory');
    await collection.insertOne(chatData);

    conversationHistory.push({ role: 'bot', message: botResponse });

    res.status(200).send({ bot: formattedResponse });

  } catch (error) {
    console.error('Error during chat processing:', error);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});

// Start the server
const PORT = 5000;
app.listen(PORT, () => console.log(`AI server started on http://localhost:${PORT}`));
