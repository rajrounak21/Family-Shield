import { getImageUrl } from "./api.js";

export class UIManager {
  constructor() {
    this.messagesList = document.getElementById("messages-list");
    this.messagesLoading = document.getElementById("messages-loading");
    this.typingIndicator = document.getElementById("typing-indicator");
    this.typingUser = document.getElementById("typing-user");
    this.messageInput = document.getElementById("message-input");
    this.sendBtn = document.getElementById("send-btn");
    this.memberCount = document.getElementById("member-count");
    this.familyName = document.getElementById("family-name");
    this.onlineUsers = document.getElementById("online-users");
    this.imagePreview = document.getElementById("image-preview");
    this.previewImg = document.getElementById("preview-img");
    this.currentUserId = null;
    this.memberCountNum = 0;
  }

  setCurrentUserId(userId) {
    this.currentUserId = userId;
  }

  hideLoading() {
    this.messagesLoading.classList.add("hidden");
  }

  showEmptyState() {
    this.messagesList.innerHTML = `
      <div class="empty-chat">
        <div class="empty-chat-icon">💬</div>
        <h3>Start the conversation</h3>
        <p>Send a message to your family members. They'll receive it instantly.</p>
      </div>
    `;
  }

  renderMessage(msg, isOwn, prevMsg = null) {
    const div = document.createElement("div");
    div.className = `message ${isOwn ? "own" : "other"}`;
    div.dataset.id = msg.id;
    div.dataset.senderId = msg.sender_id;

    // Group consecutive messages from same sender
    const sameSender = prevMsg && prevMsg.sender_id === msg.sender_id;
    if (sameSender) {
      div.classList.add("grouped");
    }

    const time = this.formatTime(msg.created_at);
    const editedLabel = msg.is_edited
      ? ` · <span class="edited-label">edited</span>`
      : "";
    const reply = msg.reply_to;
    const quoteHtml = reply && reply.message_id
      ? `<div class="reply-quote" data-target="${reply.message_id}">
          <span class="reply-quote-name">${this.escapeHtml(reply.sender_name || "Unknown")}</span>
          <span class="reply-quote-text">${this.escapeHtml(reply.content || "")}</span>
        </div>`
      : "";

    if (msg.is_deleted) {
      div.classList.add("deleted");
      div.innerHTML = `
        ${!isOwn && !sameSender ? `<div class="sender-name">${msg.sender_name}</div>` : ""}
        <p class="message-text deleted-text">🚫 Message deleted.</p>
        <div class="message-time"><span class="time-text">${time}</span>${this.ticksHtml(msg, isOwn)}</div>
      `;
    } else if (msg.type === "image" && msg.image_id) {
      const imgUrl = getImageUrl(msg.image_id);
      div.innerHTML = `
        ${!isOwn && !sameSender ? `<div class="sender-name">${msg.sender_name}</div>` : ""}
        ${quoteHtml}
        <img src="${imgUrl}" class="message-image" loading="lazy" onclick="window.openImageLightbox(this.src)">
        <div class="message-time"><span class="time-text">${time}${editedLabel}</span>${this.ticksHtml(msg, isOwn)}</div>
      `;
    } else {
      div.innerHTML = `
        ${!isOwn && !sameSender ? `<div class="sender-name">${msg.sender_name}</div>` : ""}
        ${quoteHtml}
        <p class="message-text">${this.escapeHtml(msg.content)}</p>
        <div class="message-time"><span class="time-text">${time}${editedLabel}</span>${this.ticksHtml(msg, isOwn)}</div>
      `;
    }

    if (!msg.is_deleted && msg.reactions && msg.reactions.length) {
      const bar = document.createElement("div");
      bar.className = "reaction-bar";
      bar.innerHTML = msg.reactions.map((r) => {
        const mine = (r.user_ids || []).includes(this.currentUserId);
        return `<button class="reaction-pill ${mine ? "mine" : ""}" data-msg="${msg.id}" data-emoji="${r.emoji}" type="button">${r.emoji}<span>${r.count}</span></button>`;
      }).join("");
      div.appendChild(bar);
    }

    return div;
  }

  updateMessage(msg) {
    const el = this.messagesList.querySelector(`[data-id="${msg.id}"]`);
    if (!el) return;
    const prevEl = el.previousElementSibling;
    const prevMsg = prevEl && prevEl.dataset.senderId
      ? { sender_id: prevEl.dataset.senderId }
      : null;
    const isOwn = msg.sender_id === this.currentUserId;
    el.replaceWith(this.renderMessage(msg, isOwn, prevMsg));
  }

  appendMessage(msg, prevMsg = null) {
    const isOwn = msg.sender_id === this.currentUserId;
    const messageEl = this.renderMessage(msg, isOwn, prevMsg);

    // Remove empty state if present
    const emptyState = this.messagesList.querySelector(".empty-chat");
    if (emptyState) {
      emptyState.remove();
    }

    this.messagesList.appendChild(messageEl);
  }

  prependMessage(msg, nextMsg = null) {
    const isOwn = msg.sender_id === this.currentUserId;
    const messageEl = this.renderMessage(msg, isOwn, nextMsg);
    this.messagesList.insertBefore(messageEl, this.messagesList.firstChild);
  }

  renderMessages(messages, append = false) {
    if (!append) {
      this.messagesList.innerHTML = "";
    }

    messages.forEach((msg, i) => {
      const prevMsg = append ? null : (i > 0 ? messages[i - 1] : null);
      this.appendMessage(msg, prevMsg);
    });
  }

  scrollToBottom(smooth = true) {
    const container = document.getElementById("messages");
    if (smooth) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }

  showTyping(userName) {
    this.typingUser.textContent = userName;
    this.typingIndicator.classList.remove("hidden");
  }

  hideTyping() {
    this.typingIndicator.classList.add("hidden");
  }

  updateMemberCount(count) {
    this.memberCountNum = count || 0;
    this.memberCount.textContent = `${count} ${count !== 1 ? "members" : "member"}`;
  }

  ticksHtml(msg, isOwn) {
    if (!isOwn) return "";
    const total = this.memberCountNum || 0;
    const seen = (msg.seen_by || []).length;
    const all = total <= 1 || seen >= total;
    return ` <span class="ticks ${all ? "seen" : "sent"}">${all ? "✓✓" : "✓"}</span>`;
  }

  updateFamilyName(name) {
    this.familyName.textContent = name;
  }

  renderOnlineUsers(users) {
    this.onlineUsers.innerHTML = "";

    if (users.length === 0) {
      this.onlineUsers.innerHTML = `<span class="online-user">No one online</span>`;
      return;
    }

    users.forEach((user) => {
      const div = document.createElement("div");
      div.className = "online-user";
      div.innerHTML = `
        <div class="online-user-avatar">${user.name.charAt(0).toUpperCase()}</div>
        <span>${user.name}</span>
      `;
      this.onlineUsers.appendChild(div);
    });
  }

  showImagePreview(src) {
    this.previewImg.src = src;
    this.imagePreview.classList.remove("hidden");
  }

  hideImagePreview() {
    this.previewImg.src = "";
    this.imagePreview.classList.add("hidden");
  }

  setInputEnabled(enabled) {
    this.messageInput.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
  }

  formatTime(isoString) {
    const date = new Date(isoString.endsWith("Z") || isoString.includes("+") ? isoString : isoString + "Z");
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);

    if (diffSecs < 60) return "Just now";

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}
