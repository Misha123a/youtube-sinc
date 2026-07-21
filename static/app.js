'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name) => `<svg><use href="#i-${name}"></use></svg>`;
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

const storage = {
  get(key, fallback = null) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  remove(key) { localStorage.removeItem(key); }
};

const state = {
  token: storage.get('sync.session')?.token || '',
  username: storage.get('sync.session')?.username || '',
  remember: true,
  config: {},
  ws: null,
  wsRetry: null,
  roomCode: storage.get('sync.roomCode', ''),
  roomHost: '',
  members: [],
  friends: [],
  pending: [],
  queue: [],
  autoAdvancePending: false,
  autoAdvanceTrackId: null,
  currentQueueId: storage.get('sync.playerState', {})?.currentQueueId || null,
  localQueue: storage.get('sync.localQueue', []),
  currentSong: storage.get('sync.playerState', {})?.song || null,
  player: null,
  playerReady: false,
  playing: false,
  suppressPlayerEvent: false,
  searchAbort: null,
  suggestionTimer: null,
  suggestionIndex: -1,
  suggestions: [],
  googleToken: sessionStorage.getItem('sync.googleToken') || '',
  googleProfile: storage.get('sync.googleProfile', null),
  googleClient: null,
  googleConnecting: false,
  library: null,
  openPlaylist: null,
  recent: storage.get('sync.recent', []),
  visualSeed: 1,
  lastEndedAt: 0,
  wsGeneration: 0,
  lastRoomSyncAt: 0,
  pendingInvite: null,
  friendsPollTimer: null,
  friendsLoading: false,
};

const els = {};
const bindElements = () => {
  [
    'authScreen','appScreen','authForm','authTitle','authSubtitle','authSubmit','authError','loginTab','registerTab','usernameInput','passwordInput','passwordToggle',
    'sidebar','sidebarBackdrop','closeSidebarBtn','mobileMenuBtn','sidebarUsername','sidebarAvatar','logoutBtn','friendBadge','roomLiveDot',
    'youtubeDisconnected','youtubeConnected','youtubeConnectBtn','youtubeDisconnectBtn','youtubeAvatar','youtubeAccountName','youtubeAccountMeta','refreshLibraryBtn','libraryRefreshTopBtn','homeConnectBtn','libraryConnectBtn','openYoutubeBtn',
    'searchInput','searchClearBtn','suggestionsBox','connectionDot','connectionText','searchHeading','searchLoading','searchEmpty','searchResults',
    'homeEmpty','homeRecommendations','recentTracks','libraryConnectPrompt','libraryLoading','libraryContent','playlistGrid','likedGrid','subscriptionList','addLikedBtn','playLikedBtn',
    'friendInput','friendAddBtn','requestList','requestCount','friendList','friendsCount',
    'roomOffline','roomOnline','createRoomBtn','roomCodeInput','joinRoomBtn','roomCodeLabel','copyRoomBtn','roomHostLabel','leaveRoomBtn','memberList','memberCount','inviteList',
    'queueDrawer','queueBackdrop','queueBtn','closeQueueBtn','queueList','queueCount','clearQueueBtn',
    'playlistModal','playlistModalTitle','closePlaylistBtn','playlistAddAllBtn','playlistPlayAllBtn','playlistModalList',
    'playerCover','playerCoverImg','playerTitle','playerArtist','prevBtn','playPauseBtn','playPauseIcon','nextBtn','seekBar','currentTime','durationTime','volumeBar','youtubePlayer','toastStack','visualizerCanvas'
  ].forEach((id) => els[id] = document.getElementById(id));
};

const toast = (message, type = '') => {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toastStack.append(node);
  setTimeout(() => node.remove(), 3600);
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* no-op */ }
  if (!response.ok) throw new Error(payload.detail || `Ошибка ${response.status}`);
  return payload;
};

const googleApi = (path) => api(path, { headers: { Authorization: `Bearer ${state.googleToken}` }});
const sendWS = (payload) => {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload));
  else toast('Соединение с комнатой восстанавливается', 'error');
};
const svgUse = (name) => `<use href="#i-${name}"></use>`;
const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
};
const initials = (name = 'S') => name.trim().split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase() || 'S';
const imageAvatar = (profile, className = 'avatar-img') => {
  const avatarUrl = profile?.avatar || profile?.avatar_url || profile?.picture || '';
  const displayName = profile?.displayName || profile?.display_name || profile?.username || '?';
  const fallback = `<div class="avatar-fallback" style="${avatarUrl ? 'display:none' : ''}">${escapeHtml(initials(displayName))}</div>`;

  if (!avatarUrl) return fallback;

  return `<img
    class="${className}"
    src="${escapeHtml(avatarUrl)}"
    alt="${escapeHtml(displayName)}"
    referrerpolicy="no-referrer"
    onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex';"
  >${fallback}`;
};

function setAuthMode(register) {
  state.registerMode = register;
  els.loginTab.classList.toggle('active', !register);
  els.registerTab.classList.toggle('active', register);
  els.authTitle.textContent = register ? 'Создать аккаунт' : 'Войти в аккаунт';
  els.authSubtitle.textContent = register ? 'Выбери ник для Sync Music' : 'Продолжи слушать музыку вместе';
  els.authSubmit.textContent = register ? 'Зарегистрироваться' : 'Войти';
  els.passwordInput.autocomplete = register ? 'new-password' : 'current-password';
  els.authError.textContent = '';
}

async function handleAuth(event) {
  event.preventDefault();
  els.authError.textContent = '';
  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;
  try {
    const result = await api(state.registerMode ? '/api/register' : '/api/login', {
      method:'POST', body: JSON.stringify({username, password})
    });
    state.token = result.token;
    state.username = result.username;
    storage.set('sync.session', result);
    showApp();
  } catch (error) { els.authError.textContent = error.message; }
}

async function showApp() {
  els.authScreen.classList.add('hidden');
  els.appScreen.classList.remove('hidden');
  els.sidebarUsername.textContent = state.username;
  updateUserAvatar();
  await loadConfig();
  connectWebSocket();
  await Promise.allSettled([loadMe(), loadFriends()]);
  startFriendsPolling();
  renderRecent();
  renderQueue();
  if (state.googleToken) await restoreGoogle();
  else if (state.googleProfile) applyGoogleProfile(state.googleProfile, false);
}

function showAuthAfterExpiredSession(message = 'Сессия Sync Music истекла после перезапуска сервера. Войди заново.') {
  state.wsRetry && clearTimeout(state.wsRetry);
  stopFriendsPolling();
  state.ws?.close();
  storage.remove('sync.session');
  sessionStorage.removeItem('sync.googleToken');
  state.token = '';
  state.username = '';
  state.googleToken = '';
  els.appScreen.classList.add('hidden');
  els.authScreen.classList.remove('hidden');
  els.authError.textContent = message;
}

function logout() {
  stopFriendsPolling();
  state.ws?.close();
  storage.remove('sync.session');
  state.token = '';
  state.username = '';
  location.reload();
}

async function loadConfig() {
  state.config = await api('/api/config');
  if (!state.config.youtubeOAuthEnabled) {
    els.youtubeConnectBtn.disabled = true;
    els.youtubeConnectBtn.textContent = 'OAuth не настроен';
  }
}

async function loadMe() {
  const me = await api(`/api/me?token=${encodeURIComponent(state.token)}`);
  els.sidebarUsername.textContent = me.displayName || me.username;
  if (!state.googleProfile && me.avatar) {
    state.googleProfile = {name: me.displayName, picture: me.avatar, avatar: me.avatar};
    updateUserAvatar();
  }
}

function connectWebSocket() {
  clearTimeout(state.wsRetry);
  const generation=++state.wsGeneration;
  const previous=state.ws;
  if(previous && previous.readyState<2){previous.onclose=null;previous.close();}
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws=socket;
  setConnection(false, 'Подключение…');
  socket.onopen = () => {
    if(generation!==state.wsGeneration)return;
    setConnection(true, state.roomCode ? `Комната ${state.roomCode}` : 'Онлайн');
    if (state.roomCode) sendWS({type:'join_room', room_code:state.roomCode});
  };
  socket.onclose = (event) => {
    if(generation!==state.wsGeneration)return;
    if(event.code===4401||event.code===1008){showAuthAfterExpiredSession();return;}
    setConnection(false, 'Нет связи');
    state.wsRetry = setTimeout(connectWebSocket, 1800);
  };
  socket.onerror = () => socket.close();
  socket.onmessage = ({data}) => {
    if(generation!==state.wsGeneration)return;
    try { handleSocketMessage(JSON.parse(data)); } catch (error) { console.error(error); }
  };
}

function setConnection(online, text) {
  els.connectionDot.classList.toggle('online', online);
  els.connectionText.textContent = text;
}

function clearRoomState(message = '') {
  state.roomCode = '';
  state.roomHost = '';
  state.members = [];
  state.queue = [];
  state.currentQueueId = null;
  storage.remove('sync.roomCode');
  renderRoom();
  renderQueue();
  setConnection(Boolean(state.ws?.readyState === WebSocket.OPEN), 'Онлайн');
  if (message) toast(message, 'error');
}

function handleSocketMessage(message) {
  switch (message.type) {
    case 'friend_request': toast(`${message.from} отправил заявку в друзья`); loadFriends(); break;
    case 'friend_accepted': toast(`${message.by} теперь у тебя в друзьях`); loadFriends(); break;
    case 'profile_updated': loadFriends(); break;
    case 'room_invite':
      showRoomInvite(message.from, message.room_code);
      break;
    case 'room_joined':
      if (!message.ok) { clearRoomState('Комната больше не существует'); return; }
      state.roomCode = message.room_code;
      state.roomHost = message.host;
      state.members = message.members || [];
      state.queue = message.queue || [];
      state.currentQueueId = message.currentQueueId || null;
      storage.set('sync.roomCode', state.roomCode);
      renderRoom(); renderQueue();
      setConnection(true, `Комната ${state.roomCode}`);
      toast(`Ты в комнате ${state.roomCode}`);
      break;
    case 'room_presence':
      state.roomHost = message.host;
      state.members = message.members || [];
      if (message.queue) state.queue = message.queue;
      if ('currentQueueId' in message) state.currentQueueId = message.currentQueueId;
      renderRoom(); renderQueue();
      break;
    case 'room_left':
      clearRoomState();
      break;
    case 'room_closed':
    case 'room_deleted':
    case 'host_left':
      clearRoomState(message.reason || 'Хост покинул комнату. Комната закрыта');
      break;
    case 'queue_updated':
      state.queue = message.queue || [];
      state.currentQueueId = message.currentQueueId || null;
      renderQueue();
      if (message.duplicate && message.addedBy === state.username) toast('Этот трек уже есть в очереди');
      break;
    case 'queue_play':
      state.currentQueueId = message.currentQueueId;
      state.autoAdvancePending = false;
      state.autoAdvanceTrackId = message.currentQueueId || message.song?.videoId || null;
      playSongInternal(message.song, true, Math.max(0,(Date.now()-(message.ts||Date.now()))/1000));
      renderQueue();
      break;
    case 'queue_finished': toast('Очередь закончилась'); break;
    case 'sync': applyRemoteSync(message); break;
    case 'request_state': broadcastSync(); break;
  }
}


function showRoomInvite(from, roomCode){
  state.pendingInvite={from,roomCode};
  document.getElementById('roomInviteModal')?.remove();
  const modal=document.createElement('div');
  modal.id='roomInviteModal'; modal.className='invite-modal-backdrop';
  modal.innerHTML=`<div class="invite-modal"><div class="invite-glow"></div><button class="invite-close" aria-label="Закрыть">×</button><div class="invite-icon">${icon('radio')}</div><span class="invite-kicker">Приглашение в комнату</span><h3>${escapeHtml(from)} зовёт слушать вместе</h3><p>Комната <strong>${escapeHtml(roomCode)}</strong>. Ты сразу подключишься к текущему треку и общей очереди.</p><div class="invite-actions"><button class="soft-button invite-decline">Не сейчас</button><button class="primary-button invite-accept">Войти в комнату</button></div></div>`;
  document.body.append(modal);
  const close=()=>{modal.classList.add('closing');setTimeout(()=>modal.remove(),180);};
  modal.querySelector('.invite-close').onclick=close; modal.querySelector('.invite-decline').onclick=close;
  modal.querySelector('.invite-accept').onclick=()=>{close();joinRoom(roomCode);};
  modal.onclick=(e)=>{if(e.target===modal)close();};
}

function switchView(view) {
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  if (view === 'library' && state.googleToken && !state.library) loadLibrary();
  closeSidebar();
}

function openSidebar() { els.sidebar.classList.add('open'); els.sidebarBackdrop.classList.add('open'); }
function closeSidebar() { els.sidebar.classList.remove('open'); els.sidebarBackdrop.classList.remove('open'); }

async function loadFriends() {
  if (!state.token || state.friendsLoading) return;
  state.friendsLoading = true;
  try {
    const data = await api(`/api/friends/list?token=${encodeURIComponent(state.token)}`);
    state.friends = data.friends || [];
    state.pending = data.pending_requests || [];
    els.friendBadge.classList.toggle('hidden', !state.pending.length);
    els.friendBadge.textContent = state.pending.length;
    els.requestCount.textContent = state.pending.length;
    els.friendsCount.textContent = state.friends.length;
    renderPeople();
    renderRoom();
  } catch (error) {
    console.error('Не удалось обновить друзей:', error);
  } finally {
    state.friendsLoading = false;
  }
}

function startFriendsPolling() {
  stopFriendsPolling();
  state.friendsPollTimer = setInterval(() => {
    if (!document.hidden && state.token) loadFriends();
  }, 2500);
}

function stopFriendsPolling() {
  if (state.friendsPollTimer) clearInterval(state.friendsPollTimer);
  state.friendsPollTimer = null;
}

function renderPeople() {
  els.requestList.innerHTML = state.pending.length ? state.pending.map((profile) => `
    <div class="person-row">${imageAvatar(profile)}<div class="person-meta"><strong>${escapeHtml(profile.displayName)}</strong><span>@${escapeHtml(profile.username)}</span></div><button class="primary-button small" data-accept="${escapeHtml(profile.username)}">Принять</button></div>`).join('') : '<p class="muted">Новых заявок нет</p>';
  els.friendList.innerHTML = state.friends.length ? state.friends.map((profile) => `
    <div class="person-row">${imageAvatar(profile)}<div class="person-meta"><strong>${escapeHtml(profile.displayName)}</strong><span>${profile.online ? 'Сейчас онлайн' : `@${escapeHtml(profile.username)}`}</span></div>${state.roomCode && profile.online ? `<button class="soft-button small" data-invite="${escapeHtml(profile.username)}">Позвать</button>` : ''}</div>`).join('') : '<p class="muted">Добавь первого друга</p>';
}

async function addFriend() {
  const target = els.friendInput.value.trim(); if (!target) return;
  try { await api('/api/friends/request',{method:'POST',body:JSON.stringify({token:state.token,to_username:target})}); els.friendInput.value=''; toast('Заявка отправлена'); loadFriends(); }
  catch(error){ toast(error.message,'error'); }
}
async function acceptFriend(username) {
  try { await api('/api/friends/accept',{method:'POST',body:JSON.stringify({token:state.token,from_username:username})}); toast('Заявка принята'); loadFriends(); }
  catch(error){ toast(error.message,'error'); }
}

async function createRoom() {
  try { const result=await api('/api/rooms/create',{method:'POST',body:JSON.stringify({token:state.token})}); joinRoom(result.room_code); }
  catch(error){ toast(error.message,'error'); }
}
function joinRoom(code = els.roomCodeInput.value) {
  const clean=String(code||'').trim().toUpperCase(); if(clean.length!==6){toast('Введи шестизначный код','error');return;}
  sendWS({type:'join_room',room_code:clean});
}
function leaveRoom(){sendWS({type:'leave_room'});}
async function inviteFriend(username){try{await api('/api/rooms/invite',{method:'POST',body:JSON.stringify({token:state.token,room_code:state.roomCode,to_username:username})});toast('Приглашение отправлено');}catch(error){toast(error.message,'error');}}
function renderRoom() {
  const online=Boolean(state.roomCode);
  els.roomOffline.classList.toggle('hidden',online); els.roomOnline.classList.toggle('hidden',!online); els.roomLiveDot.classList.toggle('hidden',!online);
  if(!online)return;
  els.roomCodeLabel.textContent=state.roomCode; els.roomHostLabel.textContent=`Хост: ${state.roomHost}`; els.memberCount.textContent=state.members.length;
  els.memberList.innerHTML=state.members.map((name)=>{const profile=state.friends.find((f)=>f.username.toLowerCase()===name.toLowerCase())||{username:name,displayName:name,avatar:''};return `<div class="person-row">${imageAvatar(profile)}<div class="person-meta"><strong>${escapeHtml(profile.displayName)}</strong><span>${name===state.roomHost?'Хост':'Участник'}</span></div></div>`}).join('');
  const inviteable=state.friends.filter((friend)=>friend.online&&!state.members.some((name)=>name.toLowerCase()===friend.username.toLowerCase()));
  els.inviteList.innerHTML=inviteable.length?inviteable.map((profile)=>`<div class="person-row">${imageAvatar(profile)}<div class="person-meta"><strong>${escapeHtml(profile.displayName)}</strong><span>Онлайн</span></div><button class="soft-button small" data-invite="${escapeHtml(profile.username)}">Позвать</button></div>`).join(''):'<p class="muted">Все друзья уже здесь или офлайн</p>';
}

function initGoogleClient() {
  if (state.googleClient) return state.googleClient;
  if (!state.config.googleClientId || !window.google?.accounts?.oauth2) return null;
  state.googleClient = google.accounts.oauth2.initTokenClient({
    client_id: state.config.googleClientId,
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' '),
    include_granted_scopes: true,
    callback: async (response) => {
      state.googleConnecting = false;
      if (response?.error) {
        console.error('Google OAuth response:', response);
        toast(`Google OAuth: ${response.error_description || response.error}`, 'error');
        return;
      }
      if (!response?.access_token) {
        console.error('Google OAuth returned no access token:', response);
        toast('Google не вернул токен доступа. Попробуй подключить ещё раз.', 'error');
        return;
      }
      state.googleToken = response.access_token;
      sessionStorage.setItem('sync.googleToken', state.googleToken);
      toast('Google подтвердил доступ. Загружаю профиль…');
      await restoreGoogle(true);
    },
    error_callback: (error) => {
      state.googleConnecting = false;
      console.error('Google OAuth popup error:', error);
      const type = error?.type || 'unknown_error';
      const messages = {
        popup_closed: 'Окно Google было закрыто до завершения входа',
        popup_failed_to_open: 'Браузер заблокировал окно Google. Разреши всплывающие окна для localhost',
        unknown_error: 'Не удалось завершить вход Google'
      };
      toast(messages[type] || `Ошибка Google OAuth: ${type}`, 'error');
    }
  });
  return state.googleClient;
}
async function connectGoogle() {
  if (state.googleConnecting) return;
  if (!state.token) {
    toast('Сначала войди в аккаунт Sync Music', 'error');
    showAuthAfterExpiredSession();
    return;
  }
  let client = initGoogleClient();
  if (!client) {
    toast('Google ещё загружается. Повторяю через секунду…');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    client = initGoogleClient();
  }
  if (!client) {
    toast('Google OAuth не загрузился. Обнови страницу через Ctrl+F5', 'error');
    return;
  }
  state.googleConnecting = true;
  client.requestAccessToken({prompt: state.googleToken ? '' : 'consent'});
}
async function restoreGoogle(showToast=false) {
  try {
    const profile=await googleApi(`/api/youtube/profile?token=${encodeURIComponent(state.token)}`);
    state.googleProfile=profile; storage.set('sync.googleProfile',profile); applyGoogleProfile(profile,true);
    await api('/api/profile/google',{method:'POST',body:JSON.stringify({token:state.token,display_name:profile.name,avatar_url:profile.picture,email:profile.email})});
    if(showToast)toast('YouTube-аккаунт подключён');
    await loadLibrary(); await loadFriends();
  } catch(error) {
    const message = String(error.message || '');
    console.error('YouTube connect failed:', error);
    if (message.toLowerCase().includes('сессия sync music')) {
      showAuthAfterExpiredSession(message);
    } else if (message.toLowerCase().includes('google-сессия') || message.includes('Google-сессия')) {
      await disconnectGoogle(false);
      toast('Доступ Google истёк. Подключи YouTube ещё раз.', 'error');
    } else {
      toast(message || 'Не удалось подключить YouTube', 'error');
    }
  }
}
function applyGoogleProfile(profile, connected=true) {
  els.youtubeDisconnected.classList.toggle('hidden',connected);
  els.youtubeConnected.classList.toggle('hidden',!connected);
  els.youtubeAccountName.textContent=profile.name||'YouTube';
  els.youtubeAccountMeta.textContent=profile.channelTitle||profile.email||'Подключено';
  els.youtubeAvatar.src=profile.picture||profile.avatar||'';
  updateUserAvatar();
  els.libraryConnectPrompt.classList.toggle('hidden',connected);
  els.homeEmpty.classList.toggle('hidden',connected&&Boolean(state.library?.recommendations?.length));
}
async function disconnectGoogle(clearServer=true) {
  state.googleToken=''; state.googleProfile=null; state.library=null;
  sessionStorage.removeItem('sync.googleToken'); storage.remove('sync.googleProfile');
  els.youtubeDisconnected.classList.remove('hidden'); els.youtubeConnected.classList.add('hidden');
  els.libraryConnectPrompt.classList.remove('hidden'); els.libraryContent.classList.add('hidden'); els.homeRecommendations.innerHTML=''; els.homeEmpty.classList.remove('hidden');
  updateUserAvatar();
  if(clearServer) await api('/api/profile/google/disconnect',{method:'POST',body:JSON.stringify({token:state.token})}).catch(()=>{});
}
function updateUserAvatar() {
  const source=state.googleProfile?.picture||state.googleProfile?.avatar||'';
  const name=state.googleProfile?.name||state.username||'S';
  if(source){els.sidebarAvatar.outerHTML=`<img id="sidebarAvatar" class="avatar-img" src="${escapeHtml(source)}" alt="">`;els.sidebarAvatar=document.getElementById('sidebarAvatar');}
  else {els.sidebarAvatar.outerHTML=`<div id="sidebarAvatar" class="avatar-fallback">${escapeHtml(initials(name))}</div>`;els.sidebarAvatar=document.getElementById('sidebarAvatar');}
  els.sidebarUsername.textContent=name;
}

async function loadLibrary() {
  if(!state.googleToken)return;
  els.libraryLoading.classList.remove('hidden'); els.libraryContent.classList.add('hidden'); els.libraryConnectPrompt.classList.add('hidden');
  try {
    state.library=await googleApi(`/api/youtube/library?token=${encodeURIComponent(state.token)}`);
    renderLibrary();
  } catch(error) {
    toast(error.message,'error');
    if(error.message.includes('сессия истекла'))disconnectGoogle(false);
  } finally {els.libraryLoading.classList.add('hidden');}
}
function renderLibrary() {
  const lib=state.library||{playlists:[],liked:[],subscriptions:[],recommendations:[],recommendationSections:[]};
  els.libraryContent.classList.remove('hidden');
  els.playlistGrid.innerHTML=lib.playlists.length?lib.playlists.map((list)=>`<article class="playlist-card" data-playlist="${escapeHtml(list.id)}"><div class="playlist-cover">${list.thumbnail?`<img src="${escapeHtml(list.thumbnail)}" alt="">`:icon('library')}</div><strong>${escapeHtml(list.title)}</strong><span>${list.itemCount} треков</span></article>`).join(''):'<p class="muted">Плейлисты не найдены</p>';
  els.likedGrid.innerHTML=lib.liked.length?lib.liked.slice(0,20).map(trackCard).join(''):'<p class="muted">Музыкальных лайков не найдено</p>';
  els.subscriptionList.innerHTML=lib.subscriptions.length?lib.subscriptions.map((channel)=>`<div class="subscription-chip">${channel.thumbnail?`<img class="avatar-img" src="${escapeHtml(channel.thumbnail)}" alt="">`:`<div class="avatar-fallback">${escapeHtml(initials(channel.title))}</div>`}<span>${escapeHtml(channel.title)}</span></div>`).join(''):'<p class="muted">Подписок нет</p>';
  const sections=lib.recommendationSections?.length?lib.recommendationSections:[{title:'Для тебя',subtitle:'Персональная подборка',tracks:lib.recommendations||[]}];
  els.homeRecommendations.innerHTML=sections.filter(section=>section.tracks?.length).map((section)=>`<section class="music-row-section"><div class="row-heading"><div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.subtitle||'')}</p></div></div><div class="music-row">${section.tracks.map(trackCard).join('')}</div></section>`).join('');
  els.homeEmpty.classList.toggle('hidden',Boolean(sections.some(section=>section.tracks?.length)));
}
async function openPlaylist(id) {
  const meta=state.library?.playlists?.find((item)=>item.id===id); if(!meta)return;
  els.playlistModal.classList.remove('hidden'); els.playlistModalTitle.textContent=meta.title; els.playlistModalList.innerHTML='<div class="skeleton-grid"></div>';
  try {
    const data=await googleApi(`/api/youtube/playlists/${encodeURIComponent(id)}?token=${encodeURIComponent(state.token)}`);
    state.openPlaylist={...meta,items:data.items||[]};
    els.playlistModalList.innerHTML=state.openPlaylist.items.length?state.openPlaylist.items.map((song,index)=>`<div class="modal-track" data-song-index="${index}"><img src="${escapeHtml(song.thumbnail||'')}" alt=""><div class="queue-info"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist)}</span></div><button class="icon-button" data-add-index="${index}">${icon('plus')}</button></div>`).join(''):'<p class="muted">Треков нет</p>';
  } catch(error){els.playlistModalList.innerHTML=`<p class="form-error">${escapeHtml(error.message)}</p>`;}
}
function closePlaylist(){els.playlistModal.classList.add('hidden');state.openPlaylist=null;}

function trackCard(song,index=0) {
  const encoded=encodeURIComponent(JSON.stringify(song));
  const active=state.currentSong?.videoId===song.videoId; const playIcon=active&&state.playing?'pause':'play';
  return `<article class="track-card ${active?'is-current':''}" data-video-id="${escapeHtml(song.videoId)}" data-song="${encoded}" style="animation-delay:${Math.min(index,12)*25}ms"><div class="track-thumb">${song.thumbnail?`<img src="${escapeHtml(song.thumbnail)}" loading="lazy" alt="">`:''}<button class="card-play" data-play-song="${encoded}" aria-label="${active&&state.playing?'Пауза':'Воспроизвести'}">${icon(playIcon)}</button><div class="track-actions"><button data-add-song="${encoded}" title="В очередь">${icon('plus')}</button></div></div><div class="track-info"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist)}${song.duration?` · ${escapeHtml(song.duration)}`:''}</span></div></article>`;
}
function updateCardPlayButtons(){
  $$('.track-card[data-video-id]').forEach((card)=>{
    const active=card.dataset.videoId===state.currentSong?.videoId;
    card.classList.toggle('is-current',active);
    const button=card.querySelector('.card-play'); if(!button)return;
    button.innerHTML=icon(active&&state.playing?'pause':'play');
    button.setAttribute('aria-label',active&&state.playing?'Пауза':'Воспроизвести');
  });
}
function persistPlayerState(){
  if(!state.currentSong)return;
  storage.set('sync.playerState',{song:state.currentSong,currentQueueId:state.currentQueueId,time:state.playerReady?(state.player.getCurrentTime?.()||0):0,playing:state.playing,updatedAt:Date.now()});
}
function restorePlayerState(){
  const saved=storage.get('sync.playerState',null); if(!saved?.song?.videoId||state.roomCode)return;
  state.currentQueueId=saved.currentQueueId||null;
  playSongInternal(saved.song,false,Number(saved.time||0));
  state.playing=false; updateCardPlayButtons();
}
function decodeSong(value){try{return JSON.parse(decodeURIComponent(value));}catch{return null;}}

async function runSearch(query) {
  const q=String(query||'').trim(); if(!q)return;
  switchView('search'); els.searchHeading.textContent=`Результаты: ${q}`; els.searchLoading.classList.remove('hidden'); els.searchEmpty.classList.add('hidden'); els.searchResults.innerHTML='';
  state.searchAbort?.abort(); state.searchAbort=new AbortController();
  try {
    const response=await fetch(`/api/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(state.token)}`,{signal:state.searchAbort.signal});
    const data=await response.json(); if(!response.ok)throw new Error(data.detail||'Ошибка поиска');
    els.searchResults.innerHTML=(data.results||[]).map(trackCard).join('');
    els.searchEmpty.classList.toggle('hidden',Boolean(data.results?.length));
  } catch(error){if(error.name!=='AbortError')toast(error.message,'error');}
  finally{els.searchLoading.classList.add('hidden');hideSuggestions();}
}
function scheduleSuggestions() {
  clearTimeout(state.suggestionTimer); const q=els.searchInput.value.trim(); els.searchClearBtn.classList.toggle('hidden',!q);
  if(q.length<2){hideSuggestions();return;}
  state.suggestionTimer=setTimeout(async()=>{try{const data=await api(`/api/search/suggestions?q=${encodeURIComponent(q)}&token=${encodeURIComponent(state.token)}`);state.suggestions=data.suggestions||[];state.suggestionIndex=-1;renderSuggestions();}catch{hideSuggestions();}},260);
}
function renderSuggestions(){if(!state.suggestions.length){hideSuggestions();return;}els.suggestionsBox.innerHTML=state.suggestions.map((text,index)=>`<button class="suggestion-item" data-suggestion="${escapeHtml(text)}" data-index="${index}">${icon('search')}<span>${escapeHtml(text)}</span></button>`).join('');els.suggestionsBox.classList.remove('hidden');}
function hideSuggestions(){els.suggestionsBox.classList.add('hidden');state.suggestionIndex=-1;}
function moveSuggestion(delta){if(!state.suggestions.length)return;state.suggestionIndex=(state.suggestionIndex+delta+state.suggestions.length)%state.suggestions.length;$$('.suggestion-item',els.suggestionsBox).forEach((item,index)=>item.classList.toggle('active',index===state.suggestionIndex));els.searchInput.value=state.suggestions[state.suggestionIndex];}

function addRecent(song) {
  state.recent=[song,...state.recent.filter((item)=>item.videoId!==song.videoId)].slice(0,18); storage.set('sync.recent',state.recent); renderRecent();
}
function renderRecent(){els.recentTracks.innerHTML=state.recent.length?state.recent.map(trackCard).join(''):'<p class="muted">Здесь появятся прослушанные треки</p>';}

function addSong(song, playNow=false) {
  if(!song?.videoId)return;
  if(state.roomCode){sendWS({type:'queue_add',song,playNow});return;}
  let item=state.localQueue.find((entry)=>entry.videoId===song.videoId);
  if(!item){item={...song,id:crypto.randomUUID().slice(0,12),addedBy:state.username,votes:0};state.localQueue.push(item);smartLocalQueue();saveLocalQueue();}
  if(playNow){state.currentQueueId=item.id;playSongInternal(item,true,0);}renderQueue();
}
function smartLocalQueue(){if(state.localQueue.length<3)return;const current=state.localQueue.findIndex((item)=>item.id===state.currentQueueId);const prefix=current>=0?state.localQueue.slice(0,current+1):[];const rest=current>=0?state.localQueue.slice(current+1):[...state.localQueue];const ordered=[];let lastArtist=prefix.at(-1)?.artist||'';while(rest.length){rest.sort((a,b)=>(a.artist===lastArtist)-(b.artist===lastArtist));const item=rest.shift();ordered.push(item);lastArtist=item.artist;}state.localQueue=[...prefix,...ordered];}
function saveLocalQueue(){storage.set('sync.localQueue',state.localQueue);}
function activeQueue(){return state.roomCode?state.queue:state.localQueue;}
async function nextTrack(direction=1){
  if(state.roomCode){sendWS({type:direction>0?'queue_next':'queue_prev',expectedCurrentId:state.currentQueueId||null});return;}
  let queue=state.localQueue;if(!queue.length)return;
  let index=queue.findIndex((item)=>item.id===state.currentQueueId);if(index<0)index=0;
  let target=index+direction;
  if(direction>0&&target>=queue.length){
    const seed=[state.currentSong?.artist,state.currentSong?.title].filter(Boolean).join(' ');
    if(seed){try{const data=await api(`/api/search?q=${encodeURIComponent(seed)}&token=${encodeURIComponent(state.token)}`);for(const song of data.results||[]){if(!state.localQueue.some(item=>item.videoId===song.videoId)){state.localQueue.push({...song,id:crypto.randomUUID().slice(0,12),addedBy:'Умная очередь',votes:0,source:'smart_radio'});}if(state.localQueue.length>=index+7)break;}smartLocalQueue();saveLocalQueue();queue=state.localQueue;target=index+1;}catch(error){toast('Не удалось продолжить умную очередь','error');}}
  }
  if(target<0||target>=queue.length){toast('Больше треков нет');return;}
  state.currentQueueId=queue[target].id;playSongInternal(queue[target],true,0);renderQueue();
}
function playQueueItem(id){if(state.roomCode)sendWS({type:'queue_play',itemId:id});else{const item=state.localQueue.find((entry)=>entry.id===id);if(item){state.currentQueueId=id;playSongInternal(item,true,0);renderQueue();}}}
function removeQueueItem(id){if(state.roomCode)sendWS({type:'queue_remove',itemId:id});else{state.localQueue=state.localQueue.filter((item)=>item.id!==id);saveLocalQueue();renderQueue();}}
function clearQueue(){if(state.roomCode)sendWS({type:'queue_clear'});else{const current=state.localQueue.find((item)=>item.id===state.currentQueueId);state.localQueue=current?[current]:[];saveLocalQueue();renderQueue();}}
function renderQueue() {
  const queue=activeQueue();
  els.queueCount.textContent=queue.length;
  if (!queue.length) {
    els.queueList.innerHTML=`<div class="queue-empty"><span>${icon('queue')}</span><h3>Очередь пуста</h3><p>Добавь трек — продолжение подберётся автоматически.</p></div>`;
    return;
  }
  let currentIndex=queue.findIndex((item)=>item.id===state.currentQueueId);
  if(currentIndex<0)currentIndex=0;
  const current=queue[currentIndex];
  const upcoming=queue.slice(currentIndex+1);
  const history=queue.slice(0,currentIndex).slice(-4).reverse();
  const row=(item,kind,index)=>{
    const votes=state.roomCode&&kind!=='history'?`<div class="queue-votes"><button data-vote="1" data-id="${escapeHtml(item.id)}">${icon('up')}</button><small>${item.votes||0}</small><button data-vote="-1" data-id="${escapeHtml(item.id)}">${icon('down')}</button></div>`:'';
    const badge=item.source==='smart_radio'?'<em class="queue-source">Автоподбор</em>':(item.addedBy?`<em class="queue-source">${escapeHtml(item.addedBy)}</em>`:'');
    return `<div class="queue-item queue-${kind} ${item.id===state.currentQueueId?'current':''}" data-queue-play="${escapeHtml(item.id)}"><span class="queue-position">${kind==='current'?icon('volume'):(kind==='history'?icon('check'):index+1)}</span><img class="queue-thumb" src="${escapeHtml(item.thumbnail||'')}" alt=""><div class="queue-info"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.artist)}</span>${badge}</div>${votes}<button class="icon-button queue-remove" data-remove="${escapeHtml(item.id)}">${icon('trash')}</button></div>`;
  };
  els.queueList.innerHTML=`
    <section class="queue-section"><div class="queue-section-title">Сейчас играет</div>${row(current,'current',0)}</section>
    <section class="queue-section"><div class="queue-section-title">Далее <span>${upcoming.length}</span></div>${upcoming.length?upcoming.map((item,index)=>row(item,'upcoming',index)).join(''):'<div class="queue-auto-note">Когда очередь закончится, Sync Music подберёт похожие треки.</div>'}</section>
    ${history.length?`<section class="queue-section queue-history"><div class="queue-section-title">Недавно</div>${history.map((item,index)=>row(item,'history',index)).join('')}</section>`:''}`;
}
function openQueue(){els.queueDrawer.classList.add('open');els.queueBackdrop.classList.add('open');}
function closeQueue(){els.queueDrawer.classList.remove('open');els.queueBackdrop.classList.remove('open');}

function initPlayer() {
  if(state.player||!window.YT?.Player)return;
  state.player=new YT.Player('youtubePlayer',{height:'1',width:'1',playerVars:{playsinline:1,controls:0,rel:0,origin:location.origin},events:{onReady:(event)=>{state.playerReady=true;event.target.setVolume(Number(els.volumeBar.value));},onStateChange:onPlayerState}});
}
window.onYouTubeIframeAPIReady=initPlayer;
setTimeout(()=>{if(window.YT?.Player)initPlayer();},1000);

function onPlayerState(event) {
  if(!window.YT)return;
  state.playing=event.data===YT.PlayerState.PLAYING;
  $('.player-bar')?.classList.toggle('playing',state.playing);
  els.playPauseIcon.innerHTML=svgUse(state.playing?'pause':'play');
  updateCardPlayButtons(); persistPlayerState();
  if(event.data===YT.PlayerState.ENDED){
    requestAutoAdvance('ended');
    return;
  }
  if(!state.suppressPlayerEvent&&(event.data===YT.PlayerState.PLAYING||event.data===YT.PlayerState.PAUSED))broadcastSync();
}
function playSongInternal(song, autoplay=true, startOffset=0) {
  if(!song?.videoId)return;
  state.currentSong=song; state.visualSeed=hashCode(song.videoId); state.autoAdvancePending=false; state.autoAdvanceTrackId=state.currentQueueId||song.videoId; addRecent(song); updatePlayerUI(song);
  const start=Math.max(0,startOffset||0);
  const doLoad=()=>{state.suppressPlayerEvent=true;if(autoplay)state.player.loadVideoById({videoId:song.videoId,startSeconds:start});else state.player.cueVideoById({videoId:song.videoId,startSeconds:start});setTimeout(()=>state.suppressPlayerEvent=false,800);};
  if(state.playerReady)doLoad();else{const timer=setInterval(()=>{if(state.playerReady){clearInterval(timer);doLoad();}},150);}
  if('mediaSession'in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:song.title,artist:song.artist,album:song.album||'',artwork:song.thumbnail?[{src:song.thumbnail,sizes:'512x512'}]:[]});}
}
function updatePlayerUI(song) {
  updateCardPlayButtons();
  els.playerTitle.textContent=song.title||'Без названия'; els.playerArtist.textContent=song.artist||'YouTube';
  if(song.thumbnail){els.playerCover.classList.remove('empty');els.playerCoverImg.src=song.thumbnail;document.documentElement.style.setProperty('--current-art',`url("${song.thumbnail.replace(/"/g,'')}")`);}else{els.playerCover.classList.add('empty');els.playerCoverImg.removeAttribute('src');document.documentElement.style.setProperty('--current-art','none');}
}
function togglePlayback(){if(!state.playerReady||!state.currentSong)return;if(state.playing)state.player.pauseVideo();else state.player.playVideo();}
function broadcastSync(){if(!state.roomCode||!state.currentSong||!state.playerReady)return;sendWS({type:'sync',videoId:state.currentSong.videoId,state:state.playing?'playing':'paused',time:state.player.getCurrentTime()||0,ts:Date.now(),song:state.currentSong});}
function applyRemoteSync(message) {
  if(!message.videoId)return;const song=message.song||{videoId:message.videoId,title:'YouTube',artist:'Синхронизация'};const delay=message.state==='playing'?Math.max(0,(Date.now()-(message.ts||Date.now()))/1000):0;const target=Math.max(0,Number(message.time||0)+delay);
  state.suppressPlayerEvent=true;
  if(!state.currentSong||state.currentSong.videoId!==message.videoId){state.currentSong=song;updatePlayerUI(song);playSongInternal(song,message.state==='playing',target);}else if(state.playerReady){const drift=Math.abs((state.player.getCurrentTime()||0)-target);if(drift>1.1)state.player.seekTo(target,true);message.state==='playing'?state.player.playVideo():state.player.pauseVideo();}
  setTimeout(()=>state.suppressPlayerEvent=false,700);
}
function hashCode(value=''){let hash=0;for(let i=0;i<value.length;i++)hash=((hash<<5)-hash)+value.charCodeAt(i)|0;return Math.abs(hash)||1;}

function requestAutoAdvance(reason='ended') {
  const identity=state.currentQueueId||state.currentSong?.videoId||null;
  if(!identity||state.autoAdvancePending)return;
  state.autoAdvancePending=true;
  state.autoAdvanceTrackId=identity;
  if(state.roomCode){
    sendWS({type:'queue_next',expectedCurrentId:state.currentQueueId||null,reason});
  } else {
    Promise.resolve(nextTrack(1)).finally(()=>setTimeout(()=>{state.autoAdvancePending=false;},700));
  }
  setTimeout(()=>{
    if(state.autoAdvanceTrackId===identity)state.autoAdvancePending=false;
  },3500);
}

function startTimeline() {
  setInterval(()=>{
    if(!state.playerReady)return;
    const current=state.player.getCurrentTime?.()||0;
    const duration=state.player.getDuration?.()||0;
    els.currentTime.textContent=formatTime(current);
    els.durationTime.textContent=formatTime(duration);
    if(!els.seekBar.matches(':active'))els.seekBar.value=duration?Math.round(current/duration*1000):0;
    const progress=duration?Math.max(0,Math.min(100,current/duration*100)):0;
    els.seekBar.style.setProperty('--seek-progress',`${progress}%`);
    if(Math.floor(current)%2===0)persistPlayerState();
    if(state.roomCode&&state.playing&&Date.now()-state.lastRoomSyncAt>4000){state.lastRoomSyncAt=Date.now();broadcastSync();}
    // Some embeds do not reliably emit ENDED. The watchdog advances once near the real end.
    if(state.playing&&duration>8&&duration-current<=0.65)requestAutoAdvance('watchdog');
  },350);
}
function setupMediaSession(){if(!('mediaSession'in navigator))return;navigator.mediaSession.setActionHandler('play',()=>state.player?.playVideo());navigator.mediaSession.setActionHandler('pause',()=>state.player?.pauseVideo());navigator.mediaSession.setActionHandler('previoustrack',()=>nextTrack(-1));navigator.mediaSession.setActionHandler('nexttrack',()=>nextTrack(1));}

function startVisualizer() {
  const canvas=els.visualizerCanvas,ctx=canvas.getContext('2d');let width=0,height=0,dpr=1;
  const resize=()=>{dpr=Math.min(devicePixelRatio||1,2);width=innerWidth;height=innerHeight;canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;ctx.setTransform(dpr,0,0,dpr,0,0);};resize();addEventListener('resize',resize);
  const draw=(now)=>{ctx.clearRect(0,0,width,height);const current=state.playerReady?(state.player.getCurrentTime?.()||now/1000):now/1000;const energy=state.playing?.95:.22;const seed=state.visualSeed;ctx.globalCompositeOperation='lighter';
    const blobs=[{x:.17,y:.28,c:'43,217,255',s:.18},{x:.76,y:.2,c:'139,92,246',s:.22},{x:.68,y:.76,c:'240,68,201',s:.2}];
    blobs.forEach((blob,index)=>{const pulse=.75+Math.sin(current*(1.4+index*.27)+seed*.01)*.16*energy;const x=width*(blob.x+Math.sin(current*.13+index)*.035*energy),y=height*(blob.y+Math.cos(current*.11+index)*.04*energy),r=Math.min(width,height)*blob.s*pulse;const gradient=ctx.createRadialGradient(x,y,0,x,y,r);gradient.addColorStop(0,`rgba(${blob.c},${.14*energy})`);gradient.addColorStop(1,`rgba(${blob.c},0)`);ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();});
    const bars=44,baseY=height*.88;for(let i=0;i<bars;i++){const x=i/(bars-1)*width;const wave=(Math.sin(current*2.1+i*.52+seed*.004)+Math.sin(current*.73+i*.19))*0.5;const barH=(18+Math.abs(wave)*115)*energy;const hue=190+i/bars*115;ctx.fillStyle=`hsla(${hue},90%,62%,${.04+.08*energy})`;ctx.fillRect(x,baseY-barH,Math.max(2,width/bars*.46),barH);}
    ctx.globalCompositeOperation='source-over';requestAnimationFrame(draw);};requestAnimationFrame(draw);
}

function bindEvents() {
  els.authForm.addEventListener('submit',handleAuth);els.loginTab.onclick=()=>setAuthMode(false);els.registerTab.onclick=()=>setAuthMode(true);els.passwordToggle.onclick=()=>{const hidden=els.passwordInput.type==='password';els.passwordInput.type=hidden?'text':'password';els.passwordToggle.textContent=hidden?'Скрыть':'Показать';};
  els.logoutBtn.onclick=logout;els.mobileMenuBtn.onclick=openSidebar;els.closeSidebarBtn.onclick=closeSidebar;els.sidebarBackdrop.onclick=closeSidebar;
  $$('.nav-item').forEach((button)=>button.onclick=()=>switchView(button.dataset.view));$$('[data-view-link]').forEach((button)=>button.onclick=()=>switchView(button.dataset.viewLink));
  [els.youtubeConnectBtn,els.homeConnectBtn,els.libraryConnectBtn].forEach((button)=>button.onclick=connectGoogle);els.youtubeDisconnectBtn.onclick=()=>disconnectGoogle(true);els.refreshLibraryBtn.onclick=loadLibrary;els.libraryRefreshTopBtn.onclick=loadLibrary;els.openYoutubeBtn.onclick=()=>window.open('https://music.youtube.com','_blank','noopener');
  els.searchInput.addEventListener('input',scheduleSuggestions);els.searchInput.addEventListener('keydown',(event)=>{if(event.key==='ArrowDown'){event.preventDefault();moveSuggestion(1);}else if(event.key==='ArrowUp'){event.preventDefault();moveSuggestion(-1);}else if(event.key==='Escape')hideSuggestions();else if(event.key==='Enter'){event.preventDefault();runSearch(els.searchInput.value);}});els.searchClearBtn.onclick=()=>{els.searchInput.value='';hideSuggestions();els.searchClearBtn.classList.add('hidden');els.searchInput.focus();};
  els.suggestionsBox.onclick=(event)=>{const button=event.target.closest('[data-suggestion]');if(button){els.searchInput.value=button.dataset.suggestion;runSearch(button.dataset.suggestion);}};
  els.friendAddBtn.onclick=addFriend;els.friendInput.addEventListener('keydown',(event)=>{if(event.key==='Enter')addFriend();});
  els.requestList.onclick=(event)=>{const button=event.target.closest('[data-accept]');if(button)acceptFriend(button.dataset.accept);};
  document.addEventListener('click',(event)=>{const invite=event.target.closest('[data-invite]');if(invite)inviteFriend(invite.dataset.invite);const play=event.target.closest('[data-play-song]');if(play){event.stopPropagation();const song=decodeSong(play.dataset.playSong);if(state.currentSong?.videoId===song?.videoId)togglePlayback();else addSong(song,true);}const add=event.target.closest('[data-add-song]');if(add){event.stopPropagation();const song=decodeSong(add.dataset.addSong);addSong(song,false);toast('Добавлено в очередь');}const card=event.target.closest('.track-card[data-song]');if(card&&!event.target.closest('button'))addSong(decodeSong(card.dataset.song),true);});
  els.createRoomBtn.onclick=createRoom;els.joinRoomBtn.onclick=()=>joinRoom();els.roomCodeInput.addEventListener('input',()=>els.roomCodeInput.value=els.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g,''));els.leaveRoomBtn.onclick=leaveRoom;els.copyRoomBtn.onclick=async()=>{await navigator.clipboard.writeText(state.roomCode);toast('Код скопирован');};
  els.queueBtn.onclick=openQueue;els.closeQueueBtn.onclick=closeQueue;els.queueBackdrop.onclick=closeQueue;els.clearQueueBtn.onclick=clearQueue;
  els.queueList.onclick=(event)=>{const remove=event.target.closest('[data-remove]');if(remove){event.stopPropagation();removeQueueItem(remove.dataset.remove);return;}const vote=event.target.closest('[data-vote]');if(vote){event.stopPropagation();sendWS({type:'queue_vote',itemId:vote.dataset.id,delta:Number(vote.dataset.vote)});return;}const row=event.target.closest('[data-queue-play]');if(row)playQueueItem(row.dataset.queuePlay);};
  els.playlistGrid.onclick=(event)=>{const card=event.target.closest('[data-playlist]');if(card)openPlaylist(card.dataset.playlist);};els.closePlaylistBtn.onclick=closePlaylist;els.playlistModal.onclick=(event)=>{if(event.target===els.playlistModal)closePlaylist();const add=event.target.closest('[data-add-index]');if(add&&state.openPlaylist){addSong(state.openPlaylist.items[Number(add.dataset.addIndex)],false);toast('Добавлено в очередь');}const row=event.target.closest('[data-song-index]');if(row&&!event.target.closest('button')&&state.openPlaylist)addSong(state.openPlaylist.items[Number(row.dataset.songIndex)],true);};
  els.playlistAddAllBtn.onclick=()=>{state.openPlaylist?.items?.forEach((song)=>addSong(song,false));toast('Плейлист добавлен в очередь');};els.playlistPlayAllBtn.onclick=()=>{const items=state.openPlaylist?.items||[];items.forEach((song,index)=>addSong(song,index===0));closePlaylist();};
  els.addLikedBtn.onclick=()=>{state.library?.liked?.forEach((song)=>addSong(song,false));toast('Понравившиеся добавлены');};els.playLikedBtn.onclick=()=>{const items=state.library?.liked||[];items.forEach((song,index)=>addSong(song,index===0));};
  els.playPauseBtn.onclick=togglePlayback;els.nextBtn.onclick=()=>nextTrack(1);els.prevBtn.onclick=()=>nextTrack(-1);els.volumeBar.oninput=()=>state.player?.setVolume(Number(els.volumeBar.value));els.seekBar.onchange=()=>{if(!state.playerReady)return;const duration=state.player.getDuration()||0;state.player.seekTo(duration*Number(els.seekBar.value)/1000,true);broadcastSync();};
  addEventListener('keydown',(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();els.searchInput.focus();}if(event.code==='Space'&&!['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName)){event.preventDefault();togglePlayback();}});
}

async function init() {
  bindElements(); bindEvents(); setAuthMode(false); startTimeline(); setupMediaSession(); startVisualizer(); renderRoom(); renderQueue(); renderRecent();
  if (state.token && state.username) {
    try {
      await api(`/api/me?token=${encodeURIComponent(state.token)}`);
      await showApp();
      if(!state.roomCode)restorePlayerState();
    } catch (error) {
      if (String(error.message).includes('401') || String(error.message).toLowerCase().includes('сессия')) {
        showAuthAfterExpiredSession();
      } else {
        els.authError.textContent = error.message;
      }
    }
  }
}
document.addEventListener('DOMContentLoaded',init);
