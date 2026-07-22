'use strict';

/* player-likes-and-karaoke-v1 */
(() => {
  const YOUTUBE_SCOPE = [
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
  ].join(' ');

  let likedVideoId = '';
  let lyricsVideoId = '';
  let lyricLines = [];
  let lyricTimer = null;
  let lyricsOpen = false;

  const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function installGoogleScopeUpgrade() {
    if (typeof window.google === 'undefined' || !window.google?.accounts?.oauth2) {
      setTimeout(installGoogleScopeUpgrade, 300);
      return;
    }

    initGoogleClient = function initGoogleClientWithLikes() {
      if (state.googleClient) return state.googleClient;
      if (!state.config.googleClientId || !window.google?.accounts?.oauth2) return null;
      state.googleClient = google.accounts.oauth2.initTokenClient({
        client_id: state.config.googleClientId,
        scope: YOUTUBE_SCOPE,
        include_granted_scopes: true,
        callback: async (response) => {
          state.googleConnecting = false;
          if (response?.error) {
            console.error('Google OAuth response:', response);
            toast(`Google OAuth: ${response.error_description || response.error}`, 'error');
            return;
          }
          if (!response?.access_token) {
            toast('Google не вернул токен доступа. Попробуй подключить ещё раз.', 'error');
            return;
          }
          state.googleToken = response.access_token;
          sessionStorage.setItem('sync.googleToken', state.googleToken);
          await restoreGoogle(true);
          updateLikeState();
        },
        error_callback: (error) => {
          state.googleConnecting = false;
          const type = error?.type || 'unknown_error';
          const messages = {
            popup_closed: 'Окно Google было закрыто до завершения входа',
            popup_failed_to_open: 'Браузер заблокировал окно Google',
            unknown_error: 'Не удалось завершить вход Google'
          };
          toast(messages[type] || `Ошибка Google OAuth: ${type}`, 'error');
        }
      });
      return state.googleClient;
    };
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .player-extra-actions{display:flex;align-items:center;gap:4px;margin-left:8px}
      .player-extra-button{width:42px;height:42px;border:0;border-radius:50%;display:grid;place-items:center;background:transparent;color:rgba(255,255,255,.72);cursor:pointer;transition:.18s ease}
      .player-extra-button:hover{background:rgba(255,255,255,.1);color:#fff;transform:translateY(-1px)}
      .player-extra-button.active{color:#ff4f87;background:rgba(255,79,135,.13)}
      .player-extra-button svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.9}
      .player-extra-button.active .heart-fill{fill:currentColor}
      .lyrics-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(7px);z-index:1480;opacity:0;pointer-events:none;transition:.22s ease}
      .lyrics-backdrop.open{opacity:1;pointer-events:auto}
      .lyrics-panel{position:fixed;top:12px;right:12px;bottom:96px;width:min(560px,calc(100vw - 24px));z-index:1490;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:linear-gradient(155deg,rgba(35,25,55,.98),rgba(10,14,23,.98));box-shadow:0 30px 100px rgba(0,0,0,.58);transform:translateX(calc(100% + 30px));transition:transform .3s cubic-bezier(.2,.8,.2,1);overflow:hidden;display:flex;flex-direction:column}
      .lyrics-panel.open{transform:translateX(0)}
      .lyrics-head{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.09)}
      .lyrics-head img{width:58px;height:58px;object-fit:cover;border-radius:14px;background:#171b25}
      .lyrics-meta{min-width:0;flex:1}.lyrics-meta strong,.lyrics-meta span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lyrics-meta strong{font-size:17px}.lyrics-meta span{color:rgba(255,255,255,.58);margin-top:4px}
      .lyrics-close{width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;font-size:24px;cursor:pointer}
      .lyrics-body{flex:1;overflow:auto;padding:42px 34px 90px;scroll-behavior:smooth;overscroll-behavior:contain}
      .lyric-line{font-size:clamp(24px,3.2vw,40px);font-weight:760;line-height:1.18;color:rgba(255,255,255,.3);padding:12px 0;cursor:pointer;transition:color .22s ease,transform .22s ease,opacity .22s ease;transform-origin:left center}
      .lyric-line:hover{color:rgba(255,255,255,.7)}
      .lyric-line.active{color:#fff;transform:scale(1.025);text-shadow:0 8px 34px rgba(255,255,255,.15)}
      .lyric-line.past{color:rgba(255,255,255,.56)}
      .lyrics-state{min-height:100%;display:grid;place-items:center;text-align:center;color:rgba(255,255,255,.62);padding:40px;font-size:17px;line-height:1.5}
      @media(max-width:900px){.player-extra-actions{margin-left:0}.player-extra-button{width:40px;height:40px}.lyrics-panel{inset:0;width:100%;border-radius:0}.lyrics-body{padding:34px 22px 120px}.lyric-line{font-size:clamp(25px,8vw,36px)}.lyrics-backdrop{display:none}}
    `;
    document.head.append(style);
  }

  function injectControls() {
    const bar = document.querySelector('.player-bar');
    if (!bar || document.getElementById('likeCurrentBtn')) return;
    const tools = bar.querySelector('.player-tools') || bar.lastElementChild;
    const actions = document.createElement('div');
    actions.className = 'player-extra-actions';
    actions.innerHTML = `
      <button id="likeCurrentBtn" class="player-extra-button" title="Добавить в понравившиеся" aria-label="Добавить в понравившиеся">
        <svg viewBox="0 0 24 24"><path class="heart-fill" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/></svg>
      </button>
      <button id="lyricsCurrentBtn" class="player-extra-button" title="Текст песни" aria-label="Текст песни">
        <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>
      </button>`;
    bar.insertBefore(actions, tools || null);
    document.getElementById('likeCurrentBtn').onclick = toggleLike;
    document.getElementById('lyricsCurrentBtn').onclick = toggleLyrics;
  }

  function injectLyricsPanel() {
    if (document.getElementById('lyricsPanel')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'lyricsBackdrop';
    backdrop.className = 'lyrics-backdrop';
    const panel = document.createElement('aside');
    panel.id = 'lyricsPanel';
    panel.className = 'lyrics-panel';
    panel.innerHTML = `
      <header class="lyrics-head">
        <img id="lyricsCover" alt="">
        <div class="lyrics-meta"><strong id="lyricsTitle">Текст песни</strong><span id="lyricsArtist"></span></div>
        <button id="lyricsClose" class="lyrics-close" aria-label="Закрыть">×</button>
      </header>
      <div id="lyricsBody" class="lyrics-body"><div class="lyrics-state">Включи песню и нажми кнопку текста</div></div>`;
    document.body.append(backdrop, panel);
    backdrop.onclick = closeLyrics;
    panel.querySelector('#lyricsClose').onclick = closeLyrics;
  }

  async function youtubeRequest(path, options = {}) {
    if (!state.googleToken) throw new Error('Сначала подключи Google/YouTube');
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
      ...options,
      headers: {Authorization: `Bearer ${state.googleToken}`, ...(options.headers || {})}
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch {}
      if (response.status === 401 || response.status === 403) {
        throw new Error('Переподключи Google, чтобы разрешить добавление лайков');
      }
      throw new Error(detail || `YouTube API: ${response.status}`);
    }
    if (response.status === 204) return {};
    return response.json();
  }

  async function updateLikeState() {
    const button = document.getElementById('likeCurrentBtn');
    const videoId = state.currentSong?.videoId || '';
    if (!button) return;
    button.classList.remove('active');
    likedVideoId = '';
    if (!videoId || !state.googleToken) return;
    try {
      const data = await youtubeRequest(`videos/getRating?id=${encodeURIComponent(videoId)}`);
      if (data.items?.[0]?.rating === 'like') {
        likedVideoId = videoId;
        button.classList.add('active');
        button.title = 'Убрать из понравившихся';
      } else {
        button.title = 'Добавить в понравившиеся';
      }
    } catch (error) {
      console.debug('Не удалось получить рейтинг трека:', error);
    }
  }

  async function toggleLike() {
    const song = state.currentSong;
    if (!song?.videoId) return toast('Сначала включи песню', 'error');
    if (!state.googleToken) return toast('Подключи Google/YouTube, чтобы ставить лайки', 'error');
    const button = document.getElementById('likeCurrentBtn');
    button.disabled = true;
    const removing = likedVideoId === song.videoId;
    try {
      await youtubeRequest(`videos/rate?id=${encodeURIComponent(song.videoId)}&rating=${removing ? 'none' : 'like'}`, {method: 'POST'});
      likedVideoId = removing ? '' : song.videoId;
      button.classList.toggle('active', !removing);
      button.title = removing ? 'Добавить в понравившиеся' : 'Убрать из понравившихся';
      toast(removing ? 'Удалено из понравившихся' : 'Добавлено в понравившиеся');
      if (typeof loadLibrary === 'function') setTimeout(() => loadLibrary().catch(() => {}), 350);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function parseSyncedLyrics(text) {
    return String(text || '').split(/\r?\n/).map((line) => {
      const match = line.match(/^\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?]\s*(.*)$/);
      if (!match) return null;
      const fraction = Number(`0.${match[3] || 0}`);
      return {time: Number(match[1]) * 60 + Number(match[2]) + fraction, text: match[4].trim() || '♪'};
    }).filter(Boolean).sort((a, b) => a.time - b.time);
  }

  function renderLyrics(record) {
    const body = document.getElementById('lyricsBody');
    const synced = parseSyncedLyrics(record?.syncedLyrics);
    lyricLines = synced;
    if (synced.length) {
      body.innerHTML = synced.map((line, index) => `<div class="lyric-line" data-index="${index}" data-time="${line.time}">${esc(line.text)}</div>`).join('');
      body.querySelectorAll('.lyric-line').forEach((node) => {
        node.onclick = () => {
          if (state.playerReady) state.player.seekTo(Number(node.dataset.time || 0), true);
          if (state.roomCode) setTimeout(() => broadcastSync(true), 30);
        };
      });
      startLyricClock();
      return;
    }
    const plain = String(record?.plainLyrics || '').trim();
    if (plain) {
      lyricLines = [];
      body.innerHTML = plain.split(/\r?\n/).map((line) => `<div class="lyric-line">${esc(line || '♪')}</div>`).join('');
      return;
    }
    body.innerHTML = `<div class="lyrics-state">Для этой песни текст пока не найден</div>`;
  }

  function startLyricClock() {
    clearInterval(lyricTimer);
    let lastIndex = -1;
    lyricTimer = setInterval(() => {
      if (!lyricsOpen || !lyricLines.length || !state.playerReady) return;
      const current = Number(state.player.getCurrentTime?.() || 0);
      let active = -1;
      for (let index = 0; index < lyricLines.length; index += 1) {
        if (lyricLines[index].time <= current + 0.08) active = index;
        else break;
      }
      if (active === lastIndex) return;
      lastIndex = active;
      document.querySelectorAll('#lyricsBody .lyric-line').forEach((node, index) => {
        node.classList.toggle('active', index === active);
        node.classList.toggle('past', index < active);
      });
      const activeNode = document.querySelector(`#lyricsBody .lyric-line[data-index="${active}"]`);
      activeNode?.scrollIntoView({behavior: 'smooth', block: 'center'});
    }, 180);
  }

  async function loadLyrics(force = false) {
    const song = state.currentSong;
    const body = document.getElementById('lyricsBody');
    if (!song?.videoId) {
      body.innerHTML = '<div class="lyrics-state">Сначала включи песню</div>';
      return;
    }
    if (!force && lyricsVideoId === song.videoId && body.children.length) return;
    lyricsVideoId = song.videoId;
    lyricLines = [];
    clearInterval(lyricTimer);
    document.getElementById('lyricsTitle').textContent = song.title || 'Текст песни';
    document.getElementById('lyricsArtist').textContent = song.artist || '';
    document.getElementById('lyricsCover').src = song.thumbnail || '';
    body.innerHTML = '<div class="lyrics-state">Ищу синхронизированный текст…</div>';
    try {
      const params = new URLSearchParams({track_name: song.title || '', artist_name: song.artist || ''});
      const response = await fetch(`https://lrclib.net/api/search?${params}`, {
        headers: {'Lrclib-Client': 'Sync Music v2.1 (https://github.com/Misha123a/youtube-sinc)'}
      });
      if (!response.ok) throw new Error(`LRCLIB: ${response.status}`);
      const records = await response.json();
      const duration = Number(song.durationSeconds || state.player?.getDuration?.() || 0);
      const ranked = (records || []).sort((a, b) => {
        const aSynced = a.syncedLyrics ? 0 : 10000;
        const bSynced = b.syncedLyrics ? 0 : 10000;
        const aDiff = duration ? Math.abs(Number(a.duration || 0) - duration) : 0;
        const bDiff = duration ? Math.abs(Number(b.duration || 0) - duration) : 0;
        return (aSynced + aDiff) - (bSynced + bDiff);
      });
      renderLyrics(ranked[0]);
    } catch (error) {
      console.error('Lyrics error:', error);
      body.innerHTML = '<div class="lyrics-state">Не удалось загрузить текст песни. Попробуй ещё раз позже.</div>';
    }
  }

  function openLyrics() {
    lyricsOpen = true;
    document.getElementById('lyricsPanel')?.classList.add('open');
    document.getElementById('lyricsBackdrop')?.classList.add('open');
    document.getElementById('lyricsCurrentBtn')?.classList.add('active');
    loadLyrics();
    startLyricClock();
  }

  function closeLyrics() {
    lyricsOpen = false;
    document.getElementById('lyricsPanel')?.classList.remove('open');
    document.getElementById('lyricsBackdrop')?.classList.remove('open');
    document.getElementById('lyricsCurrentBtn')?.classList.remove('active');
  }

  function toggleLyrics() {
    if (lyricsOpen) closeLyrics(); else openLyrics();
  }

  function hookTrackChanges() {
    if (typeof updatePlayerUI !== 'function') {
      setTimeout(hookTrackChanges, 200);
      return;
    }
    const originalUpdatePlayerUI = updatePlayerUI;
    updatePlayerUI = function updatePlayerUIWithExtras(song) {
      const result = originalUpdatePlayerUI(song);
      lyricsVideoId = '';
      lyricLines = [];
      clearInterval(lyricTimer);
      updateLikeState();
      if (lyricsOpen) loadLyrics(true);
      return result;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectControls();
    injectLyricsPanel();
    installGoogleScopeUpgrade();
    hookTrackChanges();
    updateLikeState();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && lyricsOpen) closeLyrics();
    });
  });
})();
