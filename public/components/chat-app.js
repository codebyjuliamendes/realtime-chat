const template = document.createElement('template');
template.innerHTML = `
  <div class="flex w-full h-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
    <!-- Sidebar -->
    <div class="w-1/3 min-w-[280px] max-w-[400px] border-r border-slate-800/80 flex flex-col bg-slate-900">
      
      <!-- User profile header -->
      <div class="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="relative w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center font-bold text-white shadow-md shadow-brand-600/20" id="my-avatar">
            <span id="my-initial">-</span>
            <div class="absolute bottom-0 right-0 w-3 h-3 bg-brand-500 rounded-full border-2 border-slate-900"></div>
          </div>
          <span class="font-semibold text-slate-200" id="my-name">-</span>
        </div>
      </div>
      
      <!-- Search bar -->
      <div class="p-3 bg-slate-900/50">
        <div class="relative">
          <input type="text" placeholder="Search or start new chat" 
            class="w-full px-4 py-2 pl-9 bg-slate-950 border border-slate-800/80 focus:border-brand-500/50 outline-none rounded-xl text-slate-200 text-sm transition placeholder-slate-500">
          <span class="absolute left-3 top-2.5 text-slate-500"><i data-lucide="search" class="w-4 h-4"></i></span>
        </div>
      </div>
      
      <!-- Channel List -->
      <div class="flex-1 overflow-y-auto divide-y divide-slate-800/30" id="channel-list">
        <!-- Channels render here dynamically -->
      </div>
    </div>
    
    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col bg-slate-950 relative">
      
      <!-- Reconnection Banner -->
      <div class="absolute top-0 left-0 right-0 py-2 px-4 bg-amber-500 text-slate-950 text-center text-sm font-semibold hidden z-50 transition-all duration-300" id="conn-banner">
        <i data-lucide="alert-triangle" class="inline w-4 h-4 mr-1"></i> Connection lost. Reconnecting...
      </div>
      
      <!-- Chat Header -->
      <div class="p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-3 z-10" id="chat-header" style="visibility: hidden;">
        <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-brand-500 border border-slate-700" id="current-channel-avatar">#</div>
        <div class="flex flex-col overflow-hidden">
          <span class="font-semibold text-slate-100" id="current-channel-name">Channel Name</span>
          <span class="text-xs text-slate-400" id="current-channel-status">Click to view details</span>
        </div>
      </div>
      
      <!-- Chat Messages Scroll Container -->
      <div class="flex-1 p-6 overflow-y-auto flex flex-col gap-4 bg-slate-950/40 relative" id="chat-messages">
        <!-- Messages go here -->
      </div>
      
      <!-- Typing Indicator -->
      <div class="px-6 py-2 text-xs text-slate-400 italic hidden flex items-center gap-2" id="typing-indicator">
        Someone is typing
        <span class="inline-flex gap-1 items-center">
          <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
          <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
          <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
        </span>
      </div>
      
      <!-- Chat Input Area -->
      <div class="p-4 bg-slate-900 border-t border-slate-800 flex items-center gap-3" id="chat-input-area" style="visibility: hidden;">
        <input type="text" class="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 focus:border-brand-500/50 outline-none rounded-xl text-slate-200 text-sm transition placeholder-slate-500" 
          id="message-input" placeholder="Type a message" autocomplete="off">
        <button class="bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-medium w-11 h-11 rounded-xl flex items-center justify-center transition shadow-lg shadow-brand-600/20" 
          id="send-btn">
          <i data-lucide="send" class="w-4 h-4"></i>
        </button>
      </div>
      
    </div>
  </div>
`;

class ChatApp extends HTMLElement {
  constructor() {
    super();
    // We render inside Light DOM so Tailwind v3 styles apply globally!
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
    
    // Set template content into the innerHTML
    this.innerHTML = template.innerHTML;
    if (window.lucide) window.lucide.createIcons();
    
    this.querySelector('#my-initial').textContent = username.charAt(0).toUpperCase();
    this.querySelector('#my-name').textContent = username;
    
    this.setupEventListeners();
    this.fetchInitialData().then(() => {
      this.connectWebSocket();
      this.renderChannelList();
      this.selectChannel('general');
    });
  }

  async fetchInitialData() {
    this.showSkeletons();
    
    // Simulate network delay to show off skeletons
    await new Promise(r => setTimeout(r, 1200));

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
      if (window.showToast) window.showToast('Failed to load initial data', 'error');
    }
  }

  showSkeletons() {
    const list = this.querySelector('#channel-list');
    list.innerHTML = `
      <div class="p-4 flex items-center gap-3 animate-pulse">
        <div class="w-11 h-11 rounded-xl bg-slate-800"></div>
        <div class="flex-1">
          <div class="h-4 bg-slate-800 rounded w-1/2 mb-2"></div>
          <div class="h-3 bg-slate-800 rounded w-3/4"></div>
        </div>
      </div>
      <div class="p-4 flex items-center gap-3 animate-pulse">
        <div class="w-11 h-11 rounded-xl bg-slate-800"></div>
        <div class="flex-1">
          <div class="h-4 bg-slate-800 rounded w-1/3 mb-2"></div>
          <div class="h-3 bg-slate-800 rounded w-2/3"></div>
        </div>
      </div>
    `;
    
    const messages = this.querySelector('#chat-messages');
    messages.innerHTML = `
      <div class="flex justify-start mb-4 animate-pulse">
        <div class="w-2/3 h-16 bg-slate-800/80 rounded-2xl rounded-tl-none"></div>
      </div>
      <div class="flex justify-end mb-4 animate-pulse">
        <div class="w-1/2 h-12 bg-emerald-800/40 rounded-2xl rounded-tr-none"></div>
      </div>
      <div class="flex justify-start mb-4 animate-pulse">
        <div class="w-3/4 h-20 bg-slate-800/80 rounded-2xl rounded-tl-none"></div>
      </div>
    `;
    this.querySelector('#chat-header').style.visibility = 'visible';
    this.querySelector('#chat-input-area').style.visibility = 'visible';
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.querySelector('#conn-banner').classList.add('hidden');
      
      // Authenticate
      this.ws.send(JSON.stringify({
        type: 'auth',
        payload: { userId: this.userId, username: this.username }
      }));
    };
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      } catch (err) {
        console.error('Error handling ws message:', err);
      }
    };
    
    this.ws.onclose = () => {
      this.handleDisconnect();
    };
    
    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  handleDisconnect() {
    this.querySelector('#conn-banner').classList.remove('hidden');
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;
      setTimeout(() => this.connectWebSocket(), Math.min(delay, 30000));
    } else {
      this.querySelector('#conn-banner').textContent = '⚠️ Connection lost permanently. Please refresh page.';
    }
  }

  handleWebSocketMessage(data) {
    const { type, payload } = data;
    
    switch (type) {
      case 'auth_ack':
        console.log('Authenticated successfully');
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
          
          // Send read receipt
          this.ws.send(JSON.stringify({
            type: 'message_read',
            payload: { id, channelId }
          }));
        } else {
          this.renderChannelList();
        }
        break;
      }
        
      case 'message_ack': {
        const msgEl = this.querySelector(`#msg-status-${payload.id}`);
        if (msgEl) {
          msgEl.textContent = '✓✓'; // Delivered
          msgEl.className = 'text-[10px] text-slate-400 font-bold ml-1';
        }
        break;
      }
      
      case 'message_update': {
        const msgEl = this.querySelector(`#msg-status-${payload.id}`);
        if (msgEl) {
          if (payload.status === 'read') {
            msgEl.textContent = '✓✓';
            msgEl.className = 'text-[10px] text-emerald-400 font-bold ml-1'; // Blue tick style but emerald for branding
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
        } else {
          this.users.set(payload.userId, { id: payload.userId, status: payload.status, last_seen: payload.lastSeen });
        }
        break;
      }
    }
  }

  setupEventListeners() {
    const input = this.querySelector('#message-input');
    const sendBtn = this.querySelector('#send-btn');
    
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
    const indicator = this.querySelector('#typing-indicator');
    const user = this.users.get(userId);
    const name = user ? (user.username || 'Someone') : 'Someone';
    
    indicator.innerHTML = `${name} is typing <span class="inline-flex gap-0.5 items-center ml-1"><span class="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></span><span class="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span><span class="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span></span>`;
    indicator.classList.remove('hidden');
    
    clearTimeout(this.indicatorTimeout);
    this.indicatorTimeout = setTimeout(() => {
      indicator.classList.add('hidden');
    }, 3000);
  }

  sendMessage() {
    const input = this.querySelector('#message-input');
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
    const list = this.querySelector('#channel-list');
    list.innerHTML = '';
    
    const channelEl = document.createElement('div');
    const isActive = this.currentChannel === 'general';
    channelEl.className = `flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-800/40 transition duration-150 ${isActive ? 'bg-slate-800/60 border-l-4 border-brand-500' : ''}`;
    
    channelEl.innerHTML = `
      <div class="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center font-bold text-brand-500">#</div>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-baseline mb-0.5">
          <span class="font-medium text-slate-200 truncate">General</span>
        </div>
        <p class="text-xs text-slate-500 truncate">Welcome to real-time chat</p>
      </div>
    `;
    
    channelEl.onclick = () => this.selectChannel('general');
    list.appendChild(channelEl);
  }

  selectChannel(channelId) {
    this.currentChannel = channelId;
    
    // Update headers and panel visibility
    this.querySelector('#chat-header').style.visibility = 'visible';
    this.querySelector('#chat-input-area').style.visibility = 'visible';
    this.querySelector('#current-channel-name').textContent = 'General Workspace';
    this.querySelector('#current-channel-status').textContent = 'Open team communication room';
    
    this.renderChannelList();
    this.renderMessages();
  }

  renderMessages() {
    const container = this.querySelector('#chat-messages');
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

  appendMessage(msgData, container = this.querySelector('#chat-messages')) {
    const isMe = msgData.userId === this.userId;
    const user = this.users.get(msgData.userId);
    const username = isMe ? 'You' : (user ? user.username : 'Unknown');
    
    const time = new Date(msgData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let statusTicks = '';
    let tickColorClass = 'text-slate-500';
    if (isMe) {
      let icon = '✓'; 
      if (msgData.status === 'sent') icon = '✓';
      if (msgData.status === 'delivered') icon = '✓✓';
      if (msgData.status === 'read') { icon = '✓✓'; tickColorClass = 'text-emerald-400'; }
      
      statusTicks = `<span class="text-[10px] ${tickColorClass} font-bold ml-1" id="msg-status-${msgData.id}">${icon}</span>`;
    }

    const wrapperEl = document.createElement('div');
    wrapperEl.className = `flex w-full mb-1 animate-[fadeIn_0.2s_ease-out] ${isMe ? 'justify-end' : 'justify-start'}`;
    
    const bubbleEl = document.createElement('div');
    bubbleEl.className = `max-w-[70%] px-4 py-2.5 rounded-2xl shadow-sm ${
      isMe 
        ? 'bg-emerald-600/90 text-white rounded-tr-none' 
        : 'bg-slate-800/80 text-slate-100 rounded-tl-none border border-slate-700/30'
    }`;
    
    const senderHtml = !isMe ? `<div class="text-xs font-semibold text-brand-500 mb-1">${username}</div>` : '';
    
    bubbleEl.innerHTML = `
      ${senderHtml}
      <div class="text-sm break-words leading-relaxed">${this.escapeHTML(msgData.content)}</div>
      <div class="flex items-center justify-end gap-1 mt-1 text-[9px] text-slate-300 select-none">
        <span>${time}</span>
        ${statusTicks}
      </div>
    `;
    
    wrapperEl.appendChild(bubbleEl);
    container.appendChild(wrapperEl);
  }

  scrollToBottom() {
    const container = this.querySelector('#chat-messages');
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
