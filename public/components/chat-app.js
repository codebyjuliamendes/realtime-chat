const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      background-color: var(--bg-color);
      color: var(--text-primary);
      overflow: hidden;
    }
    
    /* Sidebar */
    .sidebar {
      width: 30%;
      min-width: 250px;
      max-width: 400px;
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      background-color: var(--bg-secondary);
    }
    
    .sidebar-header {
      padding: 1rem;
      background-color: var(--bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-color);
    }
    
    .user-profile {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background-color: var(--accent-color);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.2rem;
      position: relative;
    }
    
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      position: absolute;
      bottom: 0;
      right: 0;
      border: 2px solid var(--bg-tertiary);
    }
    .status-dot.online { background-color: var(--status-online); }
    .status-dot.offline { background-color: var(--status-offline); }
    
    .search-bar {
      padding: 0.5rem;
      background-color: var(--bg-secondary);
    }
    .search-bar input {
      width: 100%;
      padding: 8px 12px;
      border-radius: 8px;
      border: none;
      background-color: var(--bg-tertiary);
      color: var(--text-primary);
    }
    
    .channel-list {
      flex: 1;
      overflow-y: auto;
    }
    
    .channel-item {
      padding: 12px 1rem;
      display: flex;
      align-items: center;
      gap: 15px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      transition: background-color 0.2s;
    }
    .channel-item:hover, .channel-item.active {
      background-color: var(--bg-tertiary);
    }
    
    .channel-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .channel-name {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .channel-last-msg {
      font-size: 0.85rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    /* Main Chat Area */
    .chat-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background-color: var(--bg-color);
      position: relative;
    }
    
    .chat-header {
      padding: 1rem;
      background-color: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .chat-messages {
      flex: 1;
      padding: 1rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .message-container {
      display: flex;
      flex-direction: column;
      max-width: 65%;
      animation: slideIn 0.3s ease-out;
    }
    
    .message-container.sent {
      align-self: flex-end;
    }
    .message-container.received {
      align-self: flex-start;
    }
    
    .message-bubble {
      padding: 8px 12px;
      border-radius: 8px;
      position: relative;
      word-wrap: break-word;
    }
    
    .sent .message-bubble {
      background-color: var(--message-out);
      border-top-right-radius: 0;
    }
    .received .message-bubble {
      background-color: var(--message-in);
      border-top-left-radius: 0;
    }
    
    .message-meta {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 5px;
      font-size: 0.7rem;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    
    .message-status {
      font-size: 0.7rem;
    }
    .status-read { color: #53bdeb; }
    
    .chat-input-area {
      padding: 1rem;
      background-color: var(--bg-tertiary);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .chat-input {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 1rem;
    }
    
    .send-btn {
      background-color: var(--accent-color);
      color: white;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    
    .typing-indicator {
      display: none;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      color: var(--text-secondary);
      font-style: italic;
    }
    
    .typing-dots span {
      display: inline-block;
      width: 4px;
      height: 4px;
      background-color: var(--text-secondary);
      border-radius: 50%;
      margin: 0 2px;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
    .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
    
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    
    .connection-banner {
      position: absolute;
      top: 0;
      width: 100%;
      padding: 0.5rem;
      background-color: #ff9800;
      color: #fff;
      text-align: center;
      font-size: 0.9rem;
      display: none;
      z-index: 10;
    }
  </style>

  <div class="sidebar">
    <div class="sidebar-header">
      <div class="user-profile">
        <div class="avatar" id="my-avatar">
          <span id="my-initial"></span>
          <div class="status-dot online"></div>
        </div>
        <span id="my-name"></span>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" placeholder="Search or start new chat">
    </div>
    <div class="channel-list" id="channel-list">
      <!-- Channels go here -->
    </div>
  </div>

  <div class="chat-area">
    <div class="connection-banner" id="conn-banner">Reconnecting...</div>
    <div class="chat-header" id="chat-header" style="visibility: hidden;">
      <div class="avatar" id="current-channel-avatar">#</div>
      <div class="channel-info">
        <div class="channel-name" id="current-channel-name">Channel Name</div>
        <div class="channel-last-msg" id="current-channel-status">Click to view details</div>
      </div>
    </div>
    
    <div class="chat-messages" id="chat-messages">
      <!-- Messages go here -->
    </div>
    
    <div class="typing-indicator" id="typing-indicator">
      Someone is typing <span class="typing-dots"><span></span><span></span><span></span></span>
    </div>
    
    <div class="chat-input-area" id="chat-input-area" style="visibility: hidden;">
      <input type="text" class="chat-input" id="message-input" placeholder="Type a message" autocomplete="off">
      <button class="send-btn" id="send-btn">➤</button>
    </div>
  </div>
`;

class ChatApp extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    
    this.userId = null;
    this.username = null;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.baseReconnectDelay = 1000;
    
    this.currentChannel = 'general'; // Default channel
    this.users = new Map();
    this.messages = new Map(); // channelId -> array of messages
    this.typingTimeout = null;
    this.isTyping = false;
  }

  initialize(userId, username) {
    this.userId = userId;
    this.username = username;
    
    this.shadowRoot.getElementById('my-initial').textContent = username.charAt(0).toUpperCase();
    this.shadowRoot.getElementById('my-name').textContent = username;
    
    this.setupEventListeners();
    this.fetchInitialData().then(() => {
      this.connectWebSocket();
      this.renderChannelList();
      this.selectChannel('general');
    });
  }

  async fetchInitialData() {
    try {
      // Fetch users
      const usersRes = await fetch('/api/users');
      const users = await usersRes.json();
      users.forEach(u => this.users.set(u.id, u));
      
      // Fetch initial messages for default channel
      const msgRes = await fetch('/api/messages/general');
      const msgs = await msgRes.json();
      this.messages.set('general', msgs);
    } catch (e) {
      console.error('Failed to fetch initial data', e);
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = \`\${protocol}//\${window.location.host}\`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.shadowRoot.getElementById('conn-banner').style.display = 'none';
      
      // Authenticate
      this.ws.send(JSON.stringify({
        type: 'auth',
        payload: { userId: this.userId, username: this.username }
      }));
    };
    
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };
    
    this.ws.onclose = () => {
      this.handleDisconnect();
    };
    
    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  handleDisconnect() {
    this.shadowRoot.getElementById('conn-banner').style.display = 'block';
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;
      setTimeout(() => this.connectWebSocket(), Math.min(delay, 30000));
    } else {
      this.shadowRoot.getElementById('conn-banner').textContent = 'Connection lost. Please refresh.';
    }
  }

  handleWebSocketMessage(data) {
    const { type, payload } = data;
    
    switch (type) {
      case 'auth_ack':
        console.log('Authenticated');
        break;
        
      case 'new_message': {
        const { channelId, id, userId, content, timestamp, status } = payload;
        
        if (!this.messages.has(channelId)) {
          this.messages.set(channelId, []);
        }
        this.messages.get(channelId).push({ id, channel_id: channelId, user_id: userId, content, timestamp, status });
        
        if (this.currentChannel === channelId) {
          this.appendMessage(payload);
          this.scrollToBottom();
          
          // Send read receipt if we are in this channel
          this.ws.send(JSON.stringify({
            type: 'message_read',
            payload: { id, channelId }
          }));
        } else {
          // Update channel list to show unread (simple version: just re-render list to move to top)
          this.renderChannelList();
        }
        break;
      }
        
      case 'message_ack': {
        // Update local message status to 'sent' or 'delivered'
        const msgEl = this.shadowRoot.getElementById(\`msg-status-\${payload.id}\`);
        if (msgEl) {
          msgEl.textContent = '✓✓'; // Delivered
        }
        break;
      }
      
      case 'message_update': {
        const msgEl = this.shadowRoot.getElementById(\`msg-status-\${payload.id}\`);
        if (msgEl) {
          if (payload.status === 'read') {
            msgEl.textContent = '✓✓';
            msgEl.classList.add('status-read');
          }
        }
        break;
      }

      case 'typing_indicator': {
        if (this.currentChannel === payload.channelId && payload.userId !== this.userId) {
          this.showTypingIndicator(payload.userId);
        }
        break;
      }
      
      case 'presence_update': {
        if (this.users.has(payload.userId)) {
          const user = this.users.get(payload.userId);
          user.status = payload.status;
          user.last_seen = payload.lastSeen;
          // Trigger re-render if needed
        } else {
          // New user, fetch or add
          this.users.set(payload.userId, { id: payload.userId, status: payload.status, last_seen: payload.lastSeen });
        }
        break;
      }
    }
  }

  setupEventListeners() {
    const input = this.shadowRoot.getElementById('message-input');
    const sendBtn = this.shadowRoot.getElementById('send-btn');
    
    sendBtn.addEventListener('click', () => this.sendMessage());
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      } else {
        this.handleTyping();
      }
    });
  }

  handleTyping() {
    if (!this.isTyping && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.isTyping = true;
      this.ws.send(JSON.stringify({
        type: 'typing',
        payload: { channelId: this.currentChannel }
      }));
    }
    
    clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
    }, 2000);
  }

  showTypingIndicator(userId) {
    const indicator = this.shadowRoot.getElementById('typing-indicator');
    const user = this.users.get(userId);
    const name = user ? (user.username || 'Someone') : 'Someone';
    
    indicator.innerHTML = \`\${name} is typing <span class="typing-dots"><span></span><span></span><span></span></span>\`;
    indicator.style.display = 'block';
    
    clearTimeout(this.indicatorTimeout);
    this.indicatorTimeout = setTimeout(() => {
      indicator.style.display = 'none';
    }, 3000);
  }

  sendMessage() {
    const input = this.shadowRoot.getElementById('message-input');
    const content = input.value.trim();
    
    if (content && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msgId = this.generateUUID();
      const timestamp = Date.now();
      
      const msgPayload = {
        id: msgId,
        channelId: this.currentChannel,
        content: content
      };
      
      this.ws.send(JSON.stringify({
        type: 'message',
        payload: msgPayload
      }));
      
      // Optimistic render
      const msg = {
        id: msgId,
        channel_id: this.currentChannel,
        user_id: this.userId,
        content: content,
        timestamp: timestamp,
        status: 'sending'
      };
      
      if (!this.messages.has(this.currentChannel)) {
        this.messages.set(this.currentChannel, []);
      }
      this.messages.get(this.currentChannel).push(msg);
      
      this.appendMessage({ userId: this.userId, content, timestamp, status: 'sending', id: msgId });
      this.scrollToBottom();
      
      input.value = '';
      this.isTyping = false;
    }
  }

  renderChannelList() {
    const list = this.shadowRoot.getElementById('channel-list');
    list.innerHTML = '';
    
    // For demo, hardcoding one channel. In real app, iterate over user's channels.
    const channelEl = document.createElement('div');
    channelEl.className = \`channel-item \${this.currentChannel === 'general' ? 'active' : ''}\`;
    channelEl.innerHTML = \`
      <div class="avatar">#</div>
      <div class="channel-info">
        <div class="channel-name">General</div>
        <div class="channel-last-msg">Welcome to real-time chat</div>
      </div>
    \`;
    channelEl.onclick = () => this.selectChannel('general');
    list.appendChild(channelEl);
  }

  selectChannel(channelId) {
    this.currentChannel = channelId;
    
    // Update UI
    this.shadowRoot.getElementById('chat-header').style.visibility = 'visible';
    this.shadowRoot.getElementById('chat-input-area').style.visibility = 'visible';
    this.shadowRoot.getElementById('current-channel-name').textContent = 'General';
    
    // Highlight in list
    const items = this.shadowRoot.querySelectorAll('.channel-item');
    items.forEach(item => item.classList.remove('active'));
    // Assuming first item is general for now
    if(items.length > 0) items[0].classList.add('active');
    
    this.renderMessages();
  }

  renderMessages() {
    const container = this.shadowRoot.getElementById('chat-messages');
    container.innerHTML = '';
    
    const msgs = this.messages.get(this.currentChannel) || [];
    msgs.forEach(msg => {
      this.appendMessage({
        id: msg.id,
        userId: msg.user_id,
        content: msg.content,
        timestamp: msg.timestamp,
        status: msg.status
      }, container);
    });
    
    this.scrollToBottom();
  }

  appendMessage(msgData, container = this.shadowRoot.getElementById('chat-messages')) {
    const isMe = msgData.userId === this.userId;
    const user = this.users.get(msgData.userId);
    const username = isMe ? 'You' : (user ? user.username : 'Unknown');
    
    const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let statusHtml = '';
    if (isMe) {
      let icon = '✓'; // sending
      let sClass = '';
      if (msgData.status === 'sent') icon = '✓';
      if (msgData.status === 'delivered') icon = '✓✓';
      if (msgData.status === 'read') { icon = '✓✓'; sClass = 'status-read'; }
      
      statusHtml = \`<span class="message-status \${sClass}" id="msg-status-\${msgData.id}">\${icon}</span>\`;
    }

    const msgEl = document.createElement('div');
    msgEl.className = \`message-container \${isMe ? 'sent' : 'received'}\`;
    
    // Only show sender name in group chats if not me (simplified)
    const nameHtml = !isMe ? \`<div style="font-size: 0.8rem; color: var(--accent-color); margin-bottom: 4px;">\${username}</div>\` : '';
    
    msgEl.innerHTML = \`
      <div class="message-bubble">
        \${nameHtml}
        <div>\${this.escapeHTML(msgData.content)}</div>
        <div class="message-meta">
          <span>\${time}</span>
          \${statusHtml}
        </div>
      </div>
    \`;
    
    container.appendChild(msgEl);
  }

  scrollToBottom() {
    const container = this.shadowRoot.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

customElements.define('chat-app', ChatApp);
