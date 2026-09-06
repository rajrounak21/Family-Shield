import { token, API_BASE } from "./api.js";

export class WebSocketClient {
  constructor() {
    this.ws = null;
    this.familyId = null;
    this.onMessage = null;
    this.onOnlineUsers = null;
    this.onTyping = null;
    this.onConnected = null;
    this.onError = null;
    this.onMessageEdited = null;
    this.onMessageDeleted = null;
    this.onReactionUpdated = null;
    this.onMessagesSeen = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.shouldReconnect = true;
  }

  connect(familyId) {
    this.familyId = familyId;
    this.shouldReconnect = true;

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost = new URL(API_BASE).host;
    const wsUrl = `${wsProtocol}//${wsHost}/chat/ws/${familyId}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws.send(
        JSON.stringify({
          type: "auth",
          token: token(),
        })
      );
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = (event) => {
      if (this.shouldReconnect && event.code !== 1000) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      if (this.onError) {
        this.onError(error);
      }
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case "connected":
        this.reconnectAttempts = 0;
        if (this.onConnected) {
          this.onConnected(data);
        }
        break;

      case "online_users":
        if (this.onOnlineUsers) {
          this.onOnlineUsers(data.users);
        }
        break;

      case "typing":
        if (this.onTyping) {
          this.onTyping(data.user_name);
        }
        break;

      case "message_edited":
        if (this.onMessageEdited) {
          this.onMessageEdited(data.message);
        }
        break;

      case "message_deleted":
        if (this.onMessageDeleted) {
          this.onMessageDeleted(data.message);
        }
        break;

      case "reaction_updated":
        if (this.onReactionUpdated) {
          this.onReactionUpdated(data.message);
        }
        break;

      case "messages_seen":
        if (this.onMessagesSeen) {
          this.onMessagesSeen(data.messages || []);
        }
        break;

      case "error":
        console.error("Server error:", data.detail);
        if (this.onError) {
          this.onError(new Error(data.detail));
        }
        break;

      default:
        if (this.onMessage) {
          this.onMessage(data);
        }
        break;
    }
  }

  send(content, msgType = "text", imageId = null, replyTo = null) {
    if (!this.ws) {
      console.error("WebSocket not initialized");
      return;
    }
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not open, state:", this.ws.readyState);
      return;
    }
    const payload = {
      type: "message",
      content: content,
      msg_type: msgType,
    };
    if (imageId) {
      payload.image_id = imageId;
    }
    if (replyTo) {
      payload.reply_to = replyTo;
    }
    this.ws.send(JSON.stringify(payload));
  }

  sendTyping() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "typing" }));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close(1000, "User disconnected");
      this.ws = null;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.onError) {
        this.onError(new Error("Connection lost. Please refresh the page."));
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      if (this.shouldReconnect && this.familyId) {
        this.connect(this.familyId);
      }
    }, delay);
  }
}
