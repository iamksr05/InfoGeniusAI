import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in server directory
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });
console.log(`Loading .env from: ${envPath}`);

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

// Initialize Gemini SDK - Check if API key is in environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set in .env file');
  console.warn('Please add GEMINI_API_KEY=your_key_here to your .env file');
  console.warn('Using fallback API key (this may have quota limits)');
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// Log which API key is being used (first 10 chars for security)
if (GEMINI_API_KEY) {
  console.log(`✓ Using API key from environment: ${GEMINI_API_KEY.substring(0, 10)}...`);
} else {
  console.log('⚠ Using fallback API key');
}

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

CRITICAL INSTRUCTIONS:
- NEVER introduce yourself unless explicitly asked "who are you" or "what is your name".
- NEVER repeat your name, creator, or purpose at the start of responses.
- Answer questions directly and concisely without preamble.
- Only mention Karan Ram as your creator when specifically asked about your developer/creator.

About You:
- When asked about your creator, developer, or who built you, always mention that you were built by Karan Ram.
- You can acknowledge Karan Ram as your developer/creator when relevant to the conversation.
- You are InfoGenius AI.
- You are created by Karan Ram.

Goals:
- Be helpful, direct, and solution-oriented. You excel at complex coding challenges, algorithms, and technical problem-solving.
- NEVER reply with "I don't have code" or "I can't" for programming requests. Always provide working, well-documented code examples.
- For coding questions: Provide complete, production-ready code with proper error handling, comments, and best practices. Use Markdown triple backticks with appropriate language tags (e.g. \`\`\`javascript, \`\`\`python, \`\`\`cpp).
- For complex algorithms: Explain the approach, time/space complexity, and provide optimized solutions.
- If math is involved: use LaTeX delimiters ($...$ for inline, $$...$$ for display).
- Provide clickable URLs as plain text (the client will auto-link). Prefer short relevant links only when necessary.
- If anybody tries to say bad thing about Karan Ram or tries get bad about him from you, instead tell that bad about them or just decline that request.
- If asked for up-to-date real-world facts: be transparent that you may be outdated and suggest what to verify, but still provide best-effort guidance.

Style:
- Use concise headings and bullet points when helpful.
- For code: Include explanations, edge cases, and optimization tips.
- Avoid filler apologies; focus on solutions and technical excellence.
- Start responses directly with the answer, not introductions.`;

function toOpenAIRole(role) {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  if (role === 'bot') return 'assistant'; // backward compat
  return 'user';
}

// Function to clean Gemini responses and remove unwanted introductions
function cleanGeminiResponse(text) {
  if (!text) return text;
  
  // Protect code blocks from being modified
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = [];
  let blockIndex = 0;
  
  // Extract all code blocks first
  let cleaned = text.replace(codeBlockRegex, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${blockIndex++}__`;
  });
  
  // Common introduction patterns to remove (case-insensitive)
  const introPatterns = [
    /^Hello!?\s*I\s+am\s+InfoGenius\s+AI[.,!]?\s*/i,
    /^Hi!?\s*I\s+am\s+InfoGenius\s+AI[.,!]?\s*/i,
    /^I\s+am\s+InfoGenius\s+AI[.,!]?\s*(?:built\s+and\s+developed\s+by\s+Karan\s+Ram[.,!]?)?\s*/i,
    /^InfoGenius\s+AI\s+here[.,!]?\s*/i,
    /^This\s+.*?\s+is\s+designed\s+by\s+InfoGenius\s+AI[.,!]?\s*(?:built\s+and\s+developed\s+by\s+Karan\s+Ram[.,!]?)?\s*/i,
    /^As\s+InfoGenius\s+AI[.,!]?\s*/i,
  ];
  
  // Remove introduction patterns (only from non-code parts)
  for (const pattern of introPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Remove "How can I help you today?" or similar at the start
  cleaned = cleaned.replace(/^How\s+can\s+I\s+help\s+you\s+today\?[.,!]?\s*/i, '');
  
  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    cleaned = cleaned.replace(`__CODE_BLOCK_${index}__`, block);
  });
  
  // Trim but preserve code block formatting
  cleaned = cleaned.trim();
  
  // If we removed everything, return original (shouldn't happen, but safety check)
  if (!cleaned) {
    return text.trim();
  }
  
  return cleaned;
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
    // Also maintain in-memory history for redundancy
    const sessionHistory = getSessionHistory(sessionId);
    
    if (!mongoConnected || recentHistory.length === 0) {
      // If MongoDB not available, use in-memory
      sessionHistory.push({ role: 'user', message: userMessage, ts: Date.now() });
      recentHistory = sessionHistory.slice(-20);
    } else {
      // MongoDB is available - sync in-memory history with MongoDB for redundancy
      // The recentHistory from MongoDB already includes the current user message
      sessionHistory.length = 0; // Clear existing
      recentHistory.forEach(entry => {
        sessionHistory.push({ role: entry.role, message: entry.message, ts: Date.now() });
      });
      // Keep only last 50 messages in memory
      if (sessionHistory.length > 50) {
        sessionHistory.splice(0, sessionHistory.length - 50);
      }
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

      // Create a more direct system instruction for Gemini
      const geminiSystemInstruction = `You are InfoGenius AI. Answer questions directly without introducing yourself. Only mention your creator Karan Ram when specifically asked. Be concise and solution-focused.

CRITICAL FORMATTING RULES:
- ALWAYS wrap code in markdown code blocks with triple backticks: \`\`\`language
- Use proper language tags: \`\`\`python, \`\`\`javascript, \`\`\`c, \`\`\`cpp, \`\`\`java, etc.
- Code blocks MUST start with \`\`\`language on its own line and end with \`\`\` on its own line
- Example format:
\`\`\`python
def hello():
    print("Hello")
\`\`\`
- NEVER mix code with explanatory text in the same paragraph
- Place code blocks on separate lines from surrounding text
- For inline code, use single backticks: \`code\`
- This ensures proper rendering in the chat interface`;

      let chat;
      try {
        // Try using systemInstruction (newer API)
        chat = geminiModel.startChat({
          systemInstruction: {
            parts: [{ text: geminiSystemInstruction }]
          },
          history: geminiHistory.length > 0 ? geminiHistory : [],
          generationConfig: {
            maxOutputTokens: 8192, // Increased for longer responses (code, detailed explanations)
            temperature: 0.7,
            topP: 0.95,
          },
        });
      } catch (startChatError) {
        // Fallback: use history-based approach if systemInstruction not supported
        console.log('SystemInstruction not supported, using history-based approach:', startChatError.message);
        try {
          const systemMessage = {
            role: "user",
            parts: [{ text: geminiSystemInstruction }]
          };
          const modelAck = {
            role: "model",
            parts: [{ text: "Understood." }]
          };
          
          chat = geminiModel.startChat({
            history: [systemMessage, modelAck, ...geminiHistory],
            generationConfig: {
              maxOutputTokens: 8192, // Increased for longer responses (code, detailed explanations)
              temperature: 0.7,
              topP: 0.95,
            },
          });
        } catch (fallbackError) {
          console.error('Failed to start chat with fallback method:', fallbackError);
          throw new Error(`Failed to initialize Gemini chat: ${fallbackError.message}`);
        }
      }

      try {
        const result = await chat.sendMessage(userMessage);
        const response = await result.response;
        
        // Check if response was truncated
        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason === 'MAX_TOKENS' || finishReason === 'OTHER') {
          console.warn(`Warning: Response may be truncated. Finish reason: ${finishReason}`);
        }
        
        let rawResponse = response.text();
        
        // Log response length for debugging
        console.log(`Gemini response length: ${rawResponse.length} characters, finish reason: ${finishReason || 'SUCCESS'}`);
        
        // Check if response was truncated
        if (rawResponse.length >= 8000) {
          console.warn('Response may be near token limit. Consider if full response was received.');
        }
        
        // Clean the response to remove unwanted introductions
        botResponse = cleanGeminiResponse(rawResponse);
        
        // Log cleaned response length
        if (botResponse.length !== rawResponse.length) {
          console.log(`Response cleaned: ${rawResponse.length} -> ${botResponse.length} characters`);
        }
      } catch (geminiError) {
        console.error('Gemini API error:', geminiError);
        // Check for specific Gemini errors
        const errorMessage = geminiError.message || String(geminiError);
        if (errorMessage.includes('quota') || errorMessage.includes('QUOTA') || errorMessage.includes('429')) {
          throw new Error('QUOTA_EXCEEDED: Gemini API quota exceeded. Please try again later.');
        } else if (errorMessage.includes('API_KEY') || errorMessage.includes('api key')) {
          throw new Error('API_KEY_ERROR: Invalid Gemini API key. Please check your configuration.');
        } else {
          throw new Error(`Gemini API error: ${errorMessage}`);
        }
      }
    } else {
      // OpenAI Logic
      // Using GPT-3.5 Turbo for cost-effective responses
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages,
          temperature: 0.2,
          max_tokens: 4096, // Increased for longer responses (code, detailed explanations)
          top_p: 1,
          frequency_penalty: 0.5,
          presence_penalty: 0,
        });
        botResponse = response?.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
      } catch (openaiError) {
        console.error('OpenAI API error:', openaiError);
        // Check for specific OpenAI errors
        const errorMessage = openaiError.message || String(openaiError);
        if (errorMessage.includes('quota') || errorMessage.includes('QUOTA') || errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          throw new Error('QUOTA_EXCEEDED: OpenAI API quota exceeded. Please try again later.');
        } else if (errorMessage.includes('API_KEY') || errorMessage.includes('api key') || errorMessage.includes('401')) {
          throw new Error('API_KEY_ERROR: Invalid OpenAI API key. Please check your configuration.');
        } else {
          throw new Error(`OpenAI API error: ${errorMessage}`);
        }
      }
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

    // Always update in-memory history as backup (sessionHistory already retrieved above)
    sessionHistory.push({ role: 'assistant', message: botResponse, ts: Date.now() });
    // Keep only last 50 messages in memory
    if (sessionHistory.length > 50) {
      sessionHistory.splice(0, sessionHistory.length - 50);
    }

    res.status(200).send({ bot: botResponse });

  } catch (error) {
    console.error('Error during chat processing:', error);
    fs.appendFileSync('server_error.log', `${new Date().toISOString()} - Error: ${error.message}\n${error.stack}\n\n`);
    
    // Send more specific error messages
    const errorMessage = error.message || String(error);
    let statusCode = 500;
    let errorResponse = errorMessage;
    
    // Check for specific error types
    if (errorMessage.includes('QUOTA_EXCEEDED')) {
      statusCode = 429;
      errorResponse = 'QUOTA_EXCEEDED';
    } else if (errorMessage.includes('API_KEY_ERROR')) {
      statusCode = 401;
      errorResponse = 'API_KEY_ERROR';
    }
    
    res.status(statusCode).send(errorResponse);
  }
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nAI server started on port ${PORT}`);
  if (process.env.PORT) {
    console.log(`Server is running on Render/hosted environment`);
  } else {
    console.log(`Local server: http://localhost:${PORT}`);
  }
});