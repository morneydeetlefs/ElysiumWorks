# Elysium Works — Project Handoff Document
**For: Next Claude session** | **Date: September 2026**

---

## 1. Who This Is For

The owner is building a zero-cost full-stack business platform for **Elysium Works**, a local handyman, appliance repair, and building services business based in **Elysium / Ifafa, KZN South Coast, South Africa**.

He is a polymath with:
- Full residential construction experience (foundations to roof tiles)
- Appliance repair expertise (microwaves, washing machines, tumble dryers, etc.)
- Most modules completed toward a mechanical engineering qualification (does NOT claim full engineer title)
- Carpentry, plumbing, plan reading, surveying, project management
- Glass and aluminium patio enclosure work

**Tone of brand**: Warm, community-first, approachable, honest. Not corporate.

---

## 2. What Is Already Live

**Website**: https://elysiumworks.pages.dev/ — LIVE and deployed on Cloudflare Pages via GitHub.

The site includes:
- Hero section (tagline: "no job too small, no build too big")
- Tabbed services: Appliances / Handyman / Building & Patio / Consulting
- Zone-based callout calculator (R50 local, +R50 per ~5km)
- About section with honest note about qualifications
- Digital guides / downloads section (Gumroad links — not yet set up)
- Contact form with WhatsApp, phone (071 818 1132), email (elysiumweb@proton.me)

**Callout zones already on live site:**
- Elysium / Ifafa — R50
- Mtwalumi — R75
- Bazley — R100
- Pennington / Umzumbe — R150
- Hibberdene / Umzinto — R200
- Scottburgh / Park Rynie — R250
- Port Shepstone / further — R300+

**Brand colours** (from the website):
- Brand dark (nav/hero): `#264736`
- Brand green: `#3A6B4F`
- Brand mid: `#4E8C68`
- Brand light: `#EAF2EC`
- Accent orange: `#C2601A`
- Warm background: `#F8F6F1`
- Fonts: Fraunces (serif/headings) + Outfit (sans/body)

---

## 3. Full Tech Stack

| Layer | Tool | Status |
|---|---|---|
| Hosting | Cloudflare Pages | ✅ Live |
| CI/CD | GitHub → Cloudflare Pages | ✅ Connected |
| Database | Cloudflare D1 (SQLite at edge) | 🔲 Not yet set up |
| File storage | **Backblaze B2** (NOT Cloudflare R2) | 🔲 Account needed |
| API / backend | Cloudflare Workers | 🔲 Not yet built |
| PDF generation | jsPDF (client-side, on-device) | 🔲 Not yet built |
| Auth | Cloudflare Workers token-based | 🔲 Not yet built |

**Important**: User explicitly chose Backblaze B2 over Cloudflare R2. B2 is S3-compatible, has 10GB free, and has zero egress cost when paired with Cloudflare (bandwidth alliance). All photo and PDF storage goes to B2.

---

## 4. Database Schema (Cloudflare D1)

Three tables — not yet created, ready to implement:

```sql
-- Table 1: clients
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table 2: projects (inspections)
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  property_address TEXT,
  inspection_date DATETIME,
  status TEXT CHECK(status IN ('Draft','Completed','Sent')),
  total_estimated_repair_cost REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: inspection_items
CREATE TABLE inspection_items (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  zone_name TEXT,
  item_name TEXT,
  status TEXT CHECK(status IN ('Pass','Fail','Monitor','NA')),
  notes TEXT,
  photo_url TEXT,
  estimated_cost REAL
);
```

---

## 5. The Inspection App — What to Build Next

### Priority order:
1. **Core PWA shell** — installable to home screen, works offline
2. **Checklist UI** — zone-by-zone, Pass/Fail/Monitor/NA taps
3. **Photo capture** — camera access, compress on-device, queue for B2 upload
4. **PDF generation** — branded report, runs on-device with jsPDF
5. **Background sync** — push to D1 + B2 when signal returns
6. **Admin dashboard** — client and project tracking (do last)

### Architecture decisions made:
- **Offline-first PWA** using service worker + IndexedDB
- Service worker caches app shell so it loads with zero signal
- All inspection data saved to IndexedDB instantly on-device
- Photos compressed on-device before queuing for upload
- Sync queue pushes to cloud (D1 + B2) when signal returns
- PDF generated locally on-device (jsPDF) — works offline
- Standalone app at `app.elysiumworks.pages.dev` (separate from main site) — **this decision was pending confirmation**, ask user to confirm

### The 120-point inspection zones (to build the checklist around):
Standard SA home inspection zones — confirm with user but likely:
Roof & Attic, Gutters & Drainage, Exterior Walls, Windows & Doors, Foundation & Structure, Garage, Kitchen, Bathrooms, Plumbing, Electrical, Ceilings & Floors, Interior Walls, HVAC / Geysers, Garden & Boundary

### Mobile UI requirements:
- Big tap targets (min 48px)
- One-handed usable
- Fast tap → Pass / Fail / Monitor with colour feedback (green/red/amber)
- Notes field expands on tap
- Cost field numeric keyboard
- Photo button opens camera directly
- Progress bar per zone and overall

---

## 6. Pending Decisions (Ask User at Start of Next Session)

1. **Backblaze B2 account** — has it been created yet? Need bucket name and API keys.
2. **App location** — standalone `app.elysiumworks.pages.dev` or same repo?
3. **Inspection zones** — confirm the zone/category names for the 120-point checklist
4. **Auth** — single password for owner only, or does he have a small team?
5. **Gumroad** — has an account been set up for the digital guides yet?

---

## 7. Income Streams Discussed

| Stream | Status |
|---|---|
| Local services (callout-based) | Site live, ready to take bookings |
| Digital guides on Gumroad | Site ready, Gumroad account not yet set up |
| Inspection PDF reports as a premium service | App to be built |
| Community workshops | Listed on site, not yet scheduled |

---

## 8. Tone Notes for Responses

- He appreciates directness and practical advice
- No over-engineering — keep costs at R0/month
- Community-first framing resonates (he's been repairing appliances for neighbours for free)
- He is hands-on and capable — don't over-explain basic concepts
- South African context: prices in Rands, Gumroad for digital sales, WhatsApp is primary contact channel, PayFast/Yoco for payments

---

## 9. Files & Assets

- Live site code: in his GitHub repo connected to Cloudflare Pages
- Brand assets: embedded in the site HTML (no separate asset files mentioned)
- Project brief: stored in Claude project files as `update_to_v4`

---

*End of handoff. Paste this document at the start of the next session and say "continue the Elysium Works project".*
