/**
 * ELYSIUM WORKS — Cloudflare Worker API  v4
 *
 * Bindings required in wrangler.toml:
 *   [[d1_databases]]
 *   binding = "DB"
 *   database_name = "elysium-works-db"
 *   database_id = "1d1bcca7-b13c-436a-98b5-68b8722394c7"
 *
 * Environment variables (Cloudflare dashboard → Worker → Settings → Variables):
 *   ADMIN_PIN   = "your-pin-here"
 *   JWT_SECRET  = "any-long-random-string"
 */

const ALLOWED_ORIGIN  = 'https://elysiumworks.pages.dev';
const TOKEN_TTL_HOURS = 12;

// ── CORS ──────────────────────────────────────────────────────
function corsHeaders(origin, isPublic = false) {
  const allow = isPublic ? (origin || '*') : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin' : allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age'      : '86400',
  };
}

function json(data, status = 200, origin = ALLOWED_ORIGIN, isPublic = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, isPublic) },
  });
}
function err(msg, status = 400, origin = ALLOWED_ORIGIN, isPublic = false) {
  return json({ error: msg }, status, origin, isPublic);
}

// ── JWT (HMAC-SHA256, no library) ────────────────────────────
async function sign(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const data   = `${header}.${body}`;
  const key    = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verify(token, secret) {
  try {
    const [h, b, s] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const ok = await crypto.subtle.verify(
      'HMAC', key,
      Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
      new TextEncoder().encode(`${h}.${b}`)
    );
    if (!ok) return null;
    const payload = JSON.parse(atob(b.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
async function requireAuth(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  return await verify(token, env.JWT_SECRET);
}

// ── D1 HELPERS ────────────────────────────────────────────────
const dbRun   = (db, sql, p = []) => db.prepare(sql).bind(...p).run();
const dbAll   = async (db, sql, p = []) => { const {results} = await db.prepare(sql).bind(...p).all(); return results || []; };
const dbFirst = (db, sql, p = []) => db.prepare(sql).bind(...p).first();

// ── ROUTER ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || ALLOWED_ORIGIN;

    // Preflight
    if (method === 'OPTIONS') {
      const isPublicPath = ['/api/enquiry'].includes(path);
      return new Response(null, { status: 204, headers: corsHeaders(origin, isPublicPath) });
    }

    // ── POST /api/auth ──────────────────────────────────────
    if (path === '/api/auth' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (body.pin !== env.ADMIN_PIN) return err('Invalid PIN', 401, origin);
      const exp   = Math.floor(Date.now() / 1000) + TOKEN_TTL_HOURS * 3600;
      const token = await sign({ sub: 'admin', exp }, env.JWT_SECRET);
      return json({ token, exp }, 200, origin);
    }

    // ── POST /api/enquiry (PUBLIC) ──────────────────────────
    if (path === '/api/enquiry' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body?.name || !body?.phone) return err('Name and phone are required', 400, origin, true);

      const recent = await dbFirst(env.DB,
        `SELECT id FROM enquiries WHERE phone = ? AND created_at > datetime('now', '-1 hour')`,
        [body.phone]
      );
      if (recent) return json({ ok: true, note: 'duplicate' }, 200, origin, true);

      const id = crypto.randomUUID();
      await dbRun(env.DB,
        `INSERT INTO enquiries (id, name, phone, area, job_type, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [id, body.name, body.phone, body.area||'', body.job_type||'', body.source||'Website']
      );
      return json({ ok: true, id }, 200, origin, true);
    }

    // ── All routes below require auth ────────────────────────
    const payload = await requireAuth(request, env);
    if (!payload) return err('Unauthorised', 401, origin);

    // ── GET /api/stats ──────────────────────────────────────
    if (path === '/api/stats' && method === 'GET') {
      const inspStats = await dbFirst(env.DB,
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='Draft'     THEN 1 ELSE 0 END) AS drafts,
          SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status='Sent'      THEN 1 ELSE 0 END) AS sent,
          SUM(total_estimated_repair_cost) AS total_cost
         FROM projects`
      );
      const jobStats = await dbFirst(env.DB,
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='enquiry'  THEN 1 ELSE 0 END) AS enquiries,
          SUM(CASE WHEN status='quoted'   THEN 1 ELSE 0 END) AS quoted,
          SUM(CASE WHEN status='inprog'   THEN 1 ELSE 0 END) AS inprog,
          SUM(CASE WHEN status='paid'     THEN 1 ELSE 0 END) AS paid
         FROM jobs`
      );
      return json({ inspections: inspStats, jobs: jobStats }, 200, origin);
    }

    // ── GET /api/projects ───────────────────────────────────
    if (path === '/api/projects' && method === 'GET') {
      const rows = await dbAll(env.DB,
        `SELECT p.*, c.name AS client_name, c.phone AS client_phone
         FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id
         ORDER BY p.created_at DESC`
      );
      return json({ projects: rows }, 200, origin);
    }

    // ── POST /api/sync (inspection projects upsert) ─────────
    if (path === '/api/sync' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.projects)) return err('Expected { projects: [] }', 400, origin);

      const results = [];
      for (const project of body.projects) {
        // Upsert client
        let clientId = null;
        if (project.client_name) {
          let client = await dbFirst(env.DB,
            `SELECT id FROM clients WHERE name = ? AND phone = ?`,
            [project.client_name, project.client_phone || '']
          );
          if (!client) {
            clientId = project.client_id || crypto.randomUUID();
            await dbRun(env.DB,
              `INSERT OR IGNORE INTO clients (id, name, phone, email) VALUES (?, ?, ?, ?)`,
              [clientId, project.client_name, project.client_phone||'', project.client_email||'']
            );
          } else {
            clientId = client.id;
          }
        }

        // Upsert project
        const projId = project.id || crypto.randomUUID();
        await dbRun(env.DB, `
          INSERT INTO projects (id, client_id, property_address, inspection_date, status, total_estimated_repair_cost, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status                      = excluded.status,
            total_estimated_repair_cost = excluded.total_estimated_repair_cost,
            inspection_date             = excluded.inspection_date
        `, [
          projId, clientId,
          project.property_address || '',
          project.inspection_date ? new Date(project.inspection_date).toISOString() : null,
          project.status || 'Draft',
          project.total_cost || 0,
          project.created_at ? new Date(project.created_at).toISOString() : new Date().toISOString(),
        ]);

        // Upsert inspection items
        for (const [key, data] of Object.entries(project.items || {})) {
          if (!data?.status) continue;
          const [zoneName, ...itemParts] = key.split('::');
          const itemName = itemParts.join('::');
          const itemId   = `${projId}::${key}`;
          await dbRun(env.DB, `
            INSERT INTO inspection_items (id, project_id, zone_name, item_name, status, notes, estimated_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status         = excluded.status,
              notes          = excluded.notes,
              estimated_cost = excluded.estimated_cost
          `, [itemId, projId, zoneName, itemName, data.status, data.notes||'', data.cost||0]);
        }
        results.push({ id: projId, synced: true });
      }
      return json({ ok: true, synced: results.length, results }, 200, origin);
    }

    // ── GET /api/projects/:id ───────────────────────────────
    const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projMatch && method === 'GET') {
      const id      = projMatch[1];
      const project = await dbFirst(env.DB,
        `SELECT p.*, c.name AS client_name, c.phone AS client_phone
         FROM projects p LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.id = ?`, [id]
      );
      if (!project) return err('Not found', 404, origin);
      const items = await dbAll(env.DB, `SELECT * FROM inspection_items WHERE project_id = ?`, [id]);
      return json({ project, items }, 200, origin);
    }

    // ── DELETE /api/projects/:id ────────────────────────────
    if (projMatch && method === 'DELETE') {
      const id = projMatch[1];
      await dbRun(env.DB, `DELETE FROM inspection_items WHERE project_id = ?`, [id]);
      await dbRun(env.DB, `DELETE FROM projects WHERE id = ?`, [id]);
      return json({ ok: true, deleted: id }, 200, origin);
    }

    // ── POST /api/projects/:id/status ──────────────────────
    const statusMatch = path.match(/^\/api\/projects\/([^/]+)\/status$/);
    if (statusMatch && method === 'POST') {
      const id   = statusMatch[1];
      const body = await request.json().catch(() => ({}));
      if (!['Draft','Completed','Sent'].includes(body.status)) return err('Invalid status', 400, origin);
      await dbRun(env.DB, `UPDATE projects SET status = ? WHERE id = ?`, [body.status, id]);
      return json({ ok: true }, 200, origin);
    }

    // ── POST /api/clients/sync ──────────────────────────────
    // Push clients from device to D1 (last-write-wins)
    if (path === '/api/clients/sync' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.clients)) return err('Expected { clients: [] }', 400, origin);
      for (const c of body.clients) {
        if (!c.id || !c.data) continue;
        const existing = await dbFirst(env.DB, `SELECT updated_at FROM clients_crm WHERE id = ?`, [c.id]);
        if (!existing || c.updated_at > existing.updated_at) {
          await dbRun(env.DB,
            `INSERT INTO clients_crm (id, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
            [c.id, c.data, c.updated_at]
          );
        }
      }
      return json({ ok: true, count: body.clients.length }, 200, origin);
    }

    // ── GET /api/clients/sync ───────────────────────────────
    if (path === '/api/clients/sync' && method === 'GET') {
      const since = url.searchParams.get('since') || '0';
      const rows  = await dbAll(env.DB,
        `SELECT id, data, updated_at FROM clients_crm WHERE updated_at > ? ORDER BY updated_at DESC`,
        [parseInt(since)]
      );
      return json({ clients: rows, ts: Date.now() }, 200, origin);
    }

    // ── DELETE /api/clients/:id ─────────────────────────────
    const clientDelMatch = path.match(/^\/api\/clients\/([^/]+)$/);
    if (clientDelMatch && method === 'DELETE') {
      await dbRun(env.DB, `DELETE FROM clients_crm WHERE id = ?`, [clientDelMatch[1]]);
      return json({ ok: true }, 200, origin);
    }

    // ══════════════════════════════════════════════════════════
    // JOBS API  (v4)
    // ══════════════════════════════════════════════════════════

    // ── POST /api/jobs/sync ─────────────────────────────────
    // Push all local jobs to D1 (last-write-wins by updated_at)
    if (path === '/api/jobs/sync' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.jobs)) return err('Expected { jobs: [] }', 400, origin);

      for (const j of body.jobs) {
        if (!j.id || !j.client_id) continue;
        const existing = await dbFirst(env.DB, `SELECT updated_at FROM jobs WHERE id = ?`, [j.id]);
        if (!existing || j.updated_at > (existing.updated_at || 0)) {
          // Upsert job record
          await dbRun(env.DB, `
            INSERT INTO jobs (id, client_id, client_name, type, ref, description, address,
              visit_date, status, data, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status     = excluded.status,
              description= excluded.description,
              data       = excluded.data,
              updated_at = excluded.updated_at
          `, [
            j.id, j.client_id, j.client_name||'', j.type||'other',
            j.ref||null, j.description||'', j.address||'',
            j.visit_date ? new Date(j.visit_date).toISOString() : null,
            j.status||'enquiry',
            // Strip annotated photos from blob to keep D1 payload lean;
            // originals stay in IndexedDB / B2
            JSON.stringify({ ...j, annotatedPhotos: (j.annotatedPhotos||[]).map(p => ({ label: p.label, annotated: '[photo]', original: '[photo]' })), sketch: j.sketch ? '[sketch]' : null }),
            j.updated_at || Date.now(),
            j.created_at ? new Date(j.created_at).toISOString() : new Date().toISOString(),
          ]);

          // Upsert normalised line items for reporting
          await dbRun(env.DB, `DELETE FROM quote_line_items WHERE job_id = ?`, [j.id]);
          const lines = j.quote?.lines || [];
          for (const l of lines) {
            if (!l.description) continue;
            const qty   = parseFloat(l.qty)        || 1;
            const price = parseFloat(l.unit_price) || 0;
            await dbRun(env.DB,
              `INSERT INTO quote_line_items (id, job_id, description, qty, unit, unit_price, line_total)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [crypto.randomUUID(), j.id, l.description, qty, l.unit||'each', price, qty*price]
            );
          }
        }
      }
      return json({ ok: true, count: body.jobs.length }, 200, origin);
    }

    // ── GET /api/jobs/sync ──────────────────────────────────
    // Pull jobs updated since timestamp (metadata only — no photos)
    if (path === '/api/jobs/sync' && method === 'GET') {
      const since  = url.searchParams.get('since') || '0';
      const client = url.searchParams.get('client_id');
      let sql = `SELECT id, client_id, client_name, type, ref, description, address, visit_date, status, updated_at
                 FROM jobs WHERE updated_at > ?`;
      const params = [parseInt(since)];
      if (client) { sql += ' AND client_id = ?'; params.push(client); }
      sql += ' ORDER BY updated_at DESC';
      const rows = await dbAll(env.DB, sql, params);
      return json({ jobs: rows, ts: Date.now() }, 200, origin);
    }

    // ── GET /api/jobs/:id ───────────────────────────────────
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && method === 'GET') {
      const job = await dbFirst(env.DB, `SELECT * FROM jobs WHERE id = ?`, [jobMatch[1]]);
      if (!job) return err('Not found', 404, origin);
      const lines = await dbAll(env.DB, `SELECT * FROM quote_line_items WHERE job_id = ?`, [jobMatch[1]]);
      return json({ job, lines }, 200, origin);
    }

    // ── DELETE /api/jobs/:id ────────────────────────────────
    if (jobMatch && method === 'DELETE') {
      await dbRun(env.DB, `DELETE FROM quote_line_items WHERE job_id = ?`, [jobMatch[1]]);
      await dbRun(env.DB, `DELETE FROM jobs WHERE id = ?`,                [jobMatch[1]]);
      return json({ ok: true, deleted: jobMatch[1] }, 200, origin);
    }

    // ── PATCH /api/jobs/:id/status ──────────────────────────
    const jobStatusMatch = path.match(/^\/api\/jobs\/([^/]+)\/status$/);
    if (jobStatusMatch && method === 'PATCH') {
      const body = await request.json().catch(() => ({}));
      const allowed = ['enquiry','quoted','deposit','inprog','done','invoiced','paid'];
      if (!allowed.includes(body.status)) return err('Invalid status', 400, origin);
      await dbRun(env.DB, `UPDATE jobs SET status = ? WHERE id = ?`, [body.status, jobStatusMatch[1]]);
      return json({ ok: true }, 200, origin);
    }

    // ── GET /api/jobs (list all, with optional filters) ─────
    if (path === '/api/jobs' && method === 'GET') {
      const status = url.searchParams.get('status');
      const type   = url.searchParams.get('type');
      let sql = `SELECT j.*, c.data AS client_data
                 FROM jobs j LEFT JOIN clients_crm c ON c.id = j.client_id
                 WHERE 1=1`;
      const params = [];
      if (status) { sql += ' AND j.status = ?'; params.push(status); }
      if (type)   { sql += ' AND j.type = ?';   params.push(type); }
      sql += ' ORDER BY j.updated_at DESC LIMIT 100';
      const rows = await dbAll(env.DB, sql, params);
      return json({ jobs: rows }, 200, origin);
    }

    // ── GET /api/enquiries ──────────────────────────────────
    if (path === '/api/enquiries' && method === 'GET') {
      const rows = await dbAll(env.DB,
        `SELECT * FROM enquiries WHERE imported = 0 ORDER BY created_at DESC`
      );
      return json({ enquiries: rows }, 200, origin);
    }

    // ── POST /api/enquiries/:id/import ──────────────────────
    const importMatch = path.match(/^\/api\/enquiries\/([^/]+)\/import$/);
    if (importMatch && method === 'POST') {
      await dbRun(env.DB, `UPDATE enquiries SET imported = 1 WHERE id = ?`, [importMatch[1]]);
      return json({ ok: true }, 200, origin);
    }

    return err('Not found', 404, origin);
  },
};
