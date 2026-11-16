/**
 * SaarthiFlow Chrome Extension - API & Agentic Orchestration Layer
 * Connects the Chrome Extension to the deployed SaarthiFlow Render backend,
 * NVIDIA AI Planning endpoint (/api/agent/plan), and Approvals workflow.
 */

(function (root) {
  'use strict';

  const uid = (prefix = 'sf') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return toISODate(d);
  }

  function parseDateString(str) {
    if (!str) return null;
    const clean = str.replace(/(?:st|nd|rd|th)/gi, '').trim();
    const parsed = Date.parse(clean);
    if (!isNaN(parsed)) {
      const dt = new Date(parsed);
      if (dt.getFullYear() >= 2024 && dt.getFullYear() <= 2035) {
        return toISODate(dt);
      }
    }
    return null;
  }

  /**
   * Helper to perform fetch with background proxy fallback for CORS handling
   */
  async function safeFetch(url, options = {}) {
    const timeoutMs = options.timeoutMs || root.SF_CONFIG.LIMITS.REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
        signal: controller.signal
      });
      clearTimeout(tid);

      let data = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        try { data = await res.json(); } catch { data = null; }
      } else {
        data = await res.text();
      }

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        data: data
      };
    } catch (err) {
      clearTimeout(tid);

      // Try background proxy if direct fetch failed (e.g. CORS or network restriction in popup)
      if (chrome?.runtime?.sendMessage) {
        try {
          const proxyRes = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'SF_API_PROXY',
              url,
              method: options.method || 'GET',
              headers,
              body: options.body,
              timeoutMs
            }, resolve);
          });

          if (proxyRes && (proxyRes.ok || proxyRes.status > 0)) {
            return proxyRes;
          }
        } catch {
          // Keep original error
        }
      }

      const isAbort = err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        error: isAbort ? `Request timed out after ${timeoutMs / 1000}s. The Render server may be waking from sleep.` : err.message
      };
    }
  }

  const SF_API = {
    /**
     * Helper to get full endpoint URL
     */
    getUrl(settings, endpoint) {
      const base = settings?.backendUrl || root.SF_CONFIG.DEFAULTS.backendUrl;
      return root.SF_CONFIG.buildApiUrl(base, endpoint);
    },

    /**
     * Check backend connectivity & services health
     */
    async checkHealth(settings) {
      if (settings.mode === 'demo') {
        return {
          ok: true,
          mode: 'demo',
          status: 200,
          message: 'Local Demo Mode Active (Offline testing)'
        };
      }

      const endpoint = this.getUrl(settings, root.SF_CONFIG.ENDPOINTS.health);
      const res = await safeFetch(endpoint, {
        method: 'GET',
        timeoutMs: 12000
      });

      if (res.ok) {
        return {
          ok: true,
          mode: 'live',
          status: res.status,
          activeUrl: settings.backendUrl,
          data: res.data,
          message: `Connected to SaarthiFlow Backend (${res.data?.aiProvider || 'NVIDIA AI Ready'})`
        };
      } else {
        const errorDetail = res.error || `HTTP ${res.status}: ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '')}`;
        return {
          ok: false,
          mode: 'live',
          status: res.status,
          error: errorDetail.includes('timed out')
            ? 'Backend waking up on Render. Free-tier servers sleep after inactivity (~30-50s to wake).'
            : `Unable to connect to ${settings.backendUrl}: ${errorDetail}`
        };
      }
    },

    /**
     * PRIMARY AGENTIC FLOW: Turn Page or Email Content Into Actions
     * Calls SaarthiFlow NVIDIA AI endpoint: /api/agent/plan
     */
    async planPageActions(contentData, settings) {
      await this.recordRecentCapture(contentData);

      if (settings.mode === 'demo') {
        return this._demoPlanPageActions(contentData);
      } else {
        return this._livePlanPageActions(contentData, settings);
      }
    },

    /**
     * LIVE PLANNING VIA NVIDIA AI ON SAARTHIFLOW BACKEND
     */
    async _livePlanPageActions(contentData, settings) {
      const endpoint = this.getUrl(settings, root.SF_CONFIG.ENDPOINTS.agentPlan);
      const opp = contentData.opportunity || {};

      let command = '';
      if (contentData.isGmail && contentData.emailData) {
        command = `Analyze email: "${contentData.emailData.subject}" from "${contentData.emailData.sender}". Extract key deadlines, deliverables, and actionable tasks.`;
      } else {
        command = `Extract actionable tasks, deadlines, and requirements for ${opp.categoryName || 'opportunity'}: "${opp.opportunityTitle || contentData.title}"`;
      }

      const payload = {
        command: command,
        webpageUrl: contentData.url,
        webpageText: contentData.extractedText,
        opportunity: opp
      };

      const headers = {};
      if (settings.authToken) {
        headers['Authorization'] = `Bearer ${settings.authToken.trim()}`;
      }

      const res = await safeFetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: payload,
        timeoutMs: root.SF_CONFIG.LIMITS.REQUEST_TIMEOUT_MS
      });

      if (!res.ok) {
        const errorText = typeof res.data === 'object' && res.data?.error ? res.data.error : (res.error || `Planning failed (HTTP ${res.status})`);
        throw new Error(errorText);
      }

      const data = res.data || {};

      const mappedTasks = (data.tasks || []).map((t, idx) => ({
        id: t.id || uid(`task-${idx}`),
        title: t.title || 'Untitled Action',
        description: t.description || `Action derived from ${contentData.domain}`,
        priority: t.priority || 'Medium',
        due: t.due || addDays(4),
        project: t.project || opp.categoryName || (contentData.isGmail ? 'Email' : 'General'),
        actionType: t.actionType || 'create_task',
        selected: true
      }));

      return {
        success: true,
        mode: 'live',
        isDemo: false,
        isActionable: mappedTasks.length > 0,
        categoryName: opp.categoryName || (contentData.isGmail ? 'Email Action Item' : 'Webpage'),
        categoryIcon: opp.categoryIcon || (contentData.isGmail ? '✉️' : '🎯'),
        opportunity: opp,
        summary: data.summary || (contentData.isGmail ? `Email analysis summary for "${contentData.title}"` : `AI Action Plan drafted by SaarthiFlow Agent.`),
        tasks: mappedTasks,
        proposalId: data.proposalId || null,
        runId: data.runId || null,
        model: data.model || 'nvidia/nemotron',
        isSimulated: Boolean(data.isSimulated)
      };
    },

    /**
     * HUMAN-IN-THE-LOOP APPROVAL EXECUTION
     * Approves proposed tasks and creates them in the database via /api/approvals/:id/approve
     */
    async approveTasks(proposalId, tasks, settings) {
      if (settings.mode === 'demo') {
        const record = {
          id: proposalId || uid('demo-prop'),
          title: 'Approved Tasks',
          status: 'approved',
          tasks: tasks,
          approvedAt: Date.now(),
          isDemo: true
        };
        await this.saveDemoProposal(record);
        return {
          success: true,
          mode: 'demo',
          count: tasks.length,
          message: `${tasks.length} task(s) approved and saved locally (Demo Mode).`
        };
      }

      const headers = {};
      if (settings.authToken) {
        headers['Authorization'] = `Bearer ${settings.authToken.trim()}`;
      }

      // 1. If proposalId exists, use the official Human-in-the-Loop decision endpoint
      if (proposalId) {
        const approveEndpoint = this.getUrl(settings, `${root.SF_CONFIG.ENDPOINTS.approvals}/${proposalId}/approve`);
        const res = await safeFetch(approveEndpoint, {
          method: 'POST',
          headers: headers,
          body: {
            tasks: tasks.map(t => ({
              title: t.title,
              priority: t.priority || 'Medium',
              due: t.due,
              project: t.project || 'General',
              status: t.status || 'todo',
              actionType: t.actionType || 'create_task'
            }))
          },
          timeoutMs: 15000
        });

        if (res.ok) {
          return {
            success: true,
            mode: 'live',
            count: tasks.length,
            message: `Successfully approved and created ${tasks.length} task(s) in SaarthiFlow!`
          };
        } else {
          console.warn('[SaarthiFlow] Approval endpoint failed, falling back to direct task creation:', res.error || res.data);
        }
      }

      // 2. Direct Task Creation Fallback via POST /api/tasks
      const tasksEndpoint = this.getUrl(settings, root.SF_CONFIG.ENDPOINTS.tasks);
      let createdCount = 0;

      for (const t of tasks) {
        try {
          const res = await safeFetch(tasksEndpoint, {
            method: 'POST',
            headers: headers,
            body: {
              title: t.title,
              project: t.project || 'General',
              priority: t.priority || 'Medium',
              status: 'todo',
              due: t.due || addDays(4)
            },
            timeoutMs: 10000
          });
          if (res.ok) createdCount++;
        } catch (e) {
          console.warn('[SaarthiFlow] Task creation error:', e);
        }
      }

      if (createdCount > 0) {
        return {
          success: true,
          mode: 'live',
          count: createdCount,
          message: `Created ${createdCount} task(s) in SaarthiFlow My Space!`
        };
      } else {
        throw new Error('Failed to create tasks on the backend. Please check connection.');
      }
    },

    /**
     * Submit Proposal for Later Review in Dashboard
     */
    async submitProposalForApproval(proposalData, settings) {
      if (settings.mode === 'demo') {
        return this._demoSubmitProposal(proposalData);
      }

      const headers = {};
      if (settings.authToken) {
        headers['Authorization'] = `Bearer ${settings.authToken.trim()}`;
      }

      // If already has proposalId, update it via PATCH
      if (proposalData.proposalId) {
        const patchEndpoint = this.getUrl(settings, `${root.SF_CONFIG.ENDPOINTS.approvals}/${proposalData.proposalId}`);
        const res = await safeFetch(patchEndpoint, {
          method: 'PATCH',
          headers: headers,
          body: {
            tasks: proposalData.tasks.map(t => ({
              title: t.title,
              priority: t.priority,
              due: t.due,
              project: t.project,
              actionType: t.actionType || 'create_task'
            }))
          }
        });

        if (res.ok) {
          return {
            success: true,
            mode: 'live',
            proposalId: proposalData.proposalId,
            status: 'Awaiting Approval',
            message: 'Plan submitted successfully! Awaiting approval in SaarthiFlow.'
          };
        }
      }

      // Direct task approval
      return this.approveTasks(proposalData.proposalId, proposalData.tasks, settings);
    },

    /**
     * QUICK TASK CREATION: Create a manual task directly
     */
    async createQuickTask(taskData, settings) {
      if (settings.mode === 'demo') {
        return {
          success: true,
          mode: 'demo',
          task: { ...taskData, id: uid('task') },
          message: 'Quick Task saved locally (Demo Mode)'
        };
      }

      const endpoint = this.getUrl(settings, root.SF_CONFIG.ENDPOINTS.tasks);
      const headers = {};
      if (settings.authToken) {
        headers['Authorization'] = `Bearer ${settings.authToken.trim()}`;
      }

      const res = await safeFetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: taskData,
        timeoutMs: 12000
      });

      if (!res.ok) {
        const errText = typeof res.data === 'object' && res.data?.error ? res.data.error : (res.error || `HTTP ${res.status}`);
        throw new Error(`Unable to create task on backend: ${errText}`);
      }

      return {
        success: true,
        mode: 'live',
        task: res.data,
        message: 'Task created successfully in SaarthiFlow My Space!'
      };
    },

    // -------------------------------------------------------------
    // DEMO / OFFLINE PLANNER
    // -------------------------------------------------------------
    _demoPlanPageActions(contentData) {
      const opp = contentData.opportunity || {};
      const dates = contentData.dates || [];
      const title = opp.opportunityTitle || contentData.title || 'Page';

      let nearestDueDate = null;
      for (const d of dates) {
        const parsed = parseDateString(d.text);
        if (parsed) {
          nearestDueDate = parsed;
          break;
        }
      }

      const tasks = [];
      let summary = '';

      if (contentData.isGmail) {
        summary = `Email action plan for "${title}". Extracted action items and deadlines from sender.`;
        tasks.push({
          id: uid('t'),
          title: `Review email & required deliverables for "${title.slice(0, 45)}"`,
          description: `Analyze requests from ${opp.organizer || 'sender'}`,
          priority: 'High',
          due: addDays(2),
          project: 'Email',
          selected: true
        });
        tasks.push({
          id: uid('t'),
          title: `Draft response and complete requested tasks`,
          description: `Send reply to ${opp.organizer || 'sender'} with deliverables`,
          priority: 'High',
          due: nearestDueDate || addDays(4),
          project: 'Email',
          selected: true
        });
      } else {
        switch (opp.pageType) {
          case 'hackathon':
            summary = `Action plan for Hackathon "${title}". Extracted key deadlines and project submission criteria.`;
            tasks.push({
              id: uid('t'),
              title: `Complete team registration for ${title}`,
              description: `Register on portal before deadline (${opp.primaryDeadline})`,
              priority: 'High',
              due: nearestDueDate || addDays(3),
              project: 'Hackathon',
              selected: true
            });
            tasks.push({
              id: uid('t'),
              title: `Build MVP prototype and record walkthrough video`,
              description: `Prepare public GitHub repository and demo`,
              priority: 'High',
              due: nearestDueDate || addDays(7),
              project: 'Hackathon',
              selected: true
            });
            break;

          case 'article':
            summary = `Reading summary and action items for article: "${title}".`;
            tasks.push({
              id: uid('t'),
              title: `Review key takeaways & notes from "${title.slice(0, 45)}"`,
              description: `Summarize core ideas for reference`,
              priority: 'Medium',
              due: addDays(3),
              project: 'Learning',
              selected: true
            });
            break;

          default:
            summary = `Action plan for "${title}".`;
            tasks.push({
              id: uid('t'),
              title: `Review and follow up on ${title.slice(0, 50)}`,
              description: `Action item extracted from ${contentData.domain}`,
              priority: 'Medium',
              due: nearestDueDate || addDays(4),
              project: 'General',
              selected: true
            });
            break;
        }
      }

      return {
        success: true,
        mode: 'demo',
        isDemo: true,
        isActionable: true,
        categoryName: opp.categoryName || 'General',
        categoryIcon: opp.categoryIcon || '🎯',
        opportunity: opp,
        summary: summary,
        tasks: tasks,
        proposalId: uid('demo-prop')
      };
    },

    async _demoSubmitProposal(proposalData) {
      const proposalId = proposalData.proposalId || uid('demo-prop');
      const record = {
        id: proposalId,
        title: proposalData.title || 'Action Plan',
        url: proposalData.url || '',
        source: 'Chrome Extension (Demo)',
        created: Date.now(),
        status: 'pending',
        summary: proposalData.summary || '',
        tasks: proposalData.tasks || [],
        isDemo: true
      };

      await this.saveDemoProposal(record);

      return {
        success: true,
        mode: 'demo',
        isDemo: true,
        proposalId: proposalId,
        status: 'Awaiting Approval',
        message: 'Plan saved locally in Chrome storage (Demo Mode).'
      };
    },

    // -------------------------------------------------------------
    // STORAGE & RECENT CAPTURES
    // -------------------------------------------------------------
    async recordRecentCapture(contentData) {
      if (!chrome?.storage?.local) return;
      try {
        const key = root.SF_CONFIG.STORAGE_KEYS.RECENT_CAPTURES;
        chrome.storage.local.get([key], (res) => {
          const list = res[key] || [];
          const item = {
            url: contentData.url,
            title: contentData.opportunity?.opportunityTitle || contentData.title,
            category: contentData.opportunity?.categoryName || 'General',
            categoryIcon: contentData.opportunity?.categoryIcon || '🌐',
            isGmail: Boolean(contentData.isGmail),
            timestamp: Date.now()
          };

          const filtered = list.filter(x => x.url !== item.url);
          filtered.unshift(item);
          const trimmed = filtered.slice(0, root.SF_CONFIG.LIMITS.MAX_RECENT_CAPTURES);

          const obj = {};
          obj[key] = trimmed;
          chrome.storage.local.set(obj);
        });
      } catch (e) {
        console.debug('[SaarthiFlow] Record capture non-fatal:', e);
      }
    },

    async getRecentCaptures() {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve([]);
        chrome.storage.local.get([root.SF_CONFIG.STORAGE_KEYS.RECENT_CAPTURES], (res) => {
          resolve(res[root.SF_CONFIG.STORAGE_KEYS.RECENT_CAPTURES] || []);
        });
      });
    },

    async getDemoProposals() {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve([]);
        chrome.storage.local.get([root.SF_CONFIG.STORAGE_KEYS.DEMO_PROPOSALS], (res) => {
          resolve(res[root.SF_CONFIG.STORAGE_KEYS.DEMO_PROPOSALS] || []);
        });
      });
    },

    async saveDemoProposal(proposal) {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve();
        chrome.storage.local.get([root.SF_CONFIG.STORAGE_KEYS.DEMO_PROPOSALS], (res) => {
          const list = res[root.SF_CONFIG.STORAGE_KEYS.DEMO_PROPOSALS] || [];
          list.unshift(proposal);
          const trimmed = list.slice(0, root.SF_CONFIG.LIMITS.MAX_SAVED_PROPOSALS);
          const obj = {};
          obj[root.SF_CONFIG.STORAGE_KEYS.DEMO_PROPOSALS] = trimmed;
          chrome.storage.local.set(obj, () => resolve(trimmed));
        });
      });
    },

    async clearDemoProposals() {
      return new Promise((resolve) => {
        if (!chrome?.storage?.local) return resolve();
        const obj = {};
        obj[root.SF_CONFIG.STORAGE_KEYS.DEMO_PROPOSALS] = [];
        chrome.storage.local.set(obj, () => resolve());
      });
    }
  };

  root.SF_API = SF_API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
