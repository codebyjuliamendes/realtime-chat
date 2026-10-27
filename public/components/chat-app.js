import { ApiError, apiRequest } from '../js/api.js';
import { ChatSocket } from '../js/chat-socket.js';
import { el, hydrateIcons, showToast, uuid } from '../js/dom.js';

const HISTORY_PAGE = 50;
const CATCH_UP_PAGE = 200;
const MESSAGE_MAX_LENGTH = 2000;
const TYPING_THROTTLE_MS = 2000;
const TYPING_DISPLAY_MS = 3000;

const template = document.createElement('template');
template.innerHTML = `
  <div class="relative flex w-full h-full bg-slate-950 text-slate-100 overflow-hidden">
    <aside id="sidebar" aria-label="Workspace"
      class="fixed inset-y-0 left-0 z-40 w-[85%] max-w-xs -translate-x-full invisible md:visible transition-[transform,visibility] duration-200 md:static md:translate-x-0 md:w-80 md:max-w-none flex flex-col bg-slate-900 border-r border-slate-800">
      <div class="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative w-10 h-10 shrink-0 rounded-full bg-brand-600 flex items-center justify-center font-bold text-white" aria-hidden="true">
            <span id="my-initial">-</span>
            <span class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 bg-slate-500" id="my-presence"></span>
          </div>
          <div class="min-w-0">
            <p class="font-semibold text-slate-200 truncate" id="my-name">-</p>
            <p class="text-xs text-slate-400" id="conn-status" role="status">Connecting…</p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" id="logout-btn" class="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800" aria-label="Sign out" title="Sign out">
            <span data-icon="logout"></span>
          </button>
          <button type="button" id="close-sidebar-btn" class="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 md:hidden" aria-label="Close channel list">
            <span data-icon="close"></span>
          </button>
        </div>
      </div>

      <div class="p-3">
        <label for="channel-search" class="sr-only">Search channels</label>
        <div class="relative">
          <input type="search" id="channel-search" placeholder="Search channels" autocomplete="off"
            class="w-full px-4 py-2 pl-9 bg-slate-950 border border-slate-800 focus:border-brand-500/60 rounded-xl text-slate-200 text-sm placeholder-slate-500">
          <span class="absolute left-3 top-2.5 text-slate-500"><span data-icon="search"></span></span>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto" aria-label="Channels">
        <ul id="channel-list" class="divide-y divide-slate-800/40"></ul>
        <p id="channel-empty" class="p-4 text-sm text-slate-500" hidden>No channels match your search.</p>
      </nav>

      <form id="new-channel-form" class="p-3 border-t border-slate-800 flex gap-2" novalidate>
        <label for="new-channel-input" class="sr-only">New channel name</label>
        <input id="new-channel-input" type="text" maxlength="40" placeholder="New channel" autocomplete="off"
          class="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-800 focus:border-brand-500/60 rounded-xl text-sm text-slate-200 placeholder-slate-500">
        <button type="submit" class="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 disabled:opacity-50" aria-label="Create channel">
          <span data-icon="plus"></span>
        </button>
      </form>
    </aside>
    <div id="sidebar-backdrop" class="fixed inset-0 z-30 bg-black/60 md:hidden" hidden></div>

    <main class="flex-1 flex flex-col min-w-0 bg-slate-950">
      <header class="p-3 sm:p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-3">
        <button type="button" id="open-sidebar-btn" class="p-2 -ml-1 rounded-lg text-slate-300 hover:bg-slate-800 md:hidden"
          aria-label="Open channel list" aria-controls="sidebar" aria-expanded="false">
          <span data-icon="menu" data-class="w-5 h-5"></span>
        </button>
        <div class="w-10 h-10 shrink-0 rounded-full bg-slate-800 flex items-center justify-center font-bold text-brand-500 border border-slate-700" aria-hidden="true">#</div>
        <div class="flex flex-col min-w-0">
          <h1 class="font-semibold text-slate-100 truncate" id="current-channel-name">…</h1>
          <p class="text-xs text-slate-400 truncate" id="current-channel-status"></p>
        </div>
      </header>

      <div id="conn-banner" role="status" hidden
        class="py-2 px-4 bg-amber-500 text-slate-950 text-center text-sm font-semibold flex items-center justify-center gap-2">
        <span data-icon="alert"></span><span id="conn-banner-text">Connection lost. Reconnecting…</span>
      </div>

      <div id="chat-messages" class="flex-1 px-3 py-4 sm:p-6 overflow-y-auto">
        <div class="flex justify-center mb-4">
          <button type="button" id="load-older-btn" hidden
            class="px-3 py-1.5 text-xs rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-60">Load older messages</button>
        </div>
        <div id="messages-state" class="text-center text-sm text-slate-400 py-10" hidden></div>
        <ol id="message-list" class="flex flex-col gap-2" role="log" aria-live="polite" aria-label="Messages"></ol>
      </div>

      <p id="typing-indicator" class="px-6 h-6 text-xs text-slate-400 italic truncate" aria-live="polite"></p>

      <form id="composer" class="p-3 sm:p-4 bg-slate-900 border-t border-slate-800 flex items-center gap-2 sm:gap-3" novalidate>
        <label for="message-input" class="sr-only">Message</label>
        <input type="text" id="message-input" maxlength="${MESSAGE_MAX_LENGTH}" placeholder="Type a message" autocomplete="off"
          aria-describedby="char-count"
          class="flex-1 min-w-0 px-4 py-3 bg-slate-950 border border-slate-800 focus:border-brand-500/60 rounded-xl text-slate-200 text-sm placeholder-slate-500">
        <span id="char-count" class="text-xs text-slate-500 tabular-nums" hidden></span>
        <button type="submit" id="send-btn" aria-label="Send message"
          class="shrink-0 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 text-white w-11 h-11 rounded-xl flex items-center justify-center transition">
          <span data-icon="send"></span>
        </button>
      </form>
    </main>
  </div>
`;

const STATUS_LABEL = { sending: 'Sending', sent: 'Sent', read: 'Read', failed: 'Not sent' };
const STATUS_ICON = { sending: '…', sent: '✓', read: '✓✓', failed: '!' };

/**
 * @typedef {{ id: string, channel_id: string, user_id: string, username?: string, content: string, status: string, timestamp: number }} ChatMessage
 */

class ChatApp extends HTMLElement {
  constructor() {
    super();
    /** @type {{ token: string, user: { id: string, username: string } } | null} */
    this.session = null;
    /** @type {ChatSocket|null} */
    this.socket = null;
    this.currentChannel = 'general';
    /** @type {Map<string, {id: string, name: string}>} */
    this.channels = new Map();
    /** @type {Map<string, {id: string, username?: string, status?: string}>} */
    this.users = new Map();
    /** @type {Map<string, ChatMessage[]>} */
    this.messages = new Map();
    /** @type {Map<string, boolean>} channelId -> has older history */
    this.hasOlder = new Map();
    /** @type {Map<string, number>} */
    this.unread = new Map();
    /** @type {Set<string>} */
    this.receiptsSent = new Set();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} userId -> hide timer */
    this.typingUsers = new Map();
    this.lastTypingSentAt = 0;
    this.everConnected = false;
    /** @type {(() => void) | null} */
    this.visibilityListener = null;
  }

  /** @param {{ token: string, user: { id: string, username: string } }} session */
  async start(session) {
    this.session = session;
    this.replaceChildren(template.content.cloneNode(true));
    hydrateIcons(this);
    this.$('#my-initial').textContent = [...session.user.username][0]?.toUpperCase() ?? '?';
    this.$('#my-name').textContent = session.user.username;
    this.setupEventListeners();

    this.setMessagesState('Loading…');
    try {
      const [channels, users] = await Promise.all([this.api('/api/channels'), this.api('/api/users')]);
      for (const c of channels) this.channels.set(c.id, c);
      for (const u of users) this.users.set(u.id, u);
    } catch (error) {
      if (this.handleAuthError(error)) return;
      this.setMessagesState("Couldn't load the workspace.", () => this.restart());
      return;
    }
    this.renderChannelList();
    await this.selectChannel(this.channels.has('general') ? 'general' : [...this.channels.keys()][0]);
    this.connect();
  }

  restart() {
    if (this.session) this.start(this.session);
  }

  /** @param {string} selector @returns {any} */
  $(selector) {
    return this.querySelector(selector);
  }

  /** @param {string} path @param {Parameters<typeof apiRequest>[1]} [opts] */
  api(path, opts = {}) {
    return apiRequest(path, { ...opts, token: this.session?.token });
  }

  /** @param {unknown} error @returns {boolean} true when the session is gone */
  handleAuthError(error) {
    if (error instanceof ApiError && error.status === 401) {
      this.endSession('Your session has expired. Please join again.');
      return true;
    }
    return false;
  }

  /** @param {string} [reason] */
  endSession(reason = '') {
    this.socket?.stop();
    this.socket = null;
    this.replaceChildren();
    this.channels.clear();
    this.messages.clear();
    this.users.clear();
    this.unread.clear();
    this.hasOlder.clear();
    this.receiptsSent.clear();
    this.everConnected = false;
    this.dispatchEvent(new CustomEvent('session-ended', { detail: { reason } }));
  }

  // ---- WebSocket ---------------------------------------------------------

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new ChatSocket({
      url: `${protocol}//${location.host}/ws`,
      getToken: () => this.session?.token ?? null,
    });
    this.socket
      .on('status', (/** @type {string} */ s) => this.renderConnection(s))
      .on('ready', (/** @type {any} */ ack) => this.onReady(ack))
      .on('event', (/** @type {any} */ frame) => this.handleEvent(frame))
      .on('fatal', () => this.endSession('Your session has expired. Please join again.'));
    this.socket.connect();
  }

  /** @param {{ token: string, user: {id: string, username: string} }} ack */
  async onReady(ack) {
    if (!this.session) return;
    this.session = { token: ack.token, user: ack.user };
    this.dispatchEvent(new CustomEvent('token-refreshed', { detail: this.session }));
    for (const channelId of this.channels.keys()) this.socket?.send('join', { channelId });
    if (this.everConnected) await this.catchUp();
    this.everConnected = true;
    this.sendReadReceipts();
  }

  /** Fetches messages missed while disconnected for every loaded channel. */
  async catchUp() {
    for (const [channelId, list] of this.messages) {
      let after = list.reduce(
        (max, m) => (m.status !== 'sending' && m.status !== 'failed' ? Math.max(max, m.timestamp) : max),
        0,
      );
      for (let page = 0; page < 5; page++) {
        let batch;
        try {
          batch = await this.api(
            `/api/channels/${encodeURIComponent(channelId)}/messages?after=${after}&limit=${CATCH_UP_PAGE}`,
          );
        } catch (error) {
          this.handleAuthError(error);
          return;
        }
        for (const m of batch) this.addMessage(m, { countUnread: true });
        if (batch.length < CATCH_UP_PAGE) break;
        after = batch[batch.length - 1].timestamp;
      }
    }
  }

  /** @param {{ type: string, payload: any }} frame */
  handleEvent({ type, payload }) {
    switch (type) {
      case 'new_message':
        this.users.set(payload.userId, {
          ...this.users.get(payload.userId),
          id: payload.userId,
          username: payload.username,
        });
        this.clearTyping(payload.userId);
        this.addMessage(
          {
            id: payload.id,
            channel_id: payload.channelId,
            user_id: payload.userId,
            content: payload.content,
            status: payload.status,
            timestamp: payload.timestamp,
          },
          { countUnread: true },
        );
        this.sendReadReceipts();
        break;
      case 'message_ack':
        this.updateMessage(payload.channelId, payload.id, {
          status: payload.status === 'read' ? 'read' : 'sent',
          timestamp: payload.timestamp,
        });
        break;
      case 'message_update':
        if (payload.status === 'read') this.updateMessage(payload.channelId, payload.id, { status: 'read' });
        break;
      case 'typing_indicator':
        if (payload.channelId === this.currentChannel && payload.userId !== this.session?.user.id) {
          this.showTyping(payload.userId, payload.username);
        }
        break;
      case 'presence_update':
        this.users.set(payload.userId, {
          ...this.users.get(payload.userId),
          id: payload.userId,
          username: payload.username,
          status: payload.status,
        });
        this.renderChannelHeader();
        break;
      case 'channel_created':
        if (!this.channels.has(payload.channel.id)) {
          this.channels.set(payload.channel.id, payload.channel);
          this.socket?.send('join', { channelId: payload.channel.id });
          this.renderChannelList();
        }
        break;
      case 'error':
        if (payload.ref) {
          for (const [channelId, list] of this.messages) {
            if (list.some((m) => m.id === payload.ref) && payload.code !== 'rate_limited') {
              this.updateMessage(channelId, payload.ref, { status: 'failed' });
            }
          }
        }
        showToast(payload.code === 'rate_limited' ? 'You are sending messages too fast.' : payload.message, 'error');
        break;
    }
  }

  /** @param {string} state */
  renderConnection(state) {
    const labels = { connecting: 'Connecting…', reconnecting: 'Reconnecting…', offline: 'Offline', online: 'Online' };
    this.$('#conn-status').textContent = labels[/** @type {keyof typeof labels} */ (state)] ?? state;
    this.$('#my-presence').className =
      `absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 ${state === 'online' ? 'bg-brand-500' : 'bg-slate-500'}`;
    const banner = this.$('#conn-banner');
    banner.hidden = state === 'online' || (state === 'connecting' && !this.everConnected);
    this.$('#conn-banner-text').textContent =
      'Connection lost. Reconnecting… Messages you send will be delivered when it is back.';
  }

  // ---- UI events ----------------------------------------------------------

  setupEventListeners() {
    const input = this.$('#message-input');
    this.$('#composer').addEventListener('submit', (/** @type {Event} */ e) => {
      e.preventDefault();
      this.sendMessage();
    });
    input.addEventListener('input', () => {
      this.renderCharCount();
      if (input.value.trim()) this.sendTyping();
    });
    this.$('#channel-search').addEventListener('input', () => this.renderChannelList());
    this.$('#new-channel-form').addEventListener('submit', (/** @type {Event} */ e) => {
      e.preventDefault();
      this.createChannel();
    });
    this.$('#logout-btn').addEventListener('click', () => this.endSession());
    this.$('#open-sidebar-btn').addEventListener('click', () => this.toggleSidebar(true));
    this.$('#close-sidebar-btn').addEventListener('click', () => this.toggleSidebar(false));
    this.$('#sidebar-backdrop').addEventListener('click', () => this.toggleSidebar(false));
    this.$('#load-older-btn').addEventListener('click', () => this.loadOlder());
    this.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') this.toggleSidebar(false);
    });
    if (!this.visibilityListener) {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible') this.sendReadReceipts();
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
  }

  /** @param {boolean} open */
  toggleSidebar(open) {
    const sidebar = this.$('#sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('-translate-x-full', !open);
    // keeps the off-canvas sidebar out of the tab order on small screens
    sidebar.classList.toggle('invisible', !open);
    this.$('#sidebar-backdrop').hidden = !open;
    const opener = this.$('#open-sidebar-btn');
    opener.setAttribute('aria-expanded', String(open));
    if (open) this.$('#channel-search').focus();
    else if (document.activeElement && sidebar.contains(document.activeElement) && window.innerWidth < 768)
      opener.focus();
  }

  renderCharCount() {
    const len = [...this.$('#message-input').value].length;
    const counter = this.$('#char-count');
    counter.hidden = len < MESSAGE_MAX_LENGTH * 0.8;
    counter.textContent = `${len}/${MESSAGE_MAX_LENGTH}`;
  }

  sendTyping() {
    const now = Date.now();
    if (now - this.lastTypingSentAt < TYPING_THROTTLE_MS) return;
    if (this.socket?.send('typing', { channelId: this.currentChannel })) this.lastTypingSentAt = now;
  }

  sendMessage() {
    const input = this.$('#message-input');
    const content = input.value.trim();
    if (!content || !this.session || !this.socket) return;
    if ([...content].length > MESSAGE_MAX_LENGTH) {
      showToast(`Messages are limited to ${MESSAGE_MAX_LENGTH} characters.`, 'error');
      return;
    }
    const id = uuid();
    input.value = '';
    this.renderCharCount();
    this.lastTypingSentAt = 0;
    this.addMessage(
      {
        id,
        channel_id: this.currentChannel,
        user_id: this.session.user.id,
        content,
        status: 'sending',
        timestamp: Date.now(),
      },
      { scroll: true },
    );
    this.socket.sendMessage({ id, channelId: this.currentChannel, content });
  }

  async createChannel() {
    const input = this.$('#new-channel-input');
    const button = this.$('#new-channel-form button');
    const name = input.value.trim();
    if (!name || button.disabled) return;
    button.disabled = true;
    try {
      const channel = await this.api('/api/channels', { method: 'POST', body: { name } });
      input.value = '';
      if (!this.channels.has(channel.id)) {
        this.channels.set(channel.id, channel);
        this.socket?.send('join', { channelId: channel.id });
      }
      await this.selectChannel(channel.id);
      showToast(`Channel “${channel.name}” created.`);
    } catch (error) {
      if (!this.handleAuthError(error)) showToast(/** @type {Error} */ (error).message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  // ---- channels -----------------------------------------------------------

  renderChannelList() {
    const list = this.$('#channel-list');
    if (!list) return;
    const filter = this.$('#channel-search').value.trim().toLowerCase();
    const items = [...this.channels.values()].filter((c) => !filter || c.name.toLowerCase().includes(filter));
    list.replaceChildren(
      ...items.map((channel) => {
        const active = channel.id === this.currentChannel;
        const unread = this.unread.get(channel.id) ?? 0;
        const button = el('button', {
          className: `w-full flex items-center gap-3 p-4 text-left hover:bg-slate-800/50 transition ${active ? 'bg-slate-800/70 border-l-4 border-brand-500' : 'border-l-4 border-transparent'}`,
          attrs: { type: 'button', ...(active ? { 'aria-current': 'page' } : {}) },
          children: [
            el('span', {
              className:
                'w-10 h-10 shrink-0 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center font-bold text-brand-500',
              text: '#',
              attrs: { 'aria-hidden': 'true' },
            }),
            el('span', { className: 'flex-1 min-w-0 font-medium text-slate-200 truncate', text: channel.name }),
            unread > 0 &&
              el('span', {
                className:
                  'min-w-[1.5rem] px-1.5 py-0.5 rounded-full bg-brand-600 text-white text-xs font-semibold text-center',
                text: unread > 99 ? '99+' : String(unread),
                attrs: { 'aria-label': `${unread} unread` },
              }),
          ],
        });
        button.addEventListener('click', () => {
          this.selectChannel(channel.id);
          this.toggleSidebar(false);
        });
        return el('li', { children: [button] });
      }),
    );
    this.$('#channel-empty').hidden = items.length > 0;
  }

  renderChannelHeader() {
    const channel = this.channels.get(this.currentChannel);
    const nameEl = this.$('#current-channel-name');
    if (!nameEl) return;
    nameEl.textContent = channel ? `# ${channel.name}` : '';
    const online = [...this.users.values()].filter((u) => u.status === 'online').length;
    this.$('#current-channel-status').textContent = `${online} online`;
    document.title = channel ? `#${channel.name} - NexusChat` : 'NexusChat';
  }

  /** @param {string} channelId */
  async selectChannel(channelId) {
    if (!channelId) return;
    this.currentChannel = channelId;
    this.unread.delete(channelId);
    this.typingUsers.forEach((t) => clearTimeout(t));
    this.typingUsers.clear();
    this.renderTyping();
    this.renderChannelHeader();
    this.renderChannelList();

    if (!this.messages.has(channelId)) {
      this.$('#message-list').replaceChildren();
      this.setMessagesState('Loading messages…');
      try {
        const history = await this.api(`/api/channels/${encodeURIComponent(channelId)}/messages?limit=${HISTORY_PAGE}`);
        if (!this.messages.has(channelId)) this.messages.set(channelId, []);
        for (const m of history) this.addMessage(m, { render: false });
        this.hasOlder.set(channelId, history.length === HISTORY_PAGE);
      } catch (error) {
        if (this.handleAuthError(error)) return;
        if (this.currentChannel === channelId) {
          this.setMessagesState("Couldn't load messages.", () => this.selectChannel(channelId));
        }
        return;
      }
    }
    if (this.currentChannel !== channelId) return;
    this.renderMessages();
    this.sendReadReceipts();
    if (window.innerWidth >= 768) this.$('#message-input').focus();
  }

  async loadOlder() {
    const channelId = this.currentChannel;
    const list = this.messages.get(channelId) ?? [];
    const oldest = list.find((m) => m.status !== 'sending' && m.status !== 'failed');
    const button = this.$('#load-older-btn');
    if (!oldest || button.disabled) return;
    button.disabled = true;
    const scroller = this.$('#chat-messages');
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    try {
      const older = await this.api(
        `/api/channels/${encodeURIComponent(channelId)}/messages?before=${oldest.timestamp}&limit=${HISTORY_PAGE}`,
      );
      const known = new Set(list.map((m) => m.id));
      list.unshift(...older.filter((/** @type {ChatMessage} */ m) => !known.has(m.id)));
      this.hasOlder.set(channelId, older.length === HISTORY_PAGE);
      if (this.currentChannel === channelId) {
        this.renderMessages({ scroll: false });
        scroller.scrollTop = scroller.scrollHeight - fromBottom;
      }
    } catch (error) {
      if (!this.handleAuthError(error)) showToast(/** @type {Error} */ (error).message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  // ---- messages -----------------------------------------------------------

  /**
   * @param {string} text
   * @param {() => void} [retry]
   */
  setMessagesState(text, retry) {
    const state = this.$('#messages-state');
    if (!state) return;
    state.hidden = !text;
    state.replaceChildren(
      el('p', { text }),
      retry &&
        (() => {
          const b = el('button', {
            className: 'mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200',
            text: 'Try again',
            attrs: { type: 'button' },
          });
          b.addEventListener('click', retry);
          return b;
        })(),
    );
  }

  /**
   * Inserts a message (de-duplicated by id) and renders it when visible.
   * @param {ChatMessage} message
   * @param {{ render?: boolean, scroll?: boolean, countUnread?: boolean }} [opts]
   */
  addMessage(message, { render = true, scroll = false, countUnread = false } = {}) {
    const channelId = message.channel_id;
    if (!this.channels.has(channelId)) return;
    const loaded = this.messages.get(channelId);
    if (!loaded) {
      // History not loaded yet: it will arrive complete when the channel is opened.
      if (countUnread && message.user_id !== this.session?.user.id) this.bumpUnread(channelId);
      return;
    }
    const existing = loaded.find((m) => m.id === message.id);
    if (existing) {
      if (existing.status === 'sending' || (message.status === 'read' && existing.status !== 'read')) {
        this.updateMessage(channelId, message.id, { status: message.status, timestamp: message.timestamp });
      }
      return;
    }
    loaded.push(message);
    if (channelId !== this.currentChannel) {
      if (countUnread && message.user_id !== this.session?.user.id) this.bumpUnread(channelId);
      return;
    }
    if (!render) return;
    const scroller = this.$('#chat-messages');
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    this.$('#messages-state').hidden = true;
    this.$('#message-list').append(this.renderMessage(message));
    if (scroll || nearBottom) this.scrollToBottom();
  }

  /** @param {string} channelId */
  bumpUnread(channelId) {
    this.unread.set(channelId, (this.unread.get(channelId) ?? 0) + 1);
    this.renderChannelList();
  }

  /**
   * @param {string} channelId
   * @param {string} id
   * @param {Partial<ChatMessage>} changes
   */
  updateMessage(channelId, id, changes) {
    const message = this.messages.get(channelId)?.find((m) => m.id === id);
    if (!message) return;
    // Never downgrade "read" back to "sent" (acks and receipts can race).
    if (message.status === 'read' && changes.status && changes.status !== 'read') delete changes.status;
    Object.assign(message, Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)));
    const node = this.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    node?.replaceWith(this.renderMessage(message));
  }

  /** @param {{ scroll?: boolean }} [opts] */
  renderMessages({ scroll = true } = {}) {
    const list = this.messages.get(this.currentChannel) ?? [];
    this.$('#message-list').replaceChildren(...list.map((m) => this.renderMessage(m)));
    this.$('#load-older-btn').hidden = !this.hasOlder.get(this.currentChannel);
    if (list.length === 0) this.setMessagesState('No messages yet. Say hello!');
    else this.setMessagesState('');
    if (scroll) this.scrollToBottom();
  }

  /** @param {ChatMessage} msg */
  renderMessage(msg) {
    const isMe = msg.user_id === this.session?.user.id;
    const author = isMe ? 'You' : (this.users.get(msg.user_id)?.username ?? msg.username ?? 'Unknown');
    const date = new Date(msg.timestamp);
    const status = /** @type {keyof typeof STATUS_LABEL} */ (msg.status in STATUS_LABEL ? msg.status : 'sent');

    return el('li', {
      className: `flex w-full animate-fade-in ${isMe ? 'justify-end' : 'justify-start'}`,
      attrs: { 'data-id': msg.id },
      children: [
        el('article', {
          className: `max-w-[85%] sm:max-w-[70%] px-4 py-2.5 rounded-2xl shadow-sm ${
            isMe
              ? 'bg-emerald-700 text-white rounded-tr-none'
              : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700/40'
          } ${status === 'failed' ? 'ring-1 ring-red-400' : ''}`,
          attrs: {
            'aria-label': `${author} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          },
          children: [
            !isMe && el('p', { className: 'text-xs font-semibold text-brand-400 mb-1', text: author }),
            el('p', { className: 'text-sm whitespace-pre-wrap break-words leading-relaxed', text: msg.content }),
            el('p', {
              className: 'flex items-center justify-end gap-1 mt-1 text-[11px] text-slate-300 select-none',
              children: [
                el('time', {
                  attrs: { datetime: date.toISOString(), title: date.toLocaleString() },
                  text: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                }),
                isMe &&
                  el('span', {
                    className: `font-bold ${status === 'read' ? 'text-emerald-200' : status === 'failed' ? 'text-red-300' : 'text-slate-300'}`,
                    text: STATUS_ICON[status],
                    attrs: { 'aria-label': STATUS_LABEL[status], title: STATUS_LABEL[status], 'data-status': status },
                  }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  /** Marks visible messages from other people as read (once per message). */
  sendReadReceipts() {
    if (document.visibilityState !== 'visible' || !this.socket?.isOnline || !this.session) return;
    const list = this.messages.get(this.currentChannel) ?? [];
    const pending = list
      .filter((m) => m.user_id !== this.session?.user.id && m.status !== 'read' && !this.receiptsSent.has(m.id))
      .slice(-50);
    for (const m of pending) {
      if (this.socket.send('message_read', { id: m.id, channelId: this.currentChannel })) this.receiptsSent.add(m.id);
    }
  }

  scrollToBottom() {
    const container = this.$('#chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  // ---- typing -------------------------------------------------------------

  /** @param {string} userId @param {string} [username] */
  showTyping(userId, username) {
    if (username) this.users.set(userId, { ...this.users.get(userId), id: userId, username });
    clearTimeout(this.typingUsers.get(userId));
    this.typingUsers.set(
      userId,
      setTimeout(() => this.clearTyping(userId), TYPING_DISPLAY_MS),
    );
    this.renderTyping();
  }

  /** @param {string} userId */
  clearTyping(userId) {
    clearTimeout(this.typingUsers.get(userId));
    if (this.typingUsers.delete(userId)) this.renderTyping();
  }

  renderTyping() {
    const indicator = this.$('#typing-indicator');
    if (!indicator) return;
    const names = [...this.typingUsers.keys()].map((id) => this.users.get(id)?.username ?? 'Someone');
    indicator.textContent =
      names.length === 0
        ? ''
        : names.length === 1
          ? `${names[0]} is typing…`
          : names.length === 2
            ? `${names[0]} and ${names[1]} are typing…`
            : 'Several people are typing…';
  }
}

customElements.define('chat-app', ChatApp);
