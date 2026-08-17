'use strict';

(() => {
  const request = new XMLHttpRequest();
  request.open('GET', '/static/youtube_refresh_base.js', false);
  request.send(null);
  if (request.status < 200 || request.status >= 300) {
    console.error('Failed to load YouTube refresh upgrades', request.status);
    return;
  }
  (0, eval)(`${request.responseText}\n//# sourceURL=youtube_refresh_base.js`);

  const TRANSITION_GUARD_MS = 2600;
  const OPTIMISTIC_PLAY_GUARD_MS = 5000;
  let transitionGuardUntil = 0;
  let lastAdvanceIdentity = '';
  let lastAdvanceAt = 0;
  let optimisticQueueId = '';
  let optimisticVideoId = '';
  let optimisticPlayAt = 0;
  let localAutoQueueEnabled = storage.get('sync.autoQueueEnabled', true) !== false;
  state.autoQueueEnabled = state.roomCode ? true : localAutoQueueEnabled;

  const isHost = () => Boolean(
    state.roomCode && state.roomHost && state.username &&
    state.roomHost.toLowerCase() === state.username.toLowerCase()
  );

  function setAutoQueueState(enabled, persistLocal = false) {
    state.autoQueueEnabled = enabled !== false;
    if (persistLocal) {
      localAutoQueueEnabled = state.autoQueueEnabled;
      storage.set('sync.autoQueueEnabled', localAutoQueueEnabled);
    }
    updateAutoQueueToggle();
  }

  function updateAutoQueueToggle() {
    const button = document.getElementById('autoQueueToggleBtn');
    if (!button) return;
    const enabled = state.autoQueueEnabled !== false;
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.innerHTML = `<span class="auto-queue-dot"></span><span>Автоочередь: ${enabled ? 'Вкл' : 'Выкл'}</span>`;
    button.title = enabled
      ? 'Выключить автоматическое продолжение очереди'
      : 'Включить автоматическое продолжение очереди';
  }

  function injectAutoQueueToggle() {
    if (document.getElementById('autoQueueToggleBtn')) return;
    const clearButton = document.getElementById('clearQueueBtn');
    if (!clearButton?.parentElement) return;
    const button = document.createElement('button');
    button.id = 'autoQueueToggleBtn';
    button.type = 'button';
    button.className = 'auto-queue-toggle';
    button.onclick = () => {
      const next = state.autoQueueEnabled === false;
      setAutoQueueState(next, !state.roomCode);
      if (state.roomCode) {
        sendWS({
          type: 'queue_remove',
          itemId: next ? '__AUTO_QUEUE_ON__' : '__AUTO_QUEUE_OFF__'
        });
      }
    };
    clearButton.parentElement.insertBefore(button, clearButton);
    updateAutoQueueToggle();
  }

  function injectAutoQueueStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .auto-queue-toggle{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.055);color:rgba(255,255,255,.62);font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.18s ease}
      .auto-queue-toggle:hover{background:rgba(255,255,255,.09);color:#fff}
      .auto-queue-toggle.active{color:#dfffee;border-color:rgba(74,222,128,.35);background:rgba(34,197,94,.12)}
      .auto-queue-dot{width:8px;height:8px;border-radius:50%;background:#687080;box-shadow:0 0 0 3px rgba(104,112,128,.12);transition:.18s ease}
      .auto-queue-toggle.active .auto-queue-dot{background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.13),0 0 14px rgba(74,222,128,.32)}
      @media(max-width:900px){.auto-queue-toggle{min-height:40px;padding:0 11px;font-size:12px}}
    `;
    document.head.append(style);
  }

  const previousHandleSocketMessage = handleSocketMessage;
  handleSocketMessage = function handleSocketMessageWithQueueFixes(message) {
    if (!message) return;

    if (
      (message.type === 'room_joined' || message.type === 'room_presence' || message.type === 'queue_updated') &&
      typeof message.autoQueueEnabled === 'boolean'
    ) {
      setAutoQueueState(message.autoQueueEnabled, false);
    }

    if (message.type === 'room_left' || message.type === 'room_closed' || message.type === 'room_deleted' || message.type === 'host_left') {
      setAutoQueueState(localAutoQueueEnabled, false);
    }

    if (message.type === 'queue_play' && message.song?.videoId) {
      transitionGuardUntil = Date.now() + TRANSITION_GUARD_MS;
      lastAdvanceIdentity = '';
      lastAdvanceAt = 0;

      const sameOptimisticTrack =
        Date.now() - optimisticPlayAt < OPTIMISTIC_PLAY_GUARD_MS &&
        (
          (optimisticQueueId && String(message.currentQueueId || '') === optimisticQueueId) ||
          (optimisticVideoId && String(message.song.videoId) === optimisticVideoId)
        ) &&
        state.currentSong?.videoId === message.song.videoId;

      if (sameOptimisticTrack) {
        state.currentQueueId = message.currentQueueId || state.currentQueueId;
        state.autoAdvancePending = false;
        state.autoAdvanceTrackId = state.currentQueueId || message.song.videoId;
        optimisticQueueId = '';
        optimisticVideoId = '';
        optimisticPlayAt = 0;
        renderQueue();
        return;
      }
    }

    previousHandleSocketMessage(message);
  };

  const previousRequestAutoAdvance = requestAutoAdvance;
  requestAutoAdvance = function requestAutoAdvanceOnce(reason = 'ended') {
    if (!state.roomCode) {
      if (state.autoQueueEnabled === false) {
        const queue = state.localQueue || [];
        const index = queue.findIndex((item) => item.id === state.currentQueueId);
        if (index >= 0 && index + 1 >= queue.length) return;
      }
      return previousRequestAutoAdvance(reason);
    }

    if (state.autoQueueEnabled === false) return;
    if (!isHost() || Date.now() < transitionGuardUntil) return;

    const identity = String(state.currentQueueId || state.currentSong?.videoId || '');
    if (!identity) return;
    if (lastAdvanceIdentity === identity && Date.now() - lastAdvanceAt < 5000) return;

    lastAdvanceIdentity = identity;
    lastAdvanceAt = Date.now();
    previousRequestAutoAdvance(reason);
  };

  const previousNextTrack = nextTrack;
  nextTrack = async function nextTrackWithAutoQueueSwitch(direction = 1) {
    if (!state.roomCode && direction > 0 && state.autoQueueEnabled === false) {
      const queue = state.localQueue || [];
      let index = queue.findIndex((item) => item.id === state.currentQueueId);
      if (index < 0) index = 0;
      if (index + 1 >= queue.length) {
        toast('Автоочередь выключена');
        return;
      }
    }
    return previousNextTrack(direction);
  };

  const previousPlayQueueItem = playQueueItem;
  playQueueItem = function playQueueItemImmediately(id) {
    if (!state.roomCode) return previousPlayQueueItem(id);
    const item = (state.queue || []).find((entry) => String(entry.id) === String(id));
    if (!item?.videoId) return previousPlayQueueItem(id);

    optimisticQueueId = String(id);
    optimisticVideoId = String(item.videoId);
    optimisticPlayAt = Date.now();
    transitionGuardUntil = Date.now() + TRANSITION_GUARD_MS;
    state.currentQueueId = id;
    state.autoAdvancePending = false;
    state.autoAdvanceTrackId = id;
    playSongInternal(item, true, 0);
    renderQueue();
    sendWS({type: 'queue_play', itemId: id});
  };

  const previousAddSong = addSong;
  addSong = function addSongImmediatelyInRoom(song, playNow = false) {
    if (!state.roomCode || !playNow || !song?.videoId) {
      return previousAddSong(song, playNow);
    }

    optimisticQueueId = '';
    optimisticVideoId = String(song.videoId);
    optimisticPlayAt = Date.now();
    transitionGuardUntil = Date.now() + TRANSITION_GUARD_MS;
    state.autoAdvancePending = false;
    state.autoAdvanceTrackId = song.videoId;
    playSongInternal(song, true, 0);
    sendWS({type: 'queue_add', song, playNow: true});
  };

  document.addEventListener('DOMContentLoaded', () => {
    injectAutoQueueStyles();
    injectAutoQueueToggle();
    setTimeout(injectAutoQueueToggle, 250);
    setTimeout(injectAutoQueueToggle, 1200);
  });
})();

/* persistent-google-session-v1 */
(() => {
  const TOKEN_KEY = 'sync.googleAccess';
  const REFRESH_EARLY_MS = 5 * 60 * 1000;
  const DEFAULT_TTL_MS = 55 * 60 * 1000;
  let renewTimer = null;
  let refreshPromise = null;
  let refreshResolve = null;
  let refreshReject = null;

  function readStoredAccess() {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function saveAccess(token, expiresInSeconds) {
    if (!token) return;
    const ttl = Math.max(60, Number(expiresInSeconds || 0)) * 1000 || DEFAULT_TTL_MS;
    const value = {token, expiresAt: Date.now() + ttl};
    localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
    sessionStorage.setItem('sync.googleToken', token);
    state.googleToken = token;
    scheduleRenew(value.expiresAt);
  }

  function clearAccess() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('sync.googleToken');
    state.googleToken = '';
    if (renewTimer) clearTimeout(renewTimer);
    renewTimer = null;
  }

  function storedTokenIsUsable(record) {
    return Boolean(record?.token && Number(record.expiresAt || 0) > Date.now() + 30_000);
  }

  function restorePersistedAccess() {
    const record = readStoredAccess();
    if (!storedTokenIsUsable(record)) {
      if (record) localStorage.removeItem(TOKEN_KEY);
      return false;
    }
    state.googleToken = record.token;
    sessionStorage.setItem('sync.googleToken', record.token);
    scheduleRenew(Number(record.expiresAt));
    return true;
  }

  function scheduleRenew(expiresAt) {
    if (renewTimer) clearTimeout(renewTimer);
    const wait = Math.max(15_000, Number(expiresAt || 0) - Date.now() - REFRESH_EARLY_MS);
    renewTimer = setTimeout(() => {
      renewGoogleAccess(false).catch((error) => {
        console.debug('Background Google token renewal skipped:', error);
      });
    }, wait);
  }

  function buildGoogleClient() {
    if (!state.config.googleClientId || !window.google?.accounts?.oauth2) return null;
    state.googleClient = google.accounts.oauth2.initTokenClient({
      client_id: state.config.googleClientId,
      scope: [
        'https://www.googleapis.com/auth/youtube.force-ssl',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
      ].join(' '),
      include_granted_scopes: true,
      callback: async (response) => {
        state.googleConnecting = false;
        if (response?.error || !response?.access_token) {
          const error = new Error(response?.error_description || response?.error || 'Google не вернул токен доступа');
          if (refreshReject) refreshReject(error);
          refreshPromise = refreshResolve = refreshReject = null;
          return;
        }

        saveAccess(response.access_token, response.expires_in || 3600);
        if (refreshResolve) refreshResolve(response.access_token);
        refreshPromise = refreshResolve = refreshReject = null;

        try {
          await restoreGoogle(false);
        } catch (error) {
          console.debug('Google restore after token renewal failed:', error);
        }
      },
      error_callback: (error) => {
        state.googleConnecting = false;
        const oauthError = new Error(error?.type || 'Google OAuth failed');
        if (refreshReject) refreshReject(oauthError);
        refreshPromise = refreshResolve = refreshReject = null;
      }
    });
    return state.googleClient;
  }

  function installClientOverride() {
    initGoogleClient = function initPersistentGoogleClient() {
      if (state.googleClient) return state.googleClient;
      return buildGoogleClient();
    };
  }

  function renewGoogleAccess(interactive = false) {
    const record = readStoredAccess();
    if (!interactive && storedTokenIsUsable(record) && Number(record.expiresAt) > Date.now() + REFRESH_EARLY_MS) {
      return Promise.resolve(record.token);
    }
    if (refreshPromise) return refreshPromise;

    let client = initGoogleClient();
    if (!client) {
      return Promise.reject(new Error('Google OAuth ещё не загрузился'));
    }

    refreshPromise = new Promise((resolve, reject) => {
      refreshResolve = resolve;
      refreshReject = reject;
    });
    state.googleConnecting = true;

    try {
      client.requestAccessToken({prompt: interactive ? 'consent' : ''});
    } catch (error) {
      state.googleConnecting = false;
      refreshReject?.(error);
      refreshPromise = refreshResolve = refreshReject = null;
    }
    return refreshPromise;
  }

  function markNeedsRenewal() {
    clearAccess();
    if (state.googleProfile) {
      applyGoogleProfile(state.googleProfile, true);
      if (els.youtubeAccountMeta) els.youtubeAccountMeta.textContent = 'Нужно обновить доступ';
    }
  }

  const originalConnectGoogle = connectGoogle;
  connectGoogle = async function connectGooglePersistent() {
    if (state.googleConnecting) return;
    try {
      await renewGoogleAccess(!state.googleProfile);
      toast('YouTube-аккаунт подключён');
    } catch (error) {
      console.error('Google reconnect failed:', error);
      return originalConnectGoogle();
    }
  };

  const originalDisconnectGoogle = disconnectGoogle;
  disconnectGoogle = async function disconnectGooglePersistent(clearServer = true) {
    if (clearServer) {
      clearAccess();
      return originalDisconnectGoogle(true);
    }

    markNeedsRenewal();
    try {
      await renewGoogleAccess(false);
    } catch (error) {
      console.debug('Silent Google renewal unavailable:', error);
      if (state.googleProfile) {
        applyGoogleProfile(state.googleProfile, true);
        if (els.youtubeAccountMeta) els.youtubeAccountMeta.textContent = 'Нажми «Обновить», чтобы продлить доступ';
      }
    }
  };

  const originalLoadLibrary = loadLibrary;
  loadLibrary = async function loadLibraryWithRenewal() {
    if (!state.googleToken && state.googleProfile) {
      try {
        await renewGoogleAccess(false);
      } catch {
        if (els.youtubeAccountMeta) els.youtubeAccountMeta.textContent = 'Нажми «Обновить», чтобы продлить доступ';
        return;
      }
    }
    return originalLoadLibrary();
  };

  restorePersistedAccess();

  // player_extras.js is loaded after this file and replaces initGoogleClient.
  // Install our final client on the next task so it wins and also covers likes.
  setTimeout(() => {
    state.googleClient = null;
    installClientOverride();
    const record = readStoredAccess();
    if (storedTokenIsUsable(record)) scheduleRenew(Number(record.expiresAt));
  }, 0);
})();