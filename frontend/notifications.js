const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;
const TOKEN_KEY = "familyshield_token";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function notifApi(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

/* ─── Service Worker Registration ─── */

let swRegistration = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return swRegistration;
  } catch (err) {
    return null;
  }
}

/* ─── Push Subscription ─── */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPush() {
  if (!swRegistration) return;
  if (!("Notification" in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const VAPID_PUBLIC_KEY =
    "BDrcZ7xg5LS4xjYbT6e5Jiy349Nr-ICm1uQqxbO8Fl8P3EKHunv88hJFQsm6XrlNM9iRRxbVm4rSFuFmlTha9w0";

  try {
    const existing = await swRegistration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
    }

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await sendSubscriptionToServer(subscription);
  } catch (err) {
    // silent
  }
}

async function sendSubscriptionToServer(subscription) {
  const sub = subscription.toJSON();
  try {
    await notifApi("/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: sub.keys,
      }),
    });
  } catch (err) {
    // silent
  }
}

/* ─── Notification Bell + Center ─── */

let notifPollTimer = null;

export function startNotifPolling(onUpdate) {
  stopNotifPolling();
  loadUnreadCount(onUpdate);
  notifPollTimer = setInterval(() => loadUnreadCount(onUpdate), 30000);
}

export function stopNotifPolling() {
  if (notifPollTimer) {
    clearInterval(notifPollTimer);
    notifPollTimer = null;
  }
}

async function loadUnreadCount(onUpdate) {
  try {
    const data = await notifApi("/notifications/unread");
    if (onUpdate) onUpdate(data.unread_count);
  } catch (err) {
    // silently fail
  }
}

export async function loadNotifications() {
  return await notifApi("/notifications?limit=20");
}

export async function markNotifRead(id) {
  return await notifApi(`/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotifRead() {
  return await notifApi("/notifications/read-all", { method: "POST" });
}

/* ─── Render Bell Icon ─── */

export function renderBell(containerId, unreadCount) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const badge = unreadCount > 0
    ? `<span class="notification-badge">${unreadCount > 99 ? "99+" : unreadCount}</span>`
    : "";

  container.innerHTML = `
    <button class="notification-bell" id="notif-bell-btn" type="button" title="${"Notifications"}">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      ${badge}
    </button>`;
}

/* ─── Render Notification Panel ─── */

export function renderNotifPanel(notifications, currentUserId) {
  if (!notifications.length) {
    return `<div class="notif-empty">${"No new notifications"}</div>`;
  }

  return notifications.map((n) => {
    const time = formatNotifTime(n.created_at);
    const unreadClass = n.is_read ? "" : "notif-unread";
    const isCase = !!n.case_id;
    const isReview = !!n.review_share_id;
    const icon = isReview ? "📝" : isCase ? "📋" : "💬";
    let openTarget = "";
    if (isReview) {
      openTarget = `data-review-id="${n.review_share_id}"`;
    } else if (isCase) {
      openTarget = `data-case-id="${n.case_id}"`;
    } else if (n.family_id) {
      openTarget = `data-family-id="${n.family_id}"`;
    }
    return `
      <div class="notif-item ${unreadClass}" data-notif-id="${n.id}" data-family-id="${n.family_id}" ${isReview ? `data-review-id="${n.review_share_id}"` : ""} ${isCase ? `data-case-id="${n.case_id}"` : ""}>
        <div class="notif-icon">${icon}</div>
        <div class="notif-content">
          <p class="notif-text">${escapeHtml(n.body)}</p>
          <span class="notif-time">${time}</span>
        </div>
        ${!n.is_read ? '<div class="notif-dot"></div>' : ''}
        ${openTarget ? `<button class="notif-open-btn" ${openTarget} type="button" title="${isReview ? 'Open review' : isCase ? 'Open case' : 'Open chat'}">→</button>` : ''}
      </div>`;
  }).join("");
}

function formatNotifTime(isoString) {
  const date = new Date(isoString.endsWith("Z") || isoString.includes("+") ? isoString : isoString + "Z");
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
