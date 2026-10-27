import './components/chat-app.js';
import { apiRequest, clearSession, legacyUsername, loadSession, saveSession } from './js/api.js';
import { hydrateIcons } from './js/dom.js';

const loginContainer = /** @type {HTMLElement} */ (document.getElementById('login-container'));
const chatApp = /** @type {any} */ (document.getElementById('chat-app'));
const form = /** @type {HTMLFormElement} */ (document.getElementById('login-form'));
const usernameInput = /** @type {HTMLInputElement} */ (document.getElementById('username-input'));
const loginBtn = /** @type {HTMLButtonElement} */ (document.getElementById('login-btn'));
const loginError = /** @type {HTMLElement} */ (document.getElementById('login-error'));

hydrateIcons();

/** @param {string} [message] */
function showLogin(message = '') {
  chatApp.hidden = true;
  loginContainer.hidden = false;
  loginError.textContent = message;
  if (!usernameInput.value) usernameInput.value = legacyUsername();
  usernameInput.focus();
}

/** @param {{ token: string, user: { id: string, username: string } }} session */
function showChat(session) {
  loginContainer.hidden = true;
  chatApp.hidden = false;
  chatApp.start(session);
}

chatApp.addEventListener('session-ended', (/** @type {CustomEvent} */ e) => {
  clearSession();
  showLogin(e.detail?.reason ?? '');
});
chatApp.addEventListener('token-refreshed', (/** @type {CustomEvent} */ e) => saveSession(e.detail));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loginBtn.disabled) return; // prevents double submission
  const username = usernameInput.value.trim();
  if (!username) {
    loginError.textContent = 'Please enter a display name.';
    usernameInput.focus();
    return;
  }
  loginBtn.disabled = true;
  loginBtn.textContent = 'Joining…';
  loginError.textContent = '';
  try {
    const session = await apiRequest('/api/session', { method: 'POST', body: { username } });
    saveSession(session);
    showChat(session);
  } catch (error) {
    loginError.textContent = /** @type {Error} */ (error).message;
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Join workspace';
  }
});

const existing = loadSession();
if (existing) showChat(existing);
else showLogin();
