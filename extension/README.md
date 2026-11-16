# SaarthiFlow Chrome Extension — "Agents That Get Work Done"

> **From Browsing to Doing**  
> An Agentic AI Productivity Companion that transforms Gmail emails and web discoveries into structured, executable action plans with human-in-the-loop approvals.

---

## 1. Overview & Architecture

SaarthiFlow converts unstructured content from webpages and Gmail into actionable tasks powered by NVIDIA AI (`nemotron-3.5-bolt-e4b`) hosted on the deployed SaarthiFlow backend:

```text
DISCOVER (Page or Gmail) → EXTRACT (Targeted DOM) → PLAN (NVIDIA AI) → APPROVE (Human-in-the-Loop) → EXECUTE (Backend Database)
```

1. **DISCOVER**:
   - Detects Gmail (`mail.google.com`) and alerts user to open an email.
   - Detects opportunity types across articles, hackathons, job postings, GitHub repositories, workshops, events, and documentation.
2. **EXTRACT**:
   - **Gmail Reading**: Safely extracts sender, subject, date, and visible email body only when the user clicks **Read Email**. Does NOT scan inboxes or run in background.
   - **Webpage Reading**: Extracts headings, dates/deadlines, action links, and main content safely without touching passwords or hidden fields.
3. **PLAN**:
   - Dispatches extracted content to the deployed backend: `https://saarthiflow-t5lp.onrender.com/api/agent/plan` (configurable in settings for local dev).
   - Generates structured summaries, deadlines, priority levels, and proposed tasks via NVIDIA AI.
4. **APPROVE & EXECUTE**:
   - User reviews proposed tasks, edits titles, toggles selection, and changes deadlines/priorities.
   - Clicking **Approve Tasks** sends the approved tasks to `/api/approvals/:id/approve` (or `/api/tasks`), creating tasks in the SaarthiFlow database.

---

## 2. Directory Structure

```text
extension/
├── manifest.json       # Chrome Manifest V3 configuration & minimal required permissions
├── popup.html          # Responsive popup UI (~390px width) with Read Email, Read Page, AI Analyze
├── popup.css           # SaarthiFlow design system (clean SaaS theme with purple accents)
├── popup.js            # Controller for UI, Gmail detection, AI planning, and task approval
├── background.js       # Manifest V3 service worker & background API fetch proxy
├── content.js          # DOM extraction engine for Gmail emails and semantic webpages
├── config.js           # API endpoint builder, presets (Render / Localhost), storage keys
├── api.js              # Orchestration layer connecting extension to backend endpoints
├── icons/
│   ├── icon16.png      # 16x16 icon
│   ├── icon48.png      # 48x48 toolbar icon
│   └── icon128.png     # 128x128 high-res icon
└── README.md           # Documentation, testing guide, and permissions
```

---

## 3. Chrome Permissions & Host Permissions

- `activeTab`: Grants temporary access to the tab the user is actively viewing when the popup is clicked.
- `scripting`: Executes content extraction safely on demand in the active tab.
- `storage`: Persists local user settings (backend URL, operating mode, recent captures).
- `host_permissions`:
  - `https://saarthiflow-t5lp.onrender.com/*` — Access to deployed Render backend API.
  - `https://mail.google.com/*` — Access to active Gmail tab when reading an opened email.
  - `http://localhost/*` & `http://127.0.0.1/*` — Local development backend support.
  - `https://*/*` & `http://*/*` — General webpage extraction when clicking Read Current Page.

---

## 4. Key Functional Features

### 1. Read Email (Gmail Integration)
- Automatically detects when you are on `mail.google.com`.
- When an email is open, clicking **Read Email** extracts:
  - Email Subject
  - Sender (`Name <email@address>`)
  - Date & Timestamp
  - Visible email body text (stripping quoted history and sensitive fields)
- Dispatches content to SaarthiFlow's NVIDIA AI endpoint to generate deadlines, action items, and follow-ups.
- Does **not** read emails in the background and does **not** scan inbox lists.

### 2. Read Current Page
- Works on articles, documentation, hackathon portals, event pages, job boards, and tutorials.
- Extracts semantic visible text, headings, and deadlines.
- Discards navigation, footers, forms, scripts, and password inputs.

### 3. Analyze with AI
- Sends the extracted context to the NVIDIA AI planning endpoint.
- Displays the generated summary, deadlines, and proposed tasks in the extension popup.

### 4. Approve Tasks (Human-in-the-Loop)
- Users stay in control: tasks are only created in the database after user clicks **Approve & Create Tasks**.
- Tasks are immediately synchronized with SaarthiFlow **My Space** and **Approvals**.

---

## 5. How to Load and Test the Extension

### Step 1: Open Chrome Extensions
1. In Google Chrome, go to `chrome://extensions`.
2. Toggle **Developer mode** to **ON** (top-right corner).

### Step 2: Load Unpacked Extension
1. Click **Load unpacked** (top-left).
2. Select the `extension/` folder in your project repository:
   ```text
   SaarthiGithub/extension
   ```
3. If previously loaded, click the circular **Reload** icon on the SaarthiFlow extension card.

### Step 3: Test on Gmail
1. Open [Gmail](https://mail.google.com) in your browser.
2. Open any email message containing action items, meeting requests, or deadlines.
3. Click the **SaarthiFlow** extension icon in your Chrome toolbar.
4. Notice the **Gmail Detected** banner.
5. Click **Read Email** (or **Analyze Email with NVIDIA AI**).
6. Verify extracted subject, sender, date, AI summary, and proposed tasks.
7. Click **Approve Tasks** to save them to SaarthiFlow.

### Step 4: Test on Ordinary Webpages
1. Open any article, documentation page, or hackathon (e.g. on Devpost or Wikipedia).
2. Click the **SaarthiFlow** extension icon.
3. Click **Read Current Page**.
4. Verify structured opportunity card, AI summary, and tasks.
5. Edit task titles, toggle checkboxes, and click **Approve Tasks**.

### Step 5: Verify Backend Connectivity
1. In the extension popup, click the ⚙️ gear icon (Settings).
2. Notice the Backend URL is set to `https://saarthiflow-t5lp.onrender.com/api`.
3. Click **Test Connection** to verify connection to the deployed Render server.
4. (Optional) Switch to **Localhost (3001)** preset if testing with a local backend server (`npm run server`).
