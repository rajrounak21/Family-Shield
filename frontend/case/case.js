/* ═══════════════════════════════════════════
   FamilyShield — Family Case view
   Evidence (frozen) + thread + quick verdicts + final decision
   ═══════════════════════════════════════════ */

const CASE_API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;

const CASE_TOKEN_KEY = "familyshield_token";
const QUICK_LABELS = { check: "I'll check", dont: "Don't do it", safe: "Looks safe" };
const QUICK_ICONS = { check: "🔍", dont: "⛔", safe: "✅" };

let caseData = null;
let meId = null;

function token() {
  return localStorage.getItem(CASE_TOKEN_KEY);
}

function myId() {
  const tok = token();
  if (!tok) return null;
  try {
    return JSON.parse(atob(tok.split(".")[1])).sub || null;
  } catch {
    return null;
  }
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const tok = token();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(`${CASE_API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function showToast(msg) {
  const toast = document.getElementById("fs-toast");
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

function getCaseId() {
  return new URLSearchParams(window.location.search).get("case_id");
}

const STATUS_LABEL = {
  open: "Open",
  waiting: "Waiting for family",
  under_review: "Under review",
  resolved: "Resolved",
  ignored: "Ignored",
  reported: "Reported",
};

const VERDICT_LABEL = {
  safe: "Safe to proceed",
  not_safe: "Do not proceed",
  ignored: "Ignored",
  reported: "Reported",
};

const RISK_LABEL = {
  high: "High Risk",
  medium: "Medium Risk",
  low: "Low Risk",
  unable_to_assess: "Unable to Assess",
};

function statusPill(status) {
  return `<span class="case-status-pill st-${status}">${STATUS_LABEL[status] || status}</span>`;
}

function renderNotice(title, sub, linkText) {
  document.getElementById("case-wrap").innerHTML = `
    <div class="case-notice">
      <h2>${escHtml(title)}</h2>
      <p>${escHtml(sub)}</p>
      <a href="/" class="case-notice-btn">${escHtml(linkText || "Back to FamilyShield")}</a>
    </div>`;
}

function cleanAnswer(text) {
  // Old snapshots stored raw model JSON — show the human summary or nothing.
  const t = (text || "").trim();
  if (!t) return "";
  if (!t.startsWith("{")) return t;
  try {
    const p = JSON.parse(t);
    if (p && typeof p === "object") return (p.summary || "").trim();
  } catch (e) {}
  return t;
}

function renderCase() {
  const c = caseData;
  const snap = c.ai_snapshot || {};
  const risk = snap.risk_level || "unable_to_assess";
  const locked = ["resolved", "ignored", "reported"].includes(c.status);
  const isCreator = meId && c.created_by === meId;

  const indicators = (snap.indicators || []).map((i) => `<li>${escHtml(i)}</li>`).join("");
  const actions = (snap.recommended_actions || []).map((a) => `<li>${escHtml(a)}</li>`).join("");

  const quicks = (c.messages || []).filter((m) => m.kind === "quick");
  const myQuick = quicks.find((m) => m.sender_id === meId);
  const counts = { check: 0, dont: 0, safe: 0 };
  const who = { check: [], dont: [], safe: [] };
  for (const q of quicks) {
    if (counts[q.response] !== undefined) {
      counts[q.response] += 1;
      who[q.response].push(q.sender_name);
    }
  }

  const comments = (c.messages || []).filter((m) => m.kind !== "quick");

  // Reviews panel: every selected member, responded or pending
  const quickByUser = {};
  for (const q of quicks) quickByUser[q.sender_id] = q;
  const reviewRows = (c.selected_members || []).map((m) => {
    const q = quickByUser[m.id];
    const initial = (m.name || "?").charAt(0).toUpperCase();
    const chip = q
      ? `<span class="review-chip r-${q.response}">${QUICK_ICONS[q.response] || ""} ${escHtml(QUICK_LABELS[q.response] || q.response)}</span>`
      : `<span class="review-chip r-pending">⏳ Pending</span>`;
    return `
      <div class="review-row">
        <div class="review-avatar">${escHtml(initial)}</div>
        <div class="review-name">${escHtml(m.id === meId ? "You" : m.name)}</div>
        ${chip}
      </div>`;
  }).join("");

  let verdictHtml = "";
  if (c.verdict) {
    const v = c.verdict;
    verdictHtml = `
      <div class="case-verdict vd-${v.decision}">
        <div class="case-verdict-title">${escHtml(VERDICT_LABEL[v.decision] || v.decision)}</div>
        <div class="case-verdict-sub">${`by ${escHtml(v.by_name || "Someone")}`}${v.note ? ` — ${escHtml(v.note)}` : ""}</div>
      </div>`;
  }

  document.getElementById("case-wrap").innerHTML = `
    <header class="case-header">
      <a href="/" class="case-back" title="Back">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </a>
      <div class="case-header-info">
        <h1>${escHtml(c.title)}</h1>
        <p>${`Asked by ${escHtml(c.created_by_name)}`} · ${new Date(c.created_at).toLocaleDateString()}</p>
      </div>
      <button class="case-refresh" id="case-refresh" type="button" title="Refresh">↻</button>
    </header>
    <div class="case-status-row">${statusPill(c.status)}</div>
    ${verdictHtml}
    <section class="case-evidence">
      <div class="case-evidence-label">AI analysis (frozen snapshot)</div>
      <div class="case-question">${escHtml(snap.question || "")}</div>
      <div class="case-risk risk-${risk}">${escHtml(RISK_LABEL[risk] || "Analysis")}</div>
      ${cleanAnswer(snap.answer) ? `<div class="case-answer">${escHtml(cleanAnswer(snap.answer)).replace(/\n/g, "<br>")}</div>` : ""}
      ${indicators ? `<div class="case-sec-title">Why?</div><ul class="case-list">${indicators}</ul>` : ""}
      ${actions ? `<div class="case-sec-title">Recommended actions</div><ul class="case-list">${actions}</ul>` : ""}
      ${c.note ? `<div class="case-note">“${escHtml(c.note)}”</div>` : ""}
    </section>
    <section class="case-reviews">
      <div class="case-thread-title">Member reviews</div>
      <div class="review-list">${reviewRows || `<p class="case-empty-thread">No reviewers.</p>`}</div>
    </section>
    <section class="case-thread" id="case-thread">
      <div class="case-thread-title">Family discussion</div>
      <div id="case-messages">
        ${comments.length ? comments.map((m) => `
          <div class="case-msg ${m.sender_id === meId ? "mine" : ""}">
            <div class="case-msg-name">${escHtml(m.sender_name)}</div>
            <div class="case-msg-bubble">${escHtml(m.content).replace(/\n/g, "<br>")}</div>
          </div>`).join("") : `<p class="case-empty-thread">No replies yet — be the first to help.</p>`}
      </div>
    </section>
    ${locked ? `<p class="case-locked">This case is closed.${isCreator ? "" : " " + `Only ${escHtml(c.created_by_name)} can reopen it by asking again.`}</p>` : `
    <div class="case-quickbar">
      ${["check", "dont", "safe"].map((k) => `
        <button class="case-quick ${myQuick && myQuick.response === k ? "active" : ""}" data-quick="${k}" type="button" title="${counts[k] ? escHtml(who[k].join(", ")) : QUICK_LABELS[k]}">
          ${QUICK_ICONS[k]} ${QUICK_LABELS[k]}${counts[k] ? ` · ${counts[k]}` : ""}
        </button>`).join("")}
    </div>
    <div class="case-composer">
      <input type="text" id="case-input" placeholder="Write a reply..." maxlength="2000" autocomplete="off" />
      <button id="case-send" type="button" title="Send">➤</button>
    </div>
    ${isCreator ? `<button class="case-verdict-btn" id="case-verdict-btn" type="button">Final decision</button>` : ""}`}`;

  document.getElementById("case-refresh").addEventListener("click", () => loadCase(true));

  if (locked) return;

  document.querySelectorAll("[data-quick]").forEach((b) => {
    b.addEventListener("click", () => sendQuick(b.dataset.quick, b));
  });
  const input = document.getElementById("case-input");
  const send = document.getElementById("case-send");
  const submitComment = async () => {
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      await apiFetch(`/cases/${c.case_id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text }),
      });
      await loadCase(true);
    } catch (e) {
      showToast("Error: " + e.message);
      send.disabled = false;
    }
  };
  send.addEventListener("click", submitComment);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitComment();
  });

  const verdictBtn = document.getElementById("case-verdict-btn");
  if (verdictBtn) verdictBtn.addEventListener("click", openVerdictModal);
}

async function sendQuick(value, btn) {
  btn.disabled = true;
  try {
    await apiFetch(`/cases/${caseData.case_id}/quick`, {
      method: "POST",
      body: JSON.stringify({ response: value }),
    });
    await loadCase(true);
  } catch (e) {
    showToast("Error: " + e.message);
    btn.disabled = false;
  }
}

function openVerdictModal() {
  const overlay = document.createElement("div");
  overlay.className = "case-modal-overlay";
  const opts = [
    ["safe", "✅", "Safe to proceed"],
    ["not_safe", "⛔", "Do not proceed"],
    ["ignored", "🚫", "Ignore"],
    ["reported", "🚨", "Report sent"],
  ];
  overlay.innerHTML = `
    <div class="case-modal">
      <h3>Final decision</h3>
      <p class="case-modal-sub">This closes the case for everyone.</p>
      <div class="case-modal-opts">
        ${opts.map(([v, icon, label]) => `
          <button class="case-modal-opt" data-v="${v}" type="button">${icon} ${label}</button>`).join("")}
      </div>
      <input type="text" class="case-modal-note" id="case-verdict-note" placeholder="Note (optional)" maxlength="500" autocomplete="off" />
      <button class="case-modal-cancel" id="case-verdict-cancel" type="button">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#case-verdict-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll("[data-v]").forEach((b) => {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await apiFetch(`/cases/${caseData.case_id}/verdict`, {
          method: "POST",
          body: JSON.stringify({
            decision: b.dataset.v,
            note: overlay.querySelector("#case-verdict-note").value.trim(),
          }),
        });
        close();
        showToast("Decision recorded");
        await loadCase(true);
      } catch (e) {
        showToast("Error: " + e.message);
        b.disabled = false;
      }
    });
  });
}

async function loadCase(silent) {
  const id = getCaseId();
  if (!id) {
    renderNotice("No case selected", "This link doesn't point to a case.", "Back");
    return;
  }
  if (!token()) {
    renderNotice("Login required", "Log in to view this family case.", "Log In");
    return;
  }
  try {
    meId = myId();
    caseData = await apiFetch(`/cases/${id}`);
    renderCase();
    const thread = document.getElementById("case-thread");
    if (thread && silent) thread.scrollTop = thread.scrollHeight;
  } catch (e) {
    const msg = e.message || "";
    if (/403|access|member/i.test(msg)) {
      renderNotice("Not shared with you", "This case was shared with selected family members only.", "Back");
    } else {
      renderNotice("Case not found", "This link is invalid or the case was removed.", "Back");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => loadCase(false));
