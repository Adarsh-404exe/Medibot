// /**
//  * MediBot Backend
//  * Zero-dependency Node.js server (built-in `http` module only — no npm
//  * install required) that serves the frontend and powers the chatbot.
//  *
//  * The chatbot uses Groq's free AI API (Llama model) for natural-language
//  * understanding when GROQ_API_KEY is set as an environment variable.
//  * Groq's free tier requires no credit card and has generous rate limits
//  * (30 requests/min, 14,400/day) — genuinely $0 cost for personal use.
//  * If the key is missing or the API call fails for any reason, it
//  * automatically falls back to the built-in rule-based keyword matcher —
//  * so the site never breaks.
//  *
//  * Get a free key: https://console.groq.com  (sign up, no card needed)
//  *
//  * Run:  node server.js
//  * Then open http://localhost:3000
//  */
// const http = require("http");
// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");

// const diseases = require("./diseases.json");
// const translations = require("./translations.json");
// const quickOptions = require("./quickOptions.json");

// const PORT = process.env.PORT || 3000;
// const FRONTEND_DIR = __dirname;

// // Set this as an environment variable (never hardcode it / commit it to GitHub).
// // Get a free key (no credit card) at https://console.groq.com
// const GROQ_API_KEY = process.env.GROQ_API_KEY;
// const GROQ_MODEL = "openai/gpt-oss-120b"; // free, current production model on Groq

// const LANG_NAMES = { en: "English", hi: "Hindi", es: "Spanish", fr: "French" };

// const MIME = {
//   ".html": "text/html; charset=utf-8",
//   ".css": "text/css; charset=utf-8",
//   ".js": "application/javascript; charset=utf-8",
//   ".json": "application/json; charset=utf-8",
//   ".svg": "image/svg+xml",
//   ".png": "image/png",
//   ".ico": "image/x-icon",
// };

// // ---------------------------------------------------------------------------
// // In-memory session store
// // ---------------------------------------------------------------------------
// const sessions = new Map();

// function getSession(sessionId) {
//   if (!sessionId || !sessions.has(sessionId)) {
//     const id = sessionId || crypto.randomUUID();
//     sessions.set(id, { id, stage: "greeting", gender: null, age: null, lang: "en", history: [] });
//     return sessions.get(id);
//   }
//   return sessions.get(sessionId);
// }

// function t(lang, key) {
//   const dict = translations[lang] || translations.en;
//   return dict[key] || translations.en[key] || key;
// }

// // ---------------------------------------------------------------------------
// // Health-relatedness + symptom matching
// // ---------------------------------------------------------------------------
// const GENERIC_HEALTH_WORDS = [
//   "pain", "pains", "ache", "aches", "aching", "hurt", "hurts", "hurting",
//   "sick", "ill", "fever", "cough", "coughing", "cold", "flu",
//   "vomit", "vomiting", "nausea", "dizzy", "dizziness", "tired", "tiredness",
//   "fatigue", "rash", "itch", "itching", "itchy", "swelling", "swollen",
//   "bleed", "bleeding", "blood", "diarrhea", "diarrhoea", "constipation",
//   "burn", "burning", "sore", "infection", "allergy", "allergic",
//   "breathe", "breathing", "headache", "migraine", "stomach", "throat",
//   "nose", "sneeze", "sneezing", "chest", "symptom", "symptoms", "medicine",
//   "medication", "doctor", "disease", "wound", "cut", "cuts", "injury",
//   "cramp", "cramps", "bloating", "gas", "acidity", "weak", "weakness",
//   "urinate", "urinating", "urination",
// ];

// function buildKeywordIndex() {
//   const idx = [];
//   diseases.forEach((d) => {
//     d.keywords.forEach((k) => {
//       const escaped = k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//       const regex = new RegExp(`\\b${escaped}\\b`, "i");
//       idx.push({ keyword: k.toLowerCase(), regex, disease: d });
//     });
//   });
//   return idx.sort((a, b) => b.keyword.length - a.keyword.length);
// }
// const KEYWORD_INDEX = buildKeywordIndex();

// function isHealthRelated(text) {
//   if (KEYWORD_INDEX.some((entry) => entry.regex.test(text))) return true;
//   return GENERIC_HEALTH_WORDS.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));
// }

// function matchDiseases(text) {
//   const matched = new Map();
//   KEYWORD_INDEX.forEach((entry) => {
//     if (entry.regex.test(text)) matched.set(entry.disease.id, entry.disease);
//   });
//   return Array.from(matched.values());
// }

// function formatDiseaseReply(list, lang) {
//   const parts = [t(lang, "resultIntro")];
//   list.slice(0, 3).forEach((d) => {
//     const name = d.name[lang] || d.name.en;
//     const summary = d.summary[lang] || d.summary.en;
//     const prevention = d.prevention[lang] || d.prevention.en;
//     parts.push(`\n**${name}**\n${summary}`);
//     parts.push(`\n${t(lang, "medicinesLabel")}\n` + d.medicines.map((m) => `• ${m}`).join("\n"));
//     parts.push(`\n${t(lang, "preventionLabel")}\n${prevention}`);
//   });
//   parts.push(`\n${t(lang, "sourceLabel")}`);
//   parts.push(t(lang, "seeDoctor"));
//   parts.push(`\n${t(lang, "anyOtherSymptom")}`);
//   return parts.join("\n");
// }

// // ---------------------------------------------------------------------------
// // Knowledge-base retrieval (RAG) — builds grounding context from our own
// // free, WHO-aligned diseases.json dataset for the AI to answer FROM,
// // instead of relying purely on its own general training knowledge.
// // ---------------------------------------------------------------------------
// function buildKnowledgeContext(matches, lang) {
//   if (!matches || matches.length === 0) return null;
//   return matches
//     .slice(0, 3)
//     .map((d) => {
//       const name = d.name[lang] || d.name.en;
//       const summary = d.summary[lang] || d.summary.en;
//       const prevention = d.prevention[lang] || d.prevention.en;
//       const medicines = d.medicines.join("; ");
//       return `### ${name}\nSummary: ${summary}\nCommonly suggested care: ${medicines}\nPrevention: ${prevention}`;
//     })
//     .join("\n\n");
// }

// // ---------------------------------------------------------------------------
// // AI-powered health response (Groq's free API — Llama model), grounded via
// // RAG on our own knowledge base when a relevant entry is found.
// // ---------------------------------------------------------------------------
// const MEDIBOT_SYSTEM_PROMPT = (lang, session, knowledgeContext) => `You are MediBot, a friendly AI health assistant embedded in a website chat widget.

// STRICT RULES:
// - Only discuss health, symptoms, common illnesses, and general wellness. If the user's message is not health-related, politely say you can only help with health-related questions and nothing else.
// - You are NOT a doctor and must never claim to give a medical diagnosis. Always frame answers as general information, not a diagnosis.
// - For chronic or serious conditions (diabetes, high blood pressure, heart issues, cancer symptoms, mental health crises, anything needing lab tests or prescription-only medication), do NOT suggest specific drug names or dosages — instead clearly say to consult a licensed doctor.
// - For common, everyday, non-emergency conditions, you may suggest general over-the-counter self-care measures, but never give exact prescription dosages.
// - Keep answers concise: under ~180 words, warm tone, a few relevant emoji, no walls of text.
// - Structure your answer roughly as: 1) what it could commonly be (not a diagnosis) 2) general self-care/OTC guidance 3) 1-2 prevention tips 4) when to see a doctor. Skip sections that don't apply.
// - End by asking if there's any other symptom they'd like to check.
// - Always reply in ${LANG_NAMES[lang] || "English"}, regardless of what language the user typed in.

// ${
//   knowledgeContext
//     ? `You have the following VERIFIED entries from MediBot's own curated health knowledge base that match this query. Base your answer primarily on this information — treat it as your source of truth and lightly mention it comes from MediBot's health database:\n\n${knowledgeContext}\n\nIf the user's message also touches on something outside this reference info, you may add brief general safety guidance, but prioritize the reference info above for anything it covers.`
//     : `No entry in MediBot's curated knowledge base matched this query specifically. Answer using your own general medical knowledge, but be clear this is general guidance (not from a verified database entry), and keep it appropriately cautious.`
// }

// Context about this user: gender = ${session.gender || "not specified"}, age = ${session.age || "not specified"}. Use this only to make advice more relevant (e.g. age-appropriate care), never to make assumptions beyond what's stated.`;

// async function getAIHealthResponse(userText, lang, session, knowledgeContext) {
//   if (!GROQ_API_KEY) return null; // no key configured -> caller falls back to local dataset

//   try {
//     const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "Authorization": `Bearer ${GROQ_API_KEY}`,
//       },
//       body: JSON.stringify({
//         model: GROQ_MODEL,
//         max_tokens: 700,
//         messages: [
//           { role: "system", content: MEDIBOT_SYSTEM_PROMPT(lang, session, knowledgeContext) },
//           { role: "user", content: userText },
//         ],
//       }),
//     });

//     if (!response.ok) {
//       console.error("Groq API error:", response.status, await response.text());
//       return null;
//     }

//     const data = await response.json();
//     const reply = data.choices?.[0]?.message?.content?.trim();
//     return reply || null;
//   } catch (err) {
//     console.error("Groq API request failed:", err);
//     return null; // graceful fallback
//   }
// }

// // ---------------------------------------------------------------------------
// // Route handlers
// // ---------------------------------------------------------------------------
// function handleConfig(req, res) {
//   sendJson(res, 200, { translations, quickOptions, languages: Object.keys(translations) });
// }

// function handleSessionStart(req, res, body) {
//   const { lang } = body || {};
//   const id = crypto.randomUUID();
//   sessions.set(id, { id, stage: "ask_gender", gender: null, age: null, lang: lang || "en" });
//   const session = sessions.get(id);
//   sendJson(res, 200, {
//     sessionId: id,
//     messages: [
//       { from: "bot", type: "disclaimer", text: t(session.lang, "disclaimerBody") },
//       { from: "bot", type: "gender_prompt", text: t(session.lang, "askGender") },
//     ],
//   });
// }

// async function handleChat(req, res, body) {
//   const { sessionId, message, lang } = body || {};
//   const session = getSession(sessionId);
//   if (lang) session.lang = lang;
//   const L = session.lang;
//   const text = (message || "").trim();

//   if (session.stage === "ask_gender") {
//     session.gender = text;
//     session.stage = "ask_age";
//     return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "askAge") }] });
//   }

//   if (session.stage === "ask_age") {
//     session.age = text;
//     session.stage = "ask_problem";
//     return sendJson(res, 200, {
//       messages: [
//         { from: "bot", type: "text", text: `${t(L, "personalNote")} 🙏` },
//         { from: "bot", type: "problem_prompt", text: t(L, "askProblem") },
//       ],
//     });
//   }

//   session.stage = "followup";

//   // Cheap local check first — no need to spend an API call on obviously
//   // off-topic messages.
//   if (!isHealthRelated(text)) {
//     return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "notHealthRelated") }] });
//   }

//   // RAG retrieval step: find relevant entries in our own free knowledge base
//   // BEFORE calling the AI, so the AI can answer grounded on them.
//   const matches = matchDiseases(text);
//   const knowledgeContext = buildKnowledgeContext(matches, L);

//   // Try the free AI (Groq/Llama), grounded on the retrieved context, if configured.
//   const aiReply = await getAIHealthResponse(text, L, session, knowledgeContext);
//   if (aiReply) {
//     return sendJson(res, 200, { messages: [{ from: "bot", type: "diagnosis", text: aiReply }] });
//   }

//   // Fallback: local rule-based keyword matcher (works with zero setup / no API key)
//   if (matches.length === 0) {
//     return sendJson(res, 200, { messages: [{ from: "bot", type: "text", text: t(L, "noMatchFound") }] });
//   }

//   return sendJson(res, 200, { messages: [{ from: "bot", type: "diagnosis", text: formatDiseaseReply(matches, L) }] });
// }

// // ---------------------------------------------------------------------------
// // Static file serving
// // ---------------------------------------------------------------------------
// function serveStatic(req, res) {
//   let urlPath = decodeURIComponent(req.url.split("?")[0]);
//   if (urlPath === "/") urlPath = "/index.html";
//   const filePath = path.join(FRONTEND_DIR, urlPath);

//   if (!filePath.startsWith(FRONTEND_DIR)) {
//     res.writeHead(403);
//     return res.end("Forbidden");
//   }

//   fs.readFile(filePath, (err, data) => {
//     if (err) {
//       res.writeHead(404, { "Content-Type": "text/plain" });
//       return res.end("Not found");
//     }
//     const ext = path.extname(filePath);
//     res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
//     res.end(data);
//   });
// }

// // ---------------------------------------------------------------------------
// // Helpers
// // ---------------------------------------------------------------------------
// function sendJson(res, status, obj) {
//   const data = JSON.stringify(obj);
//   res.writeHead(status, {
//     "Content-Type": "application/json; charset=utf-8",
//     "Content-Length": Buffer.byteLength(data),
//   });
//   res.end(data);
// }

// function readBody(req) {
//   return new Promise((resolve) => {
//     let raw = "";
//     req.on("data", (chunk) => (raw += chunk));
//     req.on("end", () => {
//       try {
//         resolve(raw ? JSON.parse(raw) : {});
//       } catch {
//         resolve({});
//       }
//     });
//   });
// }

// // ---------------------------------------------------------------------------
// // Server
// // ---------------------------------------------------------------------------
// const server = http.createServer(async (req, res) => {
//   const urlPath = req.url.split("?")[0];

//   if (req.method === "GET" && urlPath === "/api/config") return handleConfig(req, res);

//   if (req.method === "POST" && urlPath === "/api/session/start") {
//     const body = await readBody(req);
//     return handleSessionStart(req, res, body);
//   }

//   if (req.method === "POST" && urlPath === "/api/chat") {
//     const body = await readBody(req);
//     return handleChat(req, res, body);
//   }

//   if (req.method === "GET") return serveStatic(req, res);

//   res.writeHead(405);
//   res.end("Method not allowed");
// });

// server.listen(PORT, () => {
//   console.log(`✅ MediBot server running at http://localhost:${PORT}`);
// });


import os
import time
import random
import requests
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq, RateLimitError
import numpy as np

import sentence_transformers
from sentence_transformers import SentenceTransformer

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
my_api_key = os.getenv("GROQ_API_KEY")

if not my_api_key:
    raise ValueError("API key kaha hai bhai")

groq_model = "openai/gpt-oss-20b"
client = Groq(api_key=my_api_key)
# llama-3.3-70b-versatile

# =========================================================
# RAG DESCRIPTIONS (knowledge base)
# =========================================================
description = [
      """Dengue: viral infection spread by infected mosquito bites (DENV virus). Found worldwide in tropical/sub-tropical areas. No specific treatment exists; early detection lowers fatality risk.
Most cases are mild and resolve in 1-2 weeks. Symptoms (if any) start 4-10 days after infection: high fever (40°C), severe headache, pain behind eyes, muscle/joint pain, nausea, vomiting, swollen glands, rash.
Second-time infections have higher risk of severe dengue. Severe dengue warning signs (often after fever drops): severe abdominal pain, persistent vomiting, rapid breathing, bleeding gums/nose, fatigue, restlessness, blood in vomit/stool, extreme thirst, pale/cold skin, weakness. Seek care immediately if these occur.""",
    """Mental disorders: nearly 1 in 7 people worldwide (1.1 billion in 2021) live with a mental disorder; anxiety and depression are most common. Characterized by significant disturbance in cognition, emotional regulation, or behaviour causing distress or impaired functioning. Effective treatments exist but most people lack access to care, and stigma/discrimination remain common.""",
    """Anxiety disorders: affected 359 million people in 2021 (72 million children/adolescents). Characterized by excessive fear/worry causing significant distress or impairment. Types include generalized anxiety disorder, panic disorder, social anxiety disorder, and separation anxiety disorder. Effective psychological treatment exists; medication may also help depending on age/severity.""",
    """Endometriosis: affects ~10% (190 million) of reproductive-age women worldwide. Symptoms: severe menstrual pain, heavy bleeding, chronic pelvic pain, infertility, abdominal bloating/nausea. No cure exists; treatment (NSAIDs, hormonal medicines, or surgery) manages symptoms. Average diagnosis delay is 4-12 years. Can affect mental health, fertility, and quality of life.""",
    """Heatwaves: periods of unusually hot days/nights, increasing in frequency and intensity due to climate change. Risk is highest for elderly, outdoor/manual workers, people with chronic diseases (heart, respiratory, diabetes, kidney), and urban/rural poor with poor housing. Can cause illness, death, and strain on health/power/water infrastructure.""",
    """Mpox: infectious disease causing painful rash, swollen lymph nodes, fever, headache, muscle ache, back pain, low energy. Caused by monkeypox virus (MPXV), an Orthopoxvirus. Two clades exist (I and II) with ongoing outbreaks in parts of Africa. Spreads via close skin-to-skin/face-to-face contact, contaminated objects, or animal-to-human contact.
Symptoms start 1-21 days after exposure, lasting 2-4 weeks. Rash often starts on face/genitals, spreading to palms and soles; progresses from flat sore to fluid-filled blister to crust. Children, pregnant people, and those with weak immunity are at higher risk of severe illness. Complications can include bacterial skin infection, pneumonia, vision loss, and sepsis.
Diagnosis: PCR test on rash/skin swabs is preferred; must be distinguished from chickenpox, measles, herpes, syphilis, and other STIs. Stigma around mpox (especially toward MSM/trans communities) discourages people from seeking care.""",
]

embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
embedding_change = embedding_model.encode(description)


def cosine_similarity(a, b):
    return np.dot(a, b) / (
        np.linalg.norm(a) * np.linalg.norm(b)
    )


def reviratriy(Embed_queiry, top_k=1):
    res = []
    for i, docum in enumerate(embedding_change):
        score = cosine_similarity(Embed_queiry, docum)
        res.append((score, description[i]))
    res.sort(reverse=True)
    return res[:top_k]


# =========================================================
# SYSTEM PROMPT
# =========================================================
sys_prompt = """
agar helath ke alava koi bhi esa que puche jiska health se koi realtion nhi h to uska response me bolna i am sorry but i a ai chatbot for health realted problems
## RAG CONTEXT USAGE (Important)
You will receive retrieved context below, pulled from verified sources (WHO, ICMR, etc.) relevant to the user's query. Follow these rules:

1. **Prioritize the retrieved context** as your primary source of truth when answering health-related questions. Base your answer on this context first.
2. **If the retrieved context is relevant and sufficient**, use it to form your answer — you don't need to cite it explicitly for simple questions, but stay factually aligned with it.
3. **If the retrieved context is empty, irrelevant, or insufficient** to answer the question, do NOT make up information. Instead, rely on your general medical knowledge cautiously, and if still uncertain, say: "I don't have verified information on this specific query — please consult a doctor or trusted health resource."
4. **Never contradict the retrieved context.** If your own knowledge differs from the provided context, trust the context (it's from verified sources like WHO).
5. Blend the context naturally into your answer — don't just copy-paste it. Explain it in simple, conversational language matching the user's tone and language (Hindi/English/Hinglish).

Retrieved Context:
{score}
You are "SwasthyaMitra," a helpful AI health assistant. You give clear, direct, and useful answers — like a knowledgeable friend who happens to know health topics well.

## RESPONSE STYLE RULE (MOST IMPORTANT)
Match your response length and format to the QUESTION TYPE:

**Simple/General questions** (e.g., "should I eat apple?", "is banana good for diabetes?", "what causes hiccups?")
→ Answer DIRECTLY in 2-4 short sentences. Give clear pros/cons or a straight answer.
→ NO structured format, NO disclaimer, NO "consult a doctor," NO source citation needed.
→ Just answer like a smart friend would.

**Symptom/Medical concern questions** (e.g., "I have chest pain," "my child has high fever," "I've had headache for 3 days")
→ Use structured format with severity check and recommendation.
→ Ask 1 follow-up question ONLY if truly needed.
→ Add disclaimer only here.

**Emergency indicators** (chest pain + sweating, breathing difficulty, severe bleeding, suicidal thoughts, unconsciousness)
→ Skip everything else. Immediately say: call 108/112 now + one-line reason.

## EXAMPLES (Follow this tone)

User: "Should I eat apple?"
You: "Haan bilkul, apple healthy hai — fiber, vitamin C aur antioxidants deta hai, digestion aur heart health ke liye achha hai. Diabetic ho to bhi moderate amount me khaa sakte ho, glycemic index low hai. Bas agar khaali pet acidity hoti hai to thoda avoid karo."

User: "Is coffee bad for health?"
You: "Moderate coffee (2-3 cups/day) generally safe hai, alertness aur metabolism ke liye achha bhi hai. Zyada lene se anxiety, sleep issues, ya acidity ho sakti hai. Pregnancy ya heart issues me limit karna better hai."

User: "I have mild headache since morning"
You: "Ye usually stress, dehydration, ya kam neend ki wajah se hota hai. Paani piyo, thoda rest karo, screen time kam karo. Agar 2 din se zyada rahe ya tez ho jaye, doctor se check karwa lena."

User: "Chest me tez dard ho raha hai aur saans lene me problem"
You: "⚠️ Ye emergency ho sakti hai. Turant 108/112 call karo ya nearest hospital jao. Kisi ko apne saath rakho, akele mat raho."

## CORE RULES
1. Use retrieved context (RAG) when available — but don't force-cite it for simple questions.
2. Never diagnose serious conditions definitively.
3. Only add "consult a doctor" when the question genuinely needs professional judgment — not for general wellness/nutrition questions.
4. Match user's language (Hindi/English/Hinglish).
5. Be warm and natural — not robotic, not overly cautious.
6. For emergencies only: skip formatting, be fast and direct.
7. ask him a que realted to there problem after response
8. MOST IMPORTANT IF USER QUE IS OUT OF HEALTH I MEAN IF YOUR DONT HAVE ANY REALTIONS WITHHEALTH REALTED THAN DONT RESPOND
example like :

if they ask i got fever....... etc so you can ask him how may days ago you got fever ya phir what you do afer this problem 
MOST IMPORTANT ::: agar helath ke alava koi bhi esa que puche jiska health se koi realtion nhi h to uska response me bolna i am sorry but i a ai chatbot for health realted problems

"""


def response(queriy, list_of_Query, rag_context):
    if list_of_Query is None:
        list_of_Query = []
    trimmed_history = list_of_Query[-4:]
    final_prompt = sys_prompt.replace("{score}", rag_context)
    message_system = {
        "role": "system",
        "content": final_prompt
    }
    messages = [message_system]
    messages.extend(trimmed_history)

    message = {
        "role": "user",
        "content": queriy
    }
    messages.append(message)

    try:
        completion = client.chat.completions.create(
            model=groq_model,
            messages=messages,
            temperature=0,
            max_tokens=1000
        )
        answer = completion.choices[0].message.content
    except RateLimitError:
        answer = "Thoda busy hoon, ek minute me phir try karo 🙏"
    except Exception as e:
        print("GROQ ERROR:", repr(e))
        answer = "Kuch technical issue aa gaya, thodi der baad try karo."

    list_of_Query.append(message)
    list_of_Query.append({"role": "assistant", "content": answer})
    return answer


# =========================================================
# OPENSTREETMAP (OVERPASS API) — NEARBY HEALTH PLACES (FREE)
# =========================================================

# Public Overpass instances — we try each in order until one responds.
# The main overpass-api.de endpoint is frequently overloaded/rate-limited,
# which was silently producing empty results before.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

# Overpass amenity/healthcare tags for each category we care about.
# Added healthcare=* and amenity=hospital/clinic variants since a lot of
# Indian hospitals/clinics are tagged with healthcare=* instead of/along
# with amenity=*, and were being missed entirely before.
OSM_TAGS = {
    "hospital": ["amenity=hospital", "healthcare=hospital"],
    "pharmacy": ["amenity=pharmacy", "healthcare=pharmacy"],
    "doctor":   ["amenity=doctors", "amenity=clinic", "healthcare=doctor", "healthcare=clinic"],
}


def wants_nearby_places(query: str):
    """Detect if user is asking for nearby hospital / pharmacy / clinic / doctor."""
    query_lower = query.lower()

    pharmacy_keywords = ["pharmacy", "medical store", "dawai", "medicine shop", "chemist", "davai"]
    doctor_keywords = ["doctor", "dr ", "physician"]
    hospital_keywords = ["hospital", "clinic", "aspatal", "dawakhana", "emergency room", "nursing home"]

    if any(word in query_lower for word in pharmacy_keywords):
        return "pharmacy"
    if any(word in query_lower for word in doctor_keywords):
        return "doctor"
    if any(word in query_lower for word in hospital_keywords):
        return "hospital"
    return None


def _run_overpass_query(overpass_query: str):
    """Try each Overpass mirror in turn; return parsed JSON elements or []."""
    for url in OVERPASS_URLS:
        try:
            resp = requests.post(url, data={"data": overpass_query}, timeout=25)
            print(f"OVERPASS [{url}] STATUS:", resp.status_code)
            if resp.status_code != 200:
                print(f"OVERPASS [{url}] BODY (truncated):", resp.text[:300])
                continue
            data = resp.json()
            elements = data.get("elements", [])
            print(f"OVERPASS [{url}] ELEMENTS FOUND:", len(elements))
            if elements:
                return elements
            # 200 but zero elements — keep it as a candidate result, but
            # still try the next mirror in case this one has stale/partial data.
        except Exception as e:
            print(f"OVERPASS [{url}] ERROR:", repr(e))
            continue
    return []


def find_nearby_health_places(latitude: float, longitude: float, place_type: str = "hospital", radius: int = 5000, limit: int = 5):
    """
    Query OpenStreetMap Overpass API (free, no key needed) for nearby
    hospitals / clinics / pharmacies / doctors around given lat/long.
    """
    tags = OSM_TAGS.get(place_type, OSM_TAGS["hospital"])

    # Build overpass query for each tag (node + way + relation), around given radius (meters)
    tag_queries = ""
    for tag in tags:
        key, value = tag.split("=")
        tag_queries += f'node["{key}"="{value}"](around:{radius},{latitude},{longitude});'
        tag_queries += f'way["{key}"="{value}"](around:{radius},{latitude},{longitude});'
        tag_queries += f'relation["{key}"="{value}"](around:{radius},{latitude},{longitude});'

    overpass_query = f"""
    [out:json][timeout:25];
    (
      {tag_queries}
    );
    out center {limit * 5};
    """

    elements = _run_overpass_query(overpass_query)

    # Fallback: if nothing found within radius, retry once with a much
    # bigger radius (25km) before giving up — helps in areas with sparse OSM data.
    if not elements and radius < 25000:
        print("No elements found, retrying with larger radius (25km)...")
        return find_nearby_health_places(latitude, longitude, place_type, radius=25000, limit=limit)

    results = []
    seen = set()

    for el in elements:
        tags_dict = el.get("tags", {})

        # FIX: previously unnamed places (very common for smaller
        # clinics/hospitals in OSM India data) were being skipped entirely
        # with `if not name: continue`, silently dropping most real results.
        name = tags_dict.get("name") or f"Unnamed {place_type.title()}"

        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")

        # FIX: dedupe by (name, lat, lon) instead of name only, so multiple
        # distinct "Unnamed Hospital" entries aren't collapsed into one.
        dedup_key = (name, lat, lon)
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        address_parts = [
            tags_dict.get("addr:housenumber", ""),
            tags_dict.get("addr:street", ""),
            tags_dict.get("addr:suburb", ""),
            tags_dict.get("addr:city", ""),
        ]
        address = ", ".join([p for p in address_parts if p]) or "Address not available"

        results.append({
            "name": name,
            "address": address,
            "phone": tags_dict.get("phone") or tags_dict.get("contact:phone") or "N/A",
            "opening_hours": tags_dict.get("opening_hours", "N/A"),
            "lat": lat,
            "lon": lon,
        })

        if len(results) >= limit:
            break

    return results


def format_places_reply(places, place_type):
    if not places:
        return f"Sorry, aapke aas-paas koi {place_type} nahi mil paayi. Location check karo ya thodi der baad try karo."

    label_map = {"hospital": "Hospitals/Clinics", "pharmacy": "Pharmacies", "doctor": "Doctors"}
    lines = [f"Aapke aas-paas ye {label_map.get(place_type, place_type)} mile hain:\n"]

    for p in places:
        maps_link = f"https://www.google.com/maps?q={p['lat']},{p['lon']}" if p["lat"] and p["lon"] else ""
        lines.append(
            f"📍 **{p['name']}**\n"
            f"   {p['address']}\n"
            f"   📞 {p['phone']}\n"
            f"   🕒 {p['opening_hours']}\n"
            + (f"   🗺️ {maps_link}\n" if maps_link else "")
        )

    return "\n".join(lines)


# =========================================================
# FASTAPI APP
# =========================================================

list_of_Query = []
chat_history = []  # simple in-memory chat history (resets on server restart)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# simple in-memory user info store (phone number + live GPS location)
user_info = {
    "phone_number": None,
    "phone_verified": False,
    "latitude": None,
    "longitude": None
}

# in-memory OTP store: { phone_number: {"otp": "1234", "expires_at": timestamp} }
otp_store = {}
OTP_EXPIRY_SECONDS = 300  # 5 minute


@app.get("/")
def read_root():
    return {"message": "Backend chal raha hai!"}


# Step 1: User phone number daalta hai -> yaha OTP generate hota hai
# DEMO NOTE: Abhi real SMS gateway (Twilio / MSG91 / Fast2SMS) connected nahi hai,
# isliye OTP yahi response me bhi bhej rahe hain taaki test kar sako.
@app.post("/send-otp")
def send_otp(phone_number: str):
    phone_number = (phone_number or "").strip()
    if not phone_number:
        raise HTTPException(status_code=400, detail="Phone number is required")

    otp = str(random.randint(1000, 9999))
    otp_store[phone_number] = {
        "otp": otp,
        "expires_at": time.time() + OTP_EXPIRY_SECONDS
    }

    send_sms_otp(phone_number, otp)  # abhi ye sirf console pe print karega (demo)

    return {
        "message": f"OTP {phone_number} pe bhej diya gaya (demo mode)",
        "otp": otp,  # DEMO ONLY — real SMS gateway lagne ke baad ye line hata dena
        "expires_in_seconds": OTP_EXPIRY_SECONDS
    }


def send_sms_otp(phone_number: str, otp: str):
    # DEMO: abhi sirf terminal me print ho raha hai.
    # Real SMS gateway (Twilio / MSG91 / Fast2SMS) integrate karne ke baad
    # yahan uska API call daal dena.
    print(f"[DEMO SMS] {phone_number} ko OTP bheja gaya: {otp}")


# Step 2: User OTP verify karta hai
@app.post("/verify-otp")
def verify_otp(phone_number: str, otp: str):
    phone_number = (phone_number or "").strip()
    otp = (otp or "").strip()

    record = otp_store.get(phone_number)
    if not record:
        raise HTTPException(status_code=400, detail="Pehle OTP mangwao (/send-otp)")
    if time.time() > record["expires_at"]:
        del otp_store[phone_number]
        raise HTTPException(status_code=400, detail="OTP expire ho gaya, dobara mangwao")
    if otp != record["otp"]:
        raise HTTPException(status_code=400, detail="Galat OTP, phir se try karo")

    user_info["phone_number"] = phone_number
    user_info["phone_verified"] = True
    del otp_store[phone_number]

    return {"message": "Phone number verify ho gaya", "phone_number": phone_number}


# Step 3: Verify hone ke baad frontend live GPS coordinates bhejega
@app.post("/register-location")
def register_location(latitude: float, longitude: float):
    if not user_info["phone_verified"]:
        raise HTTPException(status_code=400, detail="Pehle phone number verify karo (/verify-otp)")

    user_info["latitude"] = latitude
    user_info["longitude"] = longitude

    return {
        "message": "Location save ho gayi",
        "latitude": latitude,
        "longitude": longitude
    }


# Frontend check kar sakta hai ki user pura registered hai ya nahi
@app.get("/user-info")
def get_user_info():
    return user_info


# Standalone endpoint (optional) — frontend directly bhi nearby places maang sakta hai
@app.get("/nearby-places")
def nearby_places_endpoint(place_type: str = "hospital", radius: int = 500000):
    if not user_info["phone_verified"]:
        raise HTTPException(status_code=400, detail="Pehle apna phone number OTP se verify karo")
    if user_info["latitude"] is None or user_info["longitude"] is None:
        raise HTTPException(status_code=400, detail="Pehle apni live location allow karo")

    places = find_nearby_health_places(
        user_info["latitude"], user_info["longitude"], place_type=place_type, radius=radius
    )
    return {"place_type": place_type, "results": places}


@app.post("/chat")
def chat_endpoint(user_message: str):
    # Chat tabhi allow karo jab phone verified ho aur live location mil chuki ho
    if not user_info["phone_verified"]:
        raise HTTPException(status_code=400, detail="Pehle apna phone number OTP se verify karo")
    if user_info["latitude"] is None or user_info["longitude"] is None:
        raise HTTPException(status_code=400, detail="Pehle apni live location allow karo")

    try:
        # Pehle check karo ki user nearby hospital/pharmacy/doctor maang raha hai ya nahi
        place_type = wants_nearby_places(user_message)
        print("DETECTED PLACE TYPE:", place_type)

        if place_type:
            places = find_nearby_health_places(
                user_info["latitude"], user_info["longitude"], place_type=place_type
            )
            answer = format_places_reply(places, place_type)

            chat_history.append({"role": "user", "content": user_message})
            chat_history.append({"role": "assistant", "content": answer})
            return {"reply": answer}

        # Normal RAG-based chatbot flow
        embed_query = embedding_model.encode(user_message)
        top_results = reviratriy(embed_query, top_k=2)
        rag_context = "\n\n".join([text for score, text in top_results])
        answer = response(user_message, chat_history, rag_context)
        return {"reply": answer}

    except Exception as e:
        print("ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=str(e))
