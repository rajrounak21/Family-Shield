/* ═══════════════════════════════════════════
   FamilyShield AI Chat — Frontend
   ═══════════════════════════════════════════ */

const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;

const TOKEN_KEY = "familyshield_token";

let currentConversationId = null;
let currentSharedId = null;
let readOnlyMode = false;
let selectedImageFile = null;
let selectedImageId = null;

// ─── DOM ───
const sidebar = document.getElementById("ai-sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const convList = document.getElementById("conversation-list");
const newChatBtn = document.getElementById("new-chat-btn");
const emptyState = document.getElementById("ai-empty");
const messagesContainer = document.getElementById("ai-messages");
const stagesEl = document.getElementById("ai-stages");
const textInput = document.getElementById("ai-text-input");
const sendBtn = document.getElementById("send-btn");
const imageInput = document.getElementById("image-input");
const imagePreview = document.getElementById("image-preview");
const previewImg = document.getElementById("preview-img");
const removeImage = document.getElementById("remove-image");
const threadEl = document.getElementById("ai-thread");
const threadHeader = document.getElementById("ai-thread-header");
const threadTitle = document.getElementById("ai-thread-title");
const shareBtn = document.getElementById("ai-share-btn");
const shareStatus = document.getElementById("ai-share-status");
const composerWrap = document.querySelector(".ai-composer-wrap");
const sharedSection = document.getElementById("shared-section");
const sharedList = document.getElementById("shared-list");
const openSharedBtn = document.getElementById("open-shared-btn");

// ─── Auth ───
function token() {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const tok = token();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: t("common.requestFailed") }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Sidebar ───
function isMobile() {
  return window.innerWidth <= 768;
}

function showHamburger() {
  syncMobileChrome();
}

function hideHamburger() {
  syncMobileChrome();
}

// Single source of truth for the mobile floating toggle:
// visible only when there is no thread header (empty state)
// and the sidebar is closed. Desktop is pure CSS.
function syncMobileChrome() {
  if (!isMobile()) {
    sidebarToggle.style.display = "";
    return;
  }
  const headerVisible = !threadHeader.classList.contains("hidden");
  const sidebarOpen = sidebar.classList.contains("open");
  sidebarToggle.style.display = (!headerVisible && !sidebarOpen) ? "flex" : "none";
}

function openSidebar() {
  sidebar.classList.add("open");
  syncMobileChrome();
}

sidebarToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  openSidebar();
});

const threadMenuBtn = document.getElementById("thread-menu-btn");
threadMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openSidebar();
});

window.addEventListener("resize", () => {
  sidebarToggle.style.display = "";
  syncMobileChrome();
});

sidebar.addEventListener("click", (e) => {
  e.stopPropagation();
});

document.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) {
    sidebar.classList.remove("open");
    showHamburger();
  }
});

// ─── Conversations ───
async function loadConversations() {
  try {
    const convs = await apiFetch("/ai/conversations");
    if (convs.length === 0) {
      convList.innerHTML = `<div class="ai-sidebar-empty">${t("ai.noConversations")}</div>`;
      return;
    }
    convList.innerHTML = convs.map(c => `
      <div class="ai-conv-item ${c.conversation_id === currentConversationId ? 'active' : ''}"
           data-id="${c.conversation_id}">
        <svg class="ai-conv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span class="ai-conv-title">${escHtml(c.title)}</span>
        <div class="ai-conv-menu-wrap">
          <button class="ai-conv-dots" data-id="${c.conversation_id}" title="${t("ai.more")}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          <div class="ai-conv-menu" data-id="${c.conversation_id}">
            <button class="ai-conv-menu-item ai-conv-menu-open">Open</button>
            <button class="ai-conv-menu-item ai-conv-menu-cancel">${t("common.cancel")}</button>
            <button class="ai-conv-menu-item ai-conv-menu-delete">${t("common.delete")}</button>
          </div>
        </div>
      </div>
    `).join("");

    convList.querySelectorAll(".ai-conv-title").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openConversation(el.closest(".ai-conv-item").dataset.id);
        sidebar.classList.remove("open");
        showHamburger();
      });
    });

    convList.querySelectorAll(".ai-conv-dots").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = btn.nextElementSibling;
        document.querySelectorAll(".ai-conv-menu").forEach(m => { if (m !== menu) m.classList.remove("open"); });
        menu.classList.toggle("open");
      });
    });

    convList.querySelectorAll(".ai-conv-menu-open").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.closest(".ai-conv-menu").dataset.id;
        openConversation(id);
        sidebar.classList.remove("open");
        showHamburger();
      });
    });

    convList.querySelectorAll(".ai-conv-menu-cancel").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.closest(".ai-conv-menu").classList.remove("open");
      });
    });

    convList.querySelectorAll(".ai-conv-menu-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.closest(".ai-conv-menu").dataset.id;
        document.querySelectorAll(".ai-conv-menu").forEach(m => m.classList.remove("open"));
        showDeleteModal(id);
      });
    });

    document.addEventListener("click", () => {
      document.querySelectorAll(".ai-conv-menu").forEach(m => m.classList.remove("open"));
    });
  } catch (e) {
    console.error("Failed to load conversations:", e);
  }
}

// ─── Shared Conversations ───
async function loadSharedConversations() {
  try {
    const items = await apiFetch("/ai/share/shared-with-me");
    if (items.length === 0) {
      sharedSection.classList.add("hidden");
      return;
    }
    sharedSection.classList.remove("hidden");
    sharedList.innerHTML = items.map(s => `
      <div class="ai-conv-item ai-conv-shared ${s.share_id === currentSharedId ? 'active' : ''}"
           data-sid="${s.share_id}">
        <svg class="ai-conv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        <div class="ai-conv-shared-info">
          <span class="ai-conv-title">${t("ai.sharedBy", {name: escHtml(s.shared_by)})}</span>
          <span class="ai-conv-shared-date">${new Date(s.created_at).toLocaleDateString()}</span>
        </div>
      </div>
    `).join("");

    sharedList.querySelectorAll(".ai-conv-shared").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openSharedConversation(el.dataset.sid).catch(() => {});
        sidebar.classList.remove("open");
        showHamburger();
      });
    });
  } catch (e) {
    console.error("Failed to load shared conversations:", e);
  }
}

async function openSharedConversation(shareId) {
  currentSharedId = shareId;
  currentConversationId = null;
  readOnlyMode = true;
  msgCache.clear();
  showThread();

  try {
    const data = await apiFetch(`/ai/share/${shareId}/messages`);
    threadTitle.textContent = t("ai.sharedBy", {name: data.shared_by});
    messagesContainer.innerHTML = "";

    const banner = document.createElement("div");
    banner.className = "ai-readonly-banner";
    banner.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${t("ai.readOnlyShared")}`;
    messagesContainer.appendChild(banner);

    for (const msg of data.messages) {
      appendMessage(msg, false);
      rememberAiMsg(msg);
    }
    scrollToBottom();
    loadConversations();
    loadSharedConversations();
  } catch (e) {
    console.error("Failed to open shared conversation:", e);
    throw e;
  }
}

async function createConversation() {
  currentSharedId = null;
  readOnlyMode = false;
  try {
    const conv = await apiFetch("/ai/conversations", { method: "POST" });
    currentConversationId = conv.conversation_id;
    messagesContainer.innerHTML = "";
    showThread();
    await loadConversations();
    textInput.focus();
  } catch (e) {
    console.error("Failed to create conversation:", e);
  }
}

function showThread() {
  emptyState.classList.add("hidden");
  threadHeader.classList.remove("hidden");
  messagesContainer.style.display = "flex";
  if (readOnlyMode) {
    shareBtn.classList.add("hidden");
    shareStatus.classList.add("hidden");
    composerWrap.classList.add("hidden");
  } else {
    shareBtn.classList.remove("hidden");
    composerWrap.classList.remove("hidden");
  }
  syncMobileChrome();
}

function showEmpty() {
  currentConversationId = null;
  currentSharedId = null;
  readOnlyMode = false;
  msgCache.clear();
  emptyState.classList.remove("hidden");
  threadHeader.classList.add("hidden");
  shareBtn.classList.remove("shared");
  shareStatus.classList.add("hidden");
  shareBtn.classList.remove("hidden");
  composerWrap.classList.remove("hidden");
  messagesContainer.style.display = "none";
  messagesContainer.innerHTML = "";
  syncMobileChrome();
}

async function openConversation(id) {
  currentConversationId = id;
  currentSharedId = null;
  readOnlyMode = false;
  msgCache.clear();
  showThread();

  try {
    const data = await apiFetch(`/ai/conversations/${id}`);
    threadTitle.textContent = data.title;
    messagesContainer.innerHTML = "";
    for (const msg of data.messages) {
      try {
        appendMessage(msg, false);
      } catch (err) {
        console.error("Failed to render message, showing plain fallback:", err);
        try {
          appendMessage({ role: msg.role, content: msg.content || "", message_id: msg.message_id }, false);
        } catch {
          appendMessage({ role: msg.role, content: t("common.requestFailed") }, false);
        }
      }
      rememberAiMsg(msg);
    }
    scrollToBottom();
    loadConversations();
    checkShareStatus(id);
  } catch (e) {
    console.error("Failed to open conversation:", e);
  }
}

async function deleteConversation(id) {
  try {
    await apiFetch(`/ai/conversations/${id}`, { method: "DELETE" });
    if (currentConversationId === id) showEmpty();
    await loadConversations();
  } catch (e) {
    console.error("Failed to delete conversation:", e);
  }
}

// ─── Delete Confirmation Modal ───
function showDeleteModal(id) {
  const overlay = document.createElement("div");
  overlay.className = "ai-modal-overlay";
  overlay.innerHTML = `
    <div class="ai-modal">
      <p>Delete this conversation?</p>
      <div class="ai-modal-btns">
        <button class="ai-modal-btn ai-modal-no">${t("common.cancel")}</button>
        <button class="ai-modal-btn ai-modal-yes">${t("common.delete")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector(".ai-modal-no").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".ai-modal-yes").addEventListener("click", async () => {
    overlay.remove();
    await deleteConversation(id);
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── Messages ───
const msgCache = new Map();

function rememberAiMsg(m) {
  if (m && m.message_id) msgCache.set(m.message_id, m);
}

function appendMessage(msg, animate = true) {
  const role = msg.role;
  const content = msg.content;
  const metadata = msg.metadata;
  const imageId = msg.image_id;
  const div = document.createElement("div");
  if (msg.message_id) div.dataset.mid = msg.message_id;
  div.dataset.role = role;
  const tok = token();
  const imgSrc = imageId
    ? `${API_BASE}/ai/images/${imageId}${tok ? `?token=${encodeURIComponent(tok)}` : ""}`
    : "";
  const imgHtml = imageId
    ? `<img class="ai-msg-image" src="${imgSrc}" alt="Uploaded image" loading="lazy" />`
    : "";
  const editedHtml = msg.is_edited ? ` <span class="ai-edited-label">${t("ai.edited")}</span>` : "";

  if (role === "user") {
    div.className = "ai-msg ai-msg-user";
    div.innerHTML = `<div class="ai-msg-bubble">${imgHtml}<div class="ai-msg-content">${escHtml(content)}${editedHtml}</div></div>`;
  } else {
    const structured = metadata?.structured;
    const emergencyHtml = metadata?.emergency ? buildEmergencyCard(metadata.emergency) : "";
    const inner = emergencyHtml + ((structured && structured.risk_level)
      ? `<div class="ai-risk-card">${buildRiskCard(structured)}</div>`
      : `<div class="ai-msg-bubble"><div class="ai-msg-content">${formatAiText(content)}</div></div>`);
    const fb = msg.feedback;
    const fbHtml = (!readOnlyMode && msg.message_id)
      ? `<div class="ai-feedback-row">
          <button class="ai-fb-btn ${fb === "up" ? "active" : ""}" data-fb="up" data-mid="${msg.message_id}" type="button" title="${t("ai.helpful")}">👍</button>
          <button class="ai-fb-btn ${fb === "down" ? "active" : ""}" data-fb="down" data-mid="${msg.message_id}" type="button" title="${t("ai.notHelpful")}">👎</button>
          <button class="ai-askfam-btn" data-ask="${msg.message_id}" type="button" title="${t("ai.askFamilyTitle")}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            <span>${t("ai.askFamily")}</span>
          </button>
        </div>`
      : "";
    div.className = "ai-msg ai-msg-assistant";
    div.innerHTML = `
      <div class="ai-assistant-avatar">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="ai-assistant-body">${inner}${fbHtml}</div>`;
  }

  if (!animate) div.style.animation = "none";
  messagesContainer.appendChild(div);
  ensureAiMenuBtn(div, msg.message_id);
  return div;
}

function findAiMsgEl(messageId) {
  return messagesContainer.querySelector(`[data-mid="${messageId}"]`);
}

function ensureAiMenuBtn(el, messageId) {
  if (!el || readOnlyMode || !messageId) return;
  if (el.querySelector(":scope > .ai-msg-menu-btn")) return;
  const b = document.createElement("button");
  b.className = "ai-msg-menu-btn";
  b.dataset.mid = messageId;
  b.type = "button";
  b.title = t("ai.messageActions");
  b.textContent = "⋯";
  el.appendChild(b);
}

// Typing indicator while the pipeline runs
function showTyping() {
  hideTyping();
  const div = document.createElement("div");
  div.className = "ai-msg ai-msg-assistant";
  div.id = "ai-typing";
  div.innerHTML = `
    <div class="ai-assistant-avatar">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
    <div class="ai-typing-dots"><span></span><span></span><span></span></div>`;
  messagesContainer.appendChild(div);
  scrollToBottom();
}

function hideTyping() {
  document.getElementById("ai-typing")?.remove();
}

// Lightbox for AI images
messagesContainer.addEventListener("click", (e) => {
  const img = e.target.closest(".ai-msg-image");
  if (!img) return;
  const box = document.createElement("div");
  box.className = "ai-lightbox";
  box.innerHTML = `<img src="${img.src}" alt="Full image" />`;
  box.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
});

function buildEmergencyCard(kind) {
  const isMoney = kind === "money_lost";
  const title = isMoney ? t("emergency.title") : t("emergency.infoTitle");
  const steps = isMoney
    ? [t("emergency.money1"), t("emergency.money2"), t("emergency.money3"), t("emergency.money4"), t("emergency.money5")]
    : [t("emergency.info1"), t("emergency.info2"), t("emergency.info3"), t("emergency.info4")];
  return `<div class="ai-emergency">
    <div class="ai-emergency-title">${escHtml(title)}</div>
    <ol class="ai-emergency-steps">${steps.map(s => `<li>${escHtml(s)}</li>`).join("")}</ol>
    <div class="ai-emergency-actions">
      <a class="ai-emergency-btn" href="tel:1930">📞 ${escHtml(t("emergency.call1930"))}</a>
      <a class="ai-emergency-btn ai-emergency-btn-secondary" href="https://cybercrime.gov.in" target="_blank" rel="noopener">🌐 ${escHtml(t("emergency.reportOnline"))}</a>
    </div>
    <p class="ai-emergency-note">${escHtml(t("emergency.disclaimer"))}</p>
  </div>`;
}

function buildRiskCard(data) {
  const level = data.risk_level || "unable_to_assess";
  const labels = { high: t("ai.highRisk"), medium: t("ai.mediumRisk"), low: t("ai.lowRisk"), unable_to_assess: t("ai.unableToAssess") };
  const icons = { high: "⚠️", medium: "🟠", low: "✅", unable_to_assess: "⚪" };

  let html = `
    <div class="ai-risk-header ${level}">
      <span class="ai-risk-badge">${icons[level] || "⚪"}</span>
      <span>${labels[level] || t("ai.analysisComplete")}</span>
    </div>
    <div class="ai-risk-body">`;

  if (data.summary) {
    html += `<div class="ai-risk-section"><p class="ai-risk-summary">${escHtml(data.summary)}</p></div>`;
  }

  if (data.indicators?.length) {
    html += `<div class="ai-risk-section">
      <div class="ai-risk-section-title">${t("ai.why")}</div>
      <ul class="ai-risk-list">${data.indicators.map(i => `<li>${escHtml(i)}</li>`).join("")}</ul>
    </div>`;
  }

  if (data.explanation?.length) {
    html += `<div class="ai-risk-section">
      <div class="ai-risk-section-title">${t("ai.explanation")}</div>
      <ul class="ai-risk-list">${data.explanation.map(e => `<li>${escHtml(e)}</li>`).join("")}</ul>
    </div>`;
  }

  if (data.recommended_actions?.length) {
    html += `<div class="ai-risk-section">
      <div class="ai-risk-section-title">${t("ai.recommendedActions")}</div>
      <ul class="ai-risk-list">${data.recommended_actions.map(a => `<li>${escHtml(a)}</li>`).join("")}</ul>
    </div>`;
  }

  html += `</div>`;
  return html;
}

function formatAiText(text) {
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ─── Toast (same .fs-toast style as main app, no alert() popups) ───
function showToast(msg) {
  let toast = document.getElementById("fs-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "fs-toast";
    toast.className = "fs-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

// ─── Stages (driven by backend pipeline metadata) ───
function showStages() {
  stagesEl.classList.remove("hidden");
  stagesEl.innerHTML = "";
}

function renderStages(stages) {
  if (!stages || !stages.length) return;
  stagesEl.classList.remove("hidden");
  stagesEl.innerHTML = stages.map(s => {
    const icon = s.status === "failed" ? "✕" : s.status === "skipped" ? "–" : "✓";
    return `<div class="ai-stage done"><span>${icon}</span><span>${escHtml(s.label)}</span></div>`;
  }).join("");
  setTimeout(hideStages, 4000);
}

function hideStages() {
  stagesEl.classList.add("hidden");
  stagesEl.innerHTML = "";
}

// ─── Send Message ───
async function sendMessage() {
  const text = textInput.value.trim();
  if (!text && !selectedImageFile) return;
  if (!currentConversationId) await createConversation();

  const content = text || t("ai.analyzeImage");

  // Upload image if selected (dedicated AI endpoint — separate from family chat)
  let imageId = null;
  if (selectedImageFile) {
    try {
      const formData = new FormData();
      formData.append("file", selectedImageFile);
      const tok = token();
      const uploadRes = await fetch(`${API_BASE}/ai/upload`, {
        method: "POST",
        headers: tok ? { "Authorization": `Bearer ${tok}` } : {},
        body: formData,
      });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        imageId = uploadData.image_id;
      } else {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.detail || t("ai.imageUploadFailed"));
      }
    } catch (e) {
      console.error("Image upload failed:", e);
      appendMessage({ role: "assistant", content: `${t("ai.imageUploadFailed")}: ${e.message}` });
      scrollToBottom();
      sendBtn.disabled = false;
      return;
    }
    clearImage();
  }

  // Show user message (with image if attached)
  const userEl = appendMessage({ role: "user", content }, true);
  if (imageId) {
    const tok = token();
    const src = `${API_BASE}/ai/images/${imageId}${tok ? `?token=${encodeURIComponent(tok)}` : ""}`;
    const bubble = userEl.querySelector(".ai-msg-bubble");
    if (bubble) bubble.insertAdjacentHTML("afterbegin", `<img class="ai-msg-image" src="${src}" alt="Uploaded image" loading="lazy" />`);
  }
  scrollToBottom();
  if (!currentConversationId || emptyStateVisible()) showThread();

  // Clear input
  textInput.value = "";
  textInput.style.height = "auto";

  // Show live progress while pipeline runs.
  // Everything from here is inside try so a failure ALWAYS shows an error
  // bubble instead of silently leaving the thread empty.
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 150000);
  try {
    showStages();
    stagesEl.innerHTML = '<div class="ai-stage active"><span>●</span><span>' + t("ai.analyzing") + '</span></div>';
    showTyping();
    sendBtn.disabled = true;

    const body = { content };
    if (imageId) body.image_id = imageId;

    const msg = await apiFetch(`/ai/conversations/${currentConversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    // Render the real pipeline stages returned by the backend
    hideTyping();
    const assistantMsg = msg.assistant_message || msg;
    renderStages(assistantMsg.metadata?.processing_stages);
    // Tag the optimistic user bubble with its real id for edit/delete
    if (msg.user_message && msg.user_message.message_id) {
      rememberAiMsg(msg.user_message);
      if (userEl) {
        userEl.dataset.mid = msg.user_message.message_id;
        userEl.dataset.role = "user";
        ensureAiMenuBtn(userEl, msg.user_message.message_id);
      }
      const um = msg.user_message;
      if (um.is_edited && userEl) {
        const c = userEl.querySelector(".ai-msg-content");
        if (c && !c.querySelector(".ai-edited-label")) c.insertAdjacentHTML("beforeend", ` <span class="ai-edited-label">${t("ai.edited")}</span>`);
      }
    }
    rememberAiMsg(assistantMsg);
    appendMessage(assistantMsg, true);
    scrollToBottom();
    loadConversations();
  } catch (e) {
    hideTyping();
    hideStages();
    const errText = e && e.name === "AbortError" ? t("ai.timeout") : e.message;
    appendMessage({ role: "assistant", content: `${t("common.errorPrefix")}${errText}` });
    scrollToBottom();
  } finally {
    clearTimeout(timeoutId);
    sendBtn.disabled = false;
  }
}

function emptyStateVisible() {
  return !emptyState.classList.contains("hidden");
}

// ─── Image Upload ───
imageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast(t("ai.imageTooLarge"));
    return;
  }
  selectedImageFile = file;
  previewImg.src = URL.createObjectURL(file);
  imagePreview.classList.remove("hidden");
});

removeImage.addEventListener("click", () => clearImage());

function clearImage() {
  selectedImageFile = null;
  selectedImageId = null;
  imageInput.value = "";
  imagePreview.classList.add("hidden");
}

// ─── Input Handling ───
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

textInput.addEventListener("input", () => {
  textInput.style.height = "auto";
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
});

sendBtn.addEventListener("click", sendMessage);

// ─── Suggestions (fill only) ───
document.querySelectorAll(".ai-suggestion").forEach(btn => {
  btn.addEventListener("click", () => {
    textInput.value = btn.dataset.text;
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
    textInput.focus();
  });
});

// ─── New Chat ───
newChatBtn.addEventListener("click", () => {
  showEmpty();
  loadConversations();
  loadSharedConversations();
  textInput.focus();
});

// ─── Share ───
async function checkShareStatus(convId) {
  try {
    const data = await apiFetch(`/ai/conversations/${convId}/share`);
    if (data.shared) {
      shareBtn.classList.add("shared");
      shareStatus.classList.remove("hidden");
    } else {
      shareBtn.classList.remove("shared");
      shareStatus.classList.add("hidden");
    }
  } catch (e) {
    shareBtn.classList.remove("shared");
    shareStatus.classList.add("hidden");
  }
}

async function shareConversation() {
  if (!currentConversationId || shareBtn.disabled) return;
  shareBtn.disabled = true;

  try {
    const data = await apiFetch(`/ai/conversations/${currentConversationId}/share`, {
      method: "POST",
    });
    showShareModal(data.share_id, data.link);
    shareBtn.classList.add("shared");
    shareStatus.classList.remove("hidden");
  } catch (e) {
    showToast(e.message || t("ai.shareFailed"));
  } finally {
    shareBtn.disabled = false;
  }
}

function showShareModal(shareId, link) {
  const overlay = document.createElement("div");
  overlay.className = "ai-modal-overlay";
  overlay.innerHTML = `
    <div class="ai-modal ai-share-modal">
      <h3>${t("ai.shareWithTitle")}</h3>
      <p class="ai-share-modal-sub">${t("ai.shareWithDesc")}</p>
      <div class="ai-share-link-box">
        <input type="text" class="ai-share-link-input" id="ai-share-link-input" value="${escHtml(link)}" readonly />
        <button class="ai-share-copy-btn" id="ai-share-copy-btn">${t("common.copy")}</button>
      </div>
      <p class="ai-share-modal-note">${t("ai.snapshotNote")}</p>
      <div class="ai-modal-btns">
        <button class="ai-share-stop-btn ai-share-stop" id="ai-share-stop-btn">${t("ai.stopSharing")}</button>
        <button class="ai-modal-btn ai-modal-no" id="ai-share-close-btn">${t("common.done")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#ai-share-link-input");
  input.select();
  input.setSelectionRange(0, 99999);

  overlay.querySelector("#ai-share-copy-btn").addEventListener("click", () => {
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(link).then(() => {
      overlay.querySelector("#ai-share-copy-btn").textContent = t("ai.copied");
      setTimeout(() => {
        overlay.querySelector("#ai-share-copy-btn").textContent = t("common.copy");
      }, 2000);
    });
  });

  overlay.querySelector("#ai-share-stop-btn").addEventListener("click", async () => {
    overlay.remove();
    await stopSharing(shareId);
  });

  overlay.querySelector("#ai-share-close-btn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

async function stopSharing(shareId) {
  try {
    await apiFetch(`/ai/share/${shareId}`, { method: "DELETE" });
    shareBtn.classList.remove("shared");
    shareStatus.classList.add("hidden");
  } catch (e) {
    showToast(e.message || t("ai.stopShareFailed"));
  }
}

shareBtn.addEventListener("click", shareConversation);

// ─── Open Shared Link (paste-link panel, reuses current session) ───
function parseShareId(input) {
  const text = (input || "").trim();
  if (!text) return null;

  // Full URL with ?sid=...
  let m = text.match(/[?&]sid=([^&\s#]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim();
    } catch (e) {
      return null;
    }
  }

  // Bare share id
  if (/^sh_[a-f0-9]{12}$/i.test(text)) return text;

  return null;
}

function shareErrorText(msg) {
  msg = (msg && String(msg)) || "";
  if (/404|not found|invalid|expired/i.test(msg)) {
    return "This link is invalid or has expired. Ask the sender for a fresh link.";
  }
  if (/403|not a member|denied/i.test(msg)) {
    return "This conversation wasn't shared with your family.";
  }
  if (/410|no longer available|stopped/i.test(msg)) {
    return "The owner has stopped sharing this conversation.";
  }
  return msg || "Couldn't open this link. Please try again.";
}

function showOpenSharedModal() {  const overlay = document.createElement("div");
  overlay.className = "ai-modal-overlay";
  overlay.innerHTML = `
    <div class="ai-modal ai-open-shared-modal">
      <h3>${t("ai.openSharedTitle")}</h3>
      <p class="ai-open-shared-sub">${t("ai.openSharedDesc")}</p>
      <input type="text" class="ai-open-shared-input" id="ai-open-shared-input" placeholder="${t("ai.pasteShareLink")}" autocomplete="off" />
      <p class="ai-open-shared-error hidden" id="ai-open-shared-error"></p>
      <div class="ai-open-shared-guide">
        <div class="ai-open-shared-guide-title">How it works</div>
        <ol>
          <li>Ask a family member to press <strong>Share</strong> on their chat and copy the link.</li>
          <li>Paste the link above and press <strong>Open</strong>.</li>
          <li>The conversation opens here, read-only. Only your family can view it.</li>
        </ol>
      </div>
      <div class="ai-modal-btns">
        <button class="ai-modal-btn ai-modal-no" id="ai-open-shared-cancel">${t("common.cancel")}</button>
        <button class="ai-modal-btn ai-modal-open" id="ai-open-shared-go">Open</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#ai-open-shared-input");
  const errEl = overlay.querySelector("#ai-open-shared-error");
  input.focus();

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }

  async function submit() {
    errEl.classList.add("hidden");
    const sid = parseShareId(input.value);
    if (!sid) {
      showError("That doesn't look like a valid share link. It should contain an ID like sh_…");
      return;
    }
    overlay.querySelector("#ai-open-shared-go").disabled = true;
    try {
      await openSharedConversation(sid);
      sidebar.classList.remove("open");
      showHamburger();
      overlay.remove();
    } catch (e) {
      showError(shareErrorText(e && e.message));
      overlay.querySelector("#ai-open-shared-go").disabled = false;
    }
  }

  overlay.querySelector("#ai-open-shared-go").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  overlay.querySelector("#ai-open-shared-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

openSharedBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  showOpenSharedModal();
});

// ─── Message actions (floating bubble menu) ───
function closeAiMessageMenu() {
  document.querySelector(".ai-menu-overlay")?.remove();
}

function openAiMessageMenu(msg, anchorEl) {
  if (!msg || !msg.message_id || readOnlyMode || !anchorEl) return;

  closeAiMessageMenu();

  const icons = {
    edit: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
  };
  const overlay = document.createElement("div");
  overlay.className = "ai-menu-overlay";
  const isUser = msg.role === "user";
  overlay.innerHTML = `
    <div class="ai-menu" role="menu">
      <div class="ai-menu-actions">
        ${isUser && !msg.image_id ? `<button class="ai-menu-btn" data-act="edit" type="button">${icons.edit}<span>${t("ai.editRerun")}</span></button>` : ""}
        ${isUser ? `<button class="ai-menu-btn ai-menu-danger" data-act="delete" type="button">${icons.trash}<span>${t("common.delete")}</span></button>` : `<button class="ai-menu-btn ai-menu-danger" data-act="delete" type="button">${icons.trash}<span>${t("ai.deleteAnswer")}</span></button>`}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const menu = overlay.querySelector(".ai-menu");

  // Anchor to the small ⋯ button (not the whole bubble) so the menu
  // opens next to the tap point instead of under a tall card.
  const rect = anchorEl.getBoundingClientRect();
  menu.style.visibility = "hidden";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const margin = 10;
  let left = rect.left + rect.width / 2 - mw / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin));
  let placeAbove = rect.top > mh + 60;
  let top = placeAbove ? rect.top - mh - 8 : rect.bottom + 8;
  top = Math.max(margin, Math.min(top, window.innerHeight - mh - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.classList.add(placeAbove ? "ai-menu-above" : "ai-menu-below");
  menu.style.visibility = "";

  const close = () => closeAiMessageMenu();
  setTimeout(() => {
    document.addEventListener("click", close, { capture: true, once: true });
    document.addEventListener("scroll", close, { capture: true, once: true });
  }, 0);
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", esc);
    }
  });

  overlay.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      close();
      if (act === "edit") startAiEdit(msg.message_id);
      if (act === "delete") askAiDelete(msg.message_id);
    });
  });
}

function startAiEdit(messageId) {
  const msg = msgCache.get(messageId);
  if (!msg || msg.role !== "user" || readOnlyMode) return;
  const el = findAiMsgEl(messageId);
  const contentEl = el && el.querySelector(".ai-msg-content");
  if (!el || !contentEl || el.querySelector(".ai-edit-row")) return;

  const row = document.createElement("div");
  row.className = "ai-edit-row";
  row.innerHTML = `
    <textarea class="ai-edit-input" rows="2" maxlength="8000"></textarea>
    <div class="ai-edit-actions">
      <button class="ai-edit-save" type="button">${t("ai.saveRerun")}</button>
      <button class="ai-edit-cancel" type="button">${t("common.cancel")}</button>
    </div>`;
  const input = row.querySelector(".ai-edit-input");
  input.value = msg.content || "";
  contentEl.replaceWith(row);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const restoreEditor = () => {
    const cur = msgCache.get(messageId);
    const r = document.createElement("div");
    r.className = "ai-msg-content";
    const edited = cur && cur.is_edited ? ` <span class="ai-edited-label">${t("ai.edited")}</span>` : "";
    r.innerHTML = `${escHtml(cur ? cur.content : msg.content)}${edited}`;
    row.replaceWith(r);
  };

  const save = async () => {
    const val = input.value.trim();
    if (!val) {
      showToast(t("ai.msgEmpty"));
      return;
    }
    if (val === msg.content) {
      restoreEditor();
      return;
    }
    sendBtn.disabled = true;
    showStages();
  stagesEl.innerHTML = '<div class="ai-stage active"><span>●</span><span>' + t("ai.analyzing") + '</span></div>';
    showTyping();
    try {
      const data = await apiFetch(
        `/ai/conversations/${currentConversationId}/messages/${messageId}`,
        { method: "PATCH", body: JSON.stringify({ content: val }) },
      );
      hideTyping();
      hideStages();
      const um = data.user_message;
      rememberAiMsg(um);
      msgCache.set(messageId, um);
      restoreEditor();
      // Drop the stale assistant reply below, append the fresh one
      const userEl = findAiMsgEl(messageId);
      if (userEl) {
        let sib = userEl.nextElementSibling;
        if (sib && sib.dataset && sib.dataset.role === "assistant") sib.remove();
      }
      renderStages(data.assistant_message.metadata?.processing_stages);
      rememberAiMsg(data.assistant_message);
      appendMessage(data.assistant_message, true);
      scrollToBottom();
      loadConversations();
    } catch (e) {
      hideTyping();
      hideStages();
      showToast(t("common.errorPrefix") + e.message);
      restoreEditor();
    } finally {
      sendBtn.disabled = false;
    }
  };

  row.querySelector(".ai-edit-cancel").addEventListener("click", restoreEditor);
  row.querySelector(".ai-edit-save").addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") restoreEditor();
  });
}

function askAiDelete(messageId) {
  const msg = msgCache.get(messageId);
  if (!msg || readOnlyMode) return;
  const pairNote = msg.role === "user"
    ? "This removes your question <strong>and the AI reply</strong> below it."
    : "This removes the AI answer.";

  const overlay = document.createElement("div");
  overlay.className = "ai-modal-overlay";
  overlay.innerHTML = `
    <div class="ai-modal">
      <p>Delete this message?<br><span class="ai-modal-sub">${pairNote}</span></p>
      <div class="ai-modal-btns">
        <button class="ai-modal-btn ai-modal-no">${t("common.cancel")}</button>
        <button class="ai-modal-btn ai-modal-yes">${t("common.delete")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector(".ai-modal-no").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".ai-modal-yes").addEventListener("click", async () => {
    close();
    try {
      const data = await apiFetch(
        `/ai/conversations/${currentConversationId}/messages/${messageId}`,
        { method: "DELETE" },
      );
      for (const mid of (data.deleted_ids || [messageId])) {
        msgCache.delete(mid);
        findAiMsgEl(mid)?.remove();
      }
      showToast(t("ai.msgDeleted"));
      loadConversations();
    } catch (e) {
      showToast(t("common.errorPrefix") + e.message);
    }
  });
}

async function toggleAiFeedback(messageId, value) {
  const msg = msgCache.get(messageId);
  if (!msg || readOnlyMode) return;
  const next = msg.feedback === value ? null : value;
  try {
    const updated = await apiFetch(
      `/ai/conversations/${currentConversationId}/messages/${messageId}/feedback`,
      { method: "POST", body: JSON.stringify({ value: next }) },
    );
    rememberAiMsg(updated);
    document.querySelectorAll(`.ai-fb-btn[data-mid="${messageId}"]`).forEach((b) => {
      b.classList.toggle("active", updated.feedback === b.dataset.fb);
    });
  } catch (e) {
    showToast(t("common.errorPrefix") + e.message);
  }
}

// Bubble tap → sheet · feedback tap → toggle (not in read-only shared view)
messagesContainer.addEventListener("click", (e) => {
  const fb = e.target.closest(".ai-fb-btn");
  if (fb && fb.dataset.mid) {
    e.stopPropagation();
    toggleAiFeedback(fb.dataset.mid, fb.dataset.fb);
    return;
  }
  const ask = e.target.closest(".ai-askfam-btn");
  if (ask && ask.dataset.ask) {
    e.stopPropagation();
    openAskFamilyModal(ask.dataset.ask);
    return;
  }
  if (readOnlyMode) return;
  const menuBtn = e.target.closest(".ai-msg-menu-btn");
  if (menuBtn && menuBtn.dataset.mid) {
    e.stopPropagation();
    const msg = msgCache.get(menuBtn.dataset.mid);
    if (msg) openAiMessageMenu(msg, menuBtn);
    return;
  }
});

// ─── Ask family: member picker + review share creation ───
async function openAskFamilyModal(answerMid) {
  const answer = msgCache.get(answerMid);
  if (!answer || readOnlyMode) return;

  // Find the user question directly above this answer
  let question = "";
  const ansEl = findAiMsgEl(answerMid);
  if (ansEl) {
    let sib = ansEl.previousElementSibling;
    while (sib) {
      if (sib.dataset && sib.dataset.role === "user" && sib.dataset.mid) {
        const q = msgCache.get(sib.dataset.mid);
        if (q) question = q.content || "";
        break;
      }
      sib = sib.previousElementSibling;
    }
  }
  if (!question) {
    showToast(t("ai.askFirst"));
    return;
  }

  let members = [];
  let meId = "";
  let iShared = [];
  try {
    const [meData, fam, sharedReviews] = await Promise.all([
      apiFetch("/auth/me"),
      apiFetch("/family/me"),
      apiFetch("/review/i-shared"),
    ]);
    meId = meData.id;
    members = (fam.members || []).filter(
      (m) => (m.status || "active") === "active" && m.id !== meId
    );
    iShared = sharedReviews || [];
  } catch (e) {
    showToast(t("common.errorPrefix") + e.message);
    return;
  }
  if (!members.length) {
    showToast(t("ai.noMembersToAsk"));
    return;
  }

  // Find which members already received this exact question
  const alreadySharedIds = new Set();
  for (const rev of iShared) {
    if (rev.question === question) {
      // This review has the same question — get its detail to find selected_ids
      try {
        const detail = await apiFetch(`/review/${rev.share_id}/detail`);
        for (const sid of (detail.selected_ids || [])) {
          alreadySharedIds.add(sid);
        }
      } catch (e) { /* skip */ }
    }
  }

  const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

  const overlay = document.createElement("div");
  overlay.className = "ai-modal-overlay";
  overlay.innerHTML = `
    <div class="ai-modal ai-askfam-modal">
      <h3>${t("ai.askFamilyTitle")}</h3>
      <p class="ai-askfam-sub">${t("ai.askFamilyDesc")}</p>
      <div class="ai-askfam-list">
        ${members.map((m) => {
          const shared = alreadySharedIds.has(m.id);
          return `
          <div class="ai-askfam-item ${shared ? 'already-shared' : 'selected'}" data-id="${m.id}" data-shared="${shared}">
            <input type="checkbox" value="${m.id}" ${shared ? 'disabled' : 'checked'} />
            <div class="ai-askfam-check">${checkSvg}</div>
            <span class="ai-askfam-name">${escHtml(m.name)}</span>
            ${shared ? `<span class="ai-askfam-badge">${t("ai.shared")}</span>` : ''}
          </div>`;
        }).join("")}
      </div>
      <input type="text" class="ai-askfam-note" id="ai-askfam-note" placeholder="${t("ai.addNoteOptional")}" maxlength="500" autocomplete="off" />
      <p class="ai-open-shared-error hidden" id="ai-askfam-error"></p>
      <div class="ai-modal-btns">
        <button class="ai-modal-btn ai-modal-no" id="ai-askfam-cancel">${t("common.cancel")}</button>
        <button class="ai-modal-btn ai-modal-open" id="ai-askfam-go">${t("ai.sendToFamily")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Toggle selection on click (skip already-shared items)
  overlay.querySelectorAll(".ai-askfam-item").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.shared === "true") return;
      const cb = item.querySelector('input[type="checkbox"]');
      cb.checked = !cb.checked;
      item.classList.toggle("selected", cb.checked);
    });
  });

  const errEl = overlay.querySelector("#ai-askfam-error");
  const close = () => overlay.remove();
  overlay.querySelector("#ai-askfam-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#ai-askfam-go").addEventListener("click", async () => {
    const selected = [...overlay.querySelectorAll(".ai-askfam-item:not(.already-shared) input:checked")]
      .map((c) => c.value);
    if (!selected.length) {
      errEl.textContent = t("ai.selectMember");
      errEl.classList.remove("hidden");
      return;
    }
    const goBtn = overlay.querySelector("#ai-askfam-go");
    goBtn.disabled = true;
    try {
      await apiFetch("/review/share", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: currentConversationId || "",
          question,
          answer: { content: answer.content, metadata: answer.metadata },
          selected_ids: selected,
          note: overlay.querySelector("#ai-askfam-note").value.trim(),
        }),
      });
      close();
      showToast(t("ai.reviewShared"));
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
      goBtn.disabled = false;
    }
  });
}

// ─── Init ───
loadConversations();
loadSharedConversations();

// Deep link: /ai/index.html?sid=... opens the shared conversation
// directly inside the chat interface (read-only, current session).
(function openDeepLink() {
  const sid = new URLSearchParams(window.location.search).get("sid");
  if (!sid || !token()) return;
  openSharedConversation(sid.trim()).catch((e) => {
    showEmpty();
    showToast(shareErrorText(e && e.message));
  });
})();
