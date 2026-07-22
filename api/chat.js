// Serverless chat endpoint for Nicole Cheung's site.
// Answers questions using ONLY the facts in api/corpus.md.
// The Anthropic API key is read from the ANTHROPIC_API_KEY environment
// variable by the SDK — it is never sent to or exposed in the page.

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

// Load the corpus once per cold start. vercel.json bundles api/corpus.md
// alongside this function via `includeFiles`.
function loadCorpus() {
  const candidates = [
    path.join(process.cwd(), 'api', 'corpus.md'),
    path.join(__dirname, 'corpus.md'),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (_) {
      /* try next path */
    }
  }
  return '';
}

const CORPUS = loadCorpus();

const SYSTEM_PROMPT =
  "You are a friendly assistant on Nicole Cheung's personal website. " +
  'Answer visitors\' questions about Nicole using ONLY the information in the ' +
  'CONTEXT below.\n\n' +
  'Rules:\n' +
  '- Use only facts found in the CONTEXT. Do not invent or infer jobs, dates, ' +
  'titles, numbers, or any other details.\n' +
  "- If the answer isn't in the CONTEXT, say you don't have that information " +
  'and suggest reaching out to Nicole directly (email or LinkedIn).\n' +
  '- Keep answers concise, warm, and conversational. Refer to her as "Nicole".\n' +
  '- Only discuss Nicole and her background; politely decline unrelated requests.\n\n' +
  'CONTEXT:\n' +
  CORPUS;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'The chat is not configured yet.' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const incoming = Array.isArray(body.messages) ? body.messages : null;
    if (!incoming) {
      return res.status(400).json({ error: 'Missing messages.' });
    }

    // Keep only well-formed user/assistant text turns; cap history + length.
    const messages = incoming
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
      )
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'The last message must be from the user.' });
    }

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat error:', err);
    // Temporary diagnostic: surface the real error so we can see what's wrong.
    // (Does NOT expose the API key — only the API's error type/message.)
    let detail = '';
    if (err) {
      if (err.status) detail += 'HTTP ' + err.status + ' ';
      if (err.name) detail += err.name + ' ';
      const msg =
        (err.error && err.error.error && err.error.error.message) || err.message;
      if (msg) detail += '- ' + String(msg);
    }
    return res
      .status(500)
      .json({ error: 'Chat error: ' + (detail.trim() || 'unknown').slice(0, 300) });
  }
};
