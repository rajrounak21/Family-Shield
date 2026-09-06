const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;
const TOKEN_KEY = "familyshield_token";

const shell = document.getElementById("shell");
const brandPanel = document.getElementById("brand-panel");
const authView = document.querySelector("#auth-view");
const dashboardView = document.querySelector("#dashboard-view");
const onboardingView = document.querySelector("#onboarding-view");
const authTitle = document.querySelector("#auth-title");
const authForm = document.querySelector("#auth-form");
const resetForm = document.querySelector("#reset-form");
const authTabs = document.querySelector(".tabs");
const authDivider = document.querySelector(".divider");
const googleLoginButton = document.querySelector("#google-login");
const forgotButton = document.querySelector("#forgot-open");
const nameField = document.querySelector("#name-field");
const nameInput = document.querySelector("#name");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const newPasswordInput = document.querySelector("#new-password");
const message = document.querySelector("#message");
const tabs = document.querySelectorAll(".tab");
const tabIndicator = document.querySelector(".tab-indicator");

let mode = "login";

/* ─── Helpers ─── */

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function token() {
  return localStorage.getItem(TOKEN_KEY);
}

function saveToken(value) {
  localStorage.setItem(TOKEN_KEY, value);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function isOnboarded() {
  return _cachedUser && _cachedUser.onboarding_completed === true;
}

async function setOnboarded() {
  try {
    await api("/auth/onboarding", { method: "PUT" });
    if (_cachedUser) _cachedUser.onboarding_completed = true;
  } catch (e) {
    console.error("Failed to save onboarding status:", e);
  }
}

function showLoader(btn, show) {
  const text = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  if (text) text.classList.toggle("hidden", show);
  if (loader) loader.classList.toggle("hidden", !show);
  btn.disabled = show;
}

/* ─── Particles ─── */

function createParticles() {
  const container = document.getElementById("particles");
  if (!container) return;

  for (let i = 0; i < 8; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    particle.style.left = (10 + Math.random() * 80) + "%";
    particle.style.width = (Math.random() * 3 + 2) + "px";
    particle.style.height = particle.style.width;
    particle.style.animationDuration = (Math.random() * 4 + 4) + "s";
    particle.style.animationDelay = (Math.random() * 3) + "s";
    container.appendChild(particle);
  }
}

/* ─── Brand Panel Toggle ─── */

function showBrandPanel() {
  brandPanel.classList.remove("hidden");
  shell.classList.remove("dashboard-mode");
}

function hideBrandPanel() {
  brandPanel.classList.add("hidden");
  shell.classList.add("dashboard-mode");
}

/* ─── API ─── */

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const storedToken = token();
  if (storedToken) {
    headers.Authorization = `Bearer ${storedToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

/* ─── View switching ─── */

function hideAll() {
  authView.classList.add("hidden");
  dashboardView.classList.add("hidden");
  onboardingView.classList.add("hidden");
}

function showView(view) {
  hideAll();
  view.classList.remove("hidden");
  view.style.animation = "none";
  view.offsetHeight;
  view.style.animation = "";
}

/* ─── Auth mode ─── */

function setMode(nextMode) {
  mode = nextMode;
  setMessage("");
  const isResetMode = hasResetToken();

  authView.classList.toggle("auth-reset-mode", isResetMode);
  authForm.classList.toggle("hidden", isResetMode);
  authTabs.classList.toggle("hidden", isResetMode);
  authDivider.classList.toggle("hidden", isResetMode);
  googleLoginButton.classList.toggle("hidden", isResetMode);
  forgotButton.classList.toggle("hidden", isResetMode);
  resetForm.classList.toggle("hidden", !isResetMode);

  authTitle.textContent = isResetMode
    ? "Reset password"
    : mode === "login"
      ? "Welcome back"
      : "Create your account";

  nameField.classList.toggle("hidden", mode !== "signup");
  nameInput.required = mode === "signup" && !isResetMode;
  emailInput.required = !isResetMode;
  passwordInput.required = !isResetMode;
  newPasswordInput.required = isResetMode;
  passwordInput.autocomplete = mode === "login" ? "current-password" : "new-password";
  document.querySelector("#auth-submit .btn-text").textContent = mode === "login" ? "Login" : "Create account";

  tabs.forEach((tab) => {
    const isActive = tab.dataset.mode === mode;
    tab.classList.toggle("active", isActive);
  });

  tabIndicator.classList.toggle("signup", mode === "signup");
}

function hasResetToken() {
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("token"));
}

/* ─── Load user / Dashboard ─── */

async function loadMe() {
  const user = await api("/auth/me");
  _cachedUser = user;
  const firstName = (user.name || "Friend").split(" ")[0];
  const emailEl = document.querySelector("#user-email");
  const avatarEl = document.querySelector("#avatar");
  const welcomeEl = document.querySelector("#welcome-title");
  const memberYouEl = document.querySelector("#member-you");

  if (emailEl) emailEl.textContent = user.email;
  if (avatarEl) avatarEl.textContent = (user.name || "F").trim().charAt(0).toUpperCase();
  if (welcomeEl) welcomeEl.textContent = `${getGreetingPeriod() === "morning" ? "Good Morning" : getGreetingPeriod() === "afternoon" ? "Good Afternoon" : "Good Evening"}, ${firstName} 👋`;
  if (memberYouEl) memberYouEl.textContent = firstName;

  // Set greeting time label
  const greetingTimeEl = document.querySelector("#greeting-time");
  if (greetingTimeEl) greetingTimeEl.textContent = getGreetingPeriod() === "morning" ? "Good Morning" : getGreetingPeriod() === "afternoon" ? "Good Afternoon" : "Good Evening";

  // Store user id for family logic
  _currentUserId = user.id;

  refreshAvatarBadges();

  // Init profile edit click handler
  initProfileEdit();
}

function getGreetingPeriod() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

/* ─── Email verification ─── */

function needsEmailVerification() {
  return !!(
    _cachedUser &&
    _cachedUser.auth_provider === "email" &&
    !_cachedUser.email_verified
  );
}

function refreshAvatarBadges() {
  const verified = !!(_cachedUser && _cachedUser.email_verified);
  for (const id of ["avatar", "profile-avatar-large"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("verified", verified);
    el.classList.toggle("unverified", !verified);
    el.title = verified ? "Email verified" : "Email not verified";
  }
}

function updateVerifyBanner() {
  const banner = document.getElementById("verify-banner");
  if (!banner) return;
  const show =
    needsEmailVerification() &&
    sessionStorage.getItem("verify_banner_dismissed") !== "1";
  banner.classList.toggle("hidden", !show);
}

let _verifyCooldownTimer = null;

function startResendCooldown(btn) {
  if (!btn) return;
  clearInterval(_verifyCooldownTimer);
  let left = 60;
  btn.disabled = true;
  const base = "Resend";
  btn.textContent = `${base} (${left}s)`;
  _verifyCooldownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(_verifyCooldownTimer);
      btn.disabled = false;
      btn.textContent = base;
    } else {
      btn.textContent = `${base} (${left}s)`;
    }
  }, 1000);
}

async function doResendVerification(btn) {
  try {
    await api("/auth/send-verification", { method: "POST" });
    showToast("Verification code sent" + " ✉️");
    startResendCooldown(btn);
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

// Full entry flow: make sure a code is on its way, then open the modal.
async function openVerifyFlow() {
  try {
    await api("/auth/send-verification", { method: "POST" });
  } catch (e) {
    /* modal still opens — it has its own Resend */
  }
  await showVerifyModal();
}

function showVerifyModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById("verify-modal");
    const emailEl = document.getElementById("verify-email-text");
    const input = document.getElementById("verify-code-input");
    const errEl = document.getElementById("verify-modal-error");
    const submitBtn = document.getElementById("verify-submit-btn");
    const resendBtn = document.getElementById("verify-resend-btn");
    const skipBtn = document.getElementById("verify-skip-btn");

    emailEl.textContent = _cachedUser ? _cachedUser.email : "";
    input.value = "";
    errEl.classList.add("hidden");
    errEl.textContent = "";
    modal.classList.remove("hidden");
    input.focus();

    const done = (val) => {
      modal.classList.add("hidden");
      resolve(val);
    };
    const fail = (msg) => {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    };

    submitBtn.onclick = async () => {
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) {
        fail("Enter the 6-digit code from your email.");
        return;
      }
      showLoader(submitBtn, true);
      try {
        const user = await api("/auth/verify-email", {
          method: "POST",
          body: JSON.stringify({ code }),
        });
        _cachedUser = user;
        refreshAvatarBadges();
        updateVerifyBanner();
        showToast("Email verified" + " ✓");
        done(true);
      } catch (err) {
        fail(err.message);
      } finally {
        showLoader(submitBtn, false);
      }
    };
    resendBtn.onclick = () => doResendVerification(resendBtn);
    skipBtn.onclick = () => {
      showToast("You can verify later from your profile.");
      done(false);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    };
  });
}

/* ─── Profile Edit ─── */

let _cachedUser = null;

function initProfileEdit() {
  const avatar = document.getElementById("avatar");
  const modal = document.getElementById("profile-modal");
  const closeBtn = document.getElementById("profile-modal-close");
  const cancelBtn = document.getElementById("profile-cancel-btn");
  const form = document.getElementById("profile-form");
  const nameInput = document.getElementById("profile-name-input");
  const currentPw = document.getElementById("profile-current-pw");
  const newPw = document.getElementById("profile-new-pw");
  const msgEl = document.getElementById("profile-msg");
  const avatarLarge = document.getElementById("profile-avatar-large");

  avatar.addEventListener("click", async () => {
    if (!_cachedUser) {
      try { _cachedUser = await api("/auth/me"); } catch (e) { return; }
    }
    nameInput.value = _cachedUser.name || "";
    currentPw.value = "";
    newPw.value = "";
    msgEl.classList.add("hidden");
    avatarLarge.textContent = (_cachedUser.name || "F").charAt(0).toUpperCase();
    refreshAvatarBadges();
    const statusEl = document.getElementById("profile-verify-status");
    const resendBtn = document.getElementById("profile-resend-btn");
    const verifyBtn = document.getElementById("profile-verify-btn");
    if (statusEl && resendBtn && verifyBtn) {
      if (_cachedUser.email_verified) {
        statusEl.textContent = "✓ " + "Email verified";
        statusEl.className = "profile-verify-status ok";
        resendBtn.classList.add("hidden");
        verifyBtn.classList.add("hidden");
      } else {
        statusEl.textContent = "⚠ " + "Email not verified yet";
        statusEl.className = "profile-verify-status pending";
        resendBtn.classList.remove("hidden");
        verifyBtn.classList.remove("hidden");
        resendBtn.onclick = () => doResendVerification(resendBtn);
        verifyBtn.onclick = () => {
          modal.classList.add("hidden");
          openVerifyFlow();
        };
      }
    }
    modal.classList.remove("hidden");
  });

  closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
  cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const loader = form.querySelector(".btn-loader");
    const btnText = form.querySelector(".btn-text");
    loader.classList.remove("hidden");
    btnText.textContent = "Saving...";
    msgEl.classList.add("hidden");

    try {
      // Update name
      const newName = nameInput.value.trim();
      if (newName && newName !== _cachedUser.name) {
        const updated = await api("/auth/me", {
          method: "PUT",
          body: JSON.stringify({ name: newName }),
        });
        _cachedUser = updated;
        const avatarEl = document.getElementById("avatar");
        if (avatarEl) avatarEl.textContent = updated.name.charAt(0).toUpperCase();
        const welcomeEl = document.getElementById("welcome-title");
        if (welcomeEl) welcomeEl.textContent = `${getGreetingPeriod() === "morning" ? "Good Morning" : getGreetingPeriod() === "afternoon" ? "Good Afternoon" : "Good Evening"}, ${updated.name.split(" ")[0]} 👋`;
      }

      // Change password if provided
      const curPw = currentPw.value;
      const nwPw = newPw.value;
      if (curPw && nwPw) {
        await api("/auth/me/password", {
          method: "PUT",
          body: JSON.stringify({ current_password: curPw, new_password: nwPw }),
        });
        currentPw.value = "";
        newPw.value = "";
        showProfileMsg(msgEl, "Profile and password updated!", "success");
      } else {
        showProfileMsg(msgEl, "Profile updated!", "success");
      }
    } catch (err) {
      showProfileMsg(msgEl, err.message || "Update failed", "error");
    } finally {
      loader.classList.add("hidden");
      btnText.textContent = "Save Changes";
    }
  });
}

function showProfileMsg(el, text, type) {
  el.textContent = text;
  el.className = `profile-msg ${type}`;
}

/* ─── Guide Modal ─── */

function initGuide() {
  const btn = document.getElementById("guide-btn");
  const modal = document.getElementById("guide-modal");
  const closeBtn = document.getElementById("guide-modal-close");
  if (!btn || !modal) return;

  const closeModal = () => modal.classList.add("hidden");
  btn.addEventListener("click", () => modal.classList.remove("hidden"));
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
}

/* ─── Family Rename ─── */

let _familyNameEl = null;

function initFamilyRename(isAdmin, familyId, familyName) {
  if (!isAdmin) return;

  _familyNameEl = document.querySelector(".family-name");
  if (!_familyNameEl) return;

  _familyNameEl.classList.add("family-name-admin");
  _familyNameEl.addEventListener("click", () => openRenameModal(familyId, familyName));
}

function openRenameModal(familyId, currentName) {
  const modal = document.getElementById("rename-modal");
  const input = document.getElementById("rename-input");
  const form = document.getElementById("rename-form");
  const closeBtn = document.getElementById("rename-modal-close");
  const cancelBtn = document.getElementById("rename-cancel-btn");

  input.value = currentName;
  modal.classList.remove("hidden");

  const closeModal = () => modal.classList.add("hidden");
  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const newName = input.value.trim();
    if (!newName || newName === currentName) { closeModal(); return; }

    const loader = form.querySelector(".btn-loader");
    const btnText = form.querySelector(".btn-text");
    loader.classList.remove("hidden");
      btnText.textContent = "Renaming...";

    try {
      await api("/family/rename", {
        method: "PUT",
        body: JSON.stringify({ name: newName }),
      });
      if (_familyNameEl) _familyNameEl.textContent = newName;
      currentFamilyData.family.name = newName;
      closeModal();
    } catch (err) {
      showToast(err.message || "Rename failed");
    } finally {
      loader.classList.add("hidden");
      btnText.textContent = "Rename";
    }
  };
}

/* ─── Online/Offline Status ─── */

let _onlineUserIds = new Set();

function updateMemberOnlineStatus(members) {
  const chips = document.querySelectorAll("#family-card-root .member-chip");
  chips.forEach((chip) => {
    const userId = chip.dataset.userId;
    const statusDot = chip.querySelector(".member-status");
    if (!statusDot) return;
    if (_onlineUserIds.has(userId)) {
      statusDot.classList.add("online");
      statusDot.classList.remove("offline");
    } else {
      statusDot.classList.remove("online");
      statusDot.classList.add("offline");
    }
  });
}

function setOnlineUsers(userIds) {
  _onlineUserIds = new Set(userIds);
  updateMemberOnlineStatus();
}

/* ─── Dashboard WebSocket for online status ─── */

let _dashWs = null;
let _dashWsTimeout = null;

/* ─── Notification Sound (works globally) ─── */

let _notifAudioCtx = null;

function playNotifSound() {
  try {
    if (!_notifAudioCtx) _notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = _notifAudioCtx.createOscillator();
    const gain = _notifAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(_notifAudioCtx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, _notifAudioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, _notifAudioCtx.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(880, _notifAudioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.2, _notifAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, _notifAudioCtx.currentTime + 0.3);
    osc.start(_notifAudioCtx.currentTime);
    osc.stop(_notifAudioCtx.currentTime + 0.3);
  } catch (e) { }
}

// Listen for SW push sound triggers
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "PLAY_NOTIF_SOUND") {
      playNotifSound();
    }
  });
}

function connectDashboardWS(familyId) {
  if (_dashWs) { try { _dashWs.close(); } catch (e) { } }

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/chat/ws/${familyId}`;
  _dashWs = new WebSocket(wsUrl);

  _dashWs.onopen = () => {
    const storedToken = token();
    if (storedToken) {
      _dashWs.send(JSON.stringify({ type: "auth", token: storedToken }));
    }
  };

  _dashWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "online_users") {
        const ids = data.users.map((u) => u.user_id);
        setOnlineUsers(ids);
      }
    } catch (err) { }
  };

  _dashWs.onclose = () => {
    clearTimeout(_dashWsTimeout);
    _dashWsTimeout = setTimeout(() => {
      if (currentFamilyData) connectDashboardWS(currentFamilyData.family.id);
    }, 5000);
  };
}

async function showDashboard() {
  hideBrandPanel();
  showView(dashboardView);

  // Load family data and render
  const familyData = await loadFamily();
  currentFamilyData = familyData;
  renderFamilyCard(familyData, getCurrentUserId());

  // Connect WebSocket for online status
  if (familyData) {
    connectDashboardWS(familyData.family.id);
  }

  // Check if we need to show banner for a pending invite
  maybeShowInviteBanner(familyData);

  // Email verification banner for unverified password users
  updateVerifyBanner();

  // Initialize notifications
  initNotifications();
}

function showOnboarding() {
  hideBrandPanel();
  showView(onboardingView);
  currentOnboardStep = 1;
  updateOnboardStep();
}

function showAuth() {
  showBrandPanel();
  showView(authView);
}

/* ─── Onboarding ─── */

let currentOnboardStep = 1;

function updateOnboardStep() {
  document.querySelectorAll(".onboard-content").forEach((el) => el.classList.add("hidden"));
  const stepEl = document.getElementById(`onboard-step-${currentOnboardStep}`);
  if (stepEl) {
    stepEl.classList.remove("hidden");
    const icon = stepEl.querySelector(".onboard-icon");
    if (icon) {
      icon.classList.remove("bounce-in");
      icon.offsetHeight;
      icon.classList.add("bounce-in");
    }
  }

  document.querySelectorAll(".step-dot").forEach((dot) => {
    const step = parseInt(dot.dataset.step);
    dot.classList.toggle("active", step === currentOnboardStep);
    dot.classList.toggle("done", step < currentOnboardStep);
  });
}

/* ─── Bootstrap ─── */

async function bootstrap() {
  createParticles();
  checkInviteFromUrl();

  const params = new URLSearchParams(window.location.search);

  const oauthToken = params.get("token");
  const error = params.get("error");

  if (window.location.pathname.includes("/auth/callback") && oauthToken) {
    saveToken(oauthToken);
    window.history.replaceState({}, "", "/");
  }

  if (error) {
    showAuth();
    setMessage("Authentication failed. Please try again.", "error");
    window.history.replaceState({}, "", "/");
    return;
  }

  if (hasResetToken()) {
    showAuth();
    authTitle.textContent = "Reset password";
    setMessage("Enter a new password for your account.");
    authForm.classList.add("hidden");
    document.querySelector(".tabs").classList.add("hidden");
    document.querySelector(".divider").classList.add("hidden");
    document.querySelector("#google-login").classList.add("hidden");
    document.querySelector("#forgot-open").classList.add("hidden");
    resetForm.classList.remove("hidden");
    return;
  }

  if (!token()) {
    showAuth();
    return;
  }

  try {
    await loadMe();
    await autoJoinIfPendingInvite();

    if (!isOnboarded()) {
      showOnboarding();
    } else {
      showDashboard();
    }
  } catch (error) {
    clearToken();
    showAuth();
    setMessage("Please sign in again.", "error");
  }
}

/* ─── Event Listeners ─── */

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitBtn = document.querySelector("#auth-submit");
    setMessage("Working...");
  showLoader(submitBtn, true);

  try {
    if (mode === "signup") {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      saveToken(data.access_token);
      await loadMe();
      if (needsEmailVerification()) {
        await openVerifyFlow();
      }
      showOnboarding();
      setMessage("");
    } else {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });

      saveToken(data.access_token);
      await loadMe();

      if (!isOnboarded()) {
        showOnboarding();
      } else {
        showDashboard();
      }
      setMessage("");
    }
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    showLoader(submitBtn, false);
  }
});

document.querySelector("#google-login").addEventListener("click", () => {
  window.location.href = `${API_BASE}/auth/oauth`;
});

document.querySelector("#forgot-open").addEventListener("click", () => {
  window.location.href = "./forgot-password/index.html";
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const resetToken = new URLSearchParams(window.location.search).get("token");
  const submitBtn = resetForm.querySelector("button[type='submit']");
  setMessage("Resetting password...");
  showLoader(submitBtn, true);

  try {
    const data = await api("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        token: resetToken,
        new_password: document.querySelector("#new-password").value,
      }),
    });
    window.history.replaceState({}, "", "/");
    resetForm.classList.add("hidden");
    setMessage(data.message + " Redirecting to login...", "success");
    setTimeout(() => {
      authForm.classList.remove("hidden");
      document.querySelector(".tabs").classList.remove("hidden");
      document.querySelector(".divider").classList.remove("hidden");
      document.querySelector("#google-login").classList.remove("hidden");
      document.querySelector("#forgot-open").classList.remove("hidden");
      setMode("login");
      showAuth();
    }, 2000);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    showLoader(submitBtn, false);
  }
});

document.querySelector("#reset-back-login").addEventListener("click", () => {
  window.history.replaceState({}, "", "/");
  resetForm.classList.add("hidden");
  authForm.classList.remove("hidden");
  document.querySelector(".tabs").classList.remove("hidden");
  document.querySelector(".divider").classList.remove("hidden");
  document.querySelector("#google-login").classList.remove("hidden");
  document.querySelector("#forgot-open").classList.remove("hidden");
  setMode("login");
  showAuth();
});

document.querySelector("#logout").addEventListener("click", () => {
  clearToken();
  sessionStorage.removeItem("verify_banner_dismissed");
  showAuth();
  setMessage("Logged out.", "success");
});

document.querySelector("#verify-banner-resend")?.addEventListener("click", () => {
  openVerifyFlow();
});
document.querySelector("#verify-banner-dismiss")?.addEventListener("click", () => {
  sessionStorage.setItem("verify_banner_dismissed", "1");
  updateVerifyBanner();
});

/* ─── Delete account (two-step, credential-gated) ─── */

function openDeleteAccountFlow() {
  const isGoogle = _cachedUser && _cachedUser.auth_provider === "google";

  const old = document.getElementById("fs-modal-overlay");
  if (old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "fs-modal-overlay";
  overlay.innerHTML = `
    <div class="fs-modal delete-account-modal">
      <h3 class="fs-modal-title danger-label">${"Delete your account?"}</h3>
      <div class="fs-modal-message">
        <p>This is <strong>immediate and irreversible</strong>:</p>
        <ul class="delete-list">
          <li>Your AI chats, images and shares are deleted</li>
          <li>You leave your family (admin passes to longest member)</li>
          <li>Your chat messages stay as “Deleted member” blanks</li>
          <li>Notifications and login tokens are wiped</li>
        </ul>
      </div>
      <div class="fs-modal-actions">
        <button class="fs-modal-cancel" id="fs-modal-cancel">${"Keep my account"}</button>
        <button class="fs-modal-confirm fs-modal-danger" id="fs-modal-confirm">${"Continue"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#fs-modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#fs-modal-confirm").addEventListener("click", () => {
    overlay.querySelector(".fs-modal").innerHTML = `
      <h3 class="fs-modal-title danger-label">${"Last chance"}</h3>
      <p class="fs-modal-message">${
        isGoogle
          ? `Type <strong>DELETE</strong> below to confirm.`
          : `Enter your <strong>password</strong> to confirm.`
      }</p>
      <input class="fs-modal-input" id="delete-confirm-input"
        type="${isGoogle ? "text" : "password"}"
        placeholder="${isGoogle ? "Type DELETE" : "Current password"}"
        autocomplete="off" />
      <p class="fs-modal-error hidden" id="delete-confirm-error"></p>
      <div class="fs-modal-actions">
        <button class="fs-modal-cancel" id="fs-modal-cancel2">Cancel</button>
        <button class="fs-modal-confirm fs-modal-danger" id="fs-modal-confirm2">Delete everything</button>
      </div>`;
    const input = overlay.querySelector("#delete-confirm-input");
    const errEl = overlay.querySelector("#delete-confirm-error");
    input.focus();
    overlay.querySelector("#fs-modal-cancel2").addEventListener("click", close);
    overlay.querySelector("#fs-modal-confirm2").addEventListener("click", async () => {
      const val = input.value;
      if (!val) {
        errEl.textContent = isGoogle ? "Type DELETE to confirm." : "Enter your password.";
        errEl.classList.remove("hidden");
        return;
      }
      const btn = overlay.querySelector("#fs-modal-confirm2");
      btn.disabled = true;
      btn.textContent = "Deleting...";
      try {
        await api("/auth/me", {
          method: "DELETE",
          body: JSON.stringify(
            isGoogle ? { confirm_text: val } : { password: val }
          ),
        });
        close();
        document.getElementById("profile-modal")?.classList.add("hidden");
        clearToken();
        sessionStorage.removeItem("verify_banner_dismissed");
        currentFamilyData = null;
        _cachedUser = null;
        showAuth();
        showToast("Account deleted.");
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Delete everything";
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    });
  });
}

document.querySelector("#profile-delete-btn")?.addEventListener("click", () => {
  if (!_cachedUser) return;
  openDeleteAccountFlow();
});

/* ─── Theme toggle ─── */

function toggleTheme() {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  localStorage.setItem("familyshield_theme", isDark ? "dark" : "light");
}

function loadTheme() {
  const saved = localStorage.getItem("familyshield_theme");
  if (saved === "dark") {
    document.body.classList.add("dark");
  }
}

document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);

const themeToggleDash = document.querySelector("#theme-toggle-dash");
if (themeToggleDash) {
  themeToggleDash.addEventListener("click", toggleTheme);
}

/* ─── Onboarding flow ─── */

document.querySelectorAll(".onboard-next").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (currentOnboardStep === 2) {
      const nameVal = document.querySelector("#onboard-name").value.trim();
      if (nameVal) {
        const avatarEl = document.querySelector("#avatar");
        const welcomeEl = document.querySelector("#welcome-title");
        const memberYouEl = document.querySelector("#member-you");
        if (avatarEl) avatarEl.textContent = nameVal.charAt(0).toUpperCase();
        if (welcomeEl) welcomeEl.textContent = `${getGreetingPeriod() === "morning" ? "Good Morning" : getGreetingPeriod() === "afternoon" ? "Good Afternoon" : "Good Evening"}, ${nameVal.split(" ")[0]} 👋`;
        if (memberYouEl) memberYouEl.textContent = nameVal.split(" ")[0];
      }
    }
    currentOnboardStep++;
    updateOnboardStep();
  });
});

document.querySelectorAll(".onboard-skip").forEach((btn) => {
  btn.addEventListener("click", async () => {
    await setOnboarded();
    showDashboard();
  });
});

document.querySelector("#onboard-step-2 .onboard-next").addEventListener("click", () => {
  const nameVal = document.querySelector("#onboard-name").value.trim();
  if (nameVal) {
    const avatarEl = document.querySelector("#avatar");
    const welcomeEl = document.querySelector("#welcome-title");
    const memberYouEl = document.querySelector("#member-you");
    if (avatarEl) avatarEl.textContent = nameVal.charAt(0).toUpperCase();
    if (welcomeEl) welcomeEl.textContent = `${getGreetingPeriod() === "morning" ? "Good Morning" : getGreetingPeriod() === "afternoon" ? "Good Afternoon" : "Good Evening"}, ${nameVal.split(" ")[0]} 👋`;
    if (memberYouEl) memberYouEl.textContent = nameVal.split(" ")[0];
  }
});

document.querySelector(".onboard-finish").addEventListener("click", async () => {
  await setOnboarded();
  showDashboard();
});

/* ─── Family API ─── */

const INVITE_KEY = "familyshield_invite_code";

async function loadFamily() {
  try {
    const data = await api("/family/me");
    return data;
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("not part of any family")) {
      return null;
    }
    return null;
  }
}

async function createFamilyAPI(name) {
  return await api("/family/create", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

async function joinFamilyAPI(invite_code) {
  return await api("/family/join", {
    method: "POST",
    body: JSON.stringify({ invite_code }),
  });
}

async function generateInviteAPI() {
  return await api("/family/invite", { method: "POST" });
}


/* ─── Colour palette for member chips ─── */

const MEMBER_COLORS = [
  "#10b981", "#8b5cf6", "#f59e0b",
  "#3b82f6", "#ec4899", "#ef4444", "#14b8a6",
];

function memberColor(index) {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

/* ─── Render family card ─── */

function renderFamilyCard(familyData, currentUserId) {
  const root = document.getElementById("family-card-root");
  const activitySection = document.getElementById("activity-section");

  if (!familyData) {
    // STATE A: No family yet
    root.innerHTML = `
      <div class="family-card family-empty">
        <div class="family-empty-icon">🏠</div>
        <h3 class="family-empty-title">${"No family group yet"}</h3>
        <p class="family-empty-sub">${"Create your family space or join one using an invite link."}</p>
        <div class="family-empty-actions">
          <button class="primary" id="create-family-btn" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            ${"Create Family"}
          </button>
          <button class="btn-join-code" id="join-code-btn" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            ${"Join with code"}
          </button>
        </div>
      </div>`;

    document.getElementById("create-family-btn").addEventListener("click", handleCreateFamily);
    document.getElementById("join-code-btn").addEventListener("click", handleJoinWithCode);
    activitySection.classList.add("hidden");
    return;
  }

  const { family, members, invite } = familyData;
  const otherMembers = members.filter(m => m.id !== currentUserId);
  const isAdmin = family.admin_user_id === currentUserId;

  if (otherMembers.length === 0) {
    // STATE B: Solo — show invite panel
    const inviteUrl = invite ? invite.invite_url : "";
    const inviteCode = invite ? invite.invite_code : "";

    root.innerHTML = `
      <div class="family-card">
        <div class="family-card-header">
          <div class="family-card-title">
            <span class="family-icon">👨‍👩‍👧</span>
            <div>
              <h3 class="family-name">${escHtml(family.name)}</h3>
              <p class="family-subtitle">${"1 member(s)"} &middot; ${"Just you so far"}</p>
            </div>
          </div>
          <a class="btn-manage" href="./family/index.html" title="${"Manage Family"}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </a>
        </div>

        <div class="family-members">
          <div class="member-chip">
            <div class="member-avatar" style="--color:${memberColor(0)}" id="member-you-avatar">?</div>
            <div class="member-status online"></div>
            <span class="member-name">You</span>
          </div>
        </div>

        <div class="invite-panel">
          <p class="invite-panel-label">${"Invite a family member"}</p>
          <p class="invite-uses-line">${invite && invite.uses_count ? `${invite.uses_count} joined via link` : "Link works for the whole family"}</p>
          <div class="invite-actions-row">
            <button class="btn-copy-link" id="copy-link-btn" type="button">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
               ${"Copy Link"}
            </button>
            <button class="btn-share-link" id="share-link-btn" type="button">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
               ${"Share"}
            </button>
          </div>
          <button class="qr-reveal-btn" id="qr-reveal-btn" type="button">${"Show QR Code"}</button>
          <div class="qr-wrapper hidden" id="qr-wrapper">
            <canvas id="qr-canvas" class="qr-canvas"></canvas>
          </div>
        </div>
      </div>`;

    document.getElementById("copy-link-btn").addEventListener("click", () => copyToClipboard(inviteUrl));
    document.getElementById("share-link-btn").addEventListener("click", () => shareInvite(inviteUrl, family.name));
    document.getElementById("qr-reveal-btn").addEventListener("click", () => {
      const qrWrapper = document.getElementById("qr-wrapper");
      const btn = document.getElementById("qr-reveal-btn");
      if (qrWrapper.classList.contains("hidden")) {
        qrWrapper.classList.remove("hidden");
        btn.textContent = "Hide QR Code";
      } else {
        qrWrapper.classList.add("hidden");
        btn.textContent = "Show QR Code";
      }
    });
    const youAvatar = document.getElementById("member-you-avatar");
    if (youAvatar) {
      const avatarEl = document.getElementById("avatar");
      youAvatar.textContent = avatarEl ? avatarEl.textContent : "?";
    }
    if (inviteUrl) renderQR(inviteUrl);
    activitySection.classList.add("hidden");

  } else {
    // STATE C: Real members
    const memberChips = members.map((m, i) => {
      const isYou = m.id === currentUserId;
      const st = m.status || "active";
      const initial = (m.name || "?").charAt(0).toUpperCase();
      const displayName = escHtml(isYou ? "You" : m.name.split(" ")[0]);
      const tag = st === "blocked"
        ? `<span class="member-tag member-tag--blocked">Blocked</span>`
        : st === "removed"
          ? `<span class="member-tag member-tag--left">Left</span>`
          : "";
      const clickable = isAdmin && !isYou;
      return `
        <div class="member-chip ${clickable ? "member-chip--admin" : ""} ${st !== "active" ? "member-chip--inactive" : ""}" data-user-id="${m.id}" data-user-name="${escHtml(m.name)}" data-status="${st}" ${clickable ? 'role="button"' : ""}>
          <div class="member-avatar" style="--color:${memberColor(i)}">${escHtml(initial)}</div>
          <div class="member-status online"></div>
          <span class="member-name">${displayName}</span>
          ${tag}
        </div>`;
    }).join("");

    root.innerHTML = `
      <div class="family-card family-card--active">
        <div class="family-card-header">
          <div class="family-card-title">
            <div class="family-icon-wrap">👨‍👩‍👧</div>
            <div>
              <h3 class="family-name">${escHtml(family.name)}</h3>
              <p class="family-subtitle">
                <span class="member-count-dot"></span>
                ${family.member_count} member${family.member_count !== 1 ? "s" : ""} · All active
              </p>
            </div>
          </div>
          <div class="family-card-actions">
            ${isAdmin ? `<button class="btn-invite-more" id="invite-more-btn" type="button">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              ${"Invite"}
            </button>` : ""}
            <a class="btn-reviews" href="./review/index.html" title="${"Family Reviews"}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
            </a>
            <a class="btn-manage" href="./family/index.html" title="${"Manage Family"}">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            </a>
          </div>
        </div>

        <div class="family-members-row">${memberChips}</div>

        <button class="family-chat-btn" id="family-chat-btn" type="button">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>${"Open Family Chat"}</span>
          <span class="chat-badge">${family.member_count}</span>
        </button>
      </div>`;

    if (isAdmin) {
      document.getElementById("invite-more-btn").addEventListener("click", handleInviteMore);
      root.querySelectorAll(".member-chip--admin").forEach((chip) => {
        chip.addEventListener("click", () => {
          window.location.href = "./family/index.html";
        });
      });
    }
    document.getElementById("family-chat-btn").addEventListener("click", () => {
      window.location.href = `./chat/index.html?family_id=${family.id}`;
    });

    initFamilyRename(isAdmin, family.id, family.name);

    renderActivityFeed(members, currentUserId);
    activitySection.classList.remove("hidden");
  }
}

/* ─── Activity feed ─── */

function renderActivityFeed(members, currentUserId) {
  const feed = document.getElementById("activity-feed");
  const others = members.filter(m => m.id !== currentUserId);
  if (others.length === 0) { feed.innerHTML = ""; return; }

  feed.innerHTML = others.slice(0, 4).map((m, i) => {
    const initial = (m.name || "?").charAt(0).toUpperCase();
    const color = MEMBER_COLORS[(i + 1) % MEMBER_COLORS.length];
    const firstName = m.name.split(" ")[0];
    const timeAgo = friendlyTime(m.joined_at);
    return `
      <div class="activity-item activity-item--safe">
        <div class="activity-avatar" style="--color:${color}">${escHtml(initial)}</div>
        <div class="activity-body">
          <p class="activity-text"><strong>${escHtml(firstName)}</strong> joined your family</p>
          <span class="activity-meta">
            <span class="activity-badge badge-safe">✅ Member</span>
            <span class="activity-time">${timeAgo}</span>
          </span>
        </div>
      </div>`;
  }).join("");
}

function friendlyTime(date) {
  // Ensure UTC parsing — backend returns naive datetime strings, force UTC
  let d = date;
  if (typeof date === "string") {
    // Append Z if no timezone info so JS treats it as UTC not local
    d = new Date(date.endsWith("Z") || date.includes("+") ? date : date + "Z");
  }
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── QR Code ─── */

function renderQR(text) {
  if (window.QRCode) {
    _drawQR(text);
    return;
  }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
  script.onload = () => _drawQR(text);
  document.head.appendChild(script);
}

function _drawQR(text) {
  const canvas = document.getElementById("qr-canvas");
  if (!canvas) return;
  canvas.parentElement.innerHTML = `<div id="qr-output" class="qr-output"></div>`;
  new QRCode(document.getElementById("qr-output"), {
    text,
    width: 160,
    height: 160,
    colorDark: "#059669",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

/* ─── Clipboard & Share ─── */

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast("Copy Link")).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("Copy");
  });
}

function shareInvite(url, familyName) {
  if (navigator.share) {
    navigator.share({
      title: "Join my FamilyShield group",
      text: `Join my family "${familyName}" on FamilyShield — we use it to stay safe online together.`,
      url,
    }).catch(() => { });
  } else {
    copyToClipboard(url);
  }
}

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

/* ─── In-page modal helper (replaces window.prompt) ─── */

function showModal({ title, placeholder, defaultValue = "", onConfirm }) {
  // Remove any existing modal
  const existing = document.getElementById("fs-modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "fs-modal-overlay";
  overlay.innerHTML = `
    <div class="fs-modal">
      <h3 class="fs-modal-title">${title}</h3>
      <input class="fs-modal-input" id="fs-modal-input" type="text" placeholder="${placeholder}" value="${defaultValue}" autocomplete="off" />
      <div class="fs-modal-actions">
        <button class="fs-modal-cancel" id="fs-modal-cancel">Cancel</button>
        <button class="fs-modal-confirm" id="fs-modal-confirm">${"Continue"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#fs-modal-input");
  input.focus();
  input.select();

  const close = () => overlay.remove();

  overlay.querySelector("#fs-modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const confirm = () => {
    const val = input.value.trim();
    if (!val) { input.classList.add("shake"); setTimeout(() => input.classList.remove("shake"), 400); return; }
    close();
    onConfirm(val);
  };

  overlay.querySelector("#fs-modal-confirm").addEventListener("click", confirm);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") confirm(); if (e.key === "Escape") close(); });
}

/* ─── Confirm dialog (no input) ─── */

function showConfirm({ title, message, onConfirm }) {
  const existing = document.getElementById("fs-modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "fs-modal-overlay";
  overlay.innerHTML = `
    <div class="fs-modal">
      <h3 class="fs-modal-title">${title}</h3>
      <p class="fs-modal-message">${message}</p>
      <div class="fs-modal-actions">
        <button class="fs-modal-cancel" id="fs-modal-cancel">Cancel</button>
        <button class="fs-modal-confirm fs-modal-danger" id="fs-modal-confirm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#fs-modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#fs-modal-confirm").addEventListener("click", () => { close(); onConfirm(); });
}

/* ─── Handlers ─── */

function handleCreateFamily() {
  showModal({
    title: "Name your family group",
    placeholder: "e.g. The Sharma Family",
    defaultValue: "My Family",
    onConfirm: async (name) => {
      try {
        const data = await createFamilyAPI(name);
        currentFamilyData = data;
        renderFamilyCard(data, getCurrentUserId());
        showToast("Family created!");
      } catch (err) {
        showToast("Error: " + err.message);
      }
    }
  });
}

function handleJoinWithCode() {
  showModal({
    title: "Join a family",
    placeholder: "Paste invite code or link",
    onConfirm: async (code) => {
      const extracted = extractCodeFromInput(code);
      try {
        const data = await joinFamilyAPI(extracted);
        currentFamilyData = data;
        renderFamilyCard(data, getCurrentUserId());
        showToast("You joined the family!");
      } catch (err) {
        showToast("Error: " + err.message);
      }
    }
  });
}



async function handleRefreshInvite() {
  try {
    const invite = await generateInviteAPI();
    document.getElementById("invite-link-text").textContent = invite.invite_url;
    document.getElementById("copy-link-btn").onclick = () => copyToClipboard(invite.invite_url);
    document.getElementById("share-link-btn").onclick = () => shareInvite(invite.invite_url, "");
    renderQR(invite.invite_url);
    showToast("New invite link ready");
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

async function handleInviteMore() {
  try {
    const invite = await generateInviteAPI();
    copyToClipboard(invite.invite_url);
    showToast("Invite link copied");
  } catch (err) {
    showToast("Error: " + err.message);
  }
}

function extractCodeFromInput(input) {
  try {
    const url = new URL(input);
    return url.searchParams.get("invite") || input;
  } catch {
    return input;
  }
}

/* ─── Current user ID (cached after loadMe) ─── */

let _currentUserId = null;

function getCurrentUserId() {
  return _currentUserId;
}

/* ─── Invite from URL ─── */

function checkInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("invite");
  if (code) {
    sessionStorage.setItem(INVITE_KEY, code);
    window.history.replaceState({}, "", window.location.pathname);
  }
}

function getPendingInvite() {
  return sessionStorage.getItem(INVITE_KEY);
}

function clearPendingInvite() {
  sessionStorage.removeItem(INVITE_KEY);
}

async function autoJoinIfPendingInvite() {
  const code = getPendingInvite();
  if (!code) return;
  clearPendingInvite();
  const existing = await loadFamily();
  if (existing) return;
  try {
    const info = await api(`/family/join/${code}`, {}).catch(() => null);
    const data = await joinFamilyAPI(code);
    currentFamilyData = data;
    showToast(`You joined "${data.family.name}"!`);
    return data;
  } catch (err) {
    showToast("Error: " + (err.message || "Invite code is invalid or expired."));
    return null;
  }
}

/* ─── Invite banner (for when user arrives via ?invite= link) ─── */

async function maybeShowInviteBanner(familyData) {
  const code = getPendingInvite();
  if (!code || familyData) return;

  const banner = document.getElementById("invite-banner");
  if (!banner) return;

  try {
    const info = await api(`/family/join/${code}`);
    const nameEl = document.getElementById("invite-family-name");
    if (nameEl) nameEl.textContent = ` — "${info.family_name}"`;
    banner.classList.remove("hidden");

    document.getElementById("invite-banner-accept").addEventListener("click", async () => {
      banner.classList.add("hidden");
      try {
        const data = await joinFamilyAPI(code);
        clearPendingInvite();
        currentFamilyData = data;
        renderFamilyCard(data, getCurrentUserId());
        showToast(`You joined "${data.family.name}"!`);
      } catch (err) {
        showToast("Error: " + err.message);
      }
    });

    document.getElementById("invite-banner-dismiss").addEventListener("click", () => {
      banner.classList.add("hidden");
      clearPendingInvite();
    });
  } catch (err) {
    clearPendingInvite();
    showToast("Error: " + (err.message || "Invite link is invalid, expired, or revoked."));
  }
}

let currentFamilyData = null;

/* ─── Notifications ─── */

let notifPanelOpen = false;

async function initNotifications() {
  const badge = document.getElementById("notif-badge");
  const bellWrap = document.getElementById("notif-bell-wrap");
  const panel = document.getElementById("notif-panel");
  const markAllBtn = document.getElementById("notif-mark-all");
  const notifBtn = document.getElementById("notif-btn");

  if (!panel) return;

  // Move panel to body so no parent overflow clips it
  document.body.appendChild(panel);

  function openPanel() {
    notifPanelOpen = true;
    panel.classList.remove("hidden");
    panel.style.display = "";

    // Position panel: bottom-sheet on mobile, below bell on desktop
    if (window.innerWidth <= 680) {
      panel.style.position = "fixed";
      panel.style.top = "auto";
      panel.style.bottom = "0";
      panel.style.left = "0";
      panel.style.right = "0";
      panel.style.width = "100%";
      panel.style.maxWidth = "100%";
      panel.style.borderRadius = "16px 16px 0 0";
    } else {
      const rect = bellWrap.getBoundingClientRect();
      panel.style.position = "fixed";
      panel.style.top = (rect.bottom + 8) + "px";
      panel.style.left = "auto";
      panel.style.right = (window.innerWidth - rect.right) + "px";
      panel.style.bottom = "auto";
      panel.style.width = "360px";
      panel.style.maxWidth = "calc(100vw - 32px)";
      panel.style.borderRadius = "12px";
    }

    loadNotifList();
  }

  function closePanel() {
    notifPanelOpen = false;
    panel.classList.add("hidden");
  }

  // Toggle panel on bell
  if (notifBtn) {
    notifBtn.onclick = function (e) {
      e.stopPropagation();
      if (notifPanelOpen) {
        closePanel();
      } else {
        openPanel();
      }
    };
  }

  // Prevent panel taps from closing
  if (panel) {
    panel.onclick = function (e) {
      e.stopPropagation();
    };
  }

  // Close on outside tap
  document.addEventListener("click", function (e) {
    if (notifPanelOpen && bellWrap && !bellWrap.contains(e.target)) {
      closePanel();
    }
  });

  // Load unread count
  updateNotifBadge();

  // Push setup — NOT awaited, runs in background
  import("./notifications.js?v=v3").then(({ registerServiceWorker, subscribeToPush }) => {
    registerServiceWorker().then(() => subscribeToPush()).catch(() => { });
  }).catch(() => { });

  // Mark all read
  markAllBtn?.addEventListener("click", async () => {
    try {
      const { markAllNotifRead } = await import("./notifications.js?v=v3");
      await markAllNotifRead();
      badge.classList.add("hidden");
      badge.textContent = "0";
      const list = document.getElementById("notif-panel-list");
      if (list) list.innerHTML = `<div class="notif-empty">${"No new notifications"}</div>`;
    } catch (e) {
      console.error(e);
    }
  });

  // Poll every 30s
  setInterval(updateNotifBadge, 30000);
}

let _lastUnreadCount = 0;

async function updateNotifBadge() {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  try {
    const res = await api("/notifications/unread");
    const count = res.unread_count || 0;
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : count;
      badge.classList.remove("hidden");
      // Play sound if new notifications arrived
      if (count > _lastUnreadCount) {
        playNotifSound();
      }
    } else {
      badge.classList.add("hidden");
    }
    _lastUnreadCount = count;
  } catch (e) {
    // silently fail
  }
}

async function loadNotifList() {
  const list = document.getElementById("notif-panel-list");
  if (!list) return;
  try {
    const { loadNotifications, renderNotifPanel } = await import("./notifications.js?v=v3");
    const data = await loadNotifications();
    const notifications = (data.notifications || []).filter((n) => !n.is_read);
    list.innerHTML = notifications.length
      ? renderNotifPanel(notifications, getCurrentUserId())
      : `<div class="notif-empty">${"No new notifications"}</div>`;

    // Click to mark read (no navigation)
    list.querySelectorAll(".notif-item").forEach((item) => {
      item.addEventListener("click", async (e) => {
        if (e.target.closest(".notif-open-btn")) return;
        const id = item.dataset.notifId;
        if (item.classList.contains("notif-unread")) {
          const { markNotifRead } = await import("./notifications.js?v=v3");
          await markNotifRead(id);
          item.classList.remove("notif-unread");
          const dot = item.querySelector(".notif-dot");
          if (dot) dot.remove();
          updateNotifBadge();
        }
        if (item.dataset.reviewId) {
          window.location.href = `./review/index.html?share_id=${item.dataset.reviewId}`;
        } else if (item.dataset.caseId) {
          window.location.href = `./case/index.html?case_id=${item.dataset.caseId}`;
        }
      });
    });

    // Open button navigates: review page, case page, or chat
    list.querySelectorAll(".notif-open-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.reviewId) {
          window.location.href = `./review/index.html?share_id=${btn.dataset.reviewId}`;
          return;
        }
        if (btn.dataset.caseId) {
          window.location.href = `./case/index.html?case_id=${btn.dataset.caseId}`;
          return;
        }
        const familyId = btn.dataset.familyId;
        if (familyId) {
          window.location.href = `./chat/index.html?family_id=${familyId}`;
        }
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="notif-empty">Failed to load notifications</div>';
  }
}

/* ─── Init ─── */

loadTheme();
setMode("login");
initGuide();
bootstrap();

/* --- Password Visibility Toggle --- */
document.querySelectorAll('.password-toggle').forEach(btn => {
  const eyeIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const eyeOffIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  btn.innerHTML = eyeIcon; // default state is hidden (password type)

  btn.addEventListener('click', function () {
    const input = this.previousElementSibling;
    const isPassword = input.getAttribute('type') === 'password';
    input.setAttribute('type', isPassword ? 'text' : 'password');

    // If it was a password and we are making it text (visible), we show the "eye-off" icon (click to hide)
    // If it was text and we are making it password (hidden), we show the "eye" icon (click to view)
    this.innerHTML = isPassword ? eyeOffIcon : eyeIcon;
    this.style.color = isPassword ? 'var(--brand)' : 'var(--muted)';
  });
});

