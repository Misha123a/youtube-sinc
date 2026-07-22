'use strict';

(() => {
  const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  let refreshInProgress = false;
  let refreshTimer = null;

  const refreshButtons = () => [
    document.getElementById('refreshLibraryBtn'),
    document.getElementById('libraryRefreshTopBtn')
  ].filter(Boolean);

  const youtubeConnected = () => {
    const connectedBlock = document.getElementById('youtubeConnected');
    return connectedBlock && !connectedBlock.classList.contains('hidden');
  };

  const setRefreshingState = (refreshing) => {
    refreshButtons().forEach((button) => {
      if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent.trim();
      button.disabled = refreshing;
      button.setAttribute('aria-busy', String(refreshing));
      button.classList.toggle('youtube-refreshing', refreshing);
      button.textContent = refreshing ? 'Обновление…' : button.dataset.defaultText;
    });

    document.getElementById('homeRecommendations')?.classList.toggle('youtube-content-refreshing', refreshing);
    document.getElementById('libraryContent')?.classList.toggle('youtube-content-refreshing', refreshing);
  };

  const showRefreshResult = () => {
    refreshButtons().forEach((button) => {
      button.textContent = '✓ Обновлено';
      setTimeout(() => {
        if (!refreshInProgress && button.isConnected) {
          button.textContent = button.dataset.defaultText || 'Обновить';
        }
      }, 1300);
    });
  };

  async function refreshYouTubeRecommendations({silent = false} = {}) {
    if (refreshInProgress || !youtubeConnected() || typeof window.loadLibrary !== 'function') return;

    refreshInProgress = true;
    setRefreshingState(true);

    try {
      await window.loadLibrary();
      if (!silent) showRefreshResult();
    } catch (error) {
      console.error('Не удалось обновить рекомендации YouTube Music:', error);
    } finally {
      refreshInProgress = false;
      setRefreshingState(false);
    }
  }

  const startBackgroundRefresh = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (!document.hidden && youtubeConnected()) {
        refreshYouTubeRecommendations({silent: true});
      }
    }, REFRESH_INTERVAL_MS);
  };

  const injectStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
      .youtube-refreshing { cursor: wait; opacity: .72; }
      .youtube-content-refreshing { opacity: .48; filter: saturate(.72); transition: opacity .2s ease, filter .2s ease; pointer-events: none; }
    `;
    document.head.append(style);
  };

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();

    refreshButtons().forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        refreshYouTubeRecommendations();
      };
    });

    startBackgroundRefresh();
  });
})();

/* host-authoritative-room-sync-v1 */
(() => {
  const isHost = () => Boolean(state.roomCode && state.roomHost && state.username && state.roomHost.toLowerCase() === state.username.toLowerCase());
  const originalHandleSocketMessage = handleSocketMessage;

  broadcastSync = function broadcastSyncHostOnly(force = false) {
    if (!state.roomCode || !state.currentSong || !state.playerReady) return;
    if (!force && !isHost()) return;
    sendWS({
      type: 'sync',
      videoId: state.currentSong.videoId,
      state: state.playing ? 'playing' : 'paused',
      time: state.player.getCurrentTime?.() || 0,
      ts: Date.now(),
      song: state.currentSong
    });
  };

  handleSocketMessage = function handleSocketMessageHostOnly(message) {
    if (message?.type === 'request_state') {
      if (isHost()) broadcastSync(true);
      return;
    }
    originalHandleSocketMessage(message);
  };

  applyRemoteSync = function applyRemoteSyncStable(message) {
    if (!message?.videoId) return;

    const song = message.song || {
      videoId: message.videoId,
      title: 'YouTube',
      artist: 'Синхронизация'
    };
    const remotePlaying = message.state === 'playing';
    const networkDelay = remotePlaying
      ? Math.min(1.5, Math.max(0, (Date.now() - (message.ts || Date.now())) / 1000))
      : 0;
    const target = Math.max(0, Number(message.time || 0) + networkDelay);

    state.suppressPlayerEvent = true;
    clearTimeout(state.syncRateResetTimer);
    try { state.player?.setPlaybackRate?.(1); } catch {}

    if (!state.currentSong || state.currentSong.videoId !== message.videoId) {
      state.currentSong = song;
      updatePlayerUI(song);
      playSongInternal(song, remotePlaying, target);
      setTimeout(() => { state.suppressPlayerEvent = false; }, 1100);
      return;
    }

    if (state.playerReady) {
      const current = state.player.getCurrentTime?.() || 0;
      const drift = Math.abs(target - current);

      if (remotePlaying) {
        state.player.playVideo();
        if (drift > 2.25) state.player.seekTo(target, true);
      } else {
        state.player.pauseVideo();
        if (drift > 0.9) state.player.seekTo(target, true);
      }
    }

    setTimeout(() => { state.suppressPlayerEvent = false; }, 1100);
  };

  togglePlayback = function togglePlaybackImmediate() {
    if (!state.playerReady || !state.currentSong) return;
    const shouldPlay = !state.playing;
    if (shouldPlay) state.player.playVideo();
    else state.player.pauseVideo();

    if (state.roomCode) {
      setTimeout(() => {
        state.playing = shouldPlay;
        broadcastSync(true);
      }, 40);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const seek = document.getElementById('seekBar');
    if (seek) {
      const originalSeek = seek.onchange;
      seek.onchange = (event) => {
        if (typeof originalSeek === 'function') originalSeek.call(seek, event);
        if (state.roomCode) setTimeout(() => broadcastSync(true), 20);
      };
    }
  });
})();

/* stale-track-rollback-guard-v1 */
(() => {
  let acceptedVideoId = state.currentSong?.videoId || '';
  let acceptedQueueId = state.currentQueueId || '';
  let trackSwitchAt = 0;
  const STALE_SYNC_GUARD_MS = 8000;
  const previousHandleSocketMessage = handleSocketMessage;

  handleSocketMessage = function handleSocketMessageWithTrackGuard(message) {
    if (!message) return;

    if (message.type === 'queue_play' && message.song?.videoId) {
      acceptedVideoId = String(message.song.videoId);
      acceptedQueueId = String(message.currentQueueId || '');
      trackSwitchAt = Date.now();
      previousHandleSocketMessage(message);
      return;
    }

    if (message.type === 'queue_updated') {
      const incomingQueueId = String(message.currentQueueId || '');
      if (incomingQueueId && incomingQueueId !== acceptedQueueId) {
        const item = (message.queue || []).find((entry) => String(entry.id) === incomingQueueId);
        if (item?.videoId) {
          acceptedQueueId = incomingQueueId;
          acceptedVideoId = String(item.videoId);
          trackSwitchAt = Date.now();
        }
      }
      previousHandleSocketMessage(message);
      return;
    }

    if (message.type === 'sync' && message.videoId) {
      const incomingVideoId = String(message.videoId);
      const currentVideoId = String(state.currentSong?.videoId || acceptedVideoId || '');
      const protectedVideoId = acceptedVideoId || currentVideoId;
      const insideGuardWindow = Date.now() - trackSwitchAt < STALE_SYNC_GUARD_MS;

      if (protectedVideoId && incomingVideoId !== protectedVideoId) {
        if (insideGuardWindow || currentVideoId === protectedVideoId) {
          console.debug('Ignored stale room sync', {
            incomingVideoId,
            protectedVideoId,
            acceptedQueueId
          });
          return;
        }
      }
    }

    previousHandleSocketMessage(message);
  };
})();
