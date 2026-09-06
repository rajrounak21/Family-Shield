/* ═══════════════════════════════════════════
   FamilyShield — Manage Family page
   Every action: confirm → busy state → toast. Nothing silent.
   ═══════════════════════════════════════════ */

const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;

const TOKEN_KEY = "familyshield_token";

const COLORS = ["#10b981", "#8b5cf6", "#f59e0b", "#3b82f6", "#ec4899", "#ef4444", "#14b8a6"];

let me = null;
let familyData = null;

// ─── Helpers ───
function token() {
  return localStorage.getItem(TOKEN_KEY);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const tok = token();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function expiryShort(iso) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days}d`;
}

function expiryText(iso) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days}d`;
}

function showToast(msg) {
  const toast = document.getElementById("fs-toast");
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

function showConfirm({ title, message, confirmText = "Confirm", danger = true, onConfirm }) {
  const old = document.getElementById("fs-modal-overlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "fs-modal-overlay";
  overlay.innerHTML = `
    <div class="fs-modal">
      <h3 class="fs-modal-title">${title}</h3>
      <p class="fs-modal-message">${message}</p>
      <div class="fs-modal-actions">
        <button class="fs-modal-cancel" id="fs-modal-cancel">Cancel</button>
        <button class="fs-modal-confirm ${danger ? "fs-modal-danger" : ""}" id="fs-modal-confirm">${confirmText}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#fs-modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#fs-modal-confirm").addEventListener("click", () => { close(); onConfirm(); });
}

async function withBusy(btn, fn) {
  const busy = !!(btn && !btn.disabled);
  const old = busy ? btn.textContent : null;
  if (busy) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    await fn();
  } finally {
    if (busy && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = old;
    }
  }
}

function openSheet({ title, sub = "", actions }) {
  const old = document.querySelector(".mg-sheet-overlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.className = "mg-sheet-overlay";
  overlay.innerHTML = `
    <div class="mg-sheet">
      <div class="mg-sheet-handle"></div>
      <h3 class="mg-sheet-title">${escHtml(title)}</h3>
      ${sub ? `<p class="mg-sheet-sub">${escHtml(sub)}</p>` : ""}
      <div class="mg-sheet-actions">
        ${actions.map((a, i) => `
          <button class="mg-sheet-btn ${a.danger ? "mg-sheet-btn-danger" : ""}" data-i="${i}" type="button">
            ${a.icon || ""}
            <span>${escHtml(a.label)}</span>
          </button>`).join("")}
        <button class="mg-sheet-btn mg-sheet-cancel" data-i="cancel" type="button"><span>Cancel</span></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll("[data-i]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.i;
      close();
      if (v !== "cancel") actions[+v].onClick();
    });
  });
}

const ICON_REMOVE = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg>`;
const ICON_BLOCK = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>`;
const ICON_UNBLOCK = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`;

function memberSheet(id, name, status) {
  const actions =
    status === "blocked"
      ? [{ label: `Unblock ${name}`, icon: ICON_UNBLOCK, onClick: () => confirmUnblock(id, name, null) }]
      : status === "removed"
        ? [{ label: `Block ${name}`, icon: ICON_BLOCK, danger: true, onClick: () => confirmBlock(id, name, null) }]
        : [
            { label: "Remove from family", icon: ICON_REMOVE, danger: true, onClick: () => confirmRemove(id, name, null) },
            { label: "Block", icon: ICON_BLOCK, danger: true, onClick: () => confirmBlock(id, name, null) },
          ];
  openSheet({
    title: name,
    sub: status === "active" ? "Family member" : status === "blocked" ? "Blocked — can't rejoin" : "Left the family",
    actions,
  });
}

// ─── Load ───
async function loadAll() {
  document.getElementById("mg-loading").classList.remove("hidden");
  document.getElementById("mg-content").classList.add("hidden");
  try {
    me = await api("/auth/me");
    familyData = await api("/family/me");
  } catch (e) {
    document.getElementById("mg-loading").innerHTML =
      `<span>No family found. Back to Dashboard</span>`;
    return;
  }
  document.getElementById("mg-loading").classList.add("hidden");
  document.getElementById("mg-content").classList.remove("hidden");
  render();
}

function isAdmin() {
  return familyData && familyData.family.admin_user_id === me.id;
}

function memberColor(i) {
  return COLORS[i % COLORS.length];
}

// ─── Render ───
function render() {
  const { family, members, invite } = familyData;
  const admin = isAdmin();

  const active = members.filter((m) => (m.status || "active") === "active");
  document.getElementById("mg-member-count").textContent =
    `${active.length} member(s)`;

  document.getElementById("mg-role-pill").classList.toggle("hidden", !isAdmin());

  // Hero
  document.getElementById("mg-crest").textContent = (family.name || "F").charAt(0).toUpperCase();
  document.getElementById("mg-hero-name").textContent = family.name;
  const adminMember = members.find((m) => m.id === family.admin_user_id);
  document.getElementById("mg-hero-sub").textContent = isAdmin()
    ? "You're the admin"
    : `Admin · ${adminMember ? adminMember.name.split(" ")[0] : ""}`;
  document.getElementById("mg-stat-members").textContent = active.length;
  document.getElementById("mg-stat-joined").textContent = admin && invite ? (invite.uses_count || 0) : "–";
  document.getElementById("mg-stat-exp").textContent = admin && invite ? expiryShort(invite.expires_at) : "–";

  document.getElementById("mg-members").innerHTML = members.map((m, i) => {
    const st = m.status || "active";
    const isYou = m.id === me.id;
    const isFamAdmin = family.admin_user_id === m.id;
    const tag = st === "blocked"
      ? `<span class="member-tag member-tag--blocked">Blocked</span>`
      : st === "removed"
        ? `<span class="member-tag member-tag--left">Left</span>`
        : isFamAdmin
          ? `<span class="member-tag member-tag--admin">Admin</span>`
          : "";
    let kebab = "";
    if (admin && !isYou) {
      kebab = `
        <button class="mg-kebab" data-id="${m.id}" data-name="${escHtml(m.name)}" data-status="${st}" type="button" title="Actions">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>`;
    }
    return `
      <div class="mg-member ${st !== "active" ? "mg-member--inactive" : ""}">
        <div class="mg-avatar" style="--color:${memberColor(i)}">${escHtml((m.name || "?").charAt(0).toUpperCase())}</div>
        <div class="mg-member-info">
          <div class="mg-member-name">${escHtml(isYou ? "You" : m.name)} ${tag}</div>
          <div class="mg-member-sub">${"Joined " + timeAgo(m.joined_at)}</div>
        </div>
        ${kebab}
      </div>`;
  }).join("");

  document.getElementById("mg-members-hint").textContent = admin
    ? "Tap ... on a member to remove or block."
    : "Only the admin can manage members.";

  document.querySelectorAll("#mg-members .mg-kebab").forEach((btn) => {
    btn.addEventListener("click", () => {
      memberSheet(btn.dataset.id, btn.dataset.name, btn.dataset.status);
    });
  });

  // Invite card (admin only)
  const inviteCard = document.getElementById("mg-invite-card");
  if (admin && invite) {
    inviteCard.classList.remove("hidden");
    document.getElementById("mg-link-input").value = invite.invite_url;
    const uses = invite.uses_count || 0;
    document.getElementById("mg-invite-meta").innerHTML =
      `${uses} joined via this link <span class="dot"></span> ${expiryText(invite.expires_at)}`;
  } else {
    inviteCard.classList.add("hidden");
  }
}

// ─── Member actions ───
function refresh() {
  return loadAll();
}

function confirmRemove(id, name, btn) {
  showConfirm({
    title: "Remove member",
    message: `Remove <strong>${escHtml(name)}</strong>? They lose access immediately. They could still rejoin with the current invite link — revoke it or block them to fully prevent that.`,
    confirmText: "Remove",
    onConfirm: () => withBusy(btn, async () => {
      try {
        await api(`/family/members/${id}`, { method: "DELETE" });
        showToast(`${name} removed.`);
        await refresh();
      } catch (e) {
        showToast("Error: " + e.message);
      }
    }),
  });
}

function confirmBlock(id, name, btn) {
  showConfirm({
    title: "Block member",
    message: `Block <strong>${escHtml(name)}</strong>? They lose access and can't rejoin.`,
    confirmText: "Block",
    onConfirm: () => withBusy(btn, async () => {
      try {
        await api(`/family/members/${id}/block`, { method: "POST" });
        showToast(`${name} blocked.`);
        await refresh();
      } catch (e) {
        showToast("Error: " + e.message);
      }
    }),
  });
}

function confirmUnblock(id, name, btn) {
  showConfirm({
    title: "Unblock member",
    message: `Unblock <strong>${escHtml(name)}</strong>? They'll still need a fresh invite link to rejoin.`,
    confirmText: "Unblock",
    danger: false,
    onConfirm: () => withBusy(btn, async () => {
      try {
        await api(`/family/members/${id}/unblock`, { method: "POST" });
        showToast(`${name} unblocked. Share a fresh link for them to rejoin.`);
        await refresh();
      } catch (e) {
        showToast("Error: " + e.message);
      }
    }),
  });
}

// ─── Invite actions ───
document.getElementById("mg-copy-btn").addEventListener("click", async (e) => {
  const input = document.getElementById("mg-link-input");
  try {
    await navigator.clipboard.writeText(input.value);
    showToast("Invite link copied");
  } catch {
    input.select();
    showToast("Copy the link manually");
  }
});

document.getElementById("mg-new-btn").addEventListener("click", (e) => {
  withBusy(e.currentTarget, async () => {
    try {
      const invite = await api("/family/invite?fresh=true", { method: "POST" });
      familyData.invite = invite;
      render();
      showToast("New invite link ready");
    } catch (err) {
      showToast("Error: " + err.message);
    }
  });
});

document.getElementById("mg-revoke-btn").addEventListener("click", (e) => {
  showConfirm({
    title: "Revoke invite link",
    message: "The current link stops working immediately. A fresh link will be created.",
    confirmText: "Revoke",
    onConfirm: () => withBusy(e.currentTarget, async () => {
      try {
        await api("/family/invite/revoke", { method: "POST" });
        familyData.invite = await api("/family/invite?fresh=true", { method: "POST" });
        render();
        showToast("Old link revoked. New link ready");
      } catch (err) {
        showToast("Error: " + err.message);
      }
    }),
  });
});

// ─── Leave ───
document.getElementById("mg-leave-btn").addEventListener("click", () => {
  if (!familyData) return;
  const fam = familyData.family;
  const admin = isAdmin();
  let message;
  if (admin) {
    const others = (familyData.members || [])
      .filter((m) => m.id !== me.id && (m.status || "active") === "active")
      .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
    message = others.length
      ? `Adminship will pass to <strong>${escHtml(others[0].name)}</strong>, then you leave <strong>${escHtml(fam.name)}</strong>. Continue?`
      : "You are the only member — leaving will dissolve the family. Continue?";
  } else {
    message = `Leave <strong>${escHtml(fam.name)}</strong>? You will lose access to family chat.`;
  }
  showConfirm({
    title: "Leave family",
    message,
    confirmText: "Leave",
    onConfirm: async () => {
      try {
        const res = await api("/family/leave", { method: "POST" });
        showToast(res.dissolved ? "You left. Family dissolved." : "You left the family.");
        setTimeout(() => { window.location.href = "../"; }, 900);
      } catch (e) {
        showToast("Error: " + e.message);
      }
    },
  });
});

// ─── Init ───
if (!token()) {
  window.location.href = "../";
} else {
  loadAll();
}
