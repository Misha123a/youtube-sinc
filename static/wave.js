'use strict';

/* my-wave-v1 */
(() => {
  const MODES = {
    personal: {
      label: 'Для тебя',
      subtitle: 'То, что похоже на твою недавнюю музыку и любимые треки',
      query: ''
    },
    favorites: {
      label: 'Любимые',
      subtitle: 'Больше музыки рядом с тем, что ты уже лайкал',
      query: ''
    },
    energy: {
      label: 'Энергия',
      subtitle: 'Бодрее, громче и динамичнее',
      query: 'energetic dance electronic rock hits'
    },
    calm: {
      label: 'Спокойно',
      subtitle: 'Мягкая и спокойная музыка без резких переходов',
      query: 'chill calm dreamy mellow music'
    },
    nostalgia: {
      label: 'Ностальгия',
      subtitle: 'Знакомое настроение и музыка прошлых лет',
      query: '2000s 2010s nostalgic hits'
    }
  };

  let activeMode = storage.get('sync.waveMode', 'personal');
  let loading = false;

  const uniqueTracks = (tracks) => {
    const seen = new Set();
    return (tracks || []).filter((track) => {
      const id = String(track?.videoId || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  function getTasteSeeds() {
    const recent = Array.isArray(state.recent) ? state.recent : [];
    const liked = Array.isArray(state.library?.liked) ? state.library.liked : [];
    const current = state.currentSong?.videoId ? [state.currentSong] : [];

    if (activeMode === 'favorites') {
      return uniqueTracks([...liked.slice(0, 24), ...recent.slice(0, 12), ...current]);
    }

    return uniqueTracks([...current, ...recent.slice(0, 20), ...liked.slice(0, 18)]);
  }

  async function searchMoodSeed(query) {
    if (!query) return null;
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(state.token)}`);
      const items = data.results || [];
      if (!items.length) return null;
      const pool = items.slice(0, Math.min(8, items.length));
      return pool[Math.floor(Math.random() * pool.length)] || pool[0];
    } catch (error) {
      console.debug('Wave mood seed search failed', error);
      return null;
    }
  }

  async function fetchWaveTracks() {
    const taste = getTasteSeeds();
    const mode = MODES[activeMode] || MODES.personal;
    const moodSeed = await searchMoodSeed(mode.query);

    const current = moodSeed || taste[0] || state.currentSong;
    if (!current?.videoId) {
      throw new Error('Сначала послушай несколько треков или подключи YouTube Music');
    }

    const recent = uniqueTracks([
      ...(taste || []),
      ...(moodSeed ? [moodSeed] : [])
    ]).slice(0, 32);

    const exclude = uniqueTracks([
      ...(state.recent || []),
      ...(state.localQueue || []),
      ...(state.queue || [])
    ]).map((track) => track.videoId);

    const response = await api('/api/radio/smart', {
      method: 'POST',
      body: JSON.stringify({
        token: state.token,
        current,
        recent,
        exclude_video_ids: exclude,
        limit: 30
      })
    });

    let tracks = uniqueTracks(response.results || []);

    // Keep the wave recognizably personal: blend a few liked/recent tracks back in,
    // but never let them dominate the whole queue.
    const familiar = uniqueTracks([
      ...(activeMode === 'favorites' ? (state.library?.liked || []) : []),
      ...(state.recent || [])
    ]).filter((track) => track.videoId !== current.videoId);

    const mixed = [];
    let familiarIndex = 0;
    let freshIndex = 0;
    while ((freshIndex < tracks.length || familiarIndex < familiar.length) && mixed.length < 30) {
      for (let i = 0; i < 4 && freshIndex < tracks.length && mixed.length < 30; i += 1) {
        mixed.push(tracks[freshIndex++]);
      }
      if (familiarIndex < familiar.length && mixed.length < 30) {
        const candidate = familiar[familiarIndex++];
        if (!mixed.some((track) => track.videoId === candidate.videoId)) mixed.push(candidate);
      }
    }

    tracks = uniqueTracks(mixed.length ? mixed : tracks).slice(0, 30);
    if (!tracks.length) throw new Error('Не получилось собрать волну. Попробуй ещё раз');
    return tracks;
  }

  function setLoading(value) {
    loading = value;
    const button = document.getElementById('wavePlayBtn');
    if (!button) return;
    button.disabled = value;
    button.classList.toggle('loading', value);
    button.innerHTML = value
      ? '<span class="wave-spinner"></span><span>Собираю волну…</span>'
      : '<span class="wave-play-icon">▶</span><span>Запустить мою волну</span>';
  }

  async function startWave() {
    if (loading) return;
    setLoading(true);
    try {
      const tracks = await fetchWaveTracks();

      if (state.roomCode) {
        // Wave becomes the shared room queue. Keep the current room setting untouched;
        // users can still enable/disable Auto Queue separately.
        sendWS({type: 'queue_clear'});
        tracks.forEach((song, index) => {
          setTimeout(() => sendWS({type: 'queue_add', song: {...song, source: 'my_wave'}, playNow: index === 0}), index * 45);
        });
      } else {
        state.localQueue = tracks.map((song) => ({
          ...song,
          id: crypto.randomUUID().slice(0, 12),
          addedBy: 'Моя волна',
          votes: 0,
          source: 'my_wave'
        }));
        state.currentQueueId = state.localQueue[0].id;
        saveLocalQueue();
        playSongInternal(state.localQueue[0], true, 0);
        renderQueue();
      }

      const mode = MODES[activeMode] || MODES.personal;
      toast(`Моя волна · ${mode.label}`);
    } catch (error) {
      toast(error.message || 'Не удалось запустить волну', 'error');
    } finally {
      setLoading(false);
    }
  }

  function renderMode() {
    document.querySelectorAll('[data-wave-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.waveMode === activeMode);
    });
    const mode = MODES[activeMode] || MODES.personal;
    const subtitle = document.getElementById('waveSubtitle');
    if (subtitle) subtitle.textContent = mode.subtitle;
  }

  function injectWave() {
    const home = document.getElementById('view-home');
    if (!home || document.getElementById('myWaveCard')) return;

    const header = home.querySelector('.home-header');
    const card = document.createElement('section');
    card.id = 'myWaveCard';
    card.className = 'my-wave-card';
    card.innerHTML = `
      <div class="wave-orb" aria-hidden="true"><i></i><i></i><i></i><b>≈</b></div>
      <div class="wave-copy">
        <span class="home-overline">Персональное радио</span>
        <h2>Моя волна</h2>
        <p id="waveSubtitle"></p>
        <div class="wave-modes">
          ${Object.entries(MODES).map(([key, mode]) => `<button type="button" data-wave-mode="${key}">${mode.label}</button>`).join('')}
        </div>
      </div>
      <button id="wavePlayBtn" class="wave-play" type="button"><span class="wave-play-icon">▶</span><span>Запустить мою волну</span></button>
    `;

    if (header?.nextSibling) home.insertBefore(card, header.nextSibling);
    else home.prepend(card);

    card.querySelectorAll('[data-wave-mode]').forEach((button) => {
      button.onclick = () => {
        activeMode = button.dataset.waveMode || 'personal';
        storage.set('sync.waveMode', activeMode);
        renderMode();
      };
    });
    card.querySelector('#wavePlayBtn').onclick = startWave;
    renderMode();
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .my-wave-card{position:relative;display:grid;grid-template-columns:128px minmax(0,1fr) auto;align-items:center;gap:24px;overflow:hidden;margin:0 0 28px;padding:24px 26px;border:1px solid rgba(255,255,255,.1);border-radius:26px;background:radial-gradient(circle at 10% 20%,rgba(66,214,255,.18),transparent 34%),radial-gradient(circle at 78% 10%,rgba(174,92,255,.2),transparent 34%),linear-gradient(135deg,rgba(20,27,43,.95),rgba(12,15,25,.96));box-shadow:0 22px 60px rgba(0,0,0,.24)}
      .my-wave-card:after{content:"";position:absolute;inset:-80% -15%;background:linear-gradient(115deg,transparent 38%,rgba(255,255,255,.055) 50%,transparent 62%);transform:translateX(-60%);animation:waveShine 7s ease-in-out infinite;pointer-events:none}
      @keyframes waveShine{0%,65%{transform:translateX(-60%)}85%,100%{transform:translateX(60%)}}
      .wave-orb{position:relative;width:112px;height:112px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 38% 35%,#5ee7ff 0 7%,#7667ff 28%,#2b164d 62%,#11131d 100%);box-shadow:0 0 0 1px rgba(255,255,255,.12),0 18px 52px rgba(89,91,255,.28);isolation:isolate}
      .wave-orb i{position:absolute;inset:11px;border:1px solid rgba(255,255,255,.32);border-radius:48% 52% 55% 45%;animation:waveSpin 7s linear infinite}.wave-orb i:nth-child(2){inset:21px;animation-duration:5s;animation-direction:reverse}.wave-orb i:nth-child(3){inset:31px;animation-duration:3.6s}.wave-orb b{font-size:42px;font-weight:400;color:#fff;text-shadow:0 0 24px rgba(255,255,255,.75);z-index:2}
      @keyframes waveSpin{to{transform:rotate(360deg)}}
      .wave-copy{min-width:0}.wave-copy h2{margin:3px 0 7px;font-size:clamp(28px,3vw,40px);line-height:1}.wave-copy p{margin:0 0 16px;color:rgba(255,255,255,.62);max-width:760px}.wave-modes{display:flex;flex-wrap:wrap;gap:8px}.wave-modes button{border:1px solid rgba(255,255,255,.1);border-radius:999px;background:rgba(255,255,255,.055);color:rgba(255,255,255,.68);padding:8px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:.18s ease}.wave-modes button:hover{background:rgba(255,255,255,.1);color:#fff}.wave-modes button.active{color:#fff;background:linear-gradient(135deg,rgba(73,214,255,.22),rgba(139,92,246,.24));border-color:rgba(116,174,255,.42);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
      .wave-play{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 18px;border:0;border-radius:16px;background:#fff;color:#10131b;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 12px 30px rgba(255,255,255,.12);transition:.18s ease;white-space:nowrap}.wave-play:hover{transform:translateY(-2px);box-shadow:0 17px 36px rgba(255,255,255,.16)}.wave-play:disabled{cursor:wait;opacity:.72;transform:none}.wave-play-icon{font-size:16px}.wave-spinner{width:17px;height:17px;border:2px solid rgba(0,0,0,.2);border-top-color:#111;border-radius:50%;animation:waveSpin .8s linear infinite}
      @media(max-width:900px){.my-wave-card{grid-template-columns:82px minmax(0,1fr);gap:16px;padding:18px;border-radius:22px}.wave-orb{width:76px;height:76px}.wave-orb b{font-size:30px}.wave-orb i{inset:8px}.wave-orb i:nth-child(2){inset:15px}.wave-orb i:nth-child(3){inset:22px}.wave-copy h2{font-size:28px}.wave-copy p{font-size:14px;margin-bottom:13px}.wave-modes{grid-column:1/-1}.wave-play{grid-column:1/-1;width:100%;min-height:50px}.wave-modes button{flex:1 1 auto}}
      @media(max-width:520px){.my-wave-card{grid-template-columns:64px minmax(0,1fr);padding:16px 14px}.wave-orb{width:60px;height:60px}.wave-orb b{font-size:25px}.wave-copy h2{font-size:25px}.wave-modes{gap:6px}.wave-modes button{padding:7px 9px;font-size:12px}}
    `;
    document.head.append(style);
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    injectWave();
    setTimeout(injectWave, 500);
    setTimeout(injectWave, 1500);
  });
})();
