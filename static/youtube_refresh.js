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
  let transitionGuardUntil = 0;
  let lastAdvanceIdentity = '';
  let lastAdvanceAt = 0;

  const isHost = () => Boolean(
    state.roomCode && state.roomHost && state.username &&
    state.roomHost.toLowerCase() === state.username.toLowerCase()
  );

  const previousHandleSocketMessage = handleSocketMessage;
  handleSocketMessage = function handleSocketMessageWithAdvanceGuard(message) {
    if (message?.type === 'queue_play' && message.song?.videoId) {
      transitionGuardUntil = Date.now() + TRANSITION_GUARD_MS;
      lastAdvanceIdentity = '';
      lastAdvanceAt = 0;
    }
    previousHandleSocketMessage(message);
  };

  const previousRequestAutoAdvance = requestAutoAdvance;
  requestAutoAdvance = function requestAutoAdvanceOnce(reason = 'ended') {
    if (!state.roomCode) return previousRequestAutoAdvance(reason);
    if (!isHost() || Date.now() < transitionGuardUntil) return;

    const identity = String(state.currentQueueId || state.currentSong?.videoId || '');
    if (!identity) return;
    if (lastAdvanceIdentity === identity && Date.now() - lastAdvanceAt < 5000) return;

    lastAdvanceIdentity = identity;
    lastAdvanceAt = Date.now();
    previousRequestAutoAdvance(reason);
  };
})();
