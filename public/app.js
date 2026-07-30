function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const loginContainer = document.getElementById('login-container');
  const chatApp = document.getElementById('chat-app');
  const loginBtn = document.getElementById('login-btn');
  const usernameInput = document.getElementById('username-input');

  // Check if we have a saved user
  let userId = localStorage.getItem('chat_userId');
  let username = localStorage.getItem('chat_username');

  if (userId && username) {
    initApp(userId, username);
  }

  loginBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
      userId = generateUUID();
      username = name;
      localStorage.setItem('chat_userId', userId);
      localStorage.setItem('chat_username', username);
      initApp(userId, username);
    }
  });

  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loginBtn.click();
    }
  });

  function initApp(uid, uname) {
    loginContainer.style.display = 'none';
    chatApp.style.display = 'block';
    
    // Pass config to web component
    chatApp.initialize(uid, uname);
  }
});
