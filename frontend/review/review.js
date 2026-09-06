const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;

const TOKEN_KEY = "familyshield_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = "/";
    return false;
  }
  return true;
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const tok = getToken();
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "HTTP " + res.status);
  }
  return res.json();
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg) {
  let toast = document.getElementById("rv-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "rv-toast";
    toast.className = "rv-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const AVATAR_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function renderMarkdown(text) {
  if (!text) return "";
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

/* ─── State ─── */

let currentTab = "shared-with-me";
let sharedWithMe = [];
let iShared = [];
let currentShareId = null;
let myUserId = "";

/* ─── Tab switching ─── */

document.querySelectorAll(".rv-nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".rv-nav-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.tab;
    showList();
  });
});

/* ─── List views ─── */

function showList() {
  document.getElementById("rv-detail").classList.remove("active");
  document.querySelector(".rv-nav-tabs").style.display = "";
  currentShareId = null;

  const content = document.getElementById("rv-content");
  const data = currentTab === "shared-with-me" ? sharedWithMe : iShared;

  if (!data.length) {
    content.innerHTML = `
      <div class="rv-empty">
        <div class="rv-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
          </svg>
        </div>
        <h3>${currentTab === "shared-with-me" ? "No reviews yet" : "You haven't shared any"}</h3>
        <p>${currentTab === "shared-with-me"
          ? "When family members ask for your review, they'll appear here."
          : "Use 'Ask family' in AI chat to share a question for review."}</p>
      </div>`;
    return;
  }

  content.innerHTML = data.map((item) => {
    const senderName = currentTab === "shared-with-me" ? (item.shared_by || "Someone") : "You";
    const initial = senderName[0].toUpperCase();
    const color = getAvatarColor(senderName);
    const responded = item.my_response !== null && item.my_response !== undefined;
    return `
      <div class="rv-card" data-share-id="${item.share_id}">
        <div class="rv-card-header">
          <div class="rv-card-avatar" style="background:${color}20;color:${color}">${escHtml(initial)}</div>
          <div class="rv-card-meta">
            <div class="rv-card-sender">${escHtml(senderName)}</div>
            <div class="rv-card-time">${formatTime(item.created_at)}</div>
          </div>
        </div>
        <div class="rv-card-question">${escHtml(item.question)}</div>
        <div class="rv-card-footer">
          <div class="rv-card-stat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            ${item.responded_count}/${item.selected_count} responded
          </div>
          ${currentTab === "shared-with-me"
            ? `<span class="rv-card-status ${responded ? 'responded' : 'pending'}">${responded ? 'Responded' : 'Pending'}</span>`
            : ""}
        </div>
      </div>`;
  }).join("");

  content.querySelectorAll(".rv-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.shareId));
  });
}

/* ─── Detail view ─── */

async function openDetail(shareId) {
  currentShareId = shareId;
  document.querySelector(".rv-nav-tabs").style.display = "none";

  const detail = document.getElementById("rv-detail");
  const detailContent = document.getElementById("rv-detail-content");
  const listContent = document.getElementById("rv-content");

  listContent.innerHTML = "";
  detail.classList.add("active");
  detailContent.innerHTML = `<div class="rv-loading">Loading...</div>`;

  try {
    const [detailData, responsesData] = await Promise.all([
      apiFetch(`/review/${shareId}/detail`),
      apiFetch(`/review/${shareId}/responses`),
    ]);

    const question = detailData.question || "";
    const note = detailData.note || "";
    const answerContent = detailData.answer_content || "";
    const isSender = detailData.is_sender;

    let answerHtml = "";
    if (answerContent) {
      let parsed = null;
      try { parsed = JSON.parse(answerContent); } catch(e) {}
      if (parsed && parsed.risk_level) {
        answerHtml = buildRiskCard(parsed);
      } else {
        answerHtml = `<div class="rv-ai-answer-text">${renderMarkdown(answerContent)}</div>`;
      }
    }

    let responsesHtml = "";
    if (responsesData.responses.length) {
      responsesHtml = responsesData.responses.map((r) => {
        const color = getAvatarColor(r.responder_name);
        return `
          <div class="rv-response-card">
            <div class="rv-response-header">
              <div class="rv-response-avatar" style="background:${color}">${escHtml(r.responder_initial)}</div>
              <span class="rv-response-name">${escHtml(r.responder_name)}</span>
              <span class="rv-response-time">${formatTime(r.created_at)}</span>
            </div>
            <div class="rv-response-text">${renderMarkdown(r.response_text)}</div>
            ${r.status === 'updated' ? '<div class="rv-response-edited">Edited</div>' : ''}
          </div>`;
      }).join("");
    } else {
      responsesHtml = `<div class="rv-empty" style="padding:30px 0;"><p style="color:var(--muted);font-size:13px;">${"No responses yet"}</p></div>`;
    }

    const alreadyResponded = responsesData.responses.some(r => r.responder_name === "You");
    let respondForm = "";
    if (!isSender && !alreadyResponded) {
      respondForm = `
        <div class="rv-respond-form" id="rv-respond-form">
          <div class="rv-respond-label">Quick reply</div>
          <div class="rv-quick-replies">
      <button class="rv-quick-btn" data-text="Safe to proceed">Safe to proceed</button>
      <button class="rv-quick-btn" data-text="Do not touch">Do not touch</button>
      <button class="rv-quick-btn" data-text="Be careful">Be careful</button>
      <button class="rv-quick-btn" data-text="Suspicious">Suspicious</button>
      <button class="rv-quick-btn" data-text="Need more info">Need more info</button>
          </div>
          <div class="rv-respond-label" style="margin-top:12px;">Or write your own</div>
          <textarea class="rv-respond-textarea" id="rv-respond-text" placeholder="Write your response..." maxlength="2000"></textarea>
          <div class="rv-respond-actions">
            <button class="rv-btn rv-btn-primary" id="rv-submit-btn">Send Response</button>
          </div>
        </div>`;
    }

    detailContent.innerHTML = `
      <div class="rv-detail-header">
        <div class="rv-detail-header-row">
          <div class="rv-detail-header-avatar" style="background:${getAvatarColor(detailData.shared_by)}">${escHtml(detailData.shared_by[0])}</div>
          <div class="rv-detail-header-info">
            <div class="rv-detail-header-title">${isSender ? "Review sent by you" : `Review from ${escHtml(detailData.shared_by)}`}</div>
            <div class="rv-detail-header-sub">${formatTime(detailData.created_at)} · ${responsesData.responded_count} of ${responsesData.selected_count} responded</div>
          </div>
        </div>
      </div>

      <div class="rv-question-card">
        <div class="rv-question-label">Question</div>
        <div class="rv-question-text">${escHtml(question)}</div>
        ${note ? `<div class="rv-note">"${escHtml(note)}"</div>` : ''}
        ${answerHtml ? `
          <div class="rv-ai-answer">
            <div class="rv-ai-answer-label">AI Analysis</div>
            ${answerHtml}
          </div>` : ''}
      </div>

      <div class="rv-responses-header">
        <span class="rv-responses-title">Family Responses</span>
        <span class="rv-responses-count">${responsesData.responded_count} of ${responsesData.selected_count}</span>
      </div>

      ${responsesHtml}
      ${respondForm}
    `;

    const submitBtn = document.getElementById("rv-submit-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", async () => {
        const textarea = document.getElementById("rv-respond-text");
        const text = textarea.value.trim();
        if (!text) {
          showToast("Write something first");
          return;
        }
        submitBtn.disabled = true;
        try {
          await apiFetch(`/review/${shareId}/respond`, {
            method: "POST",
            body: JSON.stringify({ response_text: text }),
          });
          showToast("Response sent");
          openDetail(shareId);
        } catch (e) {
          showToast(e.message || "Failed to send");
          submitBtn.disabled = false;
        }
      });
    }

    // Quick reply buttons — click to fill textarea, then auto-send
    detailContent.querySelectorAll(".rv-quick-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const text = btn.dataset.text;
        submitBtn.disabled = true;
        try {
          await apiFetch(`/review/${shareId}/respond`, {
            method: "POST",
            body: JSON.stringify({ response_text: text }),
          });
          showToast("Response sent");
          openDetail(shareId);
        } catch (e) {
          showToast(e.message || "Failed to send");
          submitBtn.disabled = false;
        }
      });
    });

    const backBtn = document.querySelector(".rv-back");
    backBtn.onclick = (e) => {
      e.preventDefault();
      showList();
    };

  } catch (e) {
    detailContent.innerHTML = `
      <div class="rv-empty">
        <h3>Could not load review</h3>
        <p>${escHtml(e.message)}</p>
      </div>`;
  }
}

function buildRiskCard(data) {
  const level = data.risk_level || "unable_to_assess";
  const labels = { high: "High Risk", medium: "Medium Risk", low: "Low Risk", unable_to_assess: "Unable to Assess" };
  const icons = { high: "\u26a0\ufe0f", medium: "\ud83d\udfe0", low: "\u2705", unable_to_assess: "\u26aa" };
  let html = `<div class="ai-risk-card"><div class="ai-risk-header ${level}"><span class="ai-risk-badge">${icons[level] || "\u26aa"}</span><span>${labels[level] || "Analysis Complete"}</span></div><div class="ai-risk-body">`;
  if (data.summary) html += `<div class="ai-risk-section"><p class="ai-risk-summary">${escHtml(data.summary)}</p></div>`;
  if (data.indicators?.length) html += `<div class="ai-risk-section"><div class="ai-risk-section-title">Why?</div><ul class="ai-risk-list">${data.indicators.map(i => "<li>" + escHtml(i) + "</li>").join("")}</ul></div>`;
  if (data.explanation?.length) html += `<div class="ai-risk-section"><div class="ai-risk-section-title">Explanation</div><ul class="ai-risk-list">${data.explanation.map(e => "<li>" + escHtml(e) + "</li>").join("")}</ul></div>`;
  if (data.recommended_actions?.length) html += `<div class="ai-risk-section"><div class="ai-risk-section-title">Recommended Actions</div><ul class="ai-risk-list">${data.recommended_actions.map(a => "<li>" + escHtml(a) + "</li>").join("")}</ul></div>`;
  html += `</div></div>`;
  return html;
}

/* ─── Handle deep link (share_id in URL) ─── */

function getShareIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("share_id");
}

/* ─── Init ─── */

async function init() {
  if (!requireAuth()) return;

  const backBtn = document.querySelector(".rv-back");
  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentShareId) {
      showList();
    } else {
      window.location.href = "../";
    }
  });

  try {
    const meData = await apiFetch("/auth/me");
    myUserId = meData.id;

    const [swm, is_] = await Promise.all([
      apiFetch("/review/shared-with-me"),
      apiFetch("/review/i-shared"),
    ]);
    sharedWithMe = swm;
    iShared = is_;

    const badge = document.querySelector('.rv-nav-tab[data-tab="shared-with-me"]');
    if (sharedWithMe.length) {
      const b = document.createElement("span");
      b.className = "rv-tab-badge";
      b.textContent = sharedWithMe.length;
      badge.appendChild(b);
    }
  } catch (e) {
    showToast("Failed to load reviews");
  }

  document.getElementById("rv-loading").remove();

  const deepLinkShareId = getShareIdFromUrl();
  if (deepLinkShareId) {
    openDetail(deepLinkShareId);
  } else {
    showList();
  }
}

init();
