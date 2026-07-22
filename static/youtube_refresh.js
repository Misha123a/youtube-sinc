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
