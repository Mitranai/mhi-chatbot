// MHI Health Chatbot - Ollama-Powered AI Backend
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama2';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Load MHI knowledge base
let mhiKnowledge = '';
try {
  const resourcesData = JSON.parse(fs.readFileSync('resources.json', 'utf8'));
  mhiKnowledge = resourcesData.map(r => 
    `**${r.category}**\n${r.text}\nKeywords: ${r.keywords.join(', ')}\n`
  ).join('\n---\n\n');
  console.log('✓ Loaded MHI knowledge base');
} catch (error) {
  console.error('⚠ Could not load resources.json');
}

// AI System Prompt
const SYSTEM_PROMPT = `You are a compassionate AI assistant for the Mental Health Initiative (MHI).

**Your Role:**
- Provide helpful information about MHI services
- Be empathetic and supportive with mental health questions
- ALWAYS prioritize crisis situations
- Never diagnose - recommend licensed professionals
- Provide specific contact info when relevant

**Crisis Resources (ALWAYS provide if crisis detected):**
• Call 988 - National Suicide & Crisis Lifeline (24/7)
• Text "HELLO" to 741741 - Crisis Text Line
• Call 911 for emergencies
• MHI Crisis: 1-800-MHI-HELP (24/7)

**MHI Contact:**
• Main: 1-800-MHI-CARE
• Website: the-mhi.org

**MHI Knowledge Base:**
${mhiKnowledge}

**Guidelines:**
1. Detect crisis keywords and respond immediately with resources
2. Keep responses concise (2-4 paragraphs)
3. Use bullet points for clarity
4. Be warm and supportive
5. Include contact info/links when relevant`;

const conversations = new Map();

// Call Ollama API
async function callOllama(messages) {
  try {
    console.log(`Attempting to connect to Ollama at ${OLLAMA_URL}...`);
    
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: messages,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 500
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Ollama API error ${response.status}:`, errorText);
      throw new Error(`Ollama returned status ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✓ Successfully received response from Ollama');
    return data.message.content;
  } catch (error) {
    console.error('❌ Ollama Connection Error:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      throw new Error('Ollama is not running. Please start it with: ollama serve');
    } else if (error.message.includes('fetch failed')) {
      throw new Error('Cannot connect to Ollama. Make sure it is running on http://localhost:11434');
    } else {
      throw error;
    }
  }
}

// Quick crisis detection
function detectCrisis(message) {
  const crisisWords = ['suicide', 'suicidal', 'kill myself', 'end my life', 'self harm', 'hurt myself'];
  return crisisWords.some(word => message.toLowerCase().includes(word));
}

function getCrisisResponse() {
  return `🚨 **IMMEDIATE CRISIS RESOURCES** 🚨

I'm very concerned. Please reach out for immediate help:

• **Call 988** - National Suicide & Crisis Lifeline (24/7)
• **Text "HELLO" to 741741** - Crisis Text Line
• **Call 911** if in immediate danger
• **MHI Crisis: 1-800-MHI-HELP** (24/7)

**You are not alone.** Trained professionals want to help you right now.`;
}

// Check Ollama availability
async function checkOllama() {
  try {
    console.log(`Checking Ollama at ${OLLAMA_URL}...`);
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✓ Ollama is running');
      console.log(`✓ Available models: ${data.models.map(m => m.name).join(', ')}`);
      
      // Check if our model is available
      const hasModel = data.models.some(m => m.name === OLLAMA_MODEL || m.name.startsWith(OLLAMA_MODEL));
      if (!hasModel) {
        console.warn(`⚠ Model '${OLLAMA_MODEL}' not found!`);
        console.warn(`  Run: ollama pull ${OLLAMA_MODEL}`);
        return false;
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Cannot connect to Ollama');
    console.error('   Make sure Ollama is running: ollama serve');
    console.error('   Error:', error.message);
    return false;
  }
}

// API Endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'MHI Health Chatbot (Ollama)',
    version: '2.0.0',
    model: OLLAMA_MODEL,
    ollama_url: OLLAMA_URL
  });
});

app.post('/api/chat', async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Invalid message' });
  }

  console.log(`\n[User]: ${message}`);

  // Crisis detection (works without Ollama)
  if (detectCrisis(message)) {
    console.log('[CRISIS DETECTED - Immediate response]');
    return res.json({
      response: getCrisisResponse(),
      type: 'crisis',
      priority: 'EMERGENCY'
    });
  }

  try {
    const convoId = conversationId || `conv_${Date.now()}`;
    if (!conversations.has(convoId)) {
      conversations.set(convoId, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }

    const history = conversations.get(convoId);
    history.push({ role: 'user', content: message });

    if (history.length > 21) history.splice(1, 2);

    const aiResponse = await callOllama(history);
    history.push({ role: 'assistant', content: aiResponse });

    console.log(`[AI]: ${aiResponse.substring(0, 100)}...`);

    res.json({
      response: aiResponse,
      conversationId: convoId,
      type: 'ai',
      model: OLLAMA_MODEL
    });

  } catch (error) {
    console.error('[Error]:', error.message);
    
    // Provide helpful error message based on the error
    let userMessage = `I'm having trouble connecting to my AI system right now.\n\n`;
    
    if (error.message.includes('not running') || error.message.includes('Cannot connect')) {
      userMessage += `**The issue:** Ollama is not running.\n\n**To fix:**\n1. Open a new terminal\n2. Run: \`ollama serve\`\n3. Keep that terminal open\n4. Try your message again\n\n`;
    } else if (error.message.includes('Model')) {
      userMessage += `**The issue:** Model '${OLLAMA_MODEL}' is not installed.\n\n**To fix:**\n1. Run: \`ollama pull ${OLLAMA_MODEL}\`\n2. Wait for download to complete\n3. Try again\n\n`;
    } else {
      userMessage += `**Error:** ${error.message}\n\n`;
    }
    
    userMessage += `**Meanwhile, you can:**\n• Call **1-800-MHI-CARE** for direct assistance\n• Visit **the-mhi.org**\n• For crisis support: **Call 988** (24/7)`;
    
    res.json({
      response: userMessage,
      type: 'error',
      error: error.message
    });
  }
});

app.get('/api/health', async (req, res) => {
  const ollamaOk = await checkOllama();
  res.json({
    status: 'healthy',
    server: 'running',
    ollama: { 
      available: ollamaOk, 
      url: OLLAMA_URL, 
      model: OLLAMA_MODEL,
      message: ollamaOk ? 'Connected' : 'Not running - start with: ollama serve'
    }
  });
});

// Start server
const server = app.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   🧠 MHI HEALTH CHATBOT - OLLAMA POWERED 💙               ║
║   Status: SERVER ONLINE ✓                                  ║
║   Port: ${PORT}                                               ║
║   Model: ${OLLAMA_MODEL}                                      ║
║   Ollama URL: ${OLLAMA_URL}                    ║
╚════════════════════════════════════════════════════════════╝
  `);

  console.log('\nChecking Ollama connection...\n');
  const ollamaOk = await checkOllama();
  
  if (!ollamaOk) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  OLLAMA IS NOT RUNNING OR MODEL NOT INSTALLED        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('To fix this:\n');
    console.log('1. Open a NEW terminal window');
    console.log('2. Run: ollama serve');
    console.log('3. Keep that terminal open\n');
    console.log('4. In ANOTHER terminal, run: ollama pull llama2\n');
    console.log('5. Once completed, refresh your browser\n');
    console.log('The chatbot server is running, but needs Ollama to work.\n');
  } else {
    console.log('\n✅ Everything is working!');
    console.log(`✅ Open http://localhost:${PORT} in your browser\n`);
  }
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down MHI Chatbot...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});
