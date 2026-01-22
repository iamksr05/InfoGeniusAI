import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

dotenv.config(); // Load environment variables

const app = express();
app.use(express.json());
app.use(cors());

// Check for required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set in .env file');
  console.error('Please create a .env file with: OPENAI_API_KEY=your_key_here');
  process.exit(1);
}

// Initialize OpenAI SDK v4
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Gemini SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyAHviGdYbuQZgQ8HzLiNiCqTNwmyHx8DrY");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Initialize MongoDB client (no deprecated options needed in v6+)
let client = null;
let mongoConnected = false;

if (process.env.MONGODB_URL) {
  client = new MongoClient(process.env.MONGODB_URL);
} else {
  console.warn('WARNING: MONGODB_URL not set. Using in-memory storage only.');
}

// Connect to MongoDB (if URL is provided)
if (client) {
  client.connect()
    .then(() => {
      mongoConnected = true;
      console.log('Connected to MongoDB');
    })
    .catch(error => {
      console.error('MongoDB connection error:', error.message);
      console.log('Falling back to in-memory storage');
      mongoConnected = false;
    });
} else {
  console.log('MongoDB not configured. Using in-memory storage only.');
}

// In-memory fallback (resets on restart). Primary history is stored in MongoDB per sessionId.
const conversationHistory = new Map(); // sessionId -> [{role, message, ts}]

// Simple GET endpoint for testing
app.get('/', (req, res) => {
  res.status(200).send({
    message: 'Hello from InfoGeniusAI',
  });
});

const SYSTEM_PROMPT = `You are InfoGenius AI, built and developed by Karan Ram.

About You:
- You are InfoGenius AI, a multipurpose AI assistant created by Karan Ram.
- When asked about your creator, developer, or who built you, always mention that you were built by Karan Ram.
- You can acknowledge Karan Ram as your developer/creator when relevant to the conversation.

Goals:
- Be helpful, direct, and solution-oriented. You excel at complex coding challenges, algorithms, and technical problem-solving.
- NEVER reply with "I don't have code" or "I can't" for programming requests. Always provide working, well-documented code examples.
- For coding questions: Provide complete, production-ready code with proper error handling, comments, and best practices. Use Markdown triple backticks with appropriate language tags (e.g. \`\`\`javascript, \`\`\`python, \`\`\`cpp).
- For complex algorithms: Explain the approach, time/space complexity, and provide optimized solutions.
- If math is involved: use LaTeX delimiters ($...$ for inline, $$...$$ for display).
- Provide clickable URLs as plain text (the client will auto-link). Prefer short relevant links only when necessary.
- If asked for up-to-date real-world facts: be transparent that you may be outdated and suggest what to verify, but still provide best-effort guidance.

Style:
- Use concise headings and bullet points when helpful.
- For code: Include explanations, edge cases, and optimization tips.
- Avoid filler apologies; focus on solutions and technical excellence.`;

function toOpenAIRole(role) {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  if (role === 'bot') return 'assistant'; // backward compat
  return 'user';
}

// Helper function to get or create session history
function getSessionHistory(sessionId) {
  if (!conversationHistory.has(sessionId)) {
    conversationHistory.set(sessionId, []);
  }
  return conversationHistory.get(sessionId);
}

// Main POST endpoint
app.post('/', async (req, res) => {
  try {
    const userMessage = req.body.prompt;
    const sessionId = (req.body.sessionId && String(req.body.sessionId)) || 'default';
    const modelProvider = req.body.model || 'openai'; // 'openai' or 'gemini'
    const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    let recentHistory = [];

    // Try MongoDB first, fallback to in-memory
    if (mongoConnected && client) {
      try {
        const database = client.db('ChatDB');
        const collection = database.collection('MyHistory');
        const now = new Date();

        // Persist user message
        await collection.insertOne({
          sessionId,
          role: 'user',
          content: userMessage,
          timestamp: istTime,
          ts: now,
        });

        // Get recent history
        const recentDocs = await collection
          .find({ sessionId })
          .sort({ ts: 1 })
          .limit(40)
          .toArray();

        recentHistory = recentDocs
          .slice(-20)
          .map((d) => ({ role: d.role, message: d.content }));
      } catch (mongoError) {
        console.error('MongoDB operation failed, using in-memory fallback:', mongoError);
        mongoConnected = false; // Mark as disconnected for future requests
        // Fall through to in-memory logic
      }
    }

    // Fallback to in-memory history if MongoDB is not available
    if (!mongoConnected || recentHistory.length === 0) {
      const sessionHistory = getSessionHistory(sessionId);
      sessionHistory.push({ role: 'user', message: userMessage, ts: Date.now() });
      recentHistory = sessionHistory.slice(-20);
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recentHistory.map((entry) => ({
        role: toOpenAIRole(entry.role),
        content: entry.message,
      })),
    ];



    let botResponse = "Sorry, I couldn't generate a response.";

    if (modelProvider === 'gemini') {
      // Gemini Logic
      // 1. Exclude the last message (current user prompts) because sendMessage handles it.
      // 2. Ensure alternating roles.
      // The prefix history ends with 'model', so the next message must be 'user'.

      let historyForGemini = recentHistory.slice(0, -1); // Remove the current user message that was just added

      // If the remaining history starts with 'assistant' (model), remove it to avoid model-model sequence
      if (historyForGemini.length > 0 && historyForGemini[0].role === 'assistant') {
        historyForGemini.shift();
      }

      const geminiHistory = historyForGemini.map(entry => ({
        role: entry.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: entry.message }]
      }));

      const chat = geminiModel.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT.replace("You are InfoGenius AI", "You are InfoGenius AI (powered by Gemini)") }]
          },
          {
            role: "model",
            parts: [{ text: "Understood. I am InfoGenius AI, ready to help." }]
          },
          ...geminiHistory
        ],
        generationConfig: {
          maxOutputTokens: 2000,
        },
      });

      const result = await chat.sendMessage(userMessage);
      const response = await result.response;
      botResponse = response.text();
    } else {
      // OpenAI Logic
      // Using GPT-3.5 Turbo for cost-effective responses
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages,
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 1,
        frequency_penalty: 0.5,
        presence_penalty: 0,
      });
      botResponse = response?.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
    }

    // botResponse already set above

    // Persist assistant message (MongoDB or in-memory)
    if (mongoConnected && client) {
      try {
        const database = client.db('ChatDB');
        const collection = database.collection('MyHistory');
        await collection.insertOne({
          sessionId,
          role: 'assistant',
          content: botResponse,
          timestamp: istTime,
          ts: new Date(),
        });
      } catch (mongoError) {
        console.error('Failed to save assistant message to MongoDB:', mongoError);
        // Fall through to in-memory
      }
    }

    // Always update in-memory history as backup
    const sessionHistory = getSessionHistory(sessionId);
    sessionHistory.push({ role: 'assistant', message: botResponse, ts: Date.now() });
    // Keep only last 50 messages in memory
    if (sessionHistory.length > 50) {
      sessionHistory.shift();
    }

    res.status(200).send({ bot: botResponse });

  } catch (error) {
    console.error('Error during chat processing:', error);
    fs.appendFileSync('server_error.log', `${new Date().toISOString()} - Error: ${error.message}\n${error.stack}\n\n`);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nAI server started on port ${PORT}`);
  if (process.env.PORT) {
    console.log(`Server is running on Render/hosted environment`);
  } else {
    console.log(`Local server: http://localhost:${PORT}`);
  }
});