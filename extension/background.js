/**
 * SaarthiFlow Chrome Extension - Background Service Worker (Manifest V3)
 * Manages extension lifecycle, badge indicators, and background API proxying.
 */

// Import config and API into service worker scope
try {
  importScripts('config.js', 'api.js');
} catch (e) {
  console.warn('[SaarthiFlow Background] importScripts failed:', e);
}

const BADGE_COLORS = {
  DEMO: '#8b5cf6',
  LIVE: '#10b981',
  GMAIL: '#ea4335',
  ERROR: '#ef4444'
};

/**
 * Update extension action badge based on current mode
 */
async function refreshBadge() {
  try {
    if (!chrome?.action?.setBadgeText) return;

    const settings = await (globalThis.SF_CONFIG ? globalThis.SF_CONFIG.getSettings() : Promise.resolve({ mode: 'live' }));
    if (settings.mode === 'demo') {
      await chrome.action.setBadgeText({ text: 'DEMO' });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.DEMO });
    } else {
      await chrome.action.setBadgeText({ text: 'LIVE' });
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.LIVE });
    }
  } catch (err) {
    console.debug('[SaarthiFlow] Badge update non-fatal:', err);
  }
}

// Lifecycle: Extension installed or updated
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[SaarthiFlow] Extension installed/updated:', details.reason);
  try {
    if (globalThis.SF_CONFIG) {
      await globalThis.SF_CONFIG.getSettings();
    }
    await refreshBadge();
  } catch (e) {
    console.warn('[SaarthiFlow] onInstalled handler warning:', e);
  }
});

// Lifecycle: Browser startup
chrome.runtime.onStartup.addListener(() => {
  refreshBadge();
});

// Runtime message listener for background tasks & API proxying
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  switch (request.action) {
    case 'SF_PING':
      sendResponse({ status: 'pong', timestamp: Date.now() });
      break;

    case 'SF_UPDATE_BADGE':
      if (request.text !== undefined) {
        chrome.action.setBadgeText({ text: request.text });
        if (request.color) {
          chrome.action.setBadgeBackgroundColor({ color: request.color });
        }
      } else {
        refreshBadge();
      }
      sendResponse({ success: true });
      break;

    case 'SF_REFRESH_SETTINGS':
      refreshBadge().then(() => sendResponse({ success: true }));
      return true;

    // Background Fetch Proxy (Executes fetch from service worker to bypass popup CORS boundaries)
    case 'SF_API_PROXY': {
      const { url, method = 'GET', headers = {}, body } = request;
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs || 25000;
      const tid = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOptions = {
        method,
        headers: {
          'Accept': 'application/json',
          ...headers
        },
        signal: controller.signal
      };

      if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        fetchOptions.headers['Content-Type'] = 'application/json';
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      fetch(url, fetchOptions)
        .then(async (res) => {
          clearTimeout(tid);
          let responseData = null;
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            try { responseData = await res.json(); } catch { responseData = null; }
          } else {
            responseData = await res.text();
          }

          sendResponse({
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            data: responseData
          });
        })
        .catch((err) => {
          clearTimeout(tid);
          sendResponse({
            ok: false,
            status: 0,
            error: err.name === 'AbortError' ? `Request timed out after ${timeoutMs / 1000}s` : err.message
          });
        });

      return true; // Asynchronous reply
    }

    default:
      sendResponse({ success: false, error: 'Unknown action' });
      break;
  }

  return false;
});
