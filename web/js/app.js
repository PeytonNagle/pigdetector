const AUTH_URL = 'https://pigdetector-828411126105.auth.us-west-1.amazoncognito.com';
const CLIENT_ID = '53ag8m9ir3lggeb4qo0p53arbp';
const API_URL = 'https://z8c550rufd.execute-api.us-west-1.amazonaws.com';
const REDIRECT_URI = `${location.origin}/`;
const LOGOUT_URI = `${location.origin}/index.html`;
const POLL_MS = 5000;

const REGISTER_ERRORS = {
  invalid_device_id: 'Device ID must be pd- plus 8 hex digits.',
  invalid_body: 'Name must be 1 to 40 characters.',
  already_registered: 'That node is already registered to an account.',
  node_not_seen: "The cloud hasn't heard from that node yet. Power it on near the gateway and try again.",
};

const $ = (id) => document.getElementById(id);
let nodes = [];
let pollTimer = null;

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function login() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem('pkce', JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email',
    state,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
  });
  location.assign(`${AUTH_URL}/oauth2/authorize?${params}`);
}

function logout() {
  sessionStorage.clear();
  const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: LOGOUT_URI });
  location.assign(`${AUTH_URL}/logout?${params}`);
}

// Cognito sends the user back with ?code=&state= (or ?error=); trade the code for tokens once.
async function finishLogin() {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return;
  history.replaceState(null, '', location.pathname);
  if (query.has('error')) throw new Error(`Login failed: ${query.get('error_description') || query.get('error')}`);

  const pkce = JSON.parse(sessionStorage.getItem('pkce') || 'null');
  sessionStorage.removeItem('pkce');
  if (!pkce || pkce.state !== query.get('state')) throw new Error('Login failed: state mismatch. Try again.');

  const res = await fetch(`${AUTH_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: query.get('code'),
      redirect_uri: REDIRECT_URI,
      code_verifier: pkce.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Login failed: token exchange returned ${res.status}`);
  sessionStorage.setItem('idToken', (await res.json()).id_token);
}

class SignedOut extends Error {}

async function api(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sessionStorage.getItem('idToken')}`,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) throw new SignedOut();
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `HTTP ${res.status}`), { code: data.error?.code });
  return data;
}

function show(signedIn, message = '') {
  $('login').hidden = signedIn;
  $('logout').hidden = !signedIn;
  $('dashboard').hidden = !signedIn;
  $('status').textContent = message;
}

function signOutLocally(message) {
  clearTimeout(pollTimer);
  sessionStorage.removeItem('idToken');
  show(false, message);
}

const fmt = (v) => (v === null || v === undefined ? '—' : String(v));

function nodeRows(node) {
  const s = node.latest ?? {};
  const rows = [
    ['Device ID', node.deviceId],
    ['Type', node.type],
    ['Online', node.online ? 'yes' : 'no'],
    ['Last report', s.ts ? new Date(s.ts).toLocaleString() : null],
    ['Mode', s.mode],
    ['LED', s.led === undefined || s.led === null ? null : s.led ? 'on' : 'off'],
  ];
  if (node.type === 'door') rows.push(['Door', s.door], ['Open for (s)', s.openSec], ['Open limit (s)', s.limits?.openMaxSec]);
  if (node.type === 'temp') rows.push(['Temperature (°C)', s.tempC], ['Temp limit (°C)', s.limits?.tempMaxC]);
  return rows;
}

function render() {
  const list = $('nodes');
  list.replaceChildren();
  if (nodes.length === 0) {
    list.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No nodes yet. Register one above.' }));
    return;
  }
  for (const node of nodes) {
    const card = document.createElement('article');
    card.className = 'card';
    const dl = document.createElement('dl');
    for (const [label, value] of nodeRows(node)) {
      dl.append(Object.assign(document.createElement('dt'), { textContent: label }));
      dl.append(Object.assign(document.createElement('dd'), { textContent: fmt(value) }));
    }
    card.append(Object.assign(document.createElement('h2'), { textContent: node.name }), dl);
    list.append(card);
  }
}

async function poll() {
  try {
    nodes = (await api('GET', '/nodes')).nodes;
    render();
    $('status').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    if (err instanceof SignedOut) return signOutLocally('Your session expired. Log in again.');
    $('status').textContent = `Couldn't load nodes: ${err.message}`;
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

async function register(event) {
  event.preventDefault();
  const name = $('name').value.trim();
  $('registerStatus').textContent = 'Registering…';
  try {
    const node = await api('POST', '/nodes', { deviceId: $('deviceId').value, ...(name && { name }) });
    // A GET right after a register can miss the new node, so add the 201 body directly.
    nodes = [...nodes.filter((n) => n.deviceId !== node.deviceId), node];
    render();
    $('register').reset();
    $('registerStatus').textContent = `Registered ${node.deviceId}.`;
  } catch (err) {
    if (err instanceof SignedOut) return signOutLocally('Your session expired. Log in again.');
    $('registerStatus').textContent = REGISTER_ERRORS[err.code] ?? `Couldn't register: ${err.message}`;
  }
}

$('login').addEventListener('click', () => login().catch((err) => show(false, `Couldn't start login: ${err.message}`)));
$('logout').addEventListener('click', logout);
$('register').addEventListener('submit', register);

try {
  await finishLogin();
} catch (err) {
  sessionStorage.removeItem('idToken');
  show(false, err.message);
}
if (sessionStorage.getItem('idToken')) {
  show(true, 'Loading…');
  poll();
} else if (!$('status').textContent) {
  show(false, 'Log in to see your nodes.');
}
