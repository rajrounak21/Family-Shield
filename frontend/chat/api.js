export const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : window.location.origin;
const TOKEN_KEY = "familyshield_token";

export function token() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCurrentUserId() {
  const t = token();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    return payload.sub || payload.user_id || payload.id || null;
  } catch {
    return null;
  }
}

export async function api(path, options = {}) {
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

export async function getFamilyInfo() {
  const data = await api("/family/me");
  return data;
}

export async function getMessages(familyId, limit = 50, before = null) {
  let url = `/chat/${familyId}/messages?limit=${limit}`;
  if (before) url += `&before=${before}`;
  return await api(url);
}

export async function searchMessages(familyId, query) {
  return await api(`/chat/${familyId}/search?q=${encodeURIComponent(query)}`);
}

export async function uploadImage(familyId, file) {
  const formData = new FormData();
  formData.append("file", file);

  const storedToken = token();
  const response = await fetch(`${API_BASE}/chat/${familyId}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${storedToken}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Upload failed");
  }

  return data;
}

export function getImageUrl(imageId) {
  return `${API_BASE}/chat/images/${imageId}`;
}

export const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "🙏", "👍"];

export async function editMessage(familyId, messageId, content) {
  return await api(`/chat/${familyId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export async function deleteMessage(familyId, messageId) {
  return await api(`/chat/${familyId}/messages/${messageId}`, {
    method: "DELETE",
  });
}

export async function toggleReaction(familyId, messageId, emoji) {
  return await api(`/chat/${familyId}/messages/${messageId}/reactions`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
}

export async function markSeen(familyId, messageIds) {
  return await api(`/chat/${familyId}/seen`, {
    method: "POST",
    body: JSON.stringify({ message_ids: messageIds }),
  });
}
