'use strict';

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API = '';

const state = {
  token: localStorage.getItem('sync_token') || sessionStorage.getItem('sync_token') || null,
  username: localStorage.getItem('sync_username') || sessionStorage.getItem('sync_username') || null,
  authMode: 'login',
  ws: null,
  wsReconnectTimer: null,
  reconnectAttempt: 0,
  player: null,
  playerReady: false,
  playerSeeking: false,
  applyingRemote: false,
  currentSong: null,
  currentVideoId: null,
  isPlaying: false,
  room: null,
  friends: [],
  pending: [],
  queue: readJSON('sync_queue', []),
  queueIndex: -1,
  recentTracks: readJSON('sync_recent_tracks', []),
  recentQueries: readJSON('sync_recent_queries', []),
  suggestionItems: [],
  suggestionIndex: -1,
  suggestionTimer: null,
  suggestionAbort: null,
  searchAbort: null,
  progressTimer: null,
  friendRefreshTimer: null,
  googleClientId: '',
  googleToken: sessionStorage.getItem('sync_google_token') || '',
  googleProfile: readJSON('sync_google_profile', null, sessionStorage),
  googleTokenClient: null,
  pendingInvite: null,
  volume: Number(localStorage.getItem('sync_volume') ?? 75),
  mutedVolume: 75,
};

function readJSON(key, fallback, storage = localStorage) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value, storage = localStorage) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* ignored */ }
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'S';
}

function hueForName(name = '') {
  let hash = 0;
  for (const char of name) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${String(mins).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
}

function normalizeSong(song = {}) {
  return {
    videoId: String(song.videoId || ''),
    title: String(song.title || 'Без названия'),
    artist: String(song.artist || 'Неизвестный исполнитель'),
    album: String(song.album || ''),
    duration: String(song.duration || ''),
    durationSeconds: Number(song.durationSeconds || 0) || null,
    thumbnail: String(song.thumbnail || ''),
    isExplicit: Boolean(song.isExplicit),
  };
}

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    if (response.status === 401 && state.token) logout(false);
    throw new Error(data.detail || `Ошибка ${response.status}`);
  }
  return data;
}

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

function createAvatar(name, className = 'person-avatar') {
  const avatar = document.createElement('span');
  avatar.className = className;
  avatar.textContent = initials(name);
  avatar.style.setProperty('--avatar-hue', String(hueForName(name)));
  return avatar;
}

function toast(message, type = 'success', title = type === 'error' ? 'Что-то пошло не так' : 'Готово') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'error' : ''}`;

  const iconWrap = document.createElement('span');
  iconWrap.className = 'toast-icon';
  iconWrap.appendChild(icon(type === 'error' ? 'i-x' : 'i-check'));

  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const text = document.createElement('span');
  text.textContent = message;
  copy.append(strong, text);
  item.append(iconWrap, copy);
  $('toastContainer').appendChild(item);

  window.setTimeout(() => {
    item.classList.add('leaving');
    window.setTimeout(() => item.remove(), 250);
  }, 3300);
}

function setBusy(button, busy, label = 'Загрузка...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
  }
}

// ---------- Authentication ----------
function selectAuthMode(mode) {
  state.authMode = mode;
  const isLogin = mode === 'login';
  $('loginTab').classList.toggle('active', isLogin);
  $('registerTab').classList.toggle('active', !isLogin);
  $('authTitle').textContent = isLogin ? 'С возвращением' : 'Создай аккаунт';
  $('authSubtitle').textContent = isLogin ? 'Войди и продолжи слушать вместе' : 'Пара минут — и можно звать друзей';
  $('authSubmit').querySelector('span').textContent = isLogin ? 'Войти' : 'Зарегистрироваться';
  $('passwordInput').autocomplete = isLogin ? 'current-password' : 'new-password';
  $('authError').textContent = '';
}

async function submitAuth(event) {
  event.preventDefault();
  const username = $('usernameInput').value.trim();
  const password = $('passwordInput').value;
  const error = $('authError');
  error.textContent = '';

  if (username.length < 3) {
    error.textContent = 'Имя должно содержать минимум 3 символа';
    return;
  }
  if (password.length < 6) {
    error.textContent = 'Пароль должен содержать минимум 6 символов';
    return;
  }

  const button = $('authSubmit');
  button.disabled = true;
  try {
    const data = await api(`/api/${state.authMode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    state.token = data.token;
    state.username = data.username;
    const storage = $('rememberMe').checked ? localStorage : sessionStorage;
    localStorage.removeItem('sync_token');
    localStorage.removeItem('sync_username');
    sessionStorage.removeItem('sync_token');
    sessionStorage.removeItem('sync_username');
    storage.setItem('sync_token', state.token);
    storage.setItem('sync_username', state.username);
    await enterApp();
  } catch (errorValue) {
    error.textContent = errorValue.message;
  } finally {
    button.disabled = false;
  }
}

function logout(showMessage = true) {
  state.token = null;
  state.username = null;
  if (state.ws) state.ws.close();
  ['sync_token', 'sync_username'].forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  if (showMessage) location.reload();
  else {
    $('appScreen').classList.add('hidden');
    $('authScreen').classList.remove('hidden');
    $('authError').textContent = 'Сессия закончилась. Войди снова.';
  }
}

async function restoreSession() {
  if (!state.token || !state.username) return;
  try {
    const data = await api(`/api/me?token=${encodeURIComponent(state.token)}`);
    state.username = data.username;
    await enterApp();
  } catch {
    logout(false);
  }
}

async function enterApp() {
  $('authScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');
  $('sidebarUsername').textContent = state.username;
  $('sidebarAvatar').textContent = initials(state.username);
  $('welcomeTitle').textContent = `Привет, ${state.username}!`;
  renderRecent();
  renderQueue();
  updatePlayerUI();
  await Promise.allSettled([loadPublicConfig(), refreshFriends()]);
  connectWebSocket();
  loadYouTubeIframeAPI();
  clearInterval(state.friendRefreshTimer);
  state.friendRefreshTimer = window.setInterval(refreshFriends, 15000);
}

// ---------- Views and responsive navigation ----------
function setView(viewName) {
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === viewName));
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (viewName === 'search') window.setTimeout(() => $('searchInput').focus(), 120);
}

function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebarBackdrop').classList.add('show');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.remove('show');
}

// ---------- Friends ----------
async function refreshFriends() {
  if (!state.token) return;
  try {
    const data = await api(`/api/friends/list?token=${encodeURIComponent(state.token)}`);
    state.friends = data.friends || [];
    state.pending = data.pending_requests || [];
    renderFriends();
    renderPending();
    renderInviteFriends();
    updateHomeStats();
  } catch (errorValue) {
    console.error(errorValue);
  }
}

function updateHomeStats() {
  $('friendCount').textContent = String(state.friends.length);
  $('onlineCount').textContent = String(state.friends.filter((friend) => friend.online).length);
  $('friendBadge').textContent = String(state.pending.length);
  $('friendBadge').classList.toggle('hidden', state.pending.length === 0);
  $('roomStat').textContent = state.room ? state.room.room_code : 'Нет комнаты';
  $('roomLiveDot').classList.toggle('hidden', !state.room);
  $('roomShortcutText').textContent = state.room ? state.room.room_code : 'Не подключена';
}

function renderFriends() {
  const list = $('friendsList');
  list.replaceChildren();
  $('friendsCountLabel').textContent = String(state.friends.length);
  $('friendsEmpty').classList.toggle('hidden', state.friends.length > 0);

  state.friends.forEach((friend) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.appendChild(createAvatar(friend.username));

    const meta = document.createElement('div');
    meta.className = 'person-meta';
    const name = document.createElement('strong');
    name.textContent = friend.username;
    const status = document.createElement('span');
    status.innerHTML = `<i class="status-dot ${friend.online ? 'online' : 'offline'}"></i>${friend.online ? 'Сейчас онлайн' : 'Не в сети'}`;
    meta.append(name, status);

    const actions = document.createElement('div');
    actions.className = 'person-actions';
    const invite = document.createElement('button');
    invite.className = 'button button-soft button-small';
    invite.textContent = state.room ? 'Пригласить' : 'Комната';
    invite.disabled = !friend.online;
    invite.addEventListener('click', async () => {
      if (!state.room) {
        await createRoom();
      }
      if (state.room) inviteFriend(friend.username, invite);
    });
    actions.appendChild(invite);
    row.append(meta, actions);
    list.appendChild(row);
  });
}

function renderPending() {
  const list = $('pendingList');
  list.replaceChildren();
  $('pendingSection').classList.toggle('hidden', state.pending.length === 0);
  $('pendingCount').textContent = String(state.pending.length);

  state.pending.forEach((username) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.appendChild(createAvatar(username));

    const meta = document.createElement('div');
    meta.className = 'person-meta';
    const name = document.createElement('strong');
    name.textContent = username;
    const status = document.createElement('span');
    status.textContent = 'Хочет добавить тебя в друзья';
    meta.append(name, status);

    const accept = document.createElement('button');
    accept.className = 'button button-primary button-small';
    accept.textContent = 'Принять';
    accept.addEventListener('click', async () => {
      setBusy(accept, true, '...');
      try {
        await api('/api/friends/accept', {
          method: 'POST',
          body: JSON.stringify({ token: state.token, from_username: username }),
        });
        toast(`${username} теперь в друзьях`);
        await refreshFriends();
      } catch (errorValue) {
        toast(errorValue.message, 'error');
        setBusy(accept, false);
      }
    });
    row.append(meta, accept);
    list.appendChild(row);
  });
}

async function addFriend() {
  const input = $('addFriendInput');
  const username = input.value.trim();
  const message = $('friendMessage');
  message.className = 'inline-message';
  message.textContent = '';
  if (!username) return;

  const button = $('addFriendBtn');
  button.disabled = true;
  try {
    const data = await api('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ token: state.token, to_username: username }),
    });
    input.value = '';
    if (data.status === 'accepted') {
      message.textContent = `Вы с ${username} теперь друзья`;
      await refreshFriends();
    } else {
      message.textContent = `Заявка отправлена пользователю ${username}`;
    }
  } catch (errorValue) {
    message.className = 'inline-message error';
    message.textContent = errorValue.message;
  } finally {
    button.disabled = false;
  }
}

// ---------- Search and suggestions ----------
function saveRecentQuery(query) {
  const clean = query.trim();
  if (!clean) return;
  state.recentQueries = [clean, ...state.recentQueries.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 7);
  writeJSON('sync_recent_queries', state.recentQueries);
}

function hideSuggestions() {
  $('searchSuggestions').classList.add('hidden');
  state.suggestionItems = [];
  state.suggestionIndex = -1;
}

function renderSuggestions(items, mode = 'suggestions') {
  const box = $('searchSuggestions');
  box.replaceChildren();
  state.suggestionItems = items;
  state.suggestionIndex = -1;
  if (!items.length) {
    hideSuggestions();
    return;
  }

  const header = document.createElement('div');
  header.className = 'suggestion-header';
  header.textContent = mode === 'recent' ? 'Недавние запросы' : 'Подсказки YouTube Music';
  box.appendChild(header);

  items.forEach((text, index) => {
    const button = document.createElement('button');
    button.className = 'suggestion-item';
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.appendChild(icon(mode === 'recent' ? 'i-clock' : 'i-search'));
    const value = document.createElement('span');
    value.textContent = text;
    button.appendChild(value);
    if (mode === 'recent') {
      const label = document.createElement('small');
      label.textContent = 'Недавнее';
      button.appendChild(label);
    }
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => runSearch(text));
    button.dataset.index = String(index);
    box.appendChild(button);
  });
  box.classList.remove('hidden');
}

async function fetchSuggestions(query) {
  if (state.suggestionAbort) state.suggestionAbort.abort();
  state.suggestionAbort = new AbortController();
  try {
    const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}&token=${encodeURIComponent(state.token)}`, {
      signal: state.suggestionAbort.signal,
    });
    if (!response.ok) return;
    const data = await response.json();
    if ($('searchInput').value.trim() === query) renderSuggestions(data.suggestions || []);
  } catch (errorValue) {
    if (errorValue.name !== 'AbortError') console.debug('Suggestions unavailable', errorValue);
  }
}

function handleSearchInput() {
  const query = $('searchInput').value.trim();
  $('searchClearBtn').classList.toggle('hidden', query.length === 0);
  clearTimeout(state.suggestionTimer);
  if (!query) {
    renderSuggestions(state.recentQueries, 'recent');
    return;
  }
  if (query.length < 2) {
    hideSuggestions();
    return;
  }
  state.suggestionTimer = window.setTimeout(() => fetchSuggestions(query), 260);
}

function moveSuggestion(direction) {
  const buttons = $$('.suggestion-item', $('searchSuggestions'));
  if (!buttons.length) return;
  state.suggestionIndex = (state.suggestionIndex + direction + buttons.length) % buttons.length;
  buttons.forEach((button, index) => button.classList.toggle('active', index === state.suggestionIndex));
  buttons[state.suggestionIndex].scrollIntoView({ block: 'nearest' });
}

function handleSearchKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSuggestion(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSuggestion(-1);
  } else if (event.key === 'Escape') {
    hideSuggestions();
    $('searchInput').blur();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const buttons = $$('.suggestion-item', $('searchSuggestions'));
    if (state.suggestionIndex >= 0 && buttons[state.suggestionIndex]) {
      runSearch(state.suggestionItems[state.suggestionIndex]);
    } else {
      runSearch($('searchInput').value);
    }
  }
}

function renderSearchSkeleton() {
  const skeleton = $('searchSkeleton');
  skeleton.replaceChildren();
  for (let index = 0; index < 7; index += 1) {
    const row = document.createElement('div');
    row.className = 'skeleton-row';
    skeleton.appendChild(row);
  }
}

async function runSearch(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return;
  $('searchInput').value = query;
  $('searchClearBtn').classList.remove('hidden');
  hideSuggestions();
  setView('search');
  saveRecentQuery(query);
  $('searchDescription').textContent = `Ищем «${query}»`;
  $('searchEmpty').classList.add('hidden');
  $('searchResults').replaceChildren();
  renderSearchSkeleton();
  $('searchSkeleton').classList.remove('hidden');

  if (state.searchAbort) state.searchAbort.abort();
  state.searchAbort = new AbortController();
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(state.token)}`, {
      signal: state.searchAbort.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Не удалось выполнить поиск');
    const results = (data.results || []).map(normalizeSong);
    renderSearchResults(results);
    $('searchDescription').textContent = results.length ? `Найдено треков: ${results.length}` : `По запросу «${query}» ничего не найдено`;
  } catch (errorValue) {
    if (errorValue.name !== 'AbortError') {
      $('searchDescription').textContent = errorValue.message;
      $('searchEmpty').classList.remove('hidden');
      toast(errorValue.message, 'error');
    }
  } finally {
    $('searchSkeleton').classList.add('hidden');
  }
}

function renderSearchResults(results) {
  const container = $('searchResults');
  container.replaceChildren();
  $('searchEmpty').classList.toggle('hidden', results.length > 0);
  if (!results.length) return;

  results.forEach((song) => {
    const row = document.createElement('article');
    row.className = 'song-row';

    const index = document.createElement('div');
    index.className = 'song-index';
    const image = document.createElement('img');
    image.src = song.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    const play = document.createElement('button');
    play.className = 'song-hover-play';
    play.setAttribute('aria-label', `Воспроизвести ${song.title}`);
    play.appendChild(icon('i-play'));
    play.addEventListener('click', () => playSong(song));
    index.append(image, play);

    const main = document.createElement('div');
    main.className = 'song-main';
    const title = document.createElement('strong');
    title.textContent = song.title;
    if (song.isExplicit) {
      const badge = document.createElement('i');
      badge.className = 'explicit-badge';
      badge.textContent = 'E';
      title.appendChild(badge);
    }
    const artist = document.createElement('span');
    artist.textContent = song.artist;
    main.append(title, artist);

    const album = document.createElement('div');
    album.className = 'song-album';
    album.textContent = song.album || 'YouTube Music';

    const duration = document.createElement('div');
    duration.className = 'song-duration';
    duration.textContent = song.duration || '—';

    const actions = document.createElement('div');
    actions.className = 'song-actions';
    const open = document.createElement('button');
    open.className = 'icon-button compact';
    open.setAttribute('aria-label', 'Открыть на YouTube');
    open.appendChild(icon('i-external'));
    open.addEventListener('click', () => openYouTubeVideo(song.videoId));
    const add = document.createElement('button');
    add.className = 'icon-button compact';
    add.setAttribute('aria-label', 'Добавить в очередь');
    add.appendChild(icon('i-plus'));
    add.addEventListener('click', () => addToQueue(song));
    actions.append(open, add);

    row.addEventListener('dblclick', () => playSong(song));
    row.append(index, main, album, duration, actions);
    container.appendChild(row);
  });
}

// ---------- Recent tracks ----------
function addRecentTrack(song) {
  if (!song.videoId) return;
  state.recentTracks = [song, ...state.recentTracks.filter((item) => item.videoId !== song.videoId)].slice(0, 8);
  writeJSON('sync_recent_tracks', state.recentTracks);
  renderRecent();
}

function renderRecent() {
  const grid = $('recentGrid');
  grid.replaceChildren();
  const hasRecent = state.recentTracks.length > 0;
  $('recentEmpty').classList.toggle('hidden', hasRecent);
  $('clearRecentBtn').classList.toggle('hidden', !hasRecent);

  state.recentTracks.slice(0, 8).forEach((rawSong) => {
    const song = normalizeSong(rawSong);
    const card = document.createElement('article');
    card.className = 'track-card';
    const cover = document.createElement('div');
    cover.className = 'track-card-cover';
    const image = document.createElement('img');
    image.src = song.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    const play = document.createElement('button');
    play.className = 'track-card-play';
    play.appendChild(icon('i-play'));
    play.addEventListener('click', (event) => { event.stopPropagation(); playSong(song); });
    cover.append(image, play);
    const meta = document.createElement('div');
    meta.className = 'track-card-meta';
    const title = document.createElement('strong');
    title.textContent = song.title;
    const artist = document.createElement('span');
    artist.textContent = song.artist;
    meta.append(title, artist);
    card.append(cover, meta);
    card.addEventListener('click', () => playSong(song));
    grid.appendChild(card);
  });
}

// ---------- Queue ----------
function saveQueue() {
  writeJSON('sync_queue', state.queue);
}

function addToQueue(rawSong, announce = true) {
  const song = normalizeSong(rawSong);
  state.queue.push(song);
  saveQueue();
  renderQueue();
  if (announce) toast(`${song.title} добавлен в очередь`);
}

function removeFromQueue(index) {
  state.queue.splice(index, 1);
  if (index < state.queueIndex) state.queueIndex -= 1;
  if (index === state.queueIndex) state.queueIndex = -1;
  saveQueue();
  renderQueue();
}

function clearQueue() {
  state.queue = [];
  state.queueIndex = -1;
  saveQueue();
  renderQueue();
}

function renderQueue() {
  const list = $('queueList');
  list.replaceChildren();
  $('queueEmpty').classList.toggle('hidden', state.queue.length > 0);
  $('clearQueueBtn').classList.toggle('hidden', state.queue.length === 0);

  state.queue.forEach((rawSong, index) => {
    const song = normalizeSong(rawSong);
    const item = document.createElement('div');
    item.className = `queue-item ${index === state.queueIndex ? 'current' : ''}`;
    const image = document.createElement('img');
    image.src = song.thumbnail;
    image.alt = '';
    const meta = document.createElement('div');
    meta.className = 'queue-item-meta';
    const title = document.createElement('strong');
    title.textContent = song.title;
    const artist = document.createElement('span');
    artist.textContent = song.artist;
    meta.append(title, artist);
    const remove = document.createElement('button');
    remove.className = 'queue-remove';
    remove.setAttribute('aria-label', 'Удалить из очереди');
    remove.appendChild(icon('i-x'));
    remove.addEventListener('click', (event) => { event.stopPropagation(); removeFromQueue(index); });
    item.addEventListener('click', () => {
      state.queueIndex = index;
      playSong(song, { queueIndex: index });
    });
    item.append(image, meta, remove);
    list.appendChild(item);
  });
}

function playNext() {
  if (!state.queue.length) {
    toast('Добавь треки в очередь', 'error', 'Очередь пустая');
    return;
  }
  let nextIndex = state.queueIndex + 1;
  if (nextIndex < 0 || nextIndex >= state.queue.length) nextIndex = 0;
  state.queueIndex = nextIndex;
  playSong(state.queue[nextIndex], { queueIndex: nextIndex });
}

function playPrevious() {
  if (state.playerReady && state.player.getCurrentTime() > 5) {
    state.player.seekTo(0, true);
    sendSync(state.isPlaying ? 'playing' : 'paused');
    return;
  }
  if (!state.queue.length) return;
  let previousIndex = state.queueIndex - 1;
  if (previousIndex < 0) previousIndex = state.queue.length - 1;
  state.queueIndex = previousIndex;
  playSong(state.queue[previousIndex], { queueIndex: previousIndex });
}

// ---------- Player ----------
function loadYouTubeIframeAPI() {
  if (window.YT?.Player) {
    initializePlayer();
    return;
  }
  if (document.querySelector('script[data-youtube-api]')) return;
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.dataset.youtubeApi = 'true';
  document.head.appendChild(script);
}

window.onYouTubeIframeAPIReady = initializePlayer;

function initializePlayer() {
  if (state.player || !$('youtubePlayer')) return;
  state.player = new YT.Player('youtubePlayer', {
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 0,
      controls: 0,
      rel: 0,
      playsinline: 1,
      enablejsapi: 1,
      origin: window.location.origin,
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        state.player.setVolume(state.volume);
        $('playerConnectionBadge').classList.add('ready');
        $('playerConnectionBadge').innerHTML = '<i></i> Плеер готов';
        clearInterval(state.progressTimer);
        state.progressTimer = window.setInterval(updateProgress, 300);
        updateProgress();
      },
      onStateChange: handlePlayerState,
      onError: (event) => toast(`YouTube Player: ошибка ${event.data}`, 'error'),
      onAutoplayBlocked: () => toast('Нажми Play — браузер заблокировал автозапуск', 'error', 'Нужен клик'),
    },
  });
}

function playSong(rawSong, options = {}) {
  const song = normalizeSong(rawSong);
  if (!song.videoId) return;
  state.currentSong = song;
  state.currentVideoId = song.videoId;
  if (Number.isInteger(options.queueIndex)) state.queueIndex = options.queueIndex;
  renderQueue();
  updatePlayerUI();
  addRecentTrack(song);
  $('videoPlaceholder').classList.add('hidden');

  if (!state.playerReady) {
    toast('Плеер ещё загружается. Попробуй через секунду.', 'error');
    return;
  }

  state.applyingRemote = Boolean(options.remote);
  const startSeconds = Number(options.startTime || 0);
  if (options.autoplay === false) {
    state.player.cueVideoById({ videoId: song.videoId, startSeconds });
  } else {
    state.player.loadVideoById({ videoId: song.videoId, startSeconds });
  }
  if (options.remote && options.state === 'paused') {
    window.setTimeout(() => state.player.pauseVideo(), 120);
  }
  if (!options.remote && state.room) {
    window.setTimeout(() => sendSync('playing'), 450);
  }
  window.setTimeout(() => { state.applyingRemote = false; }, 900);
}

function handlePlayerState(event) {
  const YTState = window.YT?.PlayerState;
  if (!YTState) return;
  if (event.data === YTState.PLAYING) state.isPlaying = true;
  if (event.data === YTState.PAUSED || event.data === YTState.ENDED || event.data === YTState.CUED) state.isPlaying = false;
  updatePlayButton();
  updateMediaSessionPlayback();

  if (event.data === YTState.ENDED) {
    if (state.queue.length) playNext();
    return;
  }
  if (!state.applyingRemote && state.room && (event.data === YTState.PLAYING || event.data === YTState.PAUSED)) {
    sendSync(event.data === YTState.PLAYING ? 'playing' : 'paused');
  }
}

function togglePlayback() {
  if (!state.playerReady || !state.currentSong) return;
  if (state.isPlaying) state.player.pauseVideo();
  else state.player.playVideo();
}

function updatePlayButton() {
  const button = $('playPauseBtn');
  button.replaceChildren(icon(state.isPlaying ? 'i-pause' : 'i-play'));
  button.setAttribute('aria-label', state.isPlaying ? 'Поставить на паузу' : 'Воспроизвести');
}

function updateProgress() {
  if (!state.playerReady || !state.player || !state.currentSong) return;
  const current = Number(state.player.getCurrentTime?.() || 0);
  const duration = Number(state.player.getDuration?.() || 0);
  $('currentTime').textContent = formatTime(current);
  $('durationTime').textContent = formatTime(duration);
  if (!state.playerSeeking) {
    const value = duration > 0 ? Math.round((current / duration) * 1000) : 0;
    $('seekBar').value = String(value);
    setRangeProgress($('seekBar'), value / 10);
  }
  if ('mediaSession' in navigator && duration > 0 && current >= 0 && current <= duration) {
    try { navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.min(current, duration) }); } catch { /* ignored */ }
  }
}

function setRangeProgress(input, percent) {
  input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, percent))}%`);
}

function updatePlayerUI() {
  const song = state.currentSong;
  const hasSong = Boolean(song?.videoId);
  const title = hasSong ? song.title : 'Выбери трек';
  const artist = hasSong ? song.artist : 'Sync Music';
  $('dockTitle').textContent = title;
  $('dockArtist').textContent = artist;
  $('railTrackTitle').textContent = hasSong ? song.title : 'Ничего не играет';
  $('railTrackArtist').textContent = hasSong ? song.artist : 'Найди музыку через поиск';
  $('openVideoBtn').disabled = !hasSong;

  const image = $('dockThumb');
  const fallback = $('dockThumbFallback');
  if (hasSong && song.thumbnail) {
    image.src = song.thumbnail;
    image.alt = `${song.title} — ${song.artist}`;
    image.classList.remove('hidden');
    fallback.classList.add('hidden');
  } else {
    image.removeAttribute('src');
    image.classList.add('hidden');
    fallback.classList.remove('hidden');
  }
  updateMediaSessionMetadata();
}

function openYouTubeVideo(videoId = state.currentVideoId) {
  if (!videoId) return;
  window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, '_blank', 'noopener,noreferrer');
}

function updateMediaSessionMetadata() {
  if (!('mediaSession' in navigator) || !state.currentSong) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.currentSong.title,
      artist: state.currentSong.artist,
      album: state.currentSong.album || 'Sync Music',
      artwork: state.currentSong.thumbnail ? [{ src: state.currentSong.thumbnail, sizes: '512x512' }] : [],
    });
  } catch { /* ignored */ }
}

function updateMediaSessionPlayback() {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
}

function setupMediaSessionActions() {
  if (!('mediaSession' in navigator)) return;
  const actions = {
    play: () => state.player?.playVideo(),
    pause: () => state.player?.pauseVideo(),
    previoustrack: playPrevious,
    nexttrack: playNext,
    seekbackward: (details) => state.player?.seekTo(Math.max(0, state.player.getCurrentTime() - (details.seekOffset || 10)), true),
    seekforward: (details) => state.player?.seekTo(state.player.getCurrentTime() + (details.seekOffset || 10), true),
    seekto: (details) => state.player?.seekTo(details.seekTime, true),
  };
  Object.entries(actions).forEach(([action, handler]) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
  });
}

// ---------- Rooms and WebSocket ----------
function connectWebSocket() {
  if (!state.token) return;
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(state.token)}`);

  state.ws.addEventListener('open', () => {
    state.reconnectAttempt = 0;
    if (state.room?.room_code) joinRoom(state.room.room_code, false);
  });

  state.ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    handleSocketMessage(message);
  });

  state.ws.addEventListener('close', (event) => {
    if (!state.token || event.code === 4401) return;
    clearTimeout(state.wsReconnectTimer);
    const delay = Math.min(12000, 800 * (2 ** state.reconnectAttempt));
    state.reconnectAttempt += 1;
    state.wsReconnectTimer = window.setTimeout(connectWebSocket, delay);
  });
}

function sendSocket(message) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    toast('Соединение с сервером восстанавливается', 'error');
    return false;
  }
  state.ws.send(JSON.stringify(message));
  return true;
}

function handleSocketMessage(message) {
  switch (message.type) {
    case 'connected':
      refreshFriends();
      break;
    case 'friend_request':
      toast(`${message.from} хочет добавить тебя в друзья`, 'success', 'Новая заявка');
      refreshFriends();
      break;
    case 'friend_accepted':
      toast(`${message.by} принял твою заявку`, 'success', 'Теперь вы друзья');
      refreshFriends();
      break;
    case 'room_invite':
      showInviteModal(message.from, message.room_code);
      break;
    case 'room_joined':
      if (message.ok) {
        updateRoom(message);
        toast(`Ты в комнате ${message.room_code}`);
      } else {
        if (state.room?.room_code === message.room_code) clearRoomState();
        toast('Проверь код и попробуй ещё раз', 'error', 'Комната не найдена');
      }
      break;
    case 'room_presence':
      if (state.room?.room_code === message.room_code) updateRoom(message);
      break;
    case 'room_left':
      clearRoomState();
      toast('Ты вышел из комнаты');
      break;
    case 'request_state':
      if (state.currentSong && state.playerReady) sendSync(state.isPlaying ? 'playing' : 'paused');
      break;
    case 'sync':
      applyRemoteSync(message);
      break;
    default:
      break;
  }
}

async function createRoom() {
  const buttons = [$('createRoomBtn'), $('heroCreateRoomBtn')].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const data = await api('/api/rooms/create', {
      method: 'POST',
      body: JSON.stringify({ token: state.token }),
    });
    joinRoom(data.room_code);
    setView('room');
  } catch (errorValue) {
    toast(errorValue.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function joinRoom(rawCode, announceError = true) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (code.length !== 6) {
    if (announceError) toast('Код комнаты содержит 6 символов', 'error');
    return;
  }
  sendSocket({ type: 'join_room', room_code: code });
}

function updateRoom(roomData) {
  state.room = {
    room_code: roomData.room_code,
    host: roomData.host || '',
    members: roomData.members || [],
    online_members: roomData.online_members || roomData.members || [],
  };
  $('roomEmptyPanel').classList.add('hidden');
  $('roomActivePanel').classList.remove('hidden');
  $('roomCodeText').textContent = state.room.room_code;
  $('roomMemberCount').textContent = String(state.room.members.length);
  renderRoomMembers();
  renderInviteFriends();
  updateHomeStats();
  updateSyncStatus();
}

function renderRoomMembers() {
  const container = $('roomMembers');
  container.replaceChildren();
  if (!state.room) return;
  state.room.members.forEach((member) => {
    const chip = document.createElement('span');
    chip.className = 'member-chip';
    chip.appendChild(createAvatar(member));
    const name = document.createElement('span');
    name.textContent = member;
    chip.appendChild(name);
    if (member === state.room.host) {
      const host = document.createElement('span');
      host.className = 'host-badge';
      host.textContent = 'Хост';
      chip.appendChild(host);
    }
    container.appendChild(chip);
  });
}

function renderInviteFriends() {
  const container = $('inviteFriends');
  if (!container) return;
  container.replaceChildren();
  const available = state.friends.filter((friend) => friend.online && !state.room?.members?.includes(friend.username));
  $('inviteEmpty').classList.toggle('hidden', available.length > 0);
  available.forEach((friend) => {
    const row = document.createElement('div');
    row.className = 'person-row';
    row.appendChild(createAvatar(friend.username));
    const meta = document.createElement('div');
    meta.className = 'person-meta';
    const name = document.createElement('strong');
    name.textContent = friend.username;
    const status = document.createElement('span');
    status.innerHTML = '<i class="status-dot online"></i>Готов получить приглашение';
    meta.append(name, status);
    const button = document.createElement('button');
    button.className = 'button button-primary button-small';
    button.textContent = 'Пригласить';
    button.addEventListener('click', () => inviteFriend(friend.username, button));
    row.append(meta, button);
    container.appendChild(row);
  });
}

async function inviteFriend(username, button) {
  if (!state.room) return;
  button.disabled = true;
  try {
    await api('/api/rooms/invite', {
      method: 'POST',
      body: JSON.stringify({ token: state.token, room_code: state.room.room_code, to_username: username }),
    });
    button.textContent = 'Отправлено ✓';
    toast(`Приглашение отправлено пользователю ${username}`);
  } catch (errorValue) {
    button.disabled = false;
    toast(errorValue.message, 'error');
  }
}

function leaveRoom() {
  if (!state.room) return;
  sendSocket({ type: 'leave_room' });
}

function clearRoomState() {
  state.room = null;
  $('roomEmptyPanel').classList.remove('hidden');
  $('roomActivePanel').classList.add('hidden');
  updateHomeStats();
  updateSyncStatus();
}

function sendSync(playbackState = state.isPlaying ? 'playing' : 'paused') {
  if (!state.room || !state.currentSong || !state.playerReady) return;
  sendSocket({
    type: 'sync',
    videoId: state.currentSong.videoId,
    state: playbackState,
    time: Number(state.player.getCurrentTime?.() || 0),
    ts: Date.now(),
    song: state.currentSong,
  });
  updateSyncStatus(`Синхронизировано: ${state.room.room_code}`);
}

function applyRemoteSync(message) {
  if (!state.playerReady || !message.videoId) return;
  const elapsed = Math.max(0, (Date.now() - Number(message.ts || Date.now())) / 1000);
  const targetTime = Math.max(0, Number(message.time || 0) + (message.state === 'playing' ? elapsed : 0));
  const remoteSong = normalizeSong({ ...message.song, videoId: message.videoId });
  state.applyingRemote = true;

  if (message.videoId !== state.currentVideoId) {
    playSong(remoteSong, {
      remote: true,
      startTime: targetTime,
      state: message.state,
      autoplay: message.state === 'playing',
    });
  } else {
    const current = Number(state.player.getCurrentTime?.() || 0);
    if (Math.abs(current - targetTime) > 1.25) state.player.seekTo(targetTime, true);
    if (message.state === 'playing') state.player.playVideo();
    else state.player.pauseVideo();
    window.setTimeout(() => { state.applyingRemote = false; }, 750);
  }
  updateSyncStatus(`${message.sender || 'Друг'} управляет сессией`);
}

function updateSyncStatus(customText = '') {
  const element = $('syncStatus');
  const text = element.querySelector('span');
  if (state.room) {
    element.classList.add('active');
    text.textContent = customText || `Комната ${state.room.room_code}`;
  } else {
    element.classList.remove('active');
    text.textContent = 'Локальное прослушивание';
  }
}

function showInviteModal(from, roomCode) {
  state.pendingInvite = { from, roomCode };
  $('inviteFrom').textContent = from;
  $('inviteRoom').textContent = roomCode;
  $('inviteModal').classList.remove('hidden');
}

function closeInviteModal() {
  state.pendingInvite = null;
  $('inviteModal').classList.add('hidden');
}

// ---------- Google / YouTube account connection ----------
async function loadPublicConfig() {
  try {
    const config = await api('/api/config');
    state.googleClientId = config.googleClientId || '';
  } catch {
    state.googleClientId = '';
  }
  renderGoogleAccount();
}

function renderGoogleAccount() {
  const connected = Boolean(state.googleProfile);
  $('youtubeDisconnected').classList.toggle('hidden', connected);
  $('youtubeConnected').classList.toggle('hidden', !connected);
  if (connected) {
    $('youtubeAccountName').textContent = state.googleProfile.name || state.googleProfile.email || 'Google аккаунт';
    $('youtubeAccountMeta').textContent = state.googleProfile.email || 'YouTube подключён';
    $('youtubeAvatar').src = state.googleProfile.picture || '';
  }
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', reject, { once: true });
    document.head.appendChild(script);
  });
}

async function connectGoogleAccount() {
  if (!state.googleClientId) {
    $('youtubeSetupModal').classList.remove('hidden');
    return;
  }
  try {
    await loadGoogleIdentityScript();
    if (!state.googleTokenClient) {
      state.googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: state.googleClientId,
        scope: 'openid email profile https://www.googleapis.com/auth/youtube.readonly',
        callback: handleGoogleToken,
        error_callback: () => toast('Окно Google было закрыто или вход не удался', 'error'),
      });
    }
    state.googleTokenClient.requestAccessToken({ prompt: state.googleToken ? '' : 'consent' });
  } catch {
    toast('Не удалось загрузить Google Identity Services', 'error');
  }
}

async function handleGoogleToken(response) {
  if (!response?.access_token) {
    toast(response?.error_description || 'Google не вернул токен', 'error');
    return;
  }
  state.googleToken = response.access_token;
  sessionStorage.setItem('sync_google_token', state.googleToken);
  try {
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${state.googleToken}` },
    });
    if (!userResponse.ok) throw new Error('Не удалось получить профиль');
    state.googleProfile = await userResponse.json();
    writeJSON('sync_google_profile', state.googleProfile, sessionStorage);
    renderGoogleAccount();
    toast('Google/YouTube аккаунт подключён');
  } catch (errorValue) {
    toast(errorValue.message, 'error');
  }
}

function disconnectGoogleAccount() {
  const finish = () => {
    state.googleToken = '';
    state.googleProfile = null;
    sessionStorage.removeItem('sync_google_token');
    sessionStorage.removeItem('sync_google_profile');
    renderGoogleAccount();
    toast('YouTube аккаунт отключён');
  };
  if (state.googleToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(state.googleToken, finish);
  } else {
    finish();
  }
}

// ---------- Bind UI ----------
function bindEvents() {
  $('loginTab').addEventListener('click', () => selectAuthMode('login'));
  $('registerTab').addEventListener('click', () => selectAuthMode('register'));
  $('authForm').addEventListener('submit', submitAuth);
  $('passwordToggle').addEventListener('click', () => {
    const input = $('passwordInput');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('passwordToggle').textContent = show ? 'Скрыть' : 'Показать';
  });
  $('logoutBtn').addEventListener('click', () => logout(true));

  $$('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-view-link]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); setView(link.dataset.viewLink); }));
  $$('[data-open-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.openView)));
  $('mobileMenuBtn').addEventListener('click', openSidebar);
  $('closeSidebarBtn').addEventListener('click', closeSidebar);
  $('sidebarBackdrop').addEventListener('click', closeSidebar);
  $('roomShortcut').addEventListener('click', () => setView('room'));
  $('heroSearchBtn').addEventListener('click', () => setView('search'));

  $('searchInput').addEventListener('input', handleSearchInput);
  $('searchInput').addEventListener('keydown', handleSearchKeydown);
  $('searchInput').addEventListener('focus', () => {
    if (!$('searchInput').value.trim()) renderSuggestions(state.recentQueries, 'recent');
    else handleSearchInput();
  });
  $('searchClearBtn').addEventListener('click', () => {
    $('searchInput').value = '';
    $('searchClearBtn').classList.add('hidden');
    $('searchInput').focus();
    renderSuggestions(state.recentQueries, 'recent');
  });
  document.addEventListener('click', (event) => {
    if (!$('searchShell').contains(event.target)) hideSuggestions();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('searchInput').focus();
      $('searchInput').select();
    }
  });

  $('addFriendBtn').addEventListener('click', addFriend);
  $('addFriendInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') addFriend(); });

  $('createRoomBtn').addEventListener('click', createRoom);
  $('heroCreateRoomBtn').addEventListener('click', createRoom);
  $('joinRoomBtn').addEventListener('click', () => joinRoom($('joinRoomInput').value));
  $('joinRoomInput').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  $('joinRoomInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(event.target.value); });
  $('copyRoomCodeBtn').addEventListener('click', async () => {
    if (!state.room) return;
    try {
      await navigator.clipboard.writeText(state.room.room_code);
      toast('Код комнаты скопирован');
    } catch {
      toast(`Код: ${state.room.room_code}`);
    }
  });
  $('leaveRoomBtn').addEventListener('click', leaveRoom);

  $('joinInviteBtn').addEventListener('click', () => {
    if (state.pendingInvite) joinRoom(state.pendingInvite.roomCode);
    closeInviteModal();
    setView('room');
  });
  $('declineInviteBtn').addEventListener('click', closeInviteModal);
  $('closeInviteModalBtn').addEventListener('click', closeInviteModal);
  $('inviteModal').addEventListener('click', (event) => { if (event.target === $('inviteModal')) closeInviteModal(); });

  $('playPauseBtn').addEventListener('click', togglePlayback);
  $('prevBtn').addEventListener('click', playPrevious);
  $('nextBtn').addEventListener('click', playNext);
  $('openVideoBtn').addEventListener('click', () => openYouTubeVideo());
  $('seekBar').addEventListener('pointerdown', () => { state.playerSeeking = true; });
  $('seekBar').addEventListener('input', () => {
    const duration = Number(state.player?.getDuration?.() || 0);
    const percent = Number($('seekBar').value) / 10;
    setRangeProgress($('seekBar'), percent);
    $('currentTime').textContent = formatTime(duration * percent / 100);
  });
  $('seekBar').addEventListener('change', () => {
    const duration = Number(state.player?.getDuration?.() || 0);
    const target = duration * Number($('seekBar').value) / 1000;
    state.player?.seekTo(target, true);
    state.playerSeeking = false;
    sendSync(state.isPlaying ? 'playing' : 'paused');
  });
  $('seekBar').addEventListener('pointerup', () => { state.playerSeeking = false; });
  $('volumeSlider').value = String(state.volume);
  setRangeProgress($('volumeSlider'), state.volume);
  $('volumeSlider').addEventListener('input', () => {
    state.volume = Number($('volumeSlider').value);
    localStorage.setItem('sync_volume', String(state.volume));
    state.player?.setVolume(state.volume);
    if (state.volume > 0) state.player?.unMute();
    setRangeProgress($('volumeSlider'), state.volume);
    updateVolumeButton();
  });
  $('volumeBtn').addEventListener('click', () => {
    if (state.volume > 0) {
      state.mutedVolume = state.volume;
      state.volume = 0;
      state.player?.mute();
    } else {
      state.volume = state.mutedVolume || 75;
      state.player?.unMute();
      state.player?.setVolume(state.volume);
    }
    $('volumeSlider').value = String(state.volume);
    localStorage.setItem('sync_volume', String(state.volume));
    setRangeProgress($('volumeSlider'), state.volume);
    updateVolumeButton();
  });

  $('clearQueueBtn').addEventListener('click', clearQueue);
  $('clearRecentBtn').addEventListener('click', () => {
    state.recentTracks = [];
    writeJSON('sync_recent_tracks', []);
    renderRecent();
  });

  $('youtubeConnectBtn').addEventListener('click', connectGoogleAccount);
  $('youtubeDisconnectBtn').addEventListener('click', disconnectGoogleAccount);
  $('openYoutubeBtn').addEventListener('click', () => {
    window.open('https://music.youtube.com/', '_blank', 'noopener,noreferrer');
    toast('Войди в YouTube в этом же браузере и вернись в Sync Music', 'success', 'Открыт YouTube Music');
  });
  $('closeYoutubeSetupBtn').addEventListener('click', () => $('youtubeSetupModal').classList.add('hidden'));
  $('youtubeSetupModal').addEventListener('click', (event) => { if (event.target === $('youtubeSetupModal')) $('youtubeSetupModal').classList.add('hidden'); });
  $('openYoutubeSetupDocsBtn').addEventListener('click', () => window.open('/README.md', '_blank', 'noopener'));
}

function updateVolumeButton() {
  $('volumeBtn').replaceChildren(icon(state.volume === 0 ? 'i-volume-off' : 'i-volume'));
}

async function init() {
  bindEvents();
  selectAuthMode('login');
  renderSearchSkeleton();
  renderRecent();
  renderQueue();
  updatePlayerUI();
  updatePlayButton();
  updateVolumeButton();
  setupMediaSessionActions();
  await restoreSession();
}

init();
