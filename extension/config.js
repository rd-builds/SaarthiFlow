/**
 * SaarthiFlow Chrome Extension - Configuration & Settings Module
 * Centralizes defaults, storage keys, endpoints, and storage utilities.
 */

(function (root) {
  'use strict';

  const SF_CONFIG = {
    // Operating Modes
    MODES: {
      DEMO: 'demo',
      LIVE: 'live'
    },

    // Environment Presets
    PRESETS: {
      PRODUCTION: {
        label: 'Production (Render)',
        backendUrl: 'https://saarthiflow-t5lp.onrender.com/api',
        dashboardUrl: 'https://saarthi-flow-two.vercel.app/'
      },
      LOCAL: {
        label: 'Localhost (Dev)',
        backendUrl: 'http://localhost:3001/api',
        dashboardUrl: 'http://localhost:5173'
      }
    },

    // Default Configuration (Deployed backend is default)
    DEFAULTS: {
      mode: 'live',
      backendUrl: 'https://saarthiflow-t5lp.onrender.com/api',
      dashboardUrl: 'https://saarthi-flow-two.vercel.app/',
      autoDetectPageType: true,
      authToken: ''
    },

    // Chrome Storage Keys
    STORAGE_KEYS: {
      SETTINGS: 'sf_settings',
      LAST_PAGE: 'sf_last_page',
      LAST_ANALYSIS: 'sf_last_analysis',
      DEMO_PROPOSALS: 'sf_demo_proposals',
      RECENT_CAPTURES: 'sf_recent_captures',
      ACTIVE_JOB: 'sf_active_job'
    },

    // Backend API Endpoints Mapping
    ENDPOINTS: {
      health: '/health',
      agentPlan: '/agent/plan',     // Primary SaarthiFlow NVIDIA AI Planning & Proposal endpoint
      approvals: '/approvals',       // Approvals query and decision endpoint
      tasks: '/tasks',               // Quick Task direct creation endpoint
      activity: '/activity'          // Activity log endpoint
    },

    // Extension Limits & Safeguards
    LIMITS: {
      MAX_EXTRACT_CHARS: 12000,
      MAX_EMAIL_BODY_CHARS: 8000,
      MAX_SUMMARY_PREVIEW_CHARS: 240,
      REQUEST_TIMEOUT_MS: 30000, // Render cold start may take a bit longer
      MAX_SAVED_PROPOSALS: 50,
      MAX_RECENT_CAPTURES: 15
    },

    // Utility: Validate URL format
    isValidHttpUrl(urlString) {
      if (!urlString || typeof urlString !== 'string') return false;
      try {
        const parsed = new URL(urlString.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },

    // Utility: Normalize URL by stripping trailing slashes
    normalizeUrl(urlString) {
      if (!urlString || typeof urlString !== 'string') return '';
      return urlString.trim().replace(/\/+$/, '');
    },

    /**
     * Safely builds full endpoint URL handling variations:
     * e.g., base 'https://saarthiflow-t5lp.onrender.com/api' + endpoint '/health' -> '.../api/health'
     * e.g., base 'http://localhost:3001' + endpoint '/health' -> '.../api/health'
     * e.g., base 'http://localhost:3001/api' + endpoint '/api/health' -> '.../api/health'
     */
    buildApiUrl(baseUrl, endpointPath) {
      const cleanBase = this.normalizeUrl(baseUrl || this.DEFAULTS.backendUrl);
      let path = (endpointPath || '').trim();
      if (!path.startsWith('/')) path = '/' + path;

      const baseHasApi = cleanBase.endsWith('/api');
      const pathHasApi = path.startsWith('/api/');

      if (baseHasApi && pathHasApi) {
        // Strip duplicate /api from path
        return `${cleanBase}${path.substring(4)}`;
      } else if (!baseHasApi && !pathHasApi) {
        // Ensure /api is included
        return `${cleanBase}/api${path}`;
      } else {
        return `${cleanBase}${path}`;
      }
    },

    // Retrieve user settings from chrome.storage.local with defaults
    async getSettings() {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) {
          resolve({ ...SF_CONFIG.DEFAULTS });
          return;
        }

        chrome.storage.local.get([SF_CONFIG.STORAGE_KEYS.SETTINGS], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[SaarthiFlow] Failed to load settings:', chrome.runtime.lastError);
            resolve({ ...SF_CONFIG.DEFAULTS });
            return;
          }

          const stored = result[SF_CONFIG.STORAGE_KEYS.SETTINGS] || {};
          const merged = {
            mode: stored.mode === SF_CONFIG.MODES.DEMO ? SF_CONFIG.MODES.DEMO : SF_CONFIG.MODES.LIVE,
            backendUrl: SF_CONFIG.normalizeUrl(stored.backendUrl || SF_CONFIG.DEFAULTS.backendUrl),
            dashboardUrl: SF_CONFIG.normalizeUrl(stored.dashboardUrl || SF_CONFIG.DEFAULTS.dashboardUrl),
            autoDetectPageType: stored.autoDetectPageType !== undefined ? Boolean(stored.autoDetectPageType) : true,
            authToken: stored.authToken || ''
          };
          resolve(merged);
        });
      });
    },

    // Save user settings into chrome.storage.local
    async saveSettings(newSettings) {
      return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
          reject(new Error('chrome.storage.local not available'));
          return;
        }

        this.getSettings().then((current) => {
          const updated = {
            ...current,
            ...newSettings,
            backendUrl: SF_CONFIG.normalizeUrl(newSettings.backendUrl || current.backendUrl),
            dashboardUrl: SF_CONFIG.normalizeUrl(newSettings.dashboardUrl || current.dashboardUrl)
          };

          const payload = {};
          payload[SF_CONFIG.STORAGE_KEYS.SETTINGS] = updated;

          chrome.storage.local.set(payload, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(updated);
            }
          });
        });
      });
    }
  };

  // Expose to global/worker scope
  root.SF_CONFIG = SF_CONFIG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
