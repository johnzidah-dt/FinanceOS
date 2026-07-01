import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import { WebSocketServer } from "ws";

const { Pool } = pg;
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://financeos:financeos@db:5432/financeos";
const DEFAULT_EMAIL = process.env.INITIAL_ADMIN_EMAIL || "admin@demo.local";
const DEFAULT_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || "demo1234";
const pool = new Pool({ connectionString: DATABASE_URL });

const fullAccess = "dashboard,invoices,proformas,contacts,purchases,payroll,payments,cashdesk,dailyops,accounts,folders,reports,settings,profile";

function slugify(value) {
  return String(value || "societe").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "societe";
}

function defaultSettings() {
  return {
    logoDataUrl: "",
    brandName: "Finance OS",
    tagline: "Gestion financière et facturation",
    signers: { invoice: DEFAULT_EMAIL, proforma: DEFAULT_EMAIL, receipt: DEFAULT_EMAIL, payroll: DEFAULT_EMAIL },
    payrollRules: { cnssEmployee: 4, cnssEmployer: 17.5, amuEmployee: 5, amuEmployer: 5, irppRate: 0, workingDays: 22 },
    footer: "Finance OS\nFacturation - Paiements - Caisse - Banque",
    terms: "Validité de l’offre : 15 jours.\nDémarrage après validation écrite."
  };
}

function blankState(entityId = "acceleratt", entityName = "Acceleratt Group SARL", country = "Togo", signerEmail = DEFAULT_EMAIL) {
  const settings = defaultSettings();
  Object.keys(settings.signers).forEach(kind => { settings.signers[kind] = signerEmail; });
  return {
    dataSchemaVersion: 2,
    dayClosedByEntity: {},
    settings,
    entities: [{ id: entityId, name: entityName, sector: "À configurer", country, settings: structuredClone(settings) }],
    contacts: [], invoices: [], proformas: [], payments: [], receipts: [], purchaseOrders: [], supplierInvoices: [],
    accountingEntries: [], employees: [], payrollRecords: [], accounts: [], cashOperations: [], disbursements: [],
    closures: [], statements: [], projects: []
  };
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, name text NOT NULL,
      signature_title text NOT NULL DEFAULT '', bio text NOT NULL DEFAULT '', photo_data_url text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'Actif', onboarding_seen boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL, access text NOT NULL, entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_state (
      workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      revision bigint NOT NULL DEFAULT 1, schema_version integer NOT NULL DEFAULT 2,
      data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);
    INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
  `);
}

async function seed() {
  const exists = await pool.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [DEFAULT_EMAIL]);
  if (exists.rowCount) return;
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const entityId = "acceleratt";
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspaceId, "FinanceOS"]);
    await client.query("INSERT INTO users(id,email,password_hash,name,signature_title) VALUES($1,$2,$3,$4,$5)", [userId, DEFAULT_EMAIL, passwordHash, "Admin Finance", "Le Responsable administratif et financier"]);
    await client.query("INSERT INTO workspace_members(workspace_id,user_id,role,access,entity_ids) VALUES($1,$2,$3,$4,$5)", [workspaceId, userId, "Admin", fullAccess, JSON.stringify([entityId])]);
    await client.query("INSERT INTO workspace_state(workspace_id,data,updated_by) VALUES($1,$2,$3)", [workspaceId, blankState(entityId), userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function signToken(userId, workspaceId) {
  return jwt.sign({ sub: userId, workspaceId }, JWT_SECRET, { expiresIn: "12h" });
}

function safeUser(row) {
  return { id: row.id, email: row.email, name: row.name, signatureTitle: row.signature_title, bio: row.bio, photoDataUrl: row.photo_data_url, status: row.status, onboardingSeen: row.onboarding_seen, role: row.role, access: row.access, entityIds: row.entity_ids || [] };
}

async function members(workspaceId) {
  const result = await pool.query(`SELECT u.*, m.role, m.access, m.entity_ids FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.created_at`, [workspaceId]);
  return result.rows.map(safeUser);
}

async function statePayload(workspaceId) {
  const result = await pool.query("SELECT data, revision, schema_version, updated_at FROM workspace_state WHERE workspace_id=$1", [workspaceId]);
  if (!result.rowCount) throw Object.assign(new Error("Espace introuvable"), { status: 404 });
  return { state: result.rows[0].data, revision: Number(result.rows[0].revision), schemaVersion: result.rows[0].schema_version, updatedAt: result.rows[0].updated_at, users: await members(workspaceId) };
}

async function auth(req, res, next) {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const claims = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT u.*, m.workspace_id, m.role, m.access, m.entity_ids FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE u.id=$1 AND m.workspace_id=$2 AND u.status='Actif'`, [claims.sub, claims.workspaceId]);
    if (!result.rowCount) return res.status(401).json({ error: "Session invalide" });
    req.auth = { user: result.rows[0], workspaceId: claims.workspaceId };
    next();
  } catch (_) {
    res.status(401).json({ error: "Authentification requise" });
  }
}

function requireAdmin(req, res, next) {
  if (req.auth.user.role !== "Admin") return res.status(403).json({ error: "Autorisation administrateur requise" });
  next();
}

const keyPermission = {
  dayClosedByEntity: "dailyops", settings: "settings", entities: "settings", contacts: "contacts",
  invoices: "invoices", proformas: "proformas", payments: "payments", receipts: "payments",
  purchaseOrders: "purchases", supplierInvoices: "purchases", accountingEntries: "reports",
  employees: "payroll", payrollRecords: "payroll", accounts: "accounts", cashOperations: "cashdesk",
  disbursements: "cashdesk", closures: "dailyops", statements: "accounts", projects: "folders"
};

function forbiddenStateKeys(current, next, user) {
  if (user.role === "Admin") return [];
  const allowed = new Set(String(user.access || "").split(","));
  return Object.keys(keyPermission).filter(key => JSON.stringify(current?.[key]) !== JSON.stringify(next?.[key]) && !allowed.has(keyPermission[key]));
}

function changedStateKeys(base, next) {
  return Object.keys(keyPermission).filter(key => JSON.stringify(base?.[key]) !== JSON.stringify(next?.[key]));
}

const app = express();
app.use(express.json({ limit: "30mb" }));
app.get("/healthz", (_req, res) => res.type("text").send("ok\n"));

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const result = await pool.query(`SELECT u.*, m.workspace_id, m.role, m.access, m.entity_ids FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE lower(u.email)=lower($1) AND u.status='Actif' ORDER BY u.created_at LIMIT 1`, [email]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(String(req.body.password || ""), row.password_hash))) return res.status(401).json({ error: "Identifiants incorrects" });
    res.json({ token: signToken(row.id, row.workspace_id), user: safeUser(row), ...(await statePayload(row.workspace_id)) });
  } catch (error) { next(error); }
});

app.post("/api/auth/register", async (req, res, next) => {
  const { name, email, password, organization, country } = req.body;
  if (!name || !email || !password || !organization) return res.status(400).json({ error: "Tous les champs obligatoires doivent être renseignés" });
  if (String(password).length < 8) return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères" });
  const client = await pool.connect();
  try {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const entityId = `${slugify(organization)}-${crypto.randomBytes(3).toString("hex")}`;
    await client.query("BEGIN");
    await client.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspaceId, organization]);
    await client.query("INSERT INTO users(id,email,password_hash,name,signature_title) VALUES($1,$2,$3,$4,$5)", [userId, String(email).toLowerCase(), await bcrypt.hash(password, 12), name, "Le Gérant"]);
    await client.query("INSERT INTO workspace_members(workspace_id,user_id,role,access,entity_ids) VALUES($1,$2,'Admin',$3,$4)", [workspaceId, userId, fullAccess, JSON.stringify([entityId])]);
    await client.query("INSERT INTO workspace_state(workspace_id,data,updated_by) VALUES($1,$2,$3)", [workspaceId, blankState(entityId, organization, country || "Togo", String(email).toLowerCase()), userId]);
    await client.query("COMMIT");
    const row = (await client.query(`SELECT u.*, m.workspace_id, m.role, m.access, m.entity_ids FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE u.id=$1`, [userId])).rows[0];
    res.status(201).json({ token: signToken(userId, workspaceId), user: safeUser(row), ...(await statePayload(workspaceId)) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Cette adresse email est déjà utilisée" });
    next(error);
  } finally { client.release(); }
});

app.get("/api/state", auth, async (req, res, next) => {
  try { res.json({ user: safeUser(req.auth.user), ...(await statePayload(req.auth.workspaceId)) }); } catch (error) { next(error); }
});

app.put("/api/state", auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const revision = Number(req.body.revision);
    await client.query("BEGIN");
    const current = await client.query("SELECT data, revision FROM workspace_state WHERE workspace_id=$1 FOR UPDATE", [req.auth.workspaceId]);
    const row = current.rows[0];
    const baseState = req.body.baseState || row.data;
    const forbidden = forbiddenStateKeys(baseState, req.body.state, req.auth.user);
    if (forbidden.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Votre rôle ne permet pas de modifier ces données" });
    }
    let nextState = req.body.state;
    if (Number(row.revision) !== revision) {
      const clientChanges = changedStateKeys(baseState, req.body.state);
      const serverChanges = new Set(changedStateKeys(baseState, row.data));
      const conflicts = clientChanges.filter(key => serverChanges.has(key));
      if (conflicts.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Les mêmes données ont été modifiées par un autre utilisateur", ...(await statePayload(req.auth.workspaceId)) });
      }
      nextState = structuredClone(row.data);
      clientChanges.forEach(key => { nextState[key] = req.body.state[key]; });
    }
    const result = await client.query(`UPDATE workspace_state SET data=$1, revision=revision+1, schema_version=$2, updated_at=now(), updated_by=$3 WHERE workspace_id=$4 RETURNING revision, updated_at`, [nextState, Number(req.body.schemaVersion) || 2, req.auth.user.id, req.auth.workspaceId]);
    await client.query("COMMIT");
    const payload = { type: "state-updated", revision: Number(result.rows[0].revision), sourceId: req.body.sourceId || "", updatedAt: result.rows[0].updated_at, state: nextState };
    broadcast(req.auth.workspaceId, { type: payload.type, revision: payload.revision, sourceId: payload.sourceId, updatedAt: payload.updatedAt });
    res.json(payload);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally { client.release(); }
});

app.post("/api/users", auth, requireAdmin, async (req, res, next) => {
  const { name, email, password, role, access, status, entityIds, signatureTitle } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let user = (await client.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email])).rows[0];
    if (!user) {
      if (!password || String(password).length < 8) throw Object.assign(new Error("Un mot de passe initial de 8 caractères est requis"), { status: 400 });
      user = (await client.query("INSERT INTO users(id,email,password_hash,name,signature_title,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [crypto.randomUUID(), String(email).toLowerCase(), await bcrypt.hash(password, 12), name, signatureTitle || role, status || "Actif"])).rows[0];
    } else {
      user = (await client.query("UPDATE users SET name=$1, signature_title=$2, status=$3, updated_at=now() WHERE id=$4 RETURNING *", [name || user.name, signatureTitle || user.signature_title, status || user.status, user.id])).rows[0];
    }
    await client.query(`INSERT INTO workspace_members(workspace_id,user_id,role,access,entity_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role, access=excluded.access, entity_ids=excluded.entity_ids`, [req.auth.workspaceId, user.id, role, access, JSON.stringify(entityIds || [])]);
    await client.query("COMMIT");
    res.status(201).json({ users: await members(req.auth.workspaceId) });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

app.patch("/api/users/:id/password", auth, requireAdmin, async (req, res, next) => {
  try {
    if (String(req.body.password || "").length < 8) return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères" });
    await pool.query("UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2 AND EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$3 AND user_id=$2)", [await bcrypt.hash(req.body.password, 12), req.params.id, req.auth.workspaceId]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.delete("/api/users/:id", auth, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.auth.user.id) return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre accès" });
    await pool.query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [req.auth.workspaceId, req.params.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.patch("/api/profile", auth, async (req, res, next) => {
  try {
    const { name, email, signatureTitle, bio, photoDataUrl, onboardingSeen } = req.body;
    const result = await pool.query(`UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), signature_title=COALESCE($3,signature_title), bio=COALESCE($4,bio), photo_data_url=COALESCE($5,photo_data_url), onboarding_seen=COALESCE($6,onboarding_seen), updated_at=now() WHERE id=$7 RETURNING *`, [name, email?.toLowerCase(), signatureTitle, bio, photoDataUrl, onboardingSeen, req.auth.user.id]);
    res.json({ user: safeUser({ ...result.rows[0], role: req.auth.user.role, access: req.auth.user.access, entity_ids: req.auth.user.entity_ids }) });
  } catch (error) { next(error); }
});

app.patch("/api/profile/entities", auth, async (req, res, next) => {
  try {
    const entityIds = Array.isArray(req.body.entityIds) ? req.body.entityIds : [];
    await pool.query("UPDATE workspace_members SET entity_ids=$1 WHERE workspace_id=$2 AND user_id=$3", [JSON.stringify(entityIds), req.auth.workspaceId, req.auth.user.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.patch("/api/profile/password", auth, async (req, res, next) => {
  try {
    if (!(await bcrypt.compare(String(req.body.currentPassword || ""), req.auth.user.password_hash))) return res.status(400).json({ error: "Mot de passe actuel incorrect" });
    if (String(req.body.newPassword || "").length < 8) return res.status(400).json({ error: "Le nouveau mot de passe doit contenir au moins 8 caractères" });
    await pool.query("UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2", [await bcrypt.hash(req.body.newPassword, 12), req.auth.user.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : error.code === "23505" ? "Cette valeur existe déjà" : "Erreur interne du serveur" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const sockets = new Map();

function broadcast(workspaceId, message) {
  for (const socket of sockets.get(workspaceId) || []) if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname !== "/ws") return socket.destroy();
    const claims = jwt.verify(url.searchParams.get("token"), JWT_SECRET);
    wss.handleUpgrade(request, socket, head, ws => {
      const set = sockets.get(claims.workspaceId) || new Set();
      set.add(ws); sockets.set(claims.workspaceId, set);
      ws.on("close", () => set.delete(ws));
      ws.send(JSON.stringify({ type: "connected" }));
    });
  } catch (_) { socket.destroy(); }
});

await migrate();
await seed();
server.listen(PORT, "0.0.0.0", () => console.log(`FinanceOS API listening on ${PORT}`));
