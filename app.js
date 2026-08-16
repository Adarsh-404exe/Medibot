/* MediBot Frontend Logic */
(() => {
  const API = ""; // same-origin
  let CONFIG = null;       // { translations, quickOptions, languages }
  let currentLang = localStorage.getItem("medibot_lang") || "en";
  let sessionId = null;
  let stage = "idle";      // idle | ask_gender | ask_age | ask_problem | followup
  let voiceEnabled = localStorage.getItem("medibot_voice") === "on";
  let recognition = null;
  let isListening = false;

  const SPEECH_LANG_MAP = { en: "en-US", hi: "hi-IN", es: "es-ES", fr: "fr-FR" };

  const el = {
    langSelectNav: document.getElementById("lang-select-nav"),
    langSelectChat: document.getElementById("lang-select-chat"),
    chatFab: document.getElementById("chat-fab"),
    navChatBtn: document.getElementById("nav-chat-btn"),
    heroChatBtn: document.getElementById("hero-chat-btn"),
    chatWidget: document.getElementById("chat-widget"),
    closeChat: document.getElementById("close-chat"),
    restartChat: document.getElementById("restart-chat"),
    chatBody: document.getElementById("chat-body"),
    quickRow: document.getElementById("quick-options-row"),
    typing: document.getElementById("typing-indicator"),
    typingLabel: document.getElementById("typing-label"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    headerName: document.getElementById("chat-header-name"),
    headerStatus: document.getElementById("chat-header-status"),
    micBtn: document.getElementById("mic-btn"),
    voiceToggle: document.getElementById("voice-toggle"),
  };

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  async function init() {
    const res = await fetch(`${API}/api/config`);
    CONFIG = await res.json();
    populateLangSelectors();
    applyStaticTranslations();
    setupVoice();
    bindEvents();
  }

  function populateLangSelectors() {
    const names = { en: "English", hi: "हिंदी", es: "Español", fr: "Français" };
    [el.langSelectNav, el.langSelectChat].forEach((sel) => {
      sel.innerHTML = "";
      CONFIG.languages.forEach((code) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = names[code] || code;
        if (code === currentLang) opt.selected = true;
        sel.appendChild(opt);
      });
    });
  }

  function tr(key) {
    const dict = CONFIG.translations[currentLang] || CONFIG.translations.en;
    return dict[key] || CONFIG.translations.en[key] || key;
  }

  function applyStaticTranslations() {
    document.title = tr("siteTitle");
    setText("hero-title", tr("heroTitle"));
    setText("hero-subtitle", tr("heroSubtitle"));
    setText("hero-cta-text", tr("heroCta"));
    setText("features-title", tr("featuresTitle"));
    setText("f1-title", tr("feature1Title"));
    setText("f1-desc", tr("feature1Desc"));
    setText("f2-title", tr("feature2Title"));
    setText("f2-desc", tr("feature2Desc"));
    setText("f3-title", tr("feature3Title"));
    setText("f3-desc", tr("feature3Desc"));
    setText("f4-title", tr("feature4Title"));
    setText("f4-desc", tr("feature4Desc"));
    setText("how-title", tr("howTitle"));
    setText("how1", tr("how1"));
    setText("how2", tr("how2"));
    setText("how3", tr("how3"));
    setText("how4", tr("how4"));
    setText("footer-disclaimer", tr("footerText"));
    setText("footer-text-2", tr("footerText"));
    setText("chat-header-name", tr("chatHeaderName"));
    setText("chat-header-status", tr("chatHeaderStatus"));
    setText("typing-label", tr("thinking"));
    el.chatInput.placeholder = tr("chatPlaceholder");
  }

  function setText(id, val) {
    const node = document.getElementById(id);
    if (node) node.textContent = val;
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------
  function bindEvents() {
    el.chatFab.addEventListener("click", openChat);
    el.navChatBtn.addEventListener("click", openChat);
    el.heroChatBtn.addEventListener("click", openChat);
    el.closeChat.addEventListener("click", closeChat);
    el.restartChat.addEventListener("click", () => startSession(true));

    [el.langSelectNav, el.langSelectChat].forEach((sel) => {
      sel.addEventListener("change", (e) => {
        currentLang = e.target.value;
        localStorage.setItem("medibot_lang", currentLang);
        [el.langSelectNav, el.langSelectChat].forEach((s) => (s.value = currentLang));
        applyStaticTranslations();
        renderQuickOptions();
      });
    });

    el.chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = el.chatInput.value.trim();
      if (!val) return;
      el.chatInput.value = "";
      handleUserTurn(val);
      hideQuickOptions();
    });

    // Show quick-suggestion chips only while the user is focused on the
    // input box (i.e. about to type / choose). Hide them the rest of the
    // time so they don't block the bot's answer.
    el.chatInput.addEventListener("focus", showQuickOptions);
    el.chatInput.addEventListener("blur", () => {
      // small delay so a chip click (which also blurs the input) still registers
      setTimeout(hideQuickOptions, 150);
    });

    if (el.micBtn) el.micBtn.addEventListener("click", toggleListening);
    if (el.voiceToggle) el.voiceToggle.addEventListener("click", toggleVoiceReply);
  }

  function showQuickOptions() {
    el.quickRow.classList.remove("chip-row--hidden");
  }
  function hideQuickOptions() {
    el.quickRow.classList.add("chip-row--hidden");
  }

  function openChat() {
    el.chatWidget.classList.add("open");
    el.chatWidget.setAttribute("aria-hidden", "false");
    if (!sessionId) startSession();
  }
  function closeChat() {
    el.chatWidget.classList.remove("open");
    el.chatWidget.setAttribute("aria-hidden", "true");
  }

  // ---------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------
  async function startSession(reset = false) {
    el.chatBody.innerHTML = "";
    el.quickRow.innerHTML = "";
    const res = await fetch(`${API}/api/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: currentLang }),
    });
    const data = await res.json();
    sessionId = data.sessionId;
    stage = "ask_gender";
    data.messages.forEach((m) => renderBotMessage(m));
    renderGenderChips();
  }

  function renderGenderChips() {
    el.quickRow.innerHTML = "";
    const label = document.createElement("div");
    label.className = "chip-row-label";
    el.quickRow.appendChild(label);
    ["genderMale", "genderFemale", "genderOther"].forEach((key) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = tr(key);
      chip.addEventListener("click", () => handleUserTurn(tr(key)));
      el.quickRow.appendChild(chip);
    });
    hideQuickOptions();
  }

  function renderQuickOptions() {
    if (stage !== "ask_problem" && stage !== "followup") return;
    el.quickRow.innerHTML = "";
    const label = document.createElement("div");
    label.className = "chip-row-label";
    label.textContent = tr("quickOptionsLabel");
    el.quickRow.appendChild(label);
    CONFIG.quickOptions.forEach((opt) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.innerHTML = `<span>${opt.emoji}</span> ${opt.label[currentLang] || opt.label.en}`;
      chip.addEventListener("click", () => handleUserTurn(opt.query[currentLang] || opt.query));
      el.quickRow.appendChild(chip);
    });
    hideQuickOptions();
  }

  // ---------------------------------------------------------------------
  // Chat turn handling
  // ---------------------------------------------------------------------
  async function handleUserTurn(text) {
    renderUserMessage(text);
    el.quickRow.innerHTML = "";
    showTyping(true);

    const minDelay = new Promise((r) => setTimeout(r, 650)); // let the "thinking" doctor emoji show briefly
    const fetchPromise = fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text, lang: currentLang }),
    }).then((r) => r.json());

    const [data] = await Promise.all([fetchPromise, minDelay]);
    showTyping(false);

    data.messages.forEach((m) => renderBotMessage(m));
    updateStageAfterServerReply(data);
  }

  function updateStageAfterServerReply(data) {
    const types = data.messages.map((m) => m.type);
    if (types.includes("text") && stage === "ask_gender") {
      stage = "ask_age";
    } else if (types.includes("problem_prompt")) {
      stage = "ask_problem";
      renderQuickOptions();
    } else if (types.includes("diagnosis") || (stage === "ask_problem")) {
      stage = "followup";
      renderQuickOptions();
    } else if (stage === "followup") {
      renderQuickOptions();
    }
  }

  // ---------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------
  function renderUserMessage(text) {
    const div = document.createElement("div");
    div.className = "msg msg--user";
    div.textContent = text;
    el.chatBody.appendChild(div);
    scrollToBottom();
  }

  function renderBotMessage(m) {
    const div = document.createElement("div");
    div.className = "msg msg--bot";
    if (m.type === "disclaimer") div.classList.add("msg--disclaimer");
    if (m.type === "diagnosis") div.classList.add("msg--diagnosis");
    div.innerHTML = mdToHtml(m.text);
    el.chatBody.appendChild(div);
    scrollToBottom();
    if (voiceEnabled) speakText(m.text);
  }

  function mdToHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br/>");
  }

  function showTyping(on) {
    el.typing.hidden = !on;
    if (on) scrollToBottom();
  }

  function scrollToBottom() {
    el.chatBody.scrollTop = el.chatBody.scrollHeight;
  }

  // ---------------------------------------------------------------------
  // Voice: Speech-to-Text (mic input) + Text-to-Speech (bot reply)
  // ---------------------------------------------------------------------
  function setupVoice() {
    // Speech-to-text setup
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionAPI) {
      recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        el.chatInput.value = transcript;
        stopListening();
        // Auto-send what was spoken
        el.chatForm.requestSubmit();
      };
      recognition.onerror = () => stopListening();
      recognition.onend = () => stopListening();
    } else if (el.micBtn) {
      // Browser doesn't support speech recognition (e.g. Firefox) — hide mic button
      el.micBtn.style.display = "none";
    }

    // Text-to-speech: reflect saved preference on the toggle button
    if (el.voiceToggle) {
      el.voiceToggle.textContent = voiceEnabled ? "🔊" : "🔈";
      el.voiceToggle.classList.toggle("active", voiceEnabled);
    }
    if (!("speechSynthesis" in window) && el.voiceToggle) {
      el.voiceToggle.style.display = "none";
    }
  }

  function toggleListening() {
    if (!recognition) return;
    if (isListening) {
      stopListening();
      return;
    }
    try {
      recognition.lang = SPEECH_LANG_MAP[currentLang] || "en-US";
      recognition.start();
      isListening = true;
      el.micBtn.classList.add("listening");
    } catch (e) {
      stopListening();
    }
  }

  function stopListening() {
    isListening = false;
    if (el.micBtn) el.micBtn.classList.remove("listening");
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* no-op */ }
    }
  }

  function toggleVoiceReply() {
    voiceEnabled = !voiceEnabled;
    localStorage.setItem("medibot_voice", voiceEnabled ? "on" : "off");
    el.voiceToggle.textContent = voiceEnabled ? "🔊" : "🔈";
    el.voiceToggle.classList.toggle("active", voiceEnabled);
    if (!voiceEnabled) window.speechSynthesis.cancel();
  }

  function speakText(text) {
    if (!("speechSynthesis" in window)) return;
    // Strip markdown/formatting so it reads naturally
    const clean = text
      .replace(/\*\*/g, "")
      .replace(/•/g, "")
      .replace(/[💊🛡️ℹ️⚠️🙏🩺]/gu, "")
      .replace(/\n+/g, ". ");
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = SPEECH_LANG_MAP[currentLang] || "en-US";
    window.speechSynthesis.cancel(); // stop any earlier speech before starting new
    window.speechSynthesis.speak(utterance);
  }

  init();
})();
