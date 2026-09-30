# Elysium Works — Project Handoff Document
**Version: v4.1** | **Date: October 2026**

---

## 1. Who This Is For

Owner: **Morney Deetlefs** — Elysium Works, Elysium / Ifafa, KZN South Coast, South Africa.

Skills: Full residential construction, appliance repair, carpentry, plumbing, plan reading, surveying, project management, glass and aluminium patio enclosures. Mechanical engineering (most modules, does NOT claim full engineer title).

**Tone**: Warm, community-first, approachable, honest. Not corporate.

---

## 2. What Is Live

| Item | URL / Location | Status |
|---|---|---|
| Main website | https://elysiumworks.pages.dev | ✅ Live |
| App (PWA) | https://elysiumworks.pages.dev/app | ✅ Live |
| Cloudflare Worker API | https://elysium-works-api.morneydeetlefs.workers.dev | ✅ Live |
| GitHub repo | https://github.com/morneydeetlefs/ElysiumWorks | ✅ Connected |
| Cloudflare D1 DB | elysium-works-db (ID: 1d1bcca7-b13c-436a-98b5-68b8722394c7) | ✅ Live |

---

## 3. Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Hosting | Cloudflare Pages | Auto-deploys from GitHub main branch |
| Database | Cloudflare D1 (SQLite) | Edge database |
| File storage | Backblaze B2 | NOT Cloudflare R2 — user chose B2 |
| API | Cloudflare Workers | worker/src/index.js |
| PDF | jsPDF (client-side) | Loaded from cdnjs |
| Auth | PIN + JWT (12hr TTL) | ADMIN_PIN and JWT_SECRET in Worker env vars |

---

## 4. Brand

- Dark nav/hero: `#264736`
- Brand green: `#3A6B4F`
- Brand mid: `#4E8C68`
- Brand light: `#EAF2EC`
- Accent orange: `#C2601A`
- Warm background: `#F8F6F1`
- Fonts: Fraunces (serif/headings) + Outfit (sans/body)
- Phone: 071 818 1132
- Email: elysiumweb@proton.me
- Banking: ABSA, Monique Deetlefs, 9347485805, branch 632005

---

## 5. App Architecture

### Single-file PWA
- `app.html` — entire app (6000+ lines), offline-first PWA
- IndexedDB version: **4** (stores: projects, settings, clients_crm, jobs)
- Service worker caches app shell for offline use

### Key globals
- `currentClient` — currently open client object
- `currentJob` — currently open job object
- `currentDetailTab` — 'current' | 'jobs' | 'notes'
- `WORKER_URL` — set in settings screen
- `cloudToken` — JWT from /api/auth

### Screen flow
```
Home → Clients → Client Detail (3 tabs) → Job Detail → Job PDF
                                        → Sketch Canvas
                                        → Annotate Photo
     → Inspection → Zone Checklist → Inspection PDF
     → Settings
```

---

## 6. Database Schema (D1)

```sql
clients          -- basic contact info
projects         -- home inspections
inspection_items -- per-item inspection results
clients_crm      -- full client JSON blob (offline-first CRM)
jobs             -- construction quotes, appliance jobs, etc.
quote_line_items -- normalised line items for reporting
enquiries        -- website form submissions
```

### Jobs table (v4)
- `id` TEXT PRIMARY KEY
- `client_id` TEXT (FK to clients_crm.id)
- `client_name` TEXT (denormalised)
- `type` TEXT — quote | appliance | handyman | inspection | patio | other
- `ref` TEXT — e.g. EW-Q-26-001
- `description`, `address`, `visit_date`, `status`
- `data` TEXT — lean JSON blob (no base64)
- `updated_at` INTEGER — epoch ms for last-write-wins sync

---

## 7. Sync Architecture

### Push (device → D1)
- `pushClients()` — sends full client blobs
- `pushJobs()` — sends job metadata (strips base64 photos before sending)
- `syncToCloud()` — sends inspection projects

### Pull (D1 → device)
- `pullClients()` — pulls clients updated since last sync
- `pullJobs()` — pulls job metadata updated since last sync; merges into local, preserving photos

### Sync triggers
- On login
- Every 5 minutes while app is open
- On tab visibility change (user returns to app)

### Important: Photos stay local
Photos and sketches are stored in IndexedDB only — they are NOT synced to D1 (too large). If you need cross-device photos, Backblaze B2 integration is the next step.

---

## 8. Job Number System

Format: `EW-{TYPE}-{YY}-{SEQ}`
- Q = Construction Quote
- A = Appliance Repair
- I = Home Inspection
- H = Handyman

Sequence stored in `settings` IndexedDB store as `jobseq_Q`, `jobseq_A` etc.

---

## 9. Known Clients in System (Oct 2026)

| Ref | Client | Job | Status |
|---|---|---|---|
| EW-A-26-001 | Brenda | Razor wire installation | Paid |
| EW-A-26-002 | Michelle | TV repair | Paid |
| EW-Q-26-001 | Vanessa | Toaster repair | Paid |
| EW-Q-26-002 | Billy Gough | Fence installation | Enquiry |
| EW-Q-26-003 | Athol Perry | Custom timber bed headboards | Paid |
| EW-Q-26-004 | Brenda | Garden table + benches | Paid |

---

## 10. PDF Generation

### jsPDF notes (CRITICAL)
- Library: loaded from cdnjs as UMD bundle
- Font: helvetica only — NO unicode support
- All text must pass through `pdfSafe()` before `doc.text()`
- `pdfSafe()` strips/replaces: em/en dashes, curly quotes, multiplication signs, non-breaking spaces, anything outside printable ASCII
- `rnd()` formats currency — do NOT use `toLocaleString('en-ZA')` in doc.text calls (produces non-breaking space thousands separator)
- The entire PDF body is wrapped in try/catch that shows a toast with the error

### Generated PDFs
- **Quote PDF** — scope, measurements, sketch image, site photos, line items, totals, banking details
- **Invoice PDF** — same but headed INVOICE

---

## 11. Pending / Known Issues

- **Enquiries** — website form submissions arrive in D1 but there's no permanent UI to view them. There's a boot-time notification banner but it disappears. Need a permanent Enquiries tab on the Clients screen.
- **Photos not cross-device** — photos taken on phone don't appear on PC (by design — B2 integration needed for this)
- **Sketch not cross-device** — same reason
- **Worker environment warning** — wrangler.toml has `[env.production]` block causing "multiple environments" warning on deploy. Harmless but can be cleaned up.

---

## 12. Files in Repo

```
app.html              — entire PWA app
index.html            — main website
demo.html             — demo page
worker/
  schema.sql          — D1 schema (run with --remote to apply)
  src/index.js        — Cloudflare Worker API
  wrangler.toml       — Worker config
.gitignore            — excludes *.zip, *.exe, node_modules, .wrangler
```

---

## 13. Deploy Process

```bash
# App only (most common)
git add app.html
git commit -m "description"
git push
# Cloudflare Pages auto-builds in ~60 seconds

# Worker changes
cd worker
wrangler deploy

# Schema changes
wrangler d1 execute elysium-works-db --file=schema.sql --remote
```

---

## 14. Environment Variables (Worker)

Set in Cloudflare Dashboard → Workers → elysium-works-api → Settings → Variables:
- `ADMIN_PIN` — numeric PIN for login
- `JWT_SECRET` — long random string for token signing

---

## 15. Income Streams

| Stream | Status |
|---|---|
| Local services (callout-based) | Live — taking bookings via WhatsApp |
| Digital guides on Gumroad | Site ready — Gumroad account not set up |
| Inspection PDF reports | App built — not yet marketed |
| Community workshops | Listed on site — not scheduled |

---

*End of handoff v4.1*
