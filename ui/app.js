const state = {
  token: localStorage.getItem('uiToken') || '',
  apiBase: localStorage.getItem('apiBase') || 'http://localhost:8787',
  logSource: null,
  qrTimer: null
};

const el = {
  apiBase: document.getElementById('apiBase'),
  saveApi: document.getElementById('saveApi'),
  apiStatus: document.getElementById('apiStatus'),
  authGate: document.getElementById('authGate'),
  loginForm: document.getElementById('loginForm'),
  loginUsername: document.getElementById('loginUsername'),
  loginPassword: document.getElementById('loginPassword'),
  loginMsg: document.getElementById('loginMsg'),
  botList: document.getElementById('botList'),
  addBotForm: document.getElementById('addBotForm'),
  addPhone: document.getElementById('addPhone'),
  useQr: document.getElementById('useQr'),
  addBotMsg: document.getElementById('addBotMsg'),
  qrBotSelect: document.getElementById('qrBotSelect'),
  qrImage: document.getElementById('qrImage'),
  qrStatus: document.getElementById('qrStatus'),
  configForm: document.getElementById('configForm'),
  prefixInput: document.getElementById('prefixInput'),
  originInput: document.getElementById('originInput'),
  configMsg: document.getElementById('configMsg'),
  passwordForm: document.getElementById('passwordForm'),
  oldPassword: document.getElementById('oldPassword'),
  newPassword: document.getElementById('newPassword'),
  passwordMsg: document.getElementById('passwordMsg'),
  rolesForm: document.getElementById('rolesForm'),
  adminsInput: document.getElementById('adminsInput'),
  subsInput: document.getElementById('subsInput'),
  rolesMsg: document.getElementById('rolesMsg'),
  sendForm: document.getElementById('sendForm'),
  sendBotSelect: document.getElementById('sendBotSelect'),
  sendJid: document.getElementById('sendJid'),
  sendText: document.getElementById('sendText'),
  sendMsg: document.getElementById('sendMsg'),
  logStream: document.getElementById('logStream')
};

function setStatus(target, text) {
  if (!target) return;
  target.textContent = text || '';
}

function setToken(token) {
  state.token = token || '';
  if (token) localStorage.setItem('uiToken', token);
  else localStorage.removeItem('uiToken');
}

function setApiBase(value) {
  state.apiBase = value;
  localStorage.setItem('apiBase', value);
}

function apiUrl(path) {
  return `${state.apiBase}${path}`;
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(apiUrl(path), Object.assign({}, options, { headers }));
  if (res.status === 401) {
    setToken('');
    showAuthGate(true);
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text || 'request_failed';
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (parsed.detail) message = `${parsed.error || 'error'}: ${parsed.detail}`;
        else if (parsed.error) message = parsed.error;
      }
    } catch (err) {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function showAuthGate(show) {
  el.authGate.style.display = show ? 'flex' : 'none';
}

async function login(username, password) {
  const res = await fetch(apiUrl('/api/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) throw new Error('invalid_password');
  const data = await res.json();
  setToken(data.token);
}

function splitLines(value) {
  return String(value)
    .split(/\n|,/)
    .map(v => v.trim())
    .filter(Boolean);
}

function renderBots(bots) {
  el.botList.innerHTML = '';
  el.qrBotSelect.innerHTML = '';
  el.sendBotSelect.innerHTML = '';

  bots.forEach(bot => {
    const row = document.createElement('div');
    row.className = 'bot-row';
    row.innerHTML = `
      <strong>${bot.displayId}</strong>
      <div>Id: ${bot.id}</div>
      <div>Status: ${bot.connected ? 'online' : 'offline'}${bot.suppressed ? ' (suppressed)' : ''}</div>
      <div>Phone: ${bot.phone || '-'}</div>
      <div class="bot-actions">
        <button data-action="start" data-id="${bot.id}">Start</button>
        <button data-action="stop" data-id="${bot.id}" class="secondary">Stop</button>
        <button data-action="remove" data-id="${bot.id}" class="secondary">Remove</button>
      </div>
    `;
    el.botList.appendChild(row);

    const option = document.createElement('option');
    option.value = bot.id;
    option.textContent = bot.displayId;
    el.qrBotSelect.appendChild(option);

    const sendOption = document.createElement('option');
    sendOption.value = bot.id;
    sendOption.textContent = bot.displayId;
    el.sendBotSelect.appendChild(sendOption);
  });
}

async function loadStatus() {
  const data = await apiFetch('/api/status');
  renderBots(data.bots || []);
}

async function loadConfig() {
  const data = await apiFetch('/api/config');
  el.prefixInput.value = data.prefix || '!';
  el.originInput.value = data.uiOrigin || '*';
  if (data.passwordManagedByEnv) {
    setStatus(el.passwordMsg, 'Password managed by UI_PASSWORD env var.');
  }
}

async function loadRoles() {
  const data = await apiFetch('/api/roles');
  el.adminsInput.value = (data.admins || []).join('\n');
  el.subsInput.value = (data.subAdmins || []).join('\n');
}

async function addBot(phone, useQR) {
  const payload = { useQR: !!useQR };
  if (phone) payload.phone = phone;
  const data = await apiFetch('/api/bots', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (data.pairingError) {
    setStatus(el.addBotMsg, `Pairing error: ${data.pairingError}`);
  } else if (data.pairingCode) {
    setStatus(el.addBotMsg, `Pairing code: ${data.pairingCode}`);
  } else {
    setStatus(el.addBotMsg, 'Bot created. Scan QR if required.');
  }
  return data;
}

async function startBot(id) {
  await apiFetch(`/api/bots/${id}/start`, { method: 'POST' });
}

async function stopBot(id) {
  await apiFetch(`/api/bots/${id}/stop`, { method: 'POST' });
}

async function removeBot(id) {
  await apiFetch(`/api/bots/${id}`, { method: 'DELETE' });
}

async function saveConfig() {
  const payload = {
    prefix: el.prefixInput.value.trim(),
    uiOrigin: el.originInput.value.trim()
  };
  await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(payload) });
  setStatus(el.configMsg, 'Config updated.');
}

async function saveRoles() {
  const payload = {
    admins: splitLines(el.adminsInput.value),
    subAdmins: splitLines(el.subsInput.value)
  };
  await apiFetch('/api/roles', { method: 'POST', body: JSON.stringify(payload) });
  setStatus(el.rolesMsg, 'Roles updated.');
}

async function sendMessage() {
  const payload = {
    botId: el.sendBotSelect.value,
    jid: el.sendJid.value.trim(),
    text: el.sendText.value.trim()
  };
  await apiFetch('/api/send', { method: 'POST', body: JSON.stringify(payload) });
  setStatus(el.sendMsg, 'Message sent.');
}

async function changePassword() {
  const payload = {
    oldPassword: el.oldPassword.value,
    newPassword: el.newPassword.value
  };
  await apiFetch('/api/password', { method: 'POST', body: JSON.stringify(payload) });
  setStatus(el.passwordMsg, 'Password updated.');
  el.oldPassword.value = '';
  el.newPassword.value = '';
}

function startLogStream() {
  if (state.logSource) state.logSource.close();
  const url = new URL(apiUrl('/api/logs'));
  url.searchParams.set('token', state.token);
  state.logSource = new EventSource(url.toString());

  state.logSource.addEventListener('log', (event) => {
    const payload = JSON.parse(event.data || '{}');
    if (!payload.line) return;
    const line = document.createElement('div');
    line.textContent = payload.line;
    el.logStream.appendChild(line);
    if (el.logStream.children.length > 400) {
      el.logStream.removeChild(el.logStream.firstChild);
    }
    el.logStream.scrollTop = el.logStream.scrollHeight;
  });

  state.logSource.onerror = () => {
    setStatus(el.apiStatus, 'Log stream disconnected.');
  };
}

function startQrPoll() {
  if (state.qrTimer) clearInterval(state.qrTimer);
  state.qrTimer = setInterval(async () => {
    const botId = el.qrBotSelect.value;
    if (!botId) return;
    try {
      const data = await apiFetch(`/api/qr?botId=${encodeURIComponent(botId)}`);
      if (data && data.dataUrl) {
        el.qrImage.src = data.dataUrl;
        setStatus(el.qrStatus, `Updated: ${new Date(data.ts).toLocaleTimeString()}`);
      }
    } catch (err) {
      setStatus(el.qrStatus, 'No QR available.');
    }
  }, 4000);
}

async function refreshAll() {
  await loadStatus();
  await loadConfig();
  await loadRoles();
  startLogStream();
  startQrPoll();
}

el.apiBase.value = state.apiBase;

el.saveApi.addEventListener('click', () => {
  const value = el.apiBase.value.trim();
  if (!value) return;
  setApiBase(value);
  setStatus(el.apiStatus, 'API base saved.');
});

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await login(el.loginUsername.value, el.loginPassword.value);
    el.loginUsername.value = '';
    el.loginPassword.value = '';
    showAuthGate(false);
    await refreshAll();
  } catch (err) {
    setStatus(el.loginMsg, 'Invalid username or password.');
  }
});

el.addBotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await addBot(el.addPhone.value.trim(), el.useQr.checked);
    await loadStatus();
    if (result && result.botId) {
      el.qrBotSelect.value = result.botId;
      el.sendBotSelect.value = result.botId;
      if (el.useQr.checked) setStatus(el.qrStatus, 'Waiting for QR...');
    }
    el.addPhone.value = '';
  } catch (err) {
    setStatus(el.addBotMsg, `Failed to create bot: ${err.message || 'unknown_error'}`);
  }
});

el.botList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    if (action === 'start') await startBot(id);
    if (action === 'stop') await stopBot(id);
    if (action === 'remove') await removeBot(id);
    await loadStatus();
  } catch (err) {
    setStatus(el.addBotMsg, 'Action failed.');
  }
});

el.configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await saveConfig();
  } catch (err) {
    setStatus(el.configMsg, 'Config update failed.');
  }
});

el.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await changePassword();
  } catch (err) {
    setStatus(el.passwordMsg, 'Password update failed.');
  }
});

el.rolesForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await saveRoles();
  } catch (err) {
    setStatus(el.rolesMsg, 'Role update failed.');
  }
});

el.sendForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await sendMessage();
  } catch (err) {
    setStatus(el.sendMsg, 'Send failed.');
  }
});

showAuthGate(!state.token);
if (state.token) {
  refreshAll().catch(() => {
    showAuthGate(true);
  });
}
