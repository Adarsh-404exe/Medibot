/**
 * MediBot Backend
 * Zero-dependency Node.js server (built-in `http` module only — no npm
 * install required) that serves the frontend and powers a rule-based
 * health-symptom chatbot.
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
    sessions.set(id, { id, stage: "greeting", gender: null, age: null, lang: "en" });
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
  "pain", "ache", "hurt", "sick", "ill", "fever", "cough", "cold", "flu",
  "vomit", "nausea", "dizzy", "tired", "fatigue", "rash", "itch", "swelling",
  "swollen", "bleed", "blood", "diarrhea", "diarrhoea", "constipation",
  "burn", "sore", "infection", "allergy", "allergic", "breathe", "breathing",
  "headache", "migraine", "stomach", "throat", "nose", "sneeze", "chest",
  "symptom", "symptoms", "medicine", "medication", "doctor", "disease",
  "wound", "cut", "injury", "cramp", "bloating", "gas", "acidity", "weak",
];

function buildKeywordIndex() {
  const idx = [];
  diseases.forEach((d) => {
    d.keywords.forEach((k) => idx.push({ keyword: k.toLowerCase(), disease: d }));
  });
  return idx.sort((a, b) => b.keyword.length - a.keyword.length);
}
const KEYWORD_INDEX = buildKeywordIndex();

function isHealthRelated(text) {
  const lower = text.toLowerCase();
  if (KEYWORD_INDEX.some((entry) => lower.includes(entry.keyword))) return true;
  return GENERIC_HEALTH_WORDS.some((w) => lower.includes(w));
}

function matchDiseases(text) {
  const lower = text.toLowerCase();
  const matched = new Map();
  KEYWORD_INDEX.forEach((entry) => {
    if (lower.includes(entry.keyword)) matched.set(entry.disease.id, entry.disease);
  });
  return Array.from(matched.values());
}

function formatDiseaseReply(list, lang) {
  const parts = [t(lang, "resultIntro")];
  list.slice(0, 2).forEach((d) => {
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

function handleChat(req, res, body) {
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

  if (!isHealthRelated(text)) {
    return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "notHealthRelated") }] });
  }

  const matches = matchDiseases(text);
  session.stage = "followup";

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
