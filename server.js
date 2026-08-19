/**
 * MediBot Backend
 * Zero-dependency Node.js server (built-in `http` module only — no npm
 * install required) that serves the frontend and powers the chatbot.
 *
 * The chatbot uses Groq's free AI API (Llama model) for natural-language
 * understanding when GROQ_API_KEY is set as an environment variable.
 * Groq's free tier requires no credit card and has generous rate limits
 * (30 requests/min, 14,400/day) — genuinely $0 cost for personal use.
 * If the key is missing or the API call fails for any reason, it
 * automatically falls back to the built-in rule-based keyword matcher —
 * so the site never breaks.
 *
 * Get a free key: https://console.groq.com  (sign up, no card needed)
 *
 * Run:  node server.js
 * Then open http://localhost:3000
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const diseases = require("./diseases.json");
const translations = require("./translations.json");
const quickOptions = require("./quickOptions.json");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = __dirname;

// Set this as an environment variable (never hardcode it / commit it to GitHub).
// Get a free key (no credit card) at https://console.groq.com
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile"; // free, high quality, generous rate limits

const LANG_NAMES = { en: "English", hi: "Hindi", es: "Spanish", fr: "French" };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------
const sessions = new Map();

function getSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) {
    const id = sessionId || crypto.randomUUID();
    sessions.set(id, { id, stage: "greeting", gender: null, age: null, lang: "en", history: [] });
    return sessions.get(id);
  }
  return sessions.get(sessionId);
}

function t(lang, key) {
  const dict = translations[lang] || translations.en;
  return dict[key] || translations.en[key] || key;
}

// ---------------------------------------------------------------------------
// Health-relatedness + symptom matching
// ---------------------------------------------------------------------------
const GENERIC_HEALTH_WORDS = [
  "pain", "pains", "ache", "aches", "aching", "hurt", "hurts", "hurting",
  "sick", "ill", "fever", "cough", "coughing", "cold", "flu",
  "vomit", "vomiting", "nausea", "dizzy", "dizziness", "tired", "tiredness",
  "fatigue", "rash", "itch", "itching", "itchy", "swelling", "swollen",
  "bleed", "bleeding", "blood", "diarrhea", "diarrhoea", "constipation",
  "burn", "burning", "sore", "infection", "allergy", "allergic",
  "breathe", "breathing", "headache", "migraine", "stomach", "throat",
  "nose", "sneeze", "sneezing", "chest", "symptom", "symptoms", "medicine",
  "medication", "doctor", "disease", "wound", "cut", "cuts", "injury",
  "cramp", "cramps", "bloating", "gas", "acidity", "weak", "weakness",
  "urinate", "urinating", "urination",
];

function buildKeywordIndex() {
  const idx = [];
  diseases.forEach((d) => {
    d.keywords.forEach((k) => {
      const escaped = k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      idx.push({ keyword: k.toLowerCase(), regex, disease: d });
    });
  });
  return idx.sort((a, b) => b.keyword.length - a.keyword.length);
}
const KEYWORD_INDEX = buildKeywordIndex();

function isHealthRelated(text) {
  if (KEYWORD_INDEX.some((entry) => entry.regex.test(text))) return true;
  return GENERIC_HEALTH_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
}

function matchDiseases(text) {
  const matched = new Map();
  KEYWORD_INDEX.forEach((entry) => {
    if (entry.regex.test(text)) matched.set(entry.disease.id, entry.disease);
  });
  return Array.from(matched.values());
}

function formatDiseaseReply(list, lang) {
  const parts = [t(lang, "resultIntro")];
  list.slice(0, 3).forEach((d) => {
    const name = d.name[lang] || d.name.en;
    const summary = d.summary[lang] || d.summary.en;
    const prevention = d.prevention[lang] || d.prevention.en;
    parts.push(`\n**${name}**\n${summary}`);
    parts.push(`\n${t(lang, "medicinesLabel")}\n` + d.medicines.map((m) => `• ${m}`).join("\n"));
    parts.push(`\n${t(lang, "preventionLabel")}\n${prevention}`);
  });
  parts.push(`\n${t(lang, "sourceLabel")}`);
  parts.push(t(lang, "seeDoctor"));
  parts.push(`\n${t(lang, "anyOtherSymptom")}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// AI-powered health response (Groq's free API — Llama model)
// ---------------------------------------------------------------------------
const MEDIBOT_SYSTEM_PROMPT = (lang, session) => `You are MediBot, a friendly AI health assistant embedded in a website chat widget.

STRICT RULES:
- Only discuss health, symptoms, common illnesses, and general wellness. If the user's message is not health-related, politely say you can only help with health-related questions and nothing else.
- You are NOT a doctor and must never claim to give a medical diagnosis. Always frame answers as general information, not a diagnosis.
- Base your guidance on general public-health knowledge consistent with WHO and mainstream medical guidance for common conditions.
- For chronic or serious conditions (diabetes, high blood pressure, heart issues, cancer symptoms, mental health crises, anything needing lab tests or prescription-only medication), do NOT suggest specific drug names or dosages — instead clearly say to consult a licensed doctor.
- For common, everyday, non-emergency conditions (cold, flu, mild fever, headache, indigestion, minor cuts, common infections), you may suggest general over-the-counter self-care measures, but never give exact prescription dosages.
- Keep answers concise: under ~180 words, warm tone, a few relevant emoji, no walls of text.
- Structure your answer roughly as: 1) what it could commonly be (not a diagnosis) 2) general self-care/OTC guidance 3) 1-2 prevention tips 4) when to see a doctor. Skip sections that don't apply.
- End by asking if there's any other symptom they'd like to check.
- Always reply in ${LANG_NAMES[lang] || "English"}, regardless of what language the user typed in.

Context about this user: gender = ${session.gender || "not specified"}, age = ${session.age || "not specified"}. Use this only to make advice more relevant (e.g. age-appropriate care), never to make assumptions beyond what's stated.`;

async function getAIHealthResponse(userText, lang, session) {
  if (!GROQ_API_KEY) return null; // no key configured -> caller falls back to local dataset

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 700,
        messages: [
          { role: "system", content: MEDIBOT_SYSTEM_PROMPT(lang, session) },
          { role: "user", content: userText },
        ],
      }),
    });

    if (!response.ok) {
      console.error("Groq API error:", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    return reply || null;
  } catch (err) {
    console.error("Groq API request failed:", err);
    return null; // graceful fallback
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
function handleConfig(req, res) {
  sendJson(res, 200, { translations, quickOptions, languages: Object.keys(translations) });
}

function handleSessionStart(req, res, body) {
  const { lang } = body || {};
  const id = crypto.randomUUID();
  sessions.set(id, { id, stage: "ask_gender", gender: null, age: null, lang: lang || "en" });
  const session = sessions.get(id);
  sendJson(res, 200, {
    sessionId: id,
    messages: [
      { from: "bot", type: "disclaimer", text: t(session.lang, "disclaimerBody") },
      { from: "bot", type: "gender_prompt", text: t(session.lang, "askGender") },
    ],
  });
}

async function handleChat(req, res, body) {
  const { sessionId, message, lang } = body || {};
  const session = getSession(sessionId);
  if (lang) session.lang = lang;
  const L = session.lang;
  const text = (message || "").trim();

  if (session.stage === "ask_gender") {
    session.gender = text;
    session.stage = "ask_age";
    return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "askAge") }] });
  }

  if (session.stage === "ask_age") {
    session.age = text;
    session.stage = "ask_problem";
    return sendJson(res, 200, {
      messages: [
        { from: "bot", type: "text", text: `${t(L, "personalNote")} 🙏` },
        { from: "bot", type: "problem_prompt", text: t(L, "askProblem") },
      ],
    });
  }

  session.stage = "followup";

  // Cheap local check first — no need to spend an API call on obviously
  // off-topic messages.
  if (!isHealthRelated(text)) {
    return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "notHealthRelated") }] });
  }

  // Try the free AI (Groq/Llama) first, if configured.
  const aiReply = await getAIHealthResponse(text, L, session);
  if (aiReply) {
    return sendJson(res, 200, { messages: [{ from: "bot", type: "diagnosis", text: aiReply }] });
  }

  // Fallback: local rule-based keyword matcher (works with zero setup / no API key)
  const matches = matchDiseases(text);
  if (matches.length === 0) {
    return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "noMatchFound") }] });
  }

  return sendJson(res, 200, { messages: [{ from: "bot", type: "diagnosis", text: formatDiseaseReply(matches, L) }] });
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(FRONTEND_DIR, urlPath);

  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];

  if (req.method === "GET" && urlPath === "/api/config") return handleConfig(req, res);

  if (req.method === "POST" && urlPath === "/api/session/start") {
    const body = await readBody(req);
    return handleSessionStart(req, res, body);
  }

  if (req.method === "POST" && urlPath === "/api/chat") {
    const body = await readBody(req);
    return handleChat(req, res, body);
  }

  if (req.method === "GET") return serveStatic(req, res);

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`✅ MediBot server running at http://localhost:${PORT}`);
});
