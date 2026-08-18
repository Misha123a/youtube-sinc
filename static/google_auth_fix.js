'use strict';

/* google-auth-user-gesture-only-v1 */
(() => {
  const install = () => {
    if (window.__syncGoogleGestureFixInstalled) return;
    if (typeof initGoogleClient !== 'function') {
      setTimeout(install, 100);
      return;
    }

    window.__syncGoogleGestureFixInstalled = true;
    const previousInitGoogleClient = initGoogleClient;

    initGoogleClient = function initGoogleClientUserGestureOnly() {
      const client = previousInitGoogleClient();
      if (!client || client.__syncGestureWrapped) return client;

      const originalRequestAccessToken = client.requestAccessToken.bind(client);
      client.requestAccessToken = (options = {}) => {
        const prompt = String(options?.prompt || '');
        const explicitConsent = prompt === 'consent' || prompt === 'select_account';
        const userActivated = Boolean(navigator.userActivation?.isActive);

        if (!explicitConsent && !userActivated) {
          const error = new Error('Google token renewal requires explicit user action');
          error.code = 'background_oauth_blocked';
          throw error;
        }

        return originalRequestAccessToken(options);
      };
      client.__syncGestureWrapped = true;
      return client;
    };

    // Rebuild the cached token client so every future request goes through the guard.
    if (typeof state !== 'undefined' && state) state.googleClient = null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), {once: true});
  } else {
    setTimeout(install, 0);
  }
})();
