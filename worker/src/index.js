/**
 * ELYSIUM WORKS — Cloudflare Worker API
 * Handles auth, project sync, and D1 persistence.
 *
 * Bindings required in wrangler.toml:
 *   [[d1_databases]]
 *   binding = "DB"
 *   database_name = "elysium-works-db"
 *   database_id = "YOUR_D1_DATABASE_ID"   ← paste after you create it
 *
 * Environment variables (set in Cloudflare dashboard → Worker → Settings → Variables):
 *   ADMIN_PIN      = "your-pin-here"
 *   JWT_SECRET     = "any-long-random-string-you-generate"
 *
 * CORS: locked to your Pages domain. Update ALLOWED_ORIGIN if you use a custom domain.
 */

const ALLOWED_ORIGIN = 'https://elysiumworks.pages.dev';
const TOKEN_TTL_HOURS = 12;

// ── CORS HEADERS ──────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  const allow = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function err(msg, status = 400, origin = ALLOWED_ORIGIN) {
  return json({ error: msg }, status, origin);
}

// ── SIMPLE JWT (HMAC-SHA256, no library needed) ───────────────────────────────
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

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  return await verify(token, env.JWT_SECRET);
}

// ── D1 HELPERS ───────────────────────────────────────────────────────────────
async function dbRun(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

async function dbAll(db, sql, params = []) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

async function dbFirst(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

// ── ROUTER ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin') || ALLOWED_ORIGIN;

    // Preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ── POST /api/auth ──────────────────────────────────────────────────────
    if (path === '/api/auth' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (body.pin !== env.ADMIN_PIN) return err('Invalid PIN', 401, origin);
      const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_HOURS * 3600;
      const token = await sign({ sub: 'admin', exp }, env.JWT_SECRET);
      return json({ token, exp }, 200, origin);
    }

    // All routes below require auth
    const payload = await requireAuth(request, env);
    if (!payload) return err('Unauthorised', 401, origin);

    // ── GET /api/projects ───────────────────────────────────────────────────
    if (path === '/api/projects' && method === 'GET') {
      const rows = await dbAll(env.DB,
        `SELECT p.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
         FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id
         ORDER BY p.created_at DESC`
      );
      return json({ projects: rows }, 200, origin);
    }

    // ── POST /api/sync ──────────────────────────────────────────────────────
    // Full upsert — the app sends its entire local state, we merge it.
    if (path === '/api/sync' && method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.projects)) {
        return err('Expected { projects: [] }', 400, origin);
      }

      const results = [];

      for (const project of body.projects) {
        // Upsert client
        let clientId = null;
        if (project.client_name) {
          // Try find existing client by name + phone
          let client = await dbFirst(env.DB,
            `SELECT id FROM clients WHERE name = ? AND phone = ?`,
            [project.client_name, project.client_phone || '']
          );
          if (!client) {
            clientId = project.client_id || crypto.randomUUID();
            await dbRun(env.DB,
              `INSERT OR IGNORE INTO clients (id, name, phone, email) VALUES (?, ?, ?, ?)`,
              [clientId, project.client_name, project.client_phone || '', project.client_email || '']
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
            status = excluded.status,
            total_estimated_repair_cost = excluded.total_estimated_repair_cost,
            inspection_date = excluded.inspection_date
        `, [
          projId,
          clientId,
          project.property_address || '',
          project.inspection_date ? new Date(project.inspection_date).toISOString() : null,
          project.status || 'Draft',
          project.total_cost || 0,
          project.created_at ? new Date(project.created_at).toISOString() : new Date().toISOString(),
        ]);

        // Upsert inspection items
        const items = project.items || {};
        for (const [key, data] of Object.entries(items)) {
          if (!data || !data.status) continue;
          const [zoneName, ...itemParts] = key.split('::');
          const itemName = itemParts.join('::');
          const itemId = `${projId}::${key}`;

          await dbRun(env.DB, `
            INSERT INTO inspection_items (id, project_id, zone_name, item_name, status, notes, estimated_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              notes  = excluded.notes,
              estimated_cost = excluded.estimated_cost
          `, [
            itemId,
            projId,
            zoneName,
            itemName,
            data.status,
            data.notes || '',
            data.cost || 0,
          ]);
        }

        results.push({ id: projId, synced: true });
      }

      return json({ ok: true, synced: results.length, results }, 200, origin);
    }

    // ── GET /api/projects/:id ───────────────────────────────────────────────
    const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projMatch && method === 'GET') {
      const id = projMatch[1];
      const project = await dbFirst(env.DB,
        `SELECT p.*, c.name AS client_name, c.phone AS client_phone
         FROM projects p LEFT JOIN clients c ON c.id = p.client_id
         WHERE p.id = ?`, [id]
      );
      if (!project) return err('Not found', 404, origin);
      const items = await dbAll(env.DB,
        `SELECT * FROM inspection_items WHERE project_id = ?`, [id]
      );
      return json({ project, items }, 200, origin);
    }

    // ── DELETE /api/projects/:id ────────────────────────────────────────────
    if (projMatch && method === 'DELETE') {
      const id = projMatch[1];
      await dbRun(env.DB, `DELETE FROM inspection_items WHERE project_id = ?`, [id]);
      await dbRun(env.DB, `DELETE FROM projects WHERE id = ?`, [id]);
      return json({ ok: true, deleted: id }, 200, origin);
    }

    // ── PATCH /api/projects/:id/status ──────────────────────────────────────
    const statusMatch = path.match(/^\/api\/projects\/([^/]+)\/status$/);
    if (statusMatch && method === 'POST') {
      const id = statusMatch[1];
      const body = await request.json().catch(() => ({}));
      const allowed = ['Draft', 'Completed', 'Sent'];
      if (!allowed.includes(body.status)) return err('Invalid status', 400, origin);
      await dbRun(env.DB, `UPDATE projects SET status = ? WHERE id = ?`, [body.status, id]);
      return json({ ok: true }, 200, origin);
    }

    // ── GET /api/stats ──────────────────────────────────────────────────────
    if (path === '/api/stats' && method === 'GET') {
      const totals = await dbFirst(env.DB,
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='Draft' THEN 1 ELSE 0 END) AS drafts,
          SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status='Sent' THEN 1 ELSE 0 END) AS sent,
          SUM(total_estimated_repair_cost) AS total_cost
         FROM projects`
      );
      return json({ stats: totals }, 200, origin);
    }

    return err('Not found', 404, origin);
  },
};
