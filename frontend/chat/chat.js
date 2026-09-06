import { api, getFamilyInfo, getMessages, uploadImage, token, getCurrentUserId, editMessage, deleteMessage, toggleReaction, markSeen, REACTION_EMOJIS } from "./api.js?v=v8";
import { WebSocketClient } from "./websocket.js?v=v8";
import { UIManager } from "./ui.js?v=v8";

/* ─── Notification Sound ─── */

let audioCtx = null;

function playNotifSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
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

class ChatApp {
  constructor() {
    this.ws = new WebSocketClient();
    this.ui = new UIManager();
    this.familyId = null;
    this.hasMoreMessages = true;
    this.oldestCursor = null;
    this.isLoadingMore = false;
    this.selectedFile = null;
    this.typingTimeout = null;
    this.msgCache = new Map();
    this.replyToId = null;
    this.pendingSeen = new Set();
    this.seenFlushTimer = null;
    this.seenFlushFails = 0;
    this.seenObserver = null;
  }

  remember(msg) {
    if (msg && msg.id) this.msgCache.set(msg.id, msg);
  }

  refreshMessage(m) {
    if (!m || !m.id) return;
    this.remember(m);
    this.ui.updateMessage(m);
    this.observeSeenEl(
      this.ui.messagesList.querySelector(`[data-id="${m.id}"]`)
    );
  }

  setupSeenObserver() {
    const container = document.getElementById("messages");
    this.seenObserver = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = en.target.dataset && en.target.dataset.id;
          const msg = id && this.msgCache.get(id);
          if (!msg || msg.is_deleted) continue;
          if (msg.sender_id === this.ui.currentUserId) continue;
          if ((msg.seen_by || []).includes(this.ui.currentUserId)) continue;
          this.pendingSeen.add(id);
        }
        this.scheduleSeenFlush();
      },
      { root: container, threshold: 0.5 }
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.flushSeen();
    });
  }

  observeSeenEl(el) {
    if (!el || !el.dataset || !el.dataset.id) return;
    if (!this.seenObserver) return;
    if (el.dataset.senderId === this.ui.currentUserId) return;
    try {
      this.seenObserver.observe(el);
    } catch (e) {}
  }

  scheduleSeenFlush() {
    if (this.seenFlushTimer || this.pendingSeen.size === 0) return;
    this.seenFlushTimer = setTimeout(() => this.flushSeen(), 2000);
  }

  async flushSeen() {
    this.seenFlushTimer = null;
    if (document.visibilityState !== "visible") return;
    if (this.pendingSeen.size === 0) return;
    const ids = [...this.pendingSeen];
    this.pendingSeen.clear();
    try {
      const data = await markSeen(this.familyId, ids);
      this.seenFlushFails = 0;
      for (const m of data.messages || []) this.refreshMessage(m);
    } catch (e) {
      this.seenFlushFails += 1;
      if (this.seenFlushFails < 3) {
        for (const id of ids) this.pendingSeen.add(id);
        this.seenFlushTimer = setTimeout(() => this.flushSeen(), 8000);
      }
    }
  }

  async init() {
    if (!token()) {
      window.location.href = "../";
      return;
    }

    this.ui.setCurrentUserId(getCurrentUserId());

    const params = new URLSearchParams(window.location.search);
    this.familyId = params.get("family_id");

    if (!this.familyId) {
      try {
        const familyData = await getFamilyInfo();
        if (!familyData || !familyData.family) {
          showToast("You need to be in a family to use chat.");
          window.location.href = "../";
          return;
        }
        this.familyId = familyData.family.id;
        this.ui.updateFamilyName(familyData.family.name);
        this.ui.updateMemberCount(familyData.members.length);
      } catch (error) {
        console.error("Failed to get family info:", error);
        showToast("Could not load family info: " + error.message);
        window.location.href = "../";
        return;
      }
    } else {
      try {
        const familyData = await getFamilyInfo();
        if (familyData && familyData.family) {
          this.ui.updateFamilyName(familyData.family.name);
          this.ui.updateMemberCount(familyData.members.length);
        }
      } catch (error) {
        console.error("Failed to get family info:", error);
      }
    }

    this.loadTheme();
    this.setupEventListeners();
    this.setupLightbox();
    this.setupSeenObserver();

    await this.loadMessages();
    this.connectWebSocket();
  }

  async loadMessages() {
    try {
      const data = await getMessages(this.familyId, 30, this.oldestCursor);

      this.ui.hideLoading();

      if (data.messages.length === 0 && !this.oldestCursor) {
        this.ui.showEmptyState();
        return;
      }

      const prev = this.oldestCursor ? null : this.ui.messagesList.lastElementChild;
      let lastPrev = prev;

      data.messages.forEach((msg) => {
        let prevMsg = null;
        if (lastPrev && lastPrev.dataset.senderId) {
          prevMsg = { sender_id: lastPrev.dataset.senderId };
        }
        this.remember(msg);
        this.ui.appendMessage(msg, prevMsg);
        lastPrev = this.ui.messagesList.lastElementChild;
        this.observeSeenEl(lastPrev);
      });

      this.hasMoreMessages = data.has_more;
      this.oldestCursor = data.oldest_cursor;

      this.ui.scrollToBottom(false);
    } catch (error) {
      console.error("Failed to load messages:", error);
      this.ui.hideLoading();
    }
  }

  connectWebSocket() {
    this.ws.connect(this.familyId);

    this.ws.onConnected = (data) => {
      this.ui.setCurrentUserId(data.user_id);
      this.ui.renderOnlineUsers(data.online_users);
      this.ui.setInputEnabled(true);
      this.ui.scrollToBottom(false);
    };

    this.ws.onMessage = (msg) => {
      this.remember(msg);
      // Get last message from DOM to check if same sender for grouping
      const lastEl = this.ui.messagesList.lastElementChild;
      let prevMsg = null;
      if (lastEl && lastEl.dataset.senderId) {
        prevMsg = { sender_id: lastEl.dataset.senderId };
      }
      this.ui.appendMessage(msg, prevMsg);
      this.observeSeenEl(this.ui.messagesList.lastElementChild);
      this.ui.scrollToBottom();

      // Play notification sound for other people's messages
      if (msg.sender_id !== this.ui.currentUserId) {
        playNotifSound();
      }
    };

    this.ws.onMessageEdited = (msg) => {
      this.refreshMessage(msg);
    };

    this.ws.onMessageDeleted = (msg) => {
      this.refreshMessage(msg);
    };

    this.ws.onReactionUpdated = (msg) => {
      this.refreshMessage(msg);
    };

    this.ws.onMessagesSeen = (msgs) => {
      for (const m of msgs || []) this.refreshMessage(m);
    };

    this.ws.onOnlineUsers = (users) => {
      this.ui.renderOnlineUsers(users);
    };

    this.ws.onTyping = (userName) => {
      this.ui.showTyping(userName);
      clearTimeout(this.typingTimeout);
      this.typingTimeout = setTimeout(() => {
        this.ui.hideTyping();
      }, 3000);
    };

    this.ws.onError = (error) => {
      console.error("WebSocket error:", error);
      showToast("Error" + (error.message || "Connection problem."));
    };
  }

  setupEventListeners() {
    const messageInput = document.getElementById("message-input");
    const sendBtn = document.getElementById("send-btn");
    const attachBtn = document.getElementById("attach-btn");
    const fileInput = document.getElementById("file-input");
    const removePreview = document.getElementById("remove-preview");
    const messagesContainer = document.getElementById("messages");
    const themeToggle = document.getElementById("theme-toggle-chat");

    sendBtn.addEventListener("click", () => this.sendMessage());

    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    messageInput.addEventListener("input", () => {
      this.ws.sendTyping();
    });

    attachBtn.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        this.selectedFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
          this.ui.showImagePreview(event.target.result);
        };
        reader.readAsDataURL(file);
      }
    });

    removePreview.addEventListener("click", () => {
      this.selectedFile = null;
      fileInput.value = "";
      this.ui.hideImagePreview();
    });

    messagesContainer.addEventListener("scroll", () => {
      if (messagesContainer.scrollTop < 40 && this.hasMoreMessages && !this.isLoadingMore) {
        this.loadMoreMessages();
      }
    });

    // Tap a bubble → action sheet · tap a reaction pill → toggle it
    // Tap a quote → jump to the original message
    this.ui.messagesList.addEventListener("click", (e) => {
      const pill = e.target.closest(".reaction-pill");
      if (pill && pill.dataset.msg) {
        this.react(pill.dataset.msg, pill.dataset.emoji);
        return;
      }
      const quote = e.target.closest(".reply-quote");
      if (quote && quote.dataset.target) {
        this.scrollToQuoted(quote.dataset.target);
        return;
      }
      if (e.target.closest("img, input, button, .edit-row")) return;
      const bubble = e.target.closest(".message");
      if (!bubble || !bubble.dataset.id) return;
      const msg = this.msgCache.get(bubble.dataset.id);
      if (msg) this.openMessageMenu(msg, bubble);
    });

    // Reply context bar above the composer
    const inputArea = document.querySelector(".chat-input-area");
    if (inputArea && !document.getElementById("reply-bar")) {
      const bar = document.createElement("div");
      bar.className = "reply-bar hidden";
      bar.id = "reply-bar";
      bar.innerHTML = `
        <div class="reply-bar-body">
          <div class="reply-bar-name" id="reply-bar-name"></div>
          <div class="reply-bar-text" id="reply-bar-text"></div>
        </div>
        <button class="reply-bar-close" id="reply-bar-close" type="button" title="Cancel reply">✕</button>`;
      inputArea.prepend(bar);
      bar.querySelector("#reply-bar-close").addEventListener("click", () => this.clearReply());
    }

    themeToggle.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      const isDark = document.body.classList.contains("dark");
      localStorage.setItem("familyshield_theme", isDark ? "dark" : "light");
    });

    // Search
    const searchToggle = document.getElementById("search-toggle-btn");
    const searchBar = document.getElementById("chat-search-bar");
    const searchInput = document.getElementById("chat-search-input");
    const searchClose = document.getElementById("search-close-btn");
    let searchTimeout = null;

    searchToggle?.addEventListener("click", () => {
      searchBar.classList.toggle("hidden");
      if (!searchBar.classList.contains("hidden")) {
        searchInput.focus();
      } else {
        searchInput.value = "";
        this.exitSearchMode();
      }
    });

    searchClose?.addEventListener("click", () => {
      searchBar.classList.add("hidden");
      searchInput.value = "";
      this.exitSearchMode();
    });

    searchInput?.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();
      if (q.length < 2) {
        this.exitSearchMode();
        return;
      }
      searchTimeout = setTimeout(() => this.performSearch(q), 300);
    });
  }

  async loadMoreMessages() {
    if (!this.hasMoreMessages || this.isLoadingMore) return;

    this.isLoadingMore = true;
    const messagesContainer = document.getElementById("messages");
    const loadMoreSpinner = document.getElementById("load-more-spinner");
    const prevScrollHeight = messagesContainer.scrollHeight;

    loadMoreSpinner.classList.remove("hidden");

    try {
      const data = await getMessages(this.familyId, 30, this.oldestCursor);

      data.messages.forEach((msg, i) => {
        let contextMsg = null;
        if (i < data.messages.length - 1) {
          contextMsg = data.messages[i + 1];
        } else if (this.ui.messagesList.firstElementChild) {
          contextMsg = { sender_id: this.ui.messagesList.firstElementChild.dataset.senderId };
        }
        this.remember(msg);
        this.ui.prependMessage(msg, contextMsg);
        this.observeSeenEl(this.ui.messagesList.firstElementChild);
      });

      this.hasMoreMessages = data.has_more;
      this.oldestCursor = data.oldest_cursor;

      const newScrollHeight = messagesContainer.scrollHeight;
      messagesContainer.scrollTop = newScrollHeight - prevScrollHeight;
    } catch (error) {
      console.error("Failed to load more messages:", error);
    } finally {
      this.isLoadingMore = false;
      loadMoreSpinner.classList.add("hidden");
    }
  }

  async performSearch(query) {
    try {
      const { searchMessages } = await import("./api.js");
      const data = await searchMessages(this.familyId, query);
      this.searchResults = data.messages;
      this.highlightSearchResults(query);
    } catch (e) {
      console.error("Search failed:", e);
    }
  }

  highlightSearchResults(query) {
    const messages = this.ui.messagesList.querySelectorAll(".message-text");
    let found = 0;
    messages.forEach((el) => {
      const original = el.textContent;
      if (original.toLowerCase().includes(query.toLowerCase())) {
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        el.innerHTML = original.replace(regex, '<span class="search-highlight">$1</span>');
        found++;
      }
    });
  }

  exitSearchMode() {
    this.searchResults = [];
    const messages = this.ui.messagesList.querySelectorAll(".message-text");
    messages.forEach((el) => {
      el.innerHTML = el.textContent;
    });
  }

  async sendMessage() {
    const input = document.getElementById("message-input");
    const content = input.value.trim();

    if (!content && !this.selectedFile) return;

    input.value = "";

    if (this.selectedFile) {
      try {
        const uploadData = await uploadImage(this.familyId, this.selectedFile);
        this.ws.send(content || " ", "image", uploadData.image_id, this.replyToId);
        this.clearReply();
      } catch (error) {
        console.error("Failed to upload image:", error);
        showToast("Upload failed. Please try again.");
        return;
      } finally {
        this.selectedFile = null;
        document.getElementById("file-input").value = "";
        this.ui.hideImagePreview();
      }
    } else {
      this.ws.send(content, "text", null, this.replyToId);
      this.clearReply();
    }
  }

  closeMessageMenu() {
    document.querySelector(".msg-menu-overlay")?.remove();
  }

  openMessageMenu(msg, anchorEl) {
    if (!msg || msg.is_deleted || !anchorEl) return;
    const isOwn = msg.sender_id === this.ui.currentUserId;
    const canEdit = isOwn && (msg.type || "text") === "text";

    this.closeMessageMenu();

    const icons = {
      reply: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>`,
      edit: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>`,
      trash: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
    };

    const overlay = document.createElement("div");
    overlay.className = "msg-menu-overlay";
    overlay.innerHTML = `
      <div class="msg-menu" role="menu">
        <div class="msg-menu-react">
          ${REACTION_EMOJIS.map((e) => `<button class="msg-menu-emoji" data-emoji="${e}" type="button">${e}</button>`).join("")}
        </div>
        <div class="msg-menu-actions">
          <button class="msg-menu-btn" data-act="reply" type="button">${icons.reply}<span>Reply</span></button>
          ${canEdit ? `<button class="msg-menu-btn" data-act="edit" type="button">${icons.edit}<span>Edit</span></button>` : ""}
          ${isOwn ? `<button class="msg-menu-btn msg-menu-danger" data-act="delete" type="button">${icons.trash}<span>Delete</span></button>` : ""}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const menu = overlay.querySelector(".msg-menu");

    // Position anchored to the tapped bubble
    const rect = anchorEl.getBoundingClientRect();
    menu.style.visibility = "hidden";
    menu.style.left = "0px";
    menu.style.top = "0px";
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const margin = 10;
    let left = rect.left + rect.width / 2 - mw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin));
    let placeAbove = rect.top > mh + 80;
    let top = placeAbove ? rect.top - mh - 8 : rect.bottom + 8;
    top = Math.max(margin, Math.min(top, window.innerHeight - mh - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.classList.add(placeAbove ? "msg-menu-above" : "msg-menu-below");
    menu.style.visibility = "";

    const close = () => this.closeMessageMenu();
    // Defer so the opening tap doesn't instantly close it
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

    overlay.querySelectorAll("[data-emoji]").forEach((btn) => {
      btn.addEventListener("click", () => { close(); this.react(msg.id, btn.dataset.emoji); });
    });
    overlay.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        close();
        if (act === "reply") this.setReply(msg.id);
        if (act === "edit") this.startEditMessage(msg.id);
        if (act === "delete") this.askDeleteMessage(msg.id);
      });
    });
  }

  setReply(msgId) {
    const msg = this.msgCache.get(msgId);
    if (!msg || msg.is_deleted) return;
    this.replyToId = msgId;
    const bar = document.getElementById("reply-bar");
    const name = msg.sender_id === this.ui.currentUserId ? "You" : msg.sender_name;
    document.getElementById("reply-bar-name").textContent = name;
    const snippet = (msg.content || (msg.type === "image" ? "Image" : "")).slice(0, 90);
    document.getElementById("reply-bar-text").textContent = snippet;
    bar.classList.remove("hidden");
    document.getElementById("message-input").focus();
  }

  clearReply() {
    this.replyToId = null;
    document.getElementById("reply-bar")?.classList.add("hidden");
  }

  scrollToQuoted(messageId) {
    const el = this.ui.messagesList.querySelector(`[data-id="${messageId}"]`);
    if (!el) {
      showToast("Original message is not loaded.");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash-highlight");
    void el.offsetWidth;
    el.classList.add("flash-highlight");
    setTimeout(() => el.classList.remove("flash-highlight"), 1400);
  }

  async react(msgId, emoji) {
    try {
      const updated = await toggleReaction(this.familyId, msgId, emoji);
      this.remember(updated);
      this.ui.updateMessage(updated);
    } catch (e) {
      showToast("Error" + e.message);
    }
  }

  startEditMessage(msgId) {
    const msg = this.msgCache.get(msgId);
    if (!msg || msg.is_deleted || (msg.type || "text") !== "text") return;
    const el = this.ui.messagesList.querySelector(`[data-id="${msgId}"]`);
    const textEl = el && el.querySelector(".message-text");
    if (!el || !textEl || el.querySelector(".edit-row")) return;

    const row = document.createElement("div");
    row.className = "edit-row";
    row.innerHTML = `
      <input class="edit-input" maxlength="4000" autocomplete="off">
      <div class="edit-actions">
        <button class="edit-save" type="button">Save</button>
        <button class="edit-cancel" type="button">Cancel</button>
      </div>`;
    const input = row.querySelector(".edit-input");
    input.value = msg.content || "";
    textEl.replaceWith(row);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const cancel = () => {
      const cur = this.msgCache.get(msgId);
      if (cur) this.ui.updateMessage(cur);
    };
    const save = async () => {
      const val = input.value.trim();
      if (!val) {
        showToast("Message cannot be empty.");
        return;
      }
      if (val === msg.content) {
        cancel();
        return;
      }
      try {
        const updated = await editMessage(this.familyId, msgId, val);
        this.remember(updated);
        this.ui.updateMessage(updated);
      } catch (e) {
        showToast("Error" + e.message);
        cancel();
      }
    };
    row.querySelector(".edit-cancel").addEventListener("click", cancel);
    row.querySelector(".edit-save").addEventListener("click", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") cancel();
    });
  }

  askDeleteMessage(msgId) {
    const msg = this.msgCache.get(msgId);
    if (!msg || msg.is_deleted) return;

    const old = document.getElementById("fs-modal-overlay");
    if (old) old.remove();
    const overlay = document.createElement("div");
    overlay.id = "fs-modal-overlay";
    overlay.innerHTML = `
      <div class="fs-modal">
        <h3 class="fs-modal-title">Delete message</h3>
        <p class="fs-modal-message">Are you sure you want to delete this message?</p>
        <div class="fs-modal-actions">
          <button class="fs-modal-cancel" id="fs-modal-cancel">Cancel</button>
          <button class="fs-modal-confirm fs-modal-danger" id="fs-modal-confirm">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector("#fs-modal-cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector("#fs-modal-confirm").addEventListener("click", async () => {
      close();
      try {
        const updated = await deleteMessage(this.familyId, msgId);
        this.remember(updated);
        this.ui.updateMessage(updated);
        showToast("Message deleted.");
      } catch (e) {
        showToast("Error" + e.message);
      }
    });
  }

  setupLightbox() {    window.openImageLightbox = (src) => {
      const lightbox = document.createElement("div");
      lightbox.className = "lightbox";
      lightbox.innerHTML = `<img src="${src}" alt="Full size image">`;
      lightbox.addEventListener("click", () => lightbox.remove());
      document.body.appendChild(lightbox);
    };
  }

  loadTheme() {
    const saved = localStorage.getItem("familyshield_theme");
    if (saved === "dark") {
      document.body.classList.add("dark");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new ChatApp();
  app.init();
});
