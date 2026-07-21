// ================= Состояние =================
let token = localStorage.getItem('token') || null;
let username = localStorage.getItem('username') || null;

let ws = null;
let player = null;
let playerReady = false;
let applyingRemote = false;
let currentVideoId = null;
let currentRoom = null;
let friendsCache = [];
let progressTimer = null;

const API = ''; // тот же сервер, что раздаёт страницу

// ================= Помощники =================
function $(id) { return document.getElementById(id); }

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Ошибка запроса');
  return data;
}

// ================= Авторизация =================
let authMode = 'login';
const rememberCheckbox = $('rememberMe');

$('tabLogin').onclick = () => { authMode = 'login'; $('tabLogin').classList.add('active'); $('tabRegister').classList.remove('active'); $('authSubmit').innerText = 'Войти'; };
$('tabRegister').onclick = () => { authMode = 'register'; $('tabRegister').classList.add('active'); $('tabLogin').classList.remove('active'); $('authSubmit').innerText = 'Создать аккаунт'; };

$('authSubmit').onclick = async () => {
  const u = $('authUsername').value.trim();
  const p = $('authPassword').value;
  const remember = rememberCheckbox.checked;
  $('authError').innerText = '';
  if (!u || !p) { $('authError').innerText = 'Заполни оба поля'; return; }

  try {
    const path = authMode === 'login' ? '/api/login' : '/api/register';
    const data = await api(path, { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    token = data.token;
    username = data.username;
    if (remember) {
      localStorage.setItem('token', token);
      localStorage.setItem('username', username);
    } else {
      sessionStorage.setItem('token', token);
      sessionStorage.setItem('username', username);
    }
    enterApp();
  } catch (e) {
    $('authError').innerText = e.message;
  }
};

$('logoutBtn').onclick = () => {
  token = null;
  username = null;
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  sessionStorage.removeItem('token');
  location.reload();
};

function enterApp() {
  $('authScreen').style.display = 'none';
  $('mainScreen').style.display = 'flex';
  $('meUsername').innerText = username;
  connectWebSocket();
  refreshFriends();
}

// Попробовать восстановить сессию при загрузке страницы
const savedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
const savedUsername = localStorage.getItem('username') || sessionStorage.getItem('username');
if (savedToken && savedUsername) {
  token = savedToken;
  username = savedUsername;
  api(`/api/friends/list?token=${encodeURIComponent(token)}`)
    .then(() => enterApp())
    .catch(() => { token = null; username = null; localStorage.clear(); sessionStorage.clear(); });
}

// ================= Друзья =================
async function refreshFriends() {
  try {
    const data = await api(`/api/friends/list?token=${encodeURIComponent(token)}`);
    friendsCache = data.friends;
    renderFriends(data.friends);
    renderPending(data.pending_requests);
  } catch (e) {
    console.error(e);
  }
}

function renderFriends(friends) {
  const el = $('friendsList');
  el.innerHTML = '';
  if (friends.length === 0) el.innerHTML = '<div class="msg">Пока никого нет</div>';
  friends.forEach(f => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerText = f;
    el.appendChild(div);
  });
  renderInviteButtons();
}

function renderPending(pending) {
  const el = $('pendingList');
  el.innerHTML = '';
  if (pending.length === 0) { el.innerHTML = '<div class="msg">Нет заявок</div>'; return; }
  pending.forEach(u => {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<span>${u}</span>`;
    const btn = document.createElement('button');
    btn.innerText = 'Принять';
    btn.onclick = async () => {
      await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ token, from_username: u }) });
      refreshFriends();
    };
    div.appendChild(btn);
    el.appendChild(div);
  });
}

$('addFriendBtn').onclick = async () => {
  const u = $('addFriendInput').value.trim();
  if (!u) return;
  $('friendMsg').innerText = '';
  try {
    await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ token, to_username: u }) });
    $('friendMsg').innerText = `Заявка отправлена пользователю ${u}`;
    $('addFriendInput').value = '';
  } catch (e) {
    $('friendMsg').innerText = e.message;
  }
};

// ================= Комнаты =================
$('createRoomBtn').onclick = async () => {
  const data = await api('/api/rooms/create', { method: 'POST', body: JSON.stringify({ token }) });
  joinRoom(data.room_code);
};

function joinRoom(roomCode) {
  ws.send(JSON.stringify({ type: 'join_room', room_code: roomCode }));
}

function renderInviteButtons() {
  const el = $('inviteFriends');
  el.innerHTML = '';
  if (!currentRoom) return;
  friendsCache.forEach(f => {
    const btn = document.createElement('button');
    btn.innerText = f;
    btn.onclick = async () => {
      await api('/api/rooms/invite', { method: 'POST', body: JSON.stringify({ token, room_code: currentRoom, to_username: f }) });
      btn.innerText = `${f} ✓`;
    };
    el.appendChild(btn);
  });
}

// ================= Поиск =================
$('searchBtn').onclick = doSearch;
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = $('searchInput').value.trim();
  if (!q) return;
  const data = await api(`/api/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(token)}`);
  renderResults(data.results);
}

function renderResults(results) {
  const el = $('searchResults');
  el.innerHTML = '';
  results.forEach(song => {
    const div = document.createElement('div');
    div.className = 'list-item song-item';
    div.innerHTML = `
      <div class="song-item-left">
        <img class="song-thumb" src="${song.thumbnail}">
        <div><b>${song.title}</b><br><span class="msg">${song.artist}</span></div>
      </div>
    `;
    div.onclick = () => loadSong(song);
    el.appendChild(div);
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function updatePlayerProgress() {
  if (!player || !playerReady) return;
  const current = player.getCurrentTime ? player.getCurrentTime() : 0;
  const duration = player.getDuration ? player.getDuration() : 0;
  const pct = duration > 0 ? Math.min(1, current / duration) * 100 : 0;
  const fill = $('playerProgressFill');
  if (fill) fill.style.width = `${pct}%`;
  const timeEl = $('playerTime');
  if (timeEl) timeEl.innerText = `${formatTime(current)} / ${formatTime(duration)}`;
}

function startProgressUpdates() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(updatePlayerProgress, 500);
}

function loadSong(song) {
  if (!playerReady) return;
  currentVideoId = song.videoId;
  player.loadVideoById(song.videoId);
  $('nowPlaying').innerText = `${song.title}`;
  $('playerStatus').innerText = `${song.artist}`;
  updatePlayerProgress();
  if (currentRoom) {
    setTimeout(() => sendSync('playing'), 500);
  }
}

// ================= WebSocket =================
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  ws = new WebSocket(`${proto}://${host}/ws?token=${encodeURIComponent(token)}`);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'friend_request':
        $('friendMsg').innerText = `${msg.from} хочет добавить тебя в друзья`;
        refreshFriends();
        break;

      case 'friend_accepted':
        $('friendMsg').innerText = `${msg.by} принял(а) твою заявку в друзья`;
        refreshFriends();
        break;

      case 'room_invite':
        showInviteModal(msg.from, msg.room_code);
        break;

      case 'room_joined':
        if (msg.ok) {
          currentRoom = msg.room_code;
          $('roomInfo').innerText = `Комната: ${msg.room_code} (участники: ${msg.members.join(', ')})`;
          $('inviteBox').style.display = 'flex';
          renderInviteButtons();
        }
        break;

      case 'request_state':
        if (currentVideoId && playerReady) {
          sendSync(player.getPlayerState() === YT.PlayerState.PLAYING ? 'playing' : 'paused');
        }
        break;

      case 'sync':
        applyRemoteSync(msg);
        break;
    }
  };

  ws.onclose = () => console.log('WebSocket отключен');
}

// ================= Invite modal =================
const inviteModal = $('inviteModal');
const inviteFrom = $('inviteFrom');
const inviteRoom = $('inviteRoom');
const joinInviteBtn = $('joinInviteBtn');
const declineInviteBtn = $('declineInviteBtn');
const toast = $('toast');

let pendingInvite = null;

function showInviteModal(from, roomCode) {
  pendingInvite = { from, roomCode };
  inviteFrom.innerText = from;
  inviteRoom.innerText = roomCode;
  inviteModal.classList.remove('hidden');
}

joinInviteBtn.onclick = () => {
  if (pendingInvite) {
    joinRoom(pendingInvite.roomCode);
    inviteModal.classList.add('hidden');
    pendingInvite = null;
    showToast('Ты присоединился к комнате');
  }
};

declineInviteBtn.onclick = () => {
  inviteModal.classList.add('hidden');
  pendingInvite = null;
  showToast('Приглашение отклонено');
};

function showToast(message) {
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

$('createRoomBtn').onclick = async () => {
  const data = await api('/api/rooms/create', { method: 'POST', body: JSON.stringify({ token }) });
  joinRoom(data.room_code);
  showToast(`Комната ${data.room_code} создана`);
};

$('playBtn').onclick = () => {
  if (playerReady) {
    player.playVideo();
  }
};

$('pauseBtn').onclick = () => {
  if (playerReady) {
    player.pauseVideo();
  }
};

$('rewindBtn').onclick = () => {
  if (playerReady) {
    player.seekTo(Math.max(0, player.getCurrentTime() - 5), true);
  }
};

$('forwardBtn').onclick = () => {
  if (playerReady) {
    player.seekTo(player.getCurrentTime() + 5, true);
  }
};

// ================= YouTube Player =================
const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '100%',
    width: '100%',
    videoId: '',
    playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, disablekb: 1, playsinline: 1 },
    events: {
      onReady: () => {
        playerReady = true;
        $('playerStatus').innerText = 'Плеер готов';
        startProgressUpdates();
        updatePlayerProgress();
      },
      onStateChange: onPlayerStateChange,
    },
  });
}

function onPlayerStateChange(event) {
  if (applyingRemote || !currentRoom) return;
  if (event.data === YT.PlayerState.PLAYING) {
    sendSync('playing');
    $('playerStatus').innerText = 'Воспроизведение';
  } else if (event.data === YT.PlayerState.PAUSED) {
    sendSync('paused');
    $('playerStatus').innerText = 'На паузе';
  }
  updatePlayerProgress();
}

function sendSync(state) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'sync',
    videoId: currentVideoId,
    state,
    time: player.getCurrentTime(),
    ts: Date.now(),
  }));
  $('playerStatus').innerText = state === 'playing' ? 'Воспроизведение синхронизировано' : 'Пауза синхронизирована';
  updatePlayerProgress();
}

function applyRemoteSync(msg) {
  if (!playerReady) return;
  applyingRemote = true;

  const elapsed = (Date.now() - msg.ts) / 1000;
  const targetTime = msg.time + (msg.state === 'playing' ? elapsed : 0);

  if (msg.videoId && msg.videoId !== currentVideoId) {
    currentVideoId = msg.videoId;
    player.loadVideoById(msg.videoId, targetTime);
    if (msg.state === 'paused') player.pauseVideo();
    $('nowPlaying').innerText = `Синхронизировано с другим участником`;
  } else {
    const diff = Math.abs(player.getCurrentTime() - targetTime);
    if (diff > 1.5) player.seekTo(targetTime, true);
    if (msg.state === 'playing') player.playVideo();
    else player.pauseVideo();
  }

  $('playerStatus').innerText = msg.state === 'playing' ? 'Другой участник играет трек' : 'Другой участник поставил на паузу';

  setTimeout(() => { applyingRemote = false; }, 400);
}
