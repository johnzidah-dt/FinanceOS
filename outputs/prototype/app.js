const DEFAULT_EMAIL = "admin@demo.local";
const APP_VERSION = "2.0.0";
const DATA_SCHEMA_VERSION = 2;
const currentDate = new Date();
const today = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
const STORAGE_KEY = "finance-os-prototype-v17";
const TOKEN_KEY = "finance-os-session";
const CLIENT_ID = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const SHARED_KEYS = [
  "dataSchemaVersion", "dayClosedByEntity", "settings", "entities", "contacts", "invoices", "proformas",
  "payments", "receipts", "purchaseOrders", "supplierInvoices", "accountingEntries", "employees",
  "payrollRecords", "accounts", "cashOperations", "disbursements", "closures", "statements", "projects"
];
let authToken = sessionStorage.getItem(TOKEN_KEY) || "";
let serverRevision = 0;
let lastSyncedState = "";
let syncTimer = null;
let syncSocket = null;
let applyingRemoteState = false;

const state = {
  dataSchemaVersion: DATA_SCHEMA_VERSION,
  authenticated: false,
  currentUserEmail: DEFAULT_EMAIL,
  currentEntityId: "acceleratt",
  selectedInvoiceId: "",
  selectedProformaId: "",
  selectedAccountId: "",
  selectedFolderName: "",
  selectedOperationDate: today,
  onboardingStep: 0,
  dayClosedByEntity: {},
  contactTab: "client",
  purchaseTab: "supplier-invoices",
  payrollTab: "runs",
  cashTab: "journal",
  settingsTab: "documents",
  selectedSupplierInvoiceId: "",
  selectedEmployeeId: "",
  editingEmployeeId: "",
  profile: {
    name: "Admin Finance",
    email: DEFAULT_EMAIL,
    signatureTitle: "Le Responsable administratif et financier",
    bio: "Responsable du suivi financier, des arrêtés et de la traçabilité documentaire.",
    photoDataUrl: ""
  },
  settings: {
    logoDataUrl: "",
    brandName: "Finance OS",
    tagline: "Gestion financière et facturation",
    signers: { invoice: DEFAULT_EMAIL, proforma: DEFAULT_EMAIL, receipt: DEFAULT_EMAIL, payroll: DEFAULT_EMAIL },
    payrollRules: { cnssEmployee: 4, cnssEmployer: 17.5, amuEmployee: 5, amuEmployer: 5, irppRate: 0, workingDays: 22 },
    footer: "Finance OS\nFacturation - Paiements - Caisse - Banque\nModèle de facture configurable par société",
    terms: "Validité de l’offre : 15 jours.\nDémarrage après validation écrite de la proforma ou réception d’un bon de commande.\nLes délais d’exécution sont confirmés après acceptation."
  },
  entities: [
    { id: "acceleratt", name: "Acceleratt Group SARL", sector: "Conseil & transformation digitale", country: "Togo", settings: null }
  ],
  contacts: [],
  invoices: [],
  proformas: [],
  payments: [],
  receipts: [],
  purchaseOrders: [],
  supplierInvoices: [],
  accountingEntries: [],
  employees: [],
  payrollRecords: [],
  accounts: [],
  cashOperations: [],
  disbursements: [],
  closures: [],
  users: [
    { entityIds: ["acceleratt"], name: "Admin Finance", email: DEFAULT_EMAIL, signatureTitle: "Le Responsable administratif et financier", role: "Admin", status: "Actif", onboardingSeen: false, access: "dashboard,invoices,proformas,contacts,purchases,payroll,payments,cashdesk,dailyops,accounts,folders,reports,settings,profile" }
  ],
  statements: [],
  projects: []
};

const byId = id => document.getElementById(id);
const fmt = value => `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value) || 0))} CFA`;
const userEntityIds = user => user?.entityIds || (user?.entityId ? [user.entityId] : []);
const scoped = key => state[key].filter(item => key === "users" ? userEntityIds(item).includes(state.currentEntityId) : item.entityId === state.currentEntityId);
const currentEntity = () => state.entities.find(e => e.id === state.currentEntityId);
const currentSettings = () => currentEntity()?.settings || state.settings;
const currentPayrollRules = () => {
  const settings = currentSettings();
  settings.payrollRules = settings.payrollRules || { cnssEmployee: 4, cnssEmployer: 17.5, amuEmployee: 5, amuEmployer: 5, irppRate: 0, workingDays: 22 };
  return settings.payrollRules;
};
const isDayClosed = () => Boolean(state.dayClosedByEntity[state.currentEntityId]);
const authorizedEntities = () => {
  const user = currentUser();
  return state.entities.filter(entity => userEntityIds(user).includes(entity.id));
};
const invoiceTotal = invoice => invoice.lines.reduce((sum, line) => sum + (line.type === "line" ? lineTotal(line) : 0), 0);
const lineTotal = line => Number(line.totalOverride ?? ((Number(line.unit) || 0) * (Number(line.qty) || 0)));
const invoiceStatus = invoice => invoice.paid >= invoiceTotal(invoice) ? "Payée" : invoice.paid > 0 ? "Partiellement payée" : "Impayée";
const statusClass = status => ["Payée", "Comptabilisée", "Validé", "Validée", "Actif"].includes(status) ? "paid" : ["Partiellement payée", "Envoyé", "Invitation envoyée"].includes(status) ? "partial" : "due";
const accountName = id => state.accounts.find(account => account.id === id)?.name || id;
const selectedInvoice = () => state.invoices.find(invoice => invoice.id === state.selectedInvoiceId) || scoped("invoices")[0];
const selectedProforma = () => state.proformas.find(proforma => proforma.id === state.selectedProformaId) || scoped("proformas")[0];
const bankAccounts = () => scoped("accounts").filter(account => account.type === "Banque");
const paymentAccount = documentData => state.accounts.find(account => account.id === documentData?.paymentAccountId) || bankAccounts()[0];
const receiptFor = paymentId => state.receipts.find(receipt => receipt.paymentId === paymentId);
const selectedFolder = () => scoped("projects").find(project => project.name === state.selectedFolderName) || scoped("projects")[0];
const selectedEmployee = () => scoped("employees").find(employee => employee.id === state.selectedEmployeeId) || null;
const currentUser = () => state.users.find(user => user.email === state.currentUserEmail) || state.users[0];
const contactFor = client => scoped("contacts").find(contact => contact.company === client || client?.includes(contact.company));
const contactMark = client => {
  const contact = contactFor(client);
  if (!contact) return `<span class="client-logo mini">?</span>`;
  return contact.logoDataUrl ? `<img class="client-logo mini" src="${contact.logoDataUrl}" alt="">` : `<span class="client-logo mini">${contact.logo || contact.company.slice(0, 2).toUpperCase()}</span>`;
};
const invoiceYear = invoice => Number(String(invoice?.date || today).slice(0, 4));
const invoiceMonth = invoice => String(invoice?.date || today).slice(5, 7) || "01";
const invoiceSequenceData = reference => {
  const match = String(reference || "").trim().match(/^N\/Réf\.(\d+)\/(\d{2}|\d{4})\/PROF\/AG$/i);
  if (!match) return null;
  const rawYear = Number(match[2]);
  return { sequence: Number(match[1]), year: match[2].length === 2 ? 2000 + rawYear : rawYear };
};
const invoiceSequence = reference => invoiceSequenceData(reference)?.sequence || null;

function nextInvoiceSequence(year = Number(String(today).slice(0, 4))) {
  const sequences = scoped("invoices")
    .filter(invoice => invoiceYear(invoice) === year)
    .map(invoice => invoiceSequenceData(invoice.reference))
    .filter(data => data && data.year === year && data.sequence > 0)
    .map(data => data.sequence);
  return sequences.length ? Math.max(...sequences) + 1 : 1;
}

function invoiceSequencePolicy(year) {
  const settings = currentSettings();
  settings.invoiceSequencePolicy = settings.invoiceSequencePolicy || {};
  settings.invoiceSequencePolicy[year] = settings.invoiceSequencePolicy[year] || {};
  return settings.invoiceSequencePolicy[year];
}

function formatInvoiceIdentifiers(invoice, sequence) {
  const year = invoiceYear(invoice);
  const shortYear = String(year).slice(-2);
  const month = invoiceMonth(invoice);
  const padded = String(sequence).padStart(3, "0");
  invoice.id = `FCT-${padded}-${month}-${shortYear}`;
  invoice.number = `${padded}/${month}/${shortYear}`;
  invoice.reference = `N/Réf.${padded}/${shortYear}/PROF/AG`;
  invoice.sequence = sequence;
}

function invoiceSeriesStart(invoice, ignoredInvoice = invoice) {
  const year = invoiceYear(invoice);
  const parsed = invoiceSequenceData(invoice.reference);
  const sequences = scoped("invoices")
    .filter(item => item !== ignoredInvoice && invoiceYear(item) === year)
    .map(item => invoiceSequenceData(item.reference))
    .filter(data => data && data.year === year && data.sequence > 0)
    .map(data => data.sequence);
  if (parsed && parsed.year === year && parsed.sequence > 0) sequences.push(parsed.sequence);
  return sequences.length ? Math.min(...sequences) : 1;
}

function confirmIrregularSequenceStart(invoice, ignoredInvoice = invoice) {
  const year = invoiceYear(invoice);
  const startSequence = invoiceSeriesStart(invoice, ignoredInvoice);
  const policy = invoiceSequencePolicy(year);
  if (startSequence === 1 || policy.approvedStart === startSequence) return true;
  const accepted = confirm(`La séquence annuelle ${year} devrait démarrer à 001. Souhaitez-vous exceptionnellement la démarrer à ${String(startSequence).padStart(3, "0")} ?`);
  if (accepted) policy.approvedStart = startSequence;
  return accepted;
}

function nextProformaSequence() {
  return scoped("proformas").length + 1;
}

function readImageFile(file, callback) {
  if (!file || !file.name) {
    callback("");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => callback(reader.result);
  reader.readAsDataURL(file);
}

function readFileData(file) {
  return new Promise(resolve => {
    if (!file || !file.name) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function ensureFolder(name, client = "") {
  const folderName = String(name || "").trim();
  if (!folderName || folderName === "Aucun dossier") return;
  const exists = scoped("projects").some(project => project.name === folderName);
  if (!exists) state.projects.unshift({ entityId: state.currentEntityId, name: folderName, client: client || "Non renseigné", expenses: 0 });
}

function documentBrandHeader() {
  const settings = currentSettings();
  const logo = settings.logoDataUrl
    ? `<img class="invoice-logo-img" src="${settings.logoDataUrl}" alt="Logo">`
    : `<div class="logo-placeholder">Logo à configurer</div>`;
  return `<header class="invoice-brand">${logo}</header>`;
}

function documentFooter() {
  return `<footer class="invoice-footer">${currentSettings().footer.replaceAll("\n", "<br>")}</footer>`;
}

function documentSigner(kind) {
  const settings = currentSettings();
  settings.signers = settings.signers || { invoice: DEFAULT_EMAIL, proforma: DEFAULT_EMAIL, receipt: DEFAULT_EMAIL, payroll: DEFAULT_EMAIL };
  if (!("payroll" in settings.signers)) settings.signers.payroll = DEFAULT_EMAIL;
  return scoped("users").find(user => user.email === settings.signers[kind] && user.status === "Actif") || null;
}

function documentSignature(kind, label) {
  const signer = documentSigner(kind);
  if (!signer) return `<div class="signature"><span>${label}</span><div class="signature-person"><strong>Signataire à configurer</strong></div></div>`;
  return `<div class="signature"><span>${signer.signatureTitle || label}</span><div class="signature-person"><strong>${signer.name}</strong></div></div>`;
}

function bankInfoBlock(documentData) {
  const account = paymentAccount(documentData);
  if (!account) return "";
  return `<section class="document-info-block bank-details"><h3>Coordonnées bancaires</h3><div class="voucher-grid">
    <strong>Titulaire</strong><span>${account.holder || currentEntity().name}</span>
    <strong>Banque</strong><span>${account.institution || account.name}</span>
    <strong>N° de compte</strong><span>${account.number || "-"}</span>
    <strong>IBAN / RIB</strong><span>${account.rib || "-"}</span>
    <strong>SWIFT / BIC</strong><span>${account.swift || "-"}</span>
  </div></section>`;
}

function termsBlock() {
  return `<section class="document-info-block terms-block"><h3>Conditions générales de vente</h3><p>${currentSettings().terms.replaceAll("\n", "<br>")}</p></section>`;
}

function closureTotals(date = today) {
  const entries = dailyEntries(date);
  const cash = entries.filter(e => state.accounts.find(a => a.id === e.accountId)?.type === "Caisse").reduce((s, e) => s + e.amount, 0);
  const bank = entries.filter(e => state.accounts.find(a => a.id === e.accountId)?.type === "Banque").reduce((s, e) => s + e.amount, 0);
  return { entries, cash, bank, total: cash + bank };
}

function blockIfDayClosed() {
  if (!isDayClosed()) return false;
  alert("La journée est déjà arrêtée. Aucune nouvelle opération ne peut être saisie aujourd’hui.");
  return true;
}

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(state.settings));
}

function ensureEntitySettings(entity = currentEntity()) {
  if (entity && !entity.settings) entity.settings = cloneDefaultSettings();
  return entity?.settings || state.settings;
}

function sharedState() {
  return Object.fromEntries(SHARED_KEYS.map(key => [key, state[key]]));
}

function cacheState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...state,
      dataSchemaVersion: DATA_SCHEMA_VERSION,
      authenticated: false,
      onboardingStep: 0
    }));
  } catch (_) {
    // Le prototype continue de fonctionner si le stockage local est indisponible.
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(options.headers || {}) }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || "Le serveur FinanceOS est indisponible.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function applyServerPayload(payload, authenticated = state.authenticated) {
  applyingRemoteState = true;
  Object.assign(state, payload.state || {});
  state.users = payload.users || state.users;
  state.authenticated = authenticated;
  if (payload.user) {
    state.currentUserEmail = payload.user.email;
    state.profile = { name: payload.user.name, email: payload.user.email, signatureTitle: payload.user.signatureTitle || payload.user.role, bio: payload.user.bio || "", photoDataUrl: payload.user.photoDataUrl || "" };
    state.currentEntityId = userEntityIds(payload.user)[0] || state.currentEntityId;
  }
  serverRevision = Number(payload.revision) || serverRevision;
  lastSyncedState = JSON.stringify(sharedState());
  state.entities.forEach(ensureEntitySettings);
  applyingRemoteState = false;
  cacheState();
}

function scheduleRemoteSave() {
  if (!state.authenticated || !authToken || applyingRemoteState) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncRemoteState, 350);
}

async function syncRemoteState() {
  const snapshot = JSON.stringify(sharedState());
  if (snapshot === lastSyncedState) return;
  try {
    const result = await apiRequest("/api/state", { method: "PUT", body: JSON.stringify({ state: JSON.parse(snapshot), baseState: lastSyncedState ? JSON.parse(lastSyncedState) : null, revision: serverRevision, schemaVersion: DATA_SCHEMA_VERSION, sourceId: CLIENT_ID }) });
    if (result.state) applyServerPayload({ ...result, users: state.users }, true);
    else {
      serverRevision = result.revision;
      lastSyncedState = snapshot;
    }
    byId("sync-status")?.classList.remove("sync-error");
  } catch (error) {
    if (error.status === 409 && error.payload?.state) {
      applyServerPayload(error.payload, true);
      renderAll();
      alert("Un autre utilisateur a modifié les données au même moment. FinanceOS a chargé la version la plus récente afin d’éviter un écrasement.");
      return;
    }
    byId("sync-status")?.classList.add("sync-error");
    console.error(error);
  }
}

function persistState() {
  cacheState();
  scheduleRemoteSave();
}

function connectRealtime() {
  syncSocket?.close();
  if (!authToken) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  syncSocket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(authToken)}`);
  syncSocket.addEventListener("open", () => byId("sync-status")?.classList.remove("sync-error"));
  syncSocket.addEventListener("message", async event => {
    const message = JSON.parse(event.data || "{}");
    if (message.type !== "state-updated" || message.sourceId === CLIENT_ID || message.revision <= serverRevision) return;
    try {
      const payload = await apiRequest("/api/state");
      applyServerPayload(payload, true);
      renderAll();
    } catch (error) { console.error(error); }
  });
  syncSocket.addEventListener("close", () => {
    if (state.authenticated) setTimeout(connectRealtime, 3000);
  });
}

function migrateSavedData(saved) {
  const migrated = JSON.parse(JSON.stringify(saved));
  const sourceVersion = Number(migrated.dataSchemaVersion) || 0;
  if (sourceVersion > DATA_SCHEMA_VERSION) throw new Error("Cette sauvegarde a été créée par une version plus récente de Finance OS.");
  if (sourceVersion < 1) migrated.dataSchemaVersion = 1;
  if (sourceVersion < 2) migrated.dataSchemaVersion = 2;
  return migrated;
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.entities) && Array.isArray(saved.users)) Object.assign(state, migrateSavedData(saved), { authenticated: false });
  } catch (_) {
    localStorage.removeItem(STORAGE_KEY);
  }
  state.entities.forEach(ensureEntitySettings);
  [state.settings, ...state.entities.map(entity => entity.settings)].filter(Boolean).forEach(settings => {
    settings.footer = String(settings.footer || "")
      .replaceAll("Entités", "Sociétés")
      .replaceAll("Entité", "Société")
      .replaceAll("entités", "sociétés")
      .replaceAll("entité", "société");
  });
  state.users.forEach(user => {
    if (!user.signatureTitle) user.signatureTitle = user.role === "Admin" ? "Le Gérant" : user.role;
    const access = String(user.access || roleAccess(user.role)).split(",").filter(Boolean);
    if (["Admin", "Manager financier", "Auditeur"].includes(user.role) && !access.includes("purchases")) access.push("purchases");
    if (["Admin", "Manager financier", "Auditeur"].includes(user.role) && !access.includes("payroll")) access.push("payroll");
    user.access = access.join(",");
  });
  state.employees.forEach(employee => {
    employee.status = employee.status || "Actif";
    employee.title = employee.title || "";
    employee.phone = employee.phone || "";
    employee.birthDate = employee.birthDate || "";
    employee.nationalId = employee.nationalId || "";
    employee.address = employee.address || "";
    employee.department = employee.department || "";
    employee.contractReference = employee.contractReference || "";
    employee.endDate = employee.endDate || "";
    employee.bankName = employee.bankName || "";
    employee.rib = employee.rib || employee.paymentDetails || "";
    employee.contractFileName = employee.contractFileName || "";
    employee.contractFileDataUrl = employee.contractFileDataUrl || "";
    employee.contractDraftFileName = employee.contractDraftFileName || "";
    employee.contractDraftFileDataUrl = employee.contractDraftFileDataUrl || "";
    employee.endReasonType = employee.endReasonType || "";
    employee.endReason = employee.endReason || "";
  });
  state.dataSchemaVersion = DATA_SCHEMA_VERSION;
}

function exportDataBackup() {
  const payload = {
    format: "finance-os-backup",
    appVersion: APP_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: { ...state, dataSchemaVersion: DATA_SCHEMA_VERSION, authenticated: false, onboardingStep: 0 }
  };
  download(`finance-os-backup-${today}.json`, "application/json;charset=utf-8", JSON.stringify(payload, null, 2));
  byId("backup-status").textContent = `Sauvegarde générée le ${new Date().toLocaleString("fr-FR")}.`;
}

function importDataBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (payload?.format !== "finance-os-backup" || !payload.data || !Array.isArray(payload.data.entities) || !Array.isArray(payload.data.users)) throw new Error("Format de sauvegarde invalide.");
      const restored = migrateSavedData(payload.data);
      if (!confirm(`Restaurer la sauvegarde du ${new Date(payload.exportedAt || file.lastModified).toLocaleString("fr-FR")} ? Les données partagées de cet espace FinanceOS seront remplacées pour tous les utilisateurs.`)) return;
      if (state.authenticated && authToken) {
        Object.assign(state, Object.fromEntries(SHARED_KEYS.filter(key => key in restored).map(key => [key, restored[key]])));
        lastSyncedState = "";
        syncRemoteState().then(() => location.reload()).catch(error => { byId("backup-status").textContent = error.message; });
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...restored, authenticated: false, onboardingStep: 0 }));
        location.reload();
      }
    } catch (error) {
      byId("backup-status").textContent = error.message || "Impossible de restaurer cette sauvegarde.";
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function entityIdFromName(name) {
  const base = String(name || "societe").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "societe";
  let id = base;
  let suffix = 2;
  while (state.entities.some(entity => entity.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function toggleAuthMode(register) {
  byId("login-form").classList.toggle("is-hidden", register);
  byId("register-form").classList.toggle("is-hidden", !register);
}

async function registerOrganization(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  byId("register-error").textContent = "Création de l’espace en cours…";
  try {
    const payload = await apiRequest("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
    authToken = payload.token;
    sessionStorage.setItem(TOKEN_KEY, authToken);
    applyServerPayload(payload, true);
    byId("login-screen").classList.add("is-hidden");
    byId("app-shell").classList.remove("is-hidden");
    byId("register-error").textContent = "";
    event.currentTarget.reset();
    connectRealtime();
    renderAll();
    openOnboarding();
  } catch (error) {
    byId("register-error").textContent = error.message;
  }
}

function renderEntitySwitcher() {
  const entities = authorizedEntities();
  if (!entities.some(entity => entity.id === state.currentEntityId) && entities[0]) state.currentEntityId = entities[0].id;
  const entity = currentEntity();
  ensureEntitySettings(entity);
  byId("entity-small-label").textContent = entity?.name || "Aucune société";
  byId("entity-select").innerHTML = entities.map(item => `<option value="${item.id}" ${item.id === state.currentEntityId ? "selected" : ""}>${item.name}</option>`).join("");
  byId("add-entity-btn").classList.toggle("is-hidden", currentUser()?.role !== "Admin");
}

function switchEntity(entityId) {
  if (!authorizedEntities().some(entity => entity.id === entityId)) return;
  state.currentEntityId = entityId;
  state.selectedInvoiceId = "";
  state.selectedProformaId = "";
  state.selectedAccountId = "";
  state.selectedFolderName = "";
  state.selectedEmployeeId = "";
  state.editingEmployeeId = "";
  const settings = ensureEntitySettings();
  byId("settings-form").brandName.value = settings.brandName;
  byId("settings-form").tagline.value = settings.tagline;
  byId("settings-form").footer.value = settings.footer;
  byId("settings-form").terms.value = settings.terms;
  navigate("dashboard");
  renderAll();
}

function closeEntityModal() {
  byId("entity-modal").classList.add("is-hidden");
}

function addEntity(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const entity = { id: entityIdFromName(data.name), name: data.name, country: data.country || "Togo", sector: data.sector || "À configurer", settings: cloneDefaultSettings() };
  state.entities.push(entity);
  const user = currentUser();
  user.entityIds = [...userEntityIds(user), entity.id];
  state.currentEntityId = entity.id;
  event.currentTarget.reset();
  closeEntityModal();
  switchEntity(entity.id);
  apiRequest("/api/profile/entities", { method: "PATCH", body: JSON.stringify({ entityIds: user.entityIds }) }).catch(error => alert(error.message));
}

function toggleMobileMenu() {
  const open = !document.querySelector(".sidebar").classList.contains("mobile-open");
  document.querySelector(".sidebar").classList.toggle("mobile-open", open);
  byId("mobile-nav-backdrop").classList.toggle("is-hidden", !open);
  byId("mobile-menu-btn").setAttribute("aria-expanded", String(open));
}

function closeMobileMenu() {
  document.querySelector(".sidebar").classList.remove("mobile-open");
  byId("mobile-nav-backdrop").classList.add("is-hidden");
  byId("mobile-menu-btn").setAttribute("aria-expanded", "false");
}

async function init() {
  restoreState();
  byId("app-version-label").textContent = APP_VERSION;
  byId("data-schema-label").textContent = DATA_SCHEMA_VERSION;
  byId("operation-date-picker").value = today;
  const settings = currentSettings();
  byId("settings-form").brandName.value = settings.brandName;
  byId("settings-form").tagline.value = settings.tagline;
  byId("settings-form").footer.value = settings.footer;
  byId("settings-form").terms.value = settings.terms;
  bindEvents();
  renderAll();
  if (authToken) {
    try {
      const payload = await apiRequest("/api/state");
      applyServerPayload(payload, true);
      byId("login-screen").classList.add("is-hidden");
      byId("app-shell").classList.remove("is-hidden");
      connectRealtime();
      renderAll();
    } catch (_) {
      authToken = "";
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }
  registerPwa();
}

function bindEvents() {
  byId("show-register-btn").addEventListener("click", () => toggleAuthMode(true));
  byId("show-login-btn").addEventListener("click", () => toggleAuthMode(false));
  byId("register-form").addEventListener("submit", registerOrganization);
  byId("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    byId("login-error").textContent = "Connexion en cours…";
    try {
      const payload = await apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
      authToken = payload.token;
      sessionStorage.setItem(TOKEN_KEY, authToken);
      applyServerPayload(payload, true);
      byId("login-screen").classList.add("is-hidden");
      byId("app-shell").classList.remove("is-hidden");
      byId("login-error").textContent = "";
      connectRealtime();
      renderAll();
      if (!payload.user.onboardingSeen) openOnboarding();
    } catch (error) {
      byId("login-error").textContent = error.message;
    }
  });
  byId("logout-btn").addEventListener("click", () => {
    state.authenticated = false;
    finishOnboarding();
    authToken = "";
    sessionStorage.removeItem(TOKEN_KEY);
    syncSocket?.close();
    closeMobileMenu();
    byId("app-shell").classList.add("is-hidden");
    byId("login-screen").classList.remove("is-hidden");
    toggleAuthMode(false);
  });
  byId("entity-select").addEventListener("change", event => switchEntity(event.target.value));
  byId("add-entity-btn").addEventListener("click", () => byId("entity-modal").classList.remove("is-hidden"));
  byId("close-entity-modal").addEventListener("click", closeEntityModal);
  byId("entity-modal").addEventListener("click", event => { if (event.target.id === "entity-modal") closeEntityModal(); });
  byId("entity-form").addEventListener("submit", addEntity);
  byId("mobile-menu-btn").addEventListener("click", toggleMobileMenu);
  byId("mobile-nav-backdrop").addEventListener("click", closeMobileMenu);
  byId("profile-btn").addEventListener("click", () => navigate("profile"));
  document.querySelectorAll(".nav-item[data-view]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.querySelectorAll("button[data-view='reports']").forEach(button => button.addEventListener("click", () => navigate("reports")));
  document.querySelectorAll("[data-export]").forEach(button => button.addEventListener("click", () => exportJournal(button.dataset.export)));
  byId("quick-new-invoice").addEventListener("click", createInvoice);
  byId("new-invoice-btn").addEventListener("click", createInvoice);
  byId("new-proforma-btn").addEventListener("click", createProforma);
  byId("save-proforma-btn").addEventListener("click", () => { saveProformaFromEditor(); renderAll(); });
  byId("back-proformas-btn").addEventListener("click", () => navigate("proformas"));
  byId("back-proforma-editor-btn").addEventListener("click", () => navigate("proforma-create"));
  byId("open-proforma-preview-btn").addEventListener("click", () => { saveProformaFromEditor(); navigate("proforma-preview-view"); renderDocumentPage("proforma-page", selectedProforma(), "PROFORMA"); });
  byId("download-proforma-pdf").addEventListener("click", () => selectedProforma() && downloadFinancialPdf(selectedProforma(), "PROFORMA"));
  byId("add-proforma-line").addEventListener("click", () => { selectedProforma().lines.push({ type: "line", ref: "", label: "", unit: 0, qty: 1, totalOverride: 0 }); renderProformaEditor(); });
  byId("back-folders-btn").addEventListener("click", () => navigate("folders"));
  byId("back-invoices-btn").addEventListener("click", () => navigate("invoices"));
  byId("back-accounts-btn").addEventListener("click", () => navigate("accounts"));
  byId("back-editor-btn").addEventListener("click", () => navigate("invoice-create"));
  byId("open-preview-btn").addEventListener("click", () => {
    if (!saveInvoiceFromEditor()) return;
    navigate("invoice-preview-view");
    renderInvoicePreview();
  });
  byId("download-invoice-pdf").addEventListener("click", () => selectedInvoice() && downloadFinancialPdf(selectedInvoice(), "FACTURE"));
  byId("add-line-btn").addEventListener("click", () => { selectedInvoice().lines.push({ type: "line", ref: "", label: "", unit: 0, qty: 1, totalOverride: 0 }); renderInvoiceEditor(); });
  byId("add-section-btn").addEventListener("click", () => { selectedInvoice().lines.push({ type: "section", title: "" }); renderInvoiceEditor(); });
  byId("save-invoice-btn").addEventListener("click", () => {
    if (saveInvoiceFromEditor()) renderAll();
  });
  byId("payment-form").addEventListener("submit", addPayment);
  byId("new-purchase-order-btn").addEventListener("click", openPurchaseOrderModal);
  byId("new-supplier-invoice-btn").addEventListener("click", openSupplierInvoiceModal);
  byId("close-purchase-order-modal").addEventListener("click", closePurchaseOrderModal);
  byId("close-supplier-invoice-modal").addEventListener("click", closeSupplierInvoiceModal);
  byId("purchase-order-modal").addEventListener("click", event => { if (event.target.id === "purchase-order-modal") closePurchaseOrderModal(); });
  byId("supplier-invoice-modal").addEventListener("click", event => { if (event.target.id === "supplier-invoice-modal") closeSupplierInvoiceModal(); });
  byId("purchase-order-form").addEventListener("submit", createPurchaseOrder);
  byId("supplier-invoice-form").addEventListener("submit", createSupplierInvoice);
  byId("add-supplier-from-order").addEventListener("click", openSupplierContactFromPurchase);
  byId("add-supplier-from-invoice").addEventListener("click", openSupplierContactFromPurchase);
  document.querySelectorAll("[data-purchase-tab]").forEach(button => button.addEventListener("click", () => setPurchaseTab(button.dataset.purchaseTab)));
  document.querySelectorAll("[data-payroll-tab]").forEach(button => button.addEventListener("click", () => setPayrollTab(button.dataset.payrollTab)));
  byId("new-employee-btn").addEventListener("click", () => openEmployeeModal());
  byId("close-employee-modal").addEventListener("click", closeEmployeeModal);
  byId("employee-modal").addEventListener("click", event => { if (event.target.id === "employee-modal") closeEmployeeModal(); });
  byId("employee-form").addEventListener("submit", addEmployee);
  byId("back-employees-btn").addEventListener("click", () => { state.payrollTab = "employees"; navigate("payroll"); renderPayroll(); });
  byId("edit-employee-btn").addEventListener("click", () => selectedEmployee() && openEmployeeModal(selectedEmployee().id));
  byId("end-employee-contract-btn").addEventListener("click", openEmployeeEndModal);
  byId("delete-employee-btn").addEventListener("click", deleteSelectedEmployee);
  byId("close-employee-end-modal").addEventListener("click", closeEmployeeEndModal);
  byId("employee-end-modal").addEventListener("click", event => { if (event.target.id === "employee-end-modal") closeEmployeeEndModal(); });
  byId("employee-end-form").addEventListener("submit", endEmployeeContract);
  byId("payroll-run-form").addEventListener("submit", generatePayroll);
  byId("open-payroll-settings").addEventListener("click", () => { navigate("settings"); setSettingsTab("payroll"); });
  document.querySelectorAll("[data-cash-tab]").forEach(button => button.addEventListener("click", () => setCashTab(button.dataset.cashTab)));
  document.querySelectorAll("[data-settings-tab]").forEach(button => button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab)));
  byId("user-form").elements.role.addEventListener("change", event => renderUserAccessOptions(event.target.value));
  byId("contact-form").addEventListener("submit", addContact);
  byId("add-contact-btn").addEventListener("click", openContactModal);
  byId("close-contact-modal").addEventListener("click", closeContactModal);
  byId("contact-modal").addEventListener("click", event => {
    if (event.target.id === "contact-modal") closeContactModal();
  });
  byId("invoice-client-form").addEventListener("submit", createClientFromInvoice);
  byId("close-client-modal").addEventListener("click", closeClientModal);
  byId("client-modal").addEventListener("click", event => {
    if (event.target.id === "client-modal") closeClientModal();
  });
  document.querySelectorAll("[data-contact-tab]").forEach(button => button.addEventListener("click", () => {
    state.contactTab = button.dataset.contactTab;
    document.querySelectorAll("[data-contact-tab]").forEach(item => {
      const active = item.dataset.contactTab === state.contactTab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderContacts();
  }));
  byId("cash-operation-form").addEventListener("submit", addCashOperation);
  byId("disbursement-form").addEventListener("submit", createDisbursement);
  byId("daily-close-btn").addEventListener("click", closeDay);
  byId("find-operation-btn").addEventListener("click", () => {
    state.selectedOperationDate = byId("operation-date-picker").value || today;
    renderOperationSearch();
  });
  byId("early-close-btn").addEventListener("click", openEarlyCloseModal);
  byId("close-early-modal").addEventListener("click", closeEarlyCloseModal);
  byId("early-close-modal").addEventListener("click", event => {
    if (event.target.id === "early-close-modal") closeEarlyCloseModal();
  });
  byId("early-close-form").addEventListener("submit", submitEarlyClose);
  byId("user-form").addEventListener("submit", addUser);
  byId("add-account-btn").addEventListener("click", openAccountModal);
  byId("close-account-modal").addEventListener("click", closeAccountModal);
  byId("account-modal").addEventListener("click", event => {
    if (event.target.id === "account-modal") closeAccountModal();
  });
  byId("account-form").addEventListener("submit", addAccount);
  byId("print-voucher-btn").addEventListener("click", () => {
    const latest = scoped("disbursements")[0];
    if (latest) downloadVoucherPdf(latest);
  });
  byId("signed-voucher-upload").addEventListener("change", event => {
    const latest = scoped("disbursements")[0];
    if (latest && event.target.files[0]) {
      latest.scanName = event.target.files[0].name;
      latest.status = "Scan attaché";
      renderCashdesk();
    }
  });
  byId("statement-upload").addEventListener("change", event => {
    if (event.target.files[0]) {
      state.statements.unshift({ entityId: state.currentEntityId, name: event.target.files[0].name, date: today, status: "À rapprocher", matches: 2 });
      renderAccounts();
    }
  });
  byId("settings-form").addEventListener("submit", saveSettings);
  byId("payroll-settings-form").addEventListener("submit", savePayrollSettings);
  byId("profile-form").addEventListener("submit", saveProfile);
  byId("password-form").addEventListener("submit", changeOwnPassword);
  byId("profile-photo-upload").addEventListener("change", uploadProfilePhoto);
  byId("logo-upload").addEventListener("change", uploadLogo);
  byId("export-data-backup").addEventListener("click", exportDataBackup);
  byId("import-data-backup").addEventListener("change", importDataBackup);
  byId("onboarding-next").addEventListener("click", nextOnboardingStep);
  byId("onboarding-prev").addEventListener("click", previousOnboardingStep);
  byId("onboarding-skip").addEventListener("click", finishOnboarding);
  byId("install-app-btn")?.addEventListener("click", installPwa);
  updateCloseAvailability();
  setInterval(updateCloseAvailability, 1000);
  setInterval(() => {
    if (state.authenticated) {
      cacheState();
      syncRemoteState();
    }
  }, 1000);
}

function navigate(view) {
  document.querySelectorAll(".view").forEach(section => section.classList.remove("active-view"));
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  byId(view).classList.add("active-view");
  document.querySelectorAll(`.nav-item[data-view="${view}"]`).forEach(item => item.classList.add("active"));
  const titles = {
    dashboard: ["Tableau de bord", "Résumé décisionnel de la société sélectionnée."],
    invoices: ["Factures", "Liste des factures générées."],
    proformas: ["Proformas", "Émission, validation et conversion des proformas."],
    contacts: ["Contacts", "Clients et fournisseurs de la société."],
    "invoice-create": ["Création / édition facture", "Écran dédié pour modifier les données sans aperçu coupé."],
    "invoice-preview-view": ["Aperçu facture", "Prévisualisation séparée de la facture."],
    "proforma-create": ["Création / édition proforma", "Écran dédié pour modifier une proforma."],
    "proforma-preview-view": ["Aperçu proforma", "Prévisualisation séparée de la proforma."],
    payments: ["Paiements", "Enregistrement et liste des paiements."],
    purchases: ["Achats fournisseurs", "Bons de commande, dettes fournisseurs et règlements."],
    payroll: ["Gestion de la paie", "Employés, bulletins et écritures mensuelles."],
    "employee-detail": ["Dossier salarié", "Profil, contrat, banque, pièces et historique de paie."],
    cashdesk: ["Opérations caisse", "Gestion courante, décaissements, impression et scans signés."],
    dailyops: ["Opérations journalières", "Arrêtés consolidés des paiements, caisses et banques."],
    accounts: ["Caisses & banques", "Vue synthèse cliquable, détails par compte et consolidation."],
    "account-detail-view": ["Détail compte", "Coordonnées bancaires et mouvements."],
    folders: ["Dossiers", "Dossiers, pièces, opérations et historique complet."],
    "folder-detail": ["Détail dossier", "Historique, pièces et opérations du dossier."],
    reports: ["Rapports", "Reporting filtrable et exportable."],
    settings: ["Paramètres", "Documents, application, utilisateurs et autorisations."],
    profile: ["Profil", "Informations personnelles et photo de profil."]
  };
  byId("view-title").textContent = titles[view][0];
  byId("view-subtitle").textContent = titles[view][1];
  closeMobileMenu();
}

function renderAll() {
  renderEntitySwitcher();
  applyRoleAccess();
  renderDashboard();
  renderInvoicesList();
  renderProformas();
  renderProformaEditor();
  renderDocumentPage("proforma-page", selectedProforma(), "PROFORMA");
  renderContacts();
  renderInvoiceEditor();
  renderInvoicePreview();
  renderPayments();
  renderPurchases();
  renderPayroll();
  renderEmployeeDetail();
  renderCashdesk();
  renderDailyOps();
  renderAccounts();
  renderFolders();
  renderFolderDetail();
  renderReports();
  renderSignerSettings();
  renderSettingsPreview();
  renderUsers();
  renderProfile();
  updateCloseAvailability();
  persistState();
}

function renderDashboard() {
  const invoices = scoped("invoices");
  const payments = scoped("payments");
  const accounts = scoped("accounts");
  const cashOps = scoped("cashOperations");
  const supplierInvoices = scoped("supplierInvoices");
  const supplierDebt = supplierInvoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount) - (Number(invoice.amountPaid) || 0)), 0);
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
  const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
  const totalDue = totalInvoiced - totalPaid;
  const treasury = accounts.reduce((sum, account) => sum + account.balance, 0);
  const late = invoices.filter(invoice => invoiceStatus(invoice) !== "Payée" && invoice.dueDate < today);
  const entity = currentEntity();
  byId("risk-pill").textContent = `${late.length} créance${late.length > 1 ? "s" : ""} critique${late.length > 1 ? "s" : ""}`;
  byId("entity-overview").innerHTML = `
    <article class="entity-card"><span class="eyebrow">${entity.country}</span><h2>${entity.name}</h2><p>${entity.sector}</p><strong>${fmt(treasury)}</strong><p>Trésorerie disponible</p></article>
    <article class="entity-mini-card"><span>Factures</span><strong>${invoices.length}</strong><p class="hint">${late.length} en retard</p></article>
    <article class="entity-mini-card"><span>Paiements</span><strong>${payments.length}</strong><p class="hint">${fmt(payments.reduce((s, p) => s + p.amount, 0))}</p></article>
    <article class="entity-mini-card"><span>Écritures</span><strong>${cashOps.length}</strong><p class="hint">Caisse & banque</p></article>`;
  byId("decision-metrics").innerHTML = [
    ["Facturé", totalInvoiced, "Volume généré"],
    ["Encaissé", totalPaid, totalInvoiced ? `${Math.round(totalPaid / totalInvoiced * 100)}% du facturé` : "Aucune facture"],
    ["Reste à payer", totalDue, `${late.length} facture(s) en retard`],
    ["Trésorerie", treasury, "Caisses + banques"]
  ].map((m, index) => `<article class="metric-card"><span>${m[0]}</span><strong>${fmt(m[1])}</strong><small>${m[2]}</small><div class="mini-bars">${[30, 55, 78, 44, 68].map((h, i) => `<i style="height:${Math.max(16, h - index * 7 + i * 2)}%"></i>`).join("")}</div></article>`).join("");
  const max = Math.max(totalInvoiced, treasury, totalDue, 1);
  byId("finance-bars").innerHTML = [["Facturé", totalInvoiced], ["Encaissé", totalPaid], ["Trésorerie", treasury], ["Reste dû", totalDue]]
    .map(item => `<div class="bar-row"><strong>${item[0]}</strong><div class="bar-track"><span style="width:${Math.max(4, item[1] / max * 100)}%"></span></div><span>${fmt(item[1])}</span></div>`).join("");
  byId("priority-list").innerHTML = [
    ["Relancer", `${late.length} facture(s) échue(s) non soldée(s)`],
    ["Fournisseurs", `${supplierInvoices.filter(invoice => supplierInvoiceStatus(invoice) !== "Réglée").length} facture(s) à régler — ${fmt(supplierDebt)}`],
    ["Clôturer", "Arrêté journalier à générer dans Opérations journalières"],
    ["Rapprocher", `${scoped("statements").length} relevé(s) à consolider`],
    ["Scanner", `${scoped("disbursements").filter(d => !d.scanName).length} fiche(s) sans scan`]
  ].map(item => `<div class="activity-item"><div class="row-between"><strong>${item[0]}</strong><span class="status warn">Action</span></div><span class="hint">${item[1]}</span></div>`).join("");
  byId("dashboard-invoices").innerHTML = invoiceTable(invoices.filter(invoice => invoiceStatus(invoice) !== "Payée"));
  bindInvoiceActions();
  const feed = [...payments.slice(0, 3), ...cashOps.slice(0, 3)];
  byId("activity-feed").innerHTML = feed.length ? feed.map(item => `<div class="activity-item"><div class="row-between"><strong>${item.invoiceId || item.label}</strong><span>${fmt(item.amount)}</span></div><span class="hint">${item.method || item.type} - ${item.date}</span></div>`).join("") : `<p class="hint">Aucun flux récent. Commencez par créer vos comptes, contacts et factures.</p>`;
}

function validateInvoiceSequence(invoice, ignoredInvoice = invoice) {
  const errors = [];
  const parsed = invoiceSequenceData(invoice.reference);
  const year = invoiceYear(invoice);
  if (!parsed || parsed.sequence < 1) {
    errors.push("La référence doit respecter la syntaxe N/Réf.001/26/PROF/AG avec une séquence positive.");
    return errors;
  }
  if (parsed.year !== year) errors.push(`L’année de la référence doit correspondre à l’année ${year} de la facture.`);
  const duplicate = scoped("invoices").some(item => item !== ignoredInvoice
    && invoiceYear(item) === year
    && invoiceSequenceData(item.reference)?.sequence === parsed.sequence);
  if (duplicate) errors.push(`La séquence ${String(parsed.sequence).padStart(3, "0")} est déjà utilisée pour ${year}.`);
  return errors;
}

function validateInvoiceForPosting(invoice) {
  const errors = [...validateInvoiceSequence(invoice)];
  if (!String(invoice.client || "").trim()) errors.push("Le client doit être renseigné.");
  if (!String(invoice.subject || "").trim()) errors.push("L’objet de la facture doit être renseigné.");
  const issueDate = String(invoice.date || "");
  const parsedIssueDate = /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? new Date(`${issueDate}T00:00:00Z`) : null;
  if (!parsedIssueDate || Number.isNaN(parsedIssueDate.getTime()) || parsedIssueDate.toISOString().slice(0, 10) !== issueDate) errors.push("La date d’émission doit être une date valide.");
  const dueDate = String(invoice.dueDate || "");
  const parsedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? new Date(`${dueDate}T00:00:00Z`) : null;
  if (!parsedDueDate || Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate) errors.push("L’échéance doit être une date valide.");
  const account = scoped("accounts").find(item => item.id === invoice.paymentAccountId && item.type === "Banque" && item.status === "Actif");
  if (!account) errors.push("Un compte bancaire actif doit être choisi pour le règlement.");
  if (!documentSigner("invoice")) errors.push("Un signataire actif doit être configuré dans les paramètres de facturation.");
  const billableLines = invoice.lines.filter(line => line.type === "line");
  if (!billableLines.length) errors.push("La facture doit contenir au moins une ligne facturable.");
  billableLines.forEach((line, index) => {
    const position = index + 1;
    if (!String(line.label || "").trim()) errors.push(`La désignation de la ligne ${position} est obligatoire.`);
    if (!(Number(line.qty) > 0)) errors.push(`La quantité de la ligne ${position} doit être positive.`);
    if (!(lineTotal(line) > 0)) errors.push(`Le montant de la ligne ${position} doit être positif.`);
  });
  invoice.lines.filter(line => line.type === "section").forEach((line, index) => {
    if (!String(line.title || "").trim()) errors.push(`Le titre de la section ${index + 1} est obligatoire.`);
  });
  return [...new Set(errors)];
}

function invoiceErrorMarkup(errors) {
  return `<div class="form-error-box full" role="alert"><strong>La facture ne peut pas être comptabilisée</strong><ul>${errors.map(error => `<li>${error}</li>`).join("")}</ul></div>`;
}

function showInvoiceEditorErrors(errors) {
  const box = byId("invoice-editor-errors");
  if (!box) return;
  box.innerHTML = errors.length ? invoiceErrorMarkup(errors) : "";
}

function invoiceTable(invoices) {
  const rows = invoices.map(invoice => {
    const total = invoiceTotal(invoice);
    const status = invoiceStatus(invoice);
    const docState = invoice.docState || "Brouillon";
    const validationErrors = docState === "Brouillon" ? validateInvoiceForPosting(invoice) : [];
    return `<tr><td><strong>${invoice.id}</strong><small>${invoice.reference}</small></td><td>${formatDate(invoice.date || today)}</td><td><div class="client-cell">${contactMark(invoice.client)}<span>${invoice.client || "Sans client"}</span></div></td><td>${invoice.project}</td><td>${fmt(total)}</td><td>${fmt(invoice.paid)}</td><td>${fmt(total - invoice.paid)}</td><td><span class="status ${statusClass(docState)}">${docState}</span>${validationErrors.length ? `<details class="invoice-row-errors"><summary>${validationErrors.length} erreur(s)</summary><ul>${validationErrors.map(error => `<li>${error}</li>`).join("")}</ul></details>` : ""}</td><td><span class="status ${statusClass(status)}">${status}</span></td><td><div class="inline-actions compact"><button class="link-button" data-edit-invoice="${invoice.id}">Modifier</button>${docState === "Brouillon" ? `<button class="link-button" data-post-invoice="${invoice.id}">Comptabiliser</button><button class="link-button danger-text" data-delete-invoice="${invoice.id}">Supprimer</button>` : ""}</div></td></tr>`;
  }).join("");
  return `<table><thead><tr><th>Facture</th><th>Date</th><th>Client</th><th>Dossier</th><th>Total</th><th>Payé</th><th>Reste</th><th>Compta</th><th>Paiement</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="10">Aucune facture enregistrée.</td></tr>`}</tbody></table>`;
}

function renderInvoicesList() {
  const invoices = scoped("invoices");
  const invalidDrafts = invoices.filter(invoice => invoice.docState === "Brouillon" && validateInvoiceForPosting(invoice).length);
  const validationAlert = byId("invoice-validation-alert");
  validationAlert.classList.toggle("is-hidden", !invalidDrafts.length);
  validationAlert.innerHTML = invalidDrafts.length ? `<strong>${invalidDrafts.length} brouillon(s) à compléter</strong><span>Les factures signalées doivent être complétées avant leur comptabilisation.</span>` : "";
  byId("invoice-table").innerHTML = invoiceTable(invoices);
  renderSequenceAlert();
  bindInvoiceActions();
}

function bindInvoiceActions() {
  document.querySelectorAll("[data-edit-invoice]").forEach(button => button.addEventListener("click", () => {
    state.selectedInvoiceId = button.dataset.editInvoice;
    navigate("invoice-create");
    renderInvoiceEditor();
  }));
  document.querySelectorAll("[data-post-invoice]").forEach(button => button.addEventListener("click", () => postInvoice(button.dataset.postInvoice)));
  document.querySelectorAll("[data-delete-invoice]").forEach(button => button.addEventListener("click", () => deleteInvoice(button.dataset.deleteInvoice)));
}

function postInvoice(id) {
  const invoice = state.invoices.find(item => item.id === id);
  if (!invoice) return;
  const errors = validateInvoiceForPosting(invoice);
  if (errors.length) {
    invoice.validationErrors = errors;
    state.selectedInvoiceId = invoice.id;
    navigate("invoice-create");
    renderInvoiceEditor();
    showInvoiceEditorErrors(errors);
    return;
  }
  if (!confirmIrregularSequenceStart(invoice)) {
    invoice.validationErrors = ["Le démarrage irrégulier n’a pas été autorisé. Utilisez la séquence 001 avant de comptabiliser cette facture."];
    state.selectedInvoiceId = invoice.id;
    navigate("invoice-create");
    renderInvoiceEditor();
    return;
  }
  delete invoice.validationErrors;
  invoice.docState = "Comptabilisée";
  renderAll();
}

function deleteInvoice(id) {
  const invoice = state.invoices.find(item => item.id === id);
  if (!invoice || invoice.docState === "Comptabilisée") return alert("Une facture comptabilisée ne peut plus être supprimée.");
  state.invoices = state.invoices.filter(item => item.id !== id);
  state.selectedInvoiceId = scoped("invoices")[0]?.id || "";
  renderAll();
}

function renderSequenceAlert() {
  const alertBox = byId("sequence-alert");
  const issues = [];
  const invoices = scoped("invoices");
  const years = [...new Set(invoices.map(invoiceYear))].sort();
  years.forEach(year => {
    const annualInvoices = invoices.filter(invoice => invoiceYear(invoice) === year);
    const invalid = annualInvoices.filter(invoice => {
      const parsed = invoiceSequenceData(invoice.reference);
      return !parsed || parsed.year !== year || parsed.sequence < 1;
    });
    if (invalid.length) issues.push(`${year} : référence(s) invalide(s) ${invalid.map(invoice => invoice.id).join(", ")}`);
    const sequences = annualInvoices.map(invoice => invoiceSequenceData(invoice.reference))
      .filter(data => data && data.year === year && data.sequence > 0)
      .map(data => data.sequence)
      .sort((a, b) => a - b);
    if (!sequences.length) return;
    const duplicates = [...new Set(sequences.filter((sequence, index) => sequences.indexOf(sequence) !== index))];
    if (duplicates.length) issues.push(`${year} : séquence(s) en double ${duplicates.map(sequence => String(sequence).padStart(3, "0")).join(", ")}`);
    const unique = [...new Set(sequences)];
    const approvedStart = invoiceSequencePolicy(year).approvedStart;
    const expectedStart = unique[0] === 1 ? 1 : approvedStart || 1;
    const missing = [];
    for (let sequence = expectedStart; sequence < unique[0]; sequence += 1) missing.push(sequence);
    for (let index = 1; index < unique.length; index += 1) {
      for (let sequence = unique[index - 1] + 1; sequence < unique[index]; sequence += 1) missing.push(sequence);
    }
    if (missing.length) issues.push(`${year} : numéro(s) manquant(s) ${missing.map(sequence => String(sequence).padStart(3, "0")).join(", ")}`);
  });
  if (!issues.length) {
    alertBox.classList.add("is-hidden");
    alertBox.innerHTML = "";
    return;
  }
  alertBox.classList.remove("is-hidden");
  alertBox.innerHTML = `<strong>Séquence irrégulière détectée</strong><span>${issues.join(" · ")}. Vérifiez avant émission officielle.</span>`;
}

function renderInvoiceEditor() {
  const invoice = selectedInvoice();
  if (!invoice) return;
  const clients = scoped("contacts").filter(contact => contact.type === "client");
  const banks = bankAccounts();
  byId("editor-title").textContent = invoice.id ? `Éditeur - ${invoice.id}` : "Nouvelle facture";
  byId("invoice-editor").innerHTML = `
    <div id="invoice-editor-errors" class="full">${invoice.validationErrors?.length ? invoiceErrorMarkup(invoice.validationErrors) : ""}</div>
    <label>Client existant<select name="clientSelect"><option value="">Choisir un client</option>${clients.map(client => `<option value="${client.company}" ${invoice.client === client.company ? "selected" : ""}>${client.company}</option>`).join("")}</select></label>
    <label>Client facturé<input name="client" value="${invoice.client || ""}" placeholder="Nom du client"></label>
    <div class="full inline-actions"><button id="open-client-modal" type="button" class="btn ghost">+ Nouveau client</button><span class="hint">Créez un client avec ses informations de contact sans quitter la facture.</span></div>
    <label>Date d’émission<input name="date" type="date" value="${invoice.date || today}"></label>
    <label>Référence annuelle<input name="reference" value="${invoice.reference || ""}"><small>Format : N/Réf.001/${String(invoiceYear(invoice)).slice(-2)}/PROF/AG</small></label>
    <label>État<div class="invoice-state-field"><span class="status ${statusClass(invoice.docState || "Brouillon")}">${invoice.docState || "Brouillon"}</span></div></label>
    <label>Objet<input name="subject" value="${invoice.subject || ""}"></label>
    <label>Pour<input name="purpose" value="${invoice.purpose || ""}"></label>
    <label>Dossier<input name="project" value="${invoice.project || ""}"></label>
    <label>Échéance<input name="dueDate" type="date" value="${invoice.dueDate || today}"></label>
    <label class="full">Compte bancaire de paiement<select name="paymentAccountId"><option value="">Choisir un compte bancaire actif</option>${banks.filter(account => account.status === "Actif").map(account => `<option value="${account.id}" ${invoice.paymentAccountId === account.id ? "selected" : ""}>${account.name} - ${account.institution || "Banque"}</option>`).join("")}</select></label>
    <div class="full"></div>
    ${invoice.lines.map((line, index) => line.type === "section" ? `
      <div class="line-editor section-line" data-line="${index}">
        <label>Section<input data-field="title" value="${line.title || ""}"></label>
        <button type="button" class="btn ghost" data-delete-line="${index}">×</button>
      </div>` : `
      <div class="line-editor" data-line="${index}">
        <label>Réf<input data-field="ref" value="${line.ref || ""}"></label>
        <label>Désignation<input data-field="label" value="${line.label || ""}"></label>
        <label>P.U<input data-field="unit" type="number" value="${line.unit || 0}"></label>
        <label>Qtté<input data-field="qty" value="${line.qty || ""}"></label>
        <label>Coût<input data-field="totalOverride" type="number" value="${lineTotal(line)}"></label>
        <button type="button" class="btn ghost" data-delete-line="${index}">×</button>
      </div>`).join("")}
  `;
  document.querySelectorAll("[data-delete-line]").forEach(button => button.addEventListener("click", () => {
    invoice.lines.splice(Number(button.dataset.deleteLine), 1);
    renderInvoiceEditor();
  }));
  const clientSelect = byId("invoice-editor").querySelector("[name='clientSelect']");
  const clientInput = byId("invoice-editor").querySelector("[name='client']");
  clientSelect.addEventListener("change", () => {
    if (clientSelect.value) clientInput.value = clientSelect.value;
  });
  byId("open-client-modal").addEventListener("click", openClientModal);
}

function saveInvoiceFromEditor() {
  const invoice = selectedInvoice();
  if (!invoice) return false;
  const formData = Object.fromEntries(new FormData(byId("invoice-editor")));
  if (formData.clientSelect) formData.client = formData.clientSelect;
  delete formData.clientSelect;
  const candidate = { ...invoice, ...formData, lines: invoice.lines.map(line => ({ ...line })) };
  byId("invoice-editor").querySelectorAll("[data-line]").forEach(row => {
    const line = candidate.lines[Number(row.dataset.line)];
    row.querySelectorAll("[data-field]").forEach(input => {
      line[input.dataset.field] = input.type === "number" ? Number(input.value) : input.value;
    });
  });
  const enteredSequence = invoiceSequenceData(candidate.reference);
  if (!enteredSequence || enteredSequence.sequence < 1) {
    showInvoiceEditorErrors(["La référence doit respecter la syntaxe N/Réf.001/26/PROF/AG avec une séquence positive."]);
    return false;
  }
  const yearChanged = invoiceYear(candidate) !== invoiceYear(invoice);
  const referenceUnchanged = formData.reference === invoice.reference;
  const sequence = yearChanged && referenceUnchanged ? nextInvoiceSequence(invoiceYear(candidate)) : enteredSequence.sequence;
  formatInvoiceIdentifiers(candidate, sequence);
  const sequenceErrors = validateInvoiceSequence(candidate, invoice);
  if (sequenceErrors.length) {
    showInvoiceEditorErrors(sequenceErrors);
    return false;
  }
  if (!confirmIrregularSequenceStart(candidate, invoice)) {
    showInvoiceEditorErrors(["Le démarrage irrégulier n’a pas été autorisé. Utilisez la séquence 001 pour enregistrer cette facture."]);
    return false;
  }
  const oldId = invoice.id;
  Object.assign(invoice, candidate);
  formatInvoiceIdentifiers(invoice, sequence);
  state.selectedInvoiceId = invoice.id;
  scoped("payments").filter(payment => payment.invoiceId === oldId).forEach(payment => { payment.invoiceId = invoice.id; });
  scoped("receipts").filter(receipt => receipt.invoiceId === oldId).forEach(receipt => { receipt.invoiceId = invoice.id; });
  delete invoice.validationErrors;
  ensureFolder(invoice.project, invoice.client);
  showInvoiceEditorErrors([]);
  return true;
}

function renderContacts() {
  const type = state.contactTab;
  const contacts = scoped("contacts").filter(contact => contact.type === type);
  const label = type === "client" ? "Clients" : "Fournisseurs";
  byId("contact-list-title").textContent = label;
  byId("contact-form-title").textContent = type === "client" ? "Nouveau client" : "Nouveau fournisseur";
  byId("contact-form").elements.type.value = type;
  byId("contacts-list").innerHTML = contacts.map(contact => `
    <article class="contact-card">
      ${contact.logoDataUrl ? `<img class="contact-logo" src="${contact.logoDataUrl}" alt="">` : `<div class="contact-logo">${contact.logo}</div>`}
      <div>
        <h3>${contact.company}</h3>
        <p>${contact.person}</p>
        <span>${contact.phone}</span>
        <span>${contact.email}</span>
        <small>${contact.address}</small>
      </div>
    </article>
  `).join("") || `<p class="hint">Aucun ${type === "client" ? "client" : "fournisseur"} enregistré.</p>`;
}

function addContact(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const file = form.elements.logoFile.files[0];
  delete data.logoFile;
  readImageFile(file, logoDataUrl => {
    state.contacts.unshift({ entityId: state.currentEntityId, ...data, logoDataUrl });
    state.contactTab = data.type;
    document.querySelectorAll("[data-contact-tab]").forEach(item => {
      const active = item.dataset.contactTab === state.contactTab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    form.reset();
    form.elements.type.value = state.contactTab;
    form.elements.logo.value = state.contactTab === "client" ? "CL" : "FR";
    closeContactModal();
    renderContacts();
    renderInvoiceEditor();
    renderInvoicesList();
    renderProformas();
  });
}

function openContactModal() {
  byId("contact-form").elements.type.value = state.contactTab;
  byId("contact-form").elements.logo.value = state.contactTab === "client" ? "CL" : "FR";
  byId("contact-form-title").textContent = state.contactTab === "client" ? "Nouveau client" : "Nouveau fournisseur";
  byId("contact-modal").classList.remove("is-hidden");
}

function closeContactModal() {
  byId("contact-modal").classList.add("is-hidden");
}

function createInvoice() {
  const year = Number(String(today).slice(0, 4));
  const sequence = nextInvoiceSequence(year);
  const invoice = {
    entityId: state.currentEntityId,
    id: "",
    number: "",
    reference: "",
    date: today,
    dueDate: today,
    client: "",
    subject: "",
    purpose: "",
    project: "",
    paid: 0,
    docState: "Brouillon",
    paymentAccountId: bankAccounts()[0]?.id || "",
    lines: []
  };
  formatInvoiceIdentifiers(invoice, sequence);
  state.invoices.unshift(invoice);
  state.selectedInvoiceId = invoice.id;
  navigate("invoice-create");
  renderAll();
}

function renderProformas() {
  const proformas = scoped("proformas");
  if (!state.selectedProformaId || !proformas.some(p => p.id === state.selectedProformaId)) state.selectedProformaId = proformas[0]?.id || "";
  byId("proforma-table").innerHTML = `<table><thead><tr><th>Proforma</th><th>Client</th><th>Total</th><th>État</th><th>Acceptation</th><th></th></tr></thead><tbody>${proformas.map(proforma => {
    const canDelete = proforma.docState !== "Validé" && !proforma.acceptanceName;
    return `<tr><td><strong>${proforma.id}</strong><small>${proforma.reference}</small></td><td><div class="client-cell">${contactMark(proforma.client)}<span>${proforma.client || "Sans client"}</span></div></td><td>${fmt(invoiceTotal(proforma))}</td><td><span class="status ${statusClass(proforma.docState)}">${proforma.docState}</span></td><td>${proforma.acceptanceName || "Non attachée"}</td><td><div class="inline-actions compact"><button class="link-button" data-edit-proforma="${proforma.id}">Modifier</button><button class="link-button" data-send-proforma="${proforma.id}">Envoyer</button><button class="link-button" data-validate-proforma="${proforma.id}">Valider</button><button class="link-button" data-convert-proforma="${proforma.id}">Transformer</button>${canDelete ? `<button class="link-button danger-text" data-delete-proforma="${proforma.id}">Supprimer</button>` : ""}</div></td></tr>`;
  }).join("")}</tbody></table>`;
  document.querySelectorAll("[data-edit-proforma]").forEach(button => button.addEventListener("click", () => {
    state.selectedProformaId = button.dataset.editProforma;
    navigate("proforma-create");
    renderProformaEditor();
  }));
  document.querySelectorAll("[data-send-proforma]").forEach(button => button.addEventListener("click", () => updateProformaState(button.dataset.sendProforma, "Envoyé")));
  document.querySelectorAll("[data-validate-proforma]").forEach(button => button.addEventListener("click", () => validateProforma(button.dataset.validateProforma)));
  document.querySelectorAll("[data-convert-proforma]").forEach(button => button.addEventListener("click", () => convertProformaToInvoice(button.dataset.convertProforma)));
  document.querySelectorAll("[data-delete-proforma]").forEach(button => button.addEventListener("click", () => deleteProforma(button.dataset.deleteProforma)));
}

function renderProformaEditor() {
  const proforma = selectedProforma();
  const clients = scoped("contacts").filter(contact => contact.type === "client");
  if (!proforma) {
    byId("proforma-editor").innerHTML = `<p class="hint full">Aucune proforma.</p>`;
    return;
  }
  byId("proforma-editor-title").textContent = `Éditeur - ${proforma.id}`;
  byId("proforma-editor").innerHTML = `
    <label>Client<select name="client">${clients.map(client => `<option value="${client.company}" ${proforma.client === client.company ? "selected" : ""}>${client.company}</option>`).join("")}</select></label>
    <label>Référence<input name="reference" value="${proforma.reference || ""}"></label>
    <label>État<select name="docState"><option ${proforma.docState === "Brouillon" ? "selected" : ""}>Brouillon</option><option ${proforma.docState === "Envoyé" ? "selected" : ""}>Envoyé</option><option ${proforma.docState === "Validé" ? "selected" : ""}>Validé</option></select></label>
    <label>Objet<input name="subject" value="${proforma.subject || ""}"></label>
    <label>Pour<input name="purpose" value="${proforma.purpose || ""}"></label>
    <label>Dossier<input name="project" value="${proforma.project || ""}"></label>
    <label>Échéance<input name="dueDate" type="date" value="${proforma.dueDate || today}"></label>
    <label>Acceptation / BC<input name="acceptanceFile" type="file" accept="image/*,.pdf"></label>
    <div class="full inline-actions"><button class="btn ghost" type="button" id="generate-purchase-order">Générer bon de commande</button><span class="hint">${proforma.acceptanceName ? `Pièce attachée : ${proforma.acceptanceName}` : "Aucune pièce d’acceptation attachée."}</span></div>
    <div class="full history-box"><strong>Historique des modifications</strong>${(proforma.history || []).map(item => `<span>${item.date} - ${item.action} - ${item.by}</span>`).join("") || `<span>Aucune modification enregistrée.</span>`}</div>
    ${proforma.lines.map((line, index) => `
      <div class="line-editor" data-proforma-line="${index}">
        <label>Réf<input data-field="ref" value="${line.ref || ""}"></label>
        <label>Désignation<input data-field="label" value="${line.label || ""}"></label>
        <label>P.U<input data-field="unit" type="number" value="${line.unit || 0}"></label>
        <label>Qtté<input data-field="qty" value="${line.qty || ""}"></label>
        <label>Coût<input data-field="totalOverride" type="number" value="${lineTotal(line)}"></label>
        <button type="button" class="btn ghost" data-delete-proforma-line="${index}">×</button>
      </div>`).join("")}
    <div class="full"></div>`;
  byId("generate-purchase-order").addEventListener("click", () => {
    proforma.acceptanceName = `BC-${proforma.number.replaceAll("/", "-")}.pdf`;
    proforma.docState = "Validé";
    proforma.history = proforma.history || [];
    proforma.history.unshift({ date: today, action: "Bon de commande généré", by: "Admin Finance" });
    createSystemPdf({
      filename: proforma.acceptanceName,
      title: "BON DE COMMANDE",
      reference: proforma.reference,
      date: today,
      infoRows: [["Client", proforma.client], ["Objet", proforma.subject], ["Dossier", proforma.project || "Non lie"]],
      headers: ["Ref", "Designation", "P.U", "Qte", "Cout"],
      widths: [58, 236, 70, 48, 91],
      rows: proforma.lines.map(line => [line.ref || "-", line.label || "-", fmt(line.unit), line.qty, fmt(lineTotal(line))]),
      summaryRows: [["TOTAL", fmt(invoiceTotal(proforma))]],
      signatureKind: "proforma",
      signatureLabel: "Signataire autorise"
    });
    renderProformaEditor();
  });
  document.querySelectorAll("[data-delete-proforma-line]").forEach(button => button.addEventListener("click", () => {
    proforma.lines.splice(Number(button.dataset.deleteProformaLine), 1);
    renderProformaEditor();
  }));
}

function saveProformaFromEditor() {
  const proforma = selectedProforma();
  if (!proforma) return;
  const before = JSON.stringify(proforma);
  const form = byId("proforma-editor");
  const data = Object.fromEntries(new FormData(form));
  const file = form.elements.acceptanceFile.files[0];
  Object.assign(proforma, data);
  delete proforma.acceptanceFile;
  if (file) proforma.acceptanceName = file.name;
  ensureFolder(proforma.project, proforma.client);
  if (proforma.docState === "Validé" && !proforma.acceptanceName) {
    alert("Ajoutez une proforma visée ou générez un bon de commande avant de valider.");
    proforma.docState = "Envoyé";
  }
  form.querySelectorAll("[data-proforma-line]").forEach(row => {
    const line = proforma.lines[Number(row.dataset.proformaLine)];
    row.querySelectorAll("[data-field]").forEach(input => {
      line[input.dataset.field] = input.type === "number" ? Number(input.value) : input.value;
    });
  });
  if (JSON.stringify(proforma) !== before) {
    proforma.history = proforma.history || [];
    proforma.history.unshift({ date: today, action: "Modification", by: "Admin Finance" });
  }
  renderProformas();
}

function createProforma() {
  const sequence = String(nextProformaSequence()).padStart(3, "0");
  const proforma = { entityId: state.currentEntityId, id: `PRO-${sequence}-06-26`, number: `${sequence}/06/26`, reference: `N/Réf.${sequence}/26/PROF/AG`, date: today, dueDate: today, client: "", subject: "", purpose: "", project: "", docState: "Brouillon", acceptanceName: "", history: [{ date: today, action: "Création", by: "Admin Finance" }], lines: [] };
  state.proformas.unshift(proforma);
  state.selectedProformaId = proforma.id;
  navigate("proforma-create");
  renderAll();
  renderProformaEditor();
}

function updateProformaState(id, docState) {
  const proforma = state.proformas.find(item => item.id === id);
  if (!proforma) return;
  proforma.docState = docState;
  proforma.history = proforma.history || [];
  proforma.history.unshift({ date: today, action: `État changé en ${docState}`, by: "Admin Finance" });
  renderProformas();
}

function validateProforma(id) {
  const proforma = state.proformas.find(item => item.id === id);
  if (!proforma) return;
  if (!proforma.acceptanceName) {
    alert("Ajoutez une proforma visée ou un bon de commande dans l’éditeur pour tracer l’acceptation.");
    return;
  }
  proforma.docState = "Validé";
  proforma.history = proforma.history || [];
  proforma.history.unshift({ date: today, action: "Validation avec acceptation", by: "Admin Finance" });
  renderProformas();
}

function deleteProforma(id) {
  const proforma = state.proformas.find(item => item.id === id);
  if (!proforma) return;
  if (proforma.docState === "Validé" || proforma.acceptanceName) return alert("Une proforma acceptée ne peut plus être supprimée.");
  state.proformas = state.proformas.filter(item => item.id !== id);
  state.selectedProformaId = scoped("proformas")[0]?.id || "";
  renderAll();
}

function convertProformaToInvoice(id) {
  const proforma = state.proformas.find(item => item.id === id);
  if (!proforma) return;
  const sequence = nextInvoiceSequence(invoiceYear(proforma));
  const invoice = { ...proforma, id: "", number: "", reference: "", docState: "Brouillon", paid: 0, paymentAccountId: bankAccounts()[0]?.id || "", lines: proforma.lines.map(line => ({ ...line })) };
  formatInvoiceIdentifiers(invoice, sequence);
  state.invoices.unshift(invoice);
  state.selectedInvoiceId = invoice.id;
  navigate("invoice-create");
  renderAll();
}

function renderDocumentMarkup(documentData, title) {
  const total = invoiceTotal(documentData);
  return `
    ${documentBrandHeader()}
    <div class="invoice-meta"><strong>${documentData.reference || "Référence"}</strong><span>Lomé, le ${formatDate(documentData.date || today)}</span></div>
    <div class="invoice-client"><p><u>Concerne : ${documentData.subject || ""}</u></p><p><strong>Client:</strong> ${documentData.client || ""}</p></div>
    <h2>${title} N°${documentData.number || ""} (CFA)</h2>
    <p><strong>Pour :</strong> ${documentData.purpose || ""}</p>
    <table class="invoice-table"><thead><tr><th>Réf</th><th>Désignation</th><th>P.U</th><th>Qtté</th><th>Coût</th></tr></thead><tbody>
      ${documentData.lines.length ? documentData.lines.map((line, index) => line.type === "section" ? `<tr class="section"><td colspan="5">${line.title}</td></tr>` : `<tr class="${index % 2 ? "alt" : ""}"><td><strong>${line.ref}</strong></td><td>${line.label}</td><td>${fmt(line.unit).replace(" CFA", "")}</td><td>${line.qty}</td><td>${fmt(lineTotal(line)).replace(" CFA", "")}</td></tr>`).join("") : `<tr><td colspan="5">Aucune ligne renseignée</td></tr>`}
    </tbody><tfoot><tr><td colspan="4">TOTAL</td><td>${fmt(total).replace(" CFA", "")}</td></tr></tfoot></table>
    <p class="amount-text">Arrêté le présent document à la somme totale de ${fmt(total)} HT.</p>
    ${documentSignature(title === "FACTURE" ? "invoice" : "proforma", "Signataire autorisé")}
    ${title === "FACTURE" ? bankInfoBlock(documentData) : ""}
    ${title === "PROFORMA" ? termsBlock() : ""}
    ${documentFooter()}`;
}

function renderDocumentPage(nodeId, documentData, title) {
  if (!documentData) return;
  byId(nodeId).innerHTML = renderDocumentMarkup(documentData, title);
}

function renderInvoicePreview() {
  renderDocumentPage("invoice-page", selectedInvoice(), "FACTURE");
}

function renderPayments() {
  const invoices = scoped("invoices").filter(invoice => invoice.docState === "Comptabilisée");
  const accounts = scoped("accounts");
  const payments = scoped("payments");
  const canPay = invoices.length && accounts.length && !isDayClosed();
  byId("payment-form").innerHTML = `
    <label>Facture<select name="invoiceId">${invoices.map(i => `<option value="${i.id}">${i.id} - ${i.client || "Sans client"}</option>`).join("")}</select></label>
    <label>Montant<input name="amount" type="number" value="250000"></label>
    <label>Moyen<select name="method"><option>Virement</option><option>Espèces</option><option>Mobile money</option><option>Chèque</option></select></label>
    <label>Destination<select name="destinationId">${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}</select></label>
    <p class="hint full">${canPay ? "Sélectionnez une facture comptabilisée et un compte de réception." : "Comptabilisez d’abord une facture et créez un compte de réception."}</p>
    <button class="btn primary full" type="submit" ${canPay ? "" : "disabled"}>Valider le paiement</button>`;
  byId("payments-summary").innerHTML = [
    ["Paiements enregistrés", payments.length],
    ["Montant encaissé", fmt(payments.reduce((s, p) => s + p.amount, 0))],
    ["Aujourd’hui", fmt(payments.filter(p => p.date === today).reduce((s, p) => s + p.amount, 0))]
  ].map(row => `<div class="activity-item"><div class="row-between"><strong>${row[0]}</strong><span>${row[1]}</span></div></div>`).join("");
  byId("payments-table").innerHTML = `<table><thead><tr><th>Date</th><th>Référence</th><th>Facture</th><th>Montant</th><th>Moyen</th><th>Destination</th><th>Statut</th><th>Reçu</th></tr></thead><tbody>${payments.length ? payments.map(p => {
    const receipt = receiptFor(p.id);
    return `<tr><td>${p.date}</td><td>${p.id}</td><td>${p.invoiceId}</td><td>${fmt(p.amount)}</td><td>${p.method}</td><td>${accountName(p.destinationId)}</td><td><span class="status paid">${p.status}</span></td><td>${receipt ? `<button class="link-button" data-download-receipt="${receipt.id}">${receipt.id}</button>` : "À générer"}</td></tr>`;
  }).join("") : `<tr><td colspan="8">Aucun paiement enregistré.</td></tr>`}</tbody></table>`;
  document.querySelectorAll("[data-download-receipt]").forEach(button => button.addEventListener("click", () => downloadReceipt(button.dataset.downloadReceipt)));
}

function addPayment(event) {
  event.preventDefault();
  if (blockIfDayClosed()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.invoiceId || !data.destinationId) return alert("Créez une facture et un compte avant d’enregistrer un paiement.");
  const amount = Number(data.amount);
  const invoice = state.invoices.find(i => i.id === data.invoiceId);
  if (!invoice || invoice.docState !== "Comptabilisée") return alert("Seule une facture comptabilisée peut recevoir un paiement.");
  if (invoice) invoice.paid = Math.min(invoiceTotal(invoice), invoice.paid + amount);
  const account = state.accounts.find(a => a.id === data.destinationId);
  if (account) account.balance += amount;
  const payment = { entityId: state.currentEntityId, id: `PAY-${String(scoped("payments").length + 1).padStart(3, "0")}`, invoiceId: data.invoiceId, amount, method: data.method, destinationId: data.destinationId, date: today, status: "Confirmé" };
  state.payments.unshift(payment);
  state.receipts.unshift({ entityId: state.currentEntityId, id: `REC-${String(scoped("receipts").length + 1).padStart(3, "0")}`, paymentId: payment.id, invoiceId: payment.invoiceId, amount, method: payment.method, destinationId: payment.destinationId, date: today });
  renderAll();
}

function downloadReceipt(id) {
  const receipt = state.receipts.find(item => item.id === id);
  if (!receipt) return;
  downloadReceiptPdf(receipt);
}

function supplierInvoiceStatus(invoice) {
  const paid = Number(invoice.amountPaid) || 0;
  if (paid >= Number(invoice.amount)) return "Réglée";
  if (paid > 0) return "Partiellement réglée";
  if (invoice.dueDate < today) return "Échue";
  return "À payer";
}

function setPurchaseTab(tab) {
  state.purchaseTab = tab;
  document.querySelectorAll("[data-purchase-tab]").forEach(button => {
    const active = button.dataset.purchaseTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-purchase-panel]").forEach(panel => panel.classList.toggle("is-hidden", panel.dataset.purchasePanel !== tab));
}

function setCashTab(tab) {
  state.cashTab = tab;
  document.querySelectorAll("[data-cash-tab]").forEach(button => {
    const active = button.dataset.cashTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-cash-panel]").forEach(panel => panel.classList.toggle("is-hidden", panel.dataset.cashPanel !== tab));
}

function renderPurchases() {
  const suppliers = scoped("contacts").filter(contact => contact.type === "supplier");
  const orders = scoped("purchaseOrders");
  const invoices = scoped("supplierInvoices");
  const entries = scoped("accountingEntries").filter(entry => entry.sourceType === "supplier-invoice");
  const outstanding = invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount) - (Number(invoice.amountPaid) || 0)), 0);
  const overdue = invoices.filter(invoice => supplierInvoiceStatus(invoice) === "Échue");
  byId("purchase-summary").innerHTML = [
    ["Bons de commande", orders.length, "Demandes d’achat"],
    ["Factures reçues", invoices.length, "Pièces fournisseurs"],
    ["Dette fournisseurs", outstanding, "Reste à régler"],
    ["Factures échues", overdue.length, "À prioriser"]
  ].map((item, index) => `<article class="metric-card"><span>${item[0]}</span><strong>${index === 2 ? fmt(item[1]) : item[1]}</strong><small>${item[2]}</small></article>`).join("");
  byId("supplier-invoice-table").innerHTML = `<table><thead><tr><th>Facture</th><th>Fournisseur</th><th>BC</th><th>Échéance</th><th>Montant</th><th>Réglé</th><th>Reste</th><th>État</th><th>Pièce</th><th></th></tr></thead><tbody>${invoices.length ? invoices.map(invoice => {
    const remaining = Math.max(0, Number(invoice.amount) - (Number(invoice.amountPaid) || 0));
    const status = supplierInvoiceStatus(invoice);
    return `<tr><td><strong>${invoice.supplierReference}</strong><small>${invoice.id}</small></td><td>${invoice.supplier}</td><td>${invoice.purchaseOrderId || "-"}</td><td>${formatDate(invoice.dueDate)}</td><td>${fmt(invoice.amount)}</td><td>${fmt(invoice.amountPaid)}</td><td>${fmt(remaining)}</td><td><span class="status ${status === "Réglée" ? "paid" : status === "Partiellement réglée" ? "partial" : "due"}">${status}</span></td><td><button class="link-button" data-download-supplier-invoice="${invoice.id}">${invoice.fileName}</button></td><td>${remaining ? `<button class="link-button" data-settle-supplier-invoice="${invoice.id}">Régler</button>` : ""}</td></tr>`;
  }).join("") : `<tr><td colspan="10">Aucune facture fournisseur enregistrée.</td></tr>`}</tbody></table>`;
  byId("purchase-order-table").innerHTML = `<table><thead><tr><th>Bon de commande</th><th>Date</th><th>Fournisseur</th><th>Objet</th><th>Montant</th><th>Dossier</th><th>État</th><th></th></tr></thead><tbody>${orders.length ? orders.map(order => `<tr><td><strong>${order.id}</strong></td><td>${formatDate(order.date)}</td><td>${order.supplier}</td><td>${order.purpose}</td><td>${fmt(order.amount)}</td><td>${order.project || "-"}</td><td><span class="status ${order.status === "Facturé" ? "paid" : "partial"}">${order.status}</span></td><td><button class="link-button" data-download-purchase-order="${order.id}">Télécharger</button></td></tr>`).join("") : `<tr><td colspan="8">Aucun bon de commande.</td></tr>`}</tbody></table>`;
  byId("purchase-accounting-table").innerHTML = `<table><thead><tr><th>Date</th><th>Référence</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Montant</th></tr></thead><tbody>${entries.length ? entries.map(entry => `<tr><td>${formatDate(entry.date)}</td><td>${entry.id}</td><td>${entry.label}</td><td>${entry.debit}</td><td>${entry.credit}</td><td>${fmt(entry.amount)}</td></tr>`).join("") : `<tr><td colspan="6">Aucune écriture fournisseur.</td></tr>`}</tbody></table>`;
  const supplierOptions = `<option value="">Choisir un fournisseur</option>${suppliers.map(supplier => `<option value="${supplier.company}">${supplier.company}</option>`).join("")}`;
  byId("purchase-order-form").elements.supplier.innerHTML = supplierOptions;
  byId("supplier-invoice-form").elements.supplier.innerHTML = supplierOptions;
  byId("supplier-invoice-form").elements.purchaseOrderId.innerHTML = `<option value="">Sans bon de commande</option>${orders.filter(order => order.status !== "Facturé").map(order => `<option value="${order.id}">${order.id} — ${order.supplier}</option>`).join("")}`;
  byId("supplier-invoice-form").elements.purchaseOrderId.onchange = event => {
    const order = orders.find(item => item.id === event.target.value);
    if (order) {
      byId("supplier-invoice-form").elements.supplier.value = order.supplier;
      byId("supplier-invoice-form").elements.project.value = order.project || "";
      byId("supplier-invoice-form").elements.amount.value = order.amount;
    }
  };
  document.querySelectorAll("[data-download-purchase-order]").forEach(button => button.addEventListener("click", () => downloadPurchaseOrder(button.dataset.downloadPurchaseOrder)));
  document.querySelectorAll("[data-download-supplier-invoice]").forEach(button => button.addEventListener("click", () => downloadSupplierInvoice(button.dataset.downloadSupplierInvoice)));
  document.querySelectorAll("[data-settle-supplier-invoice]").forEach(button => button.addEventListener("click", () => openSupplierSettlement(button.dataset.settleSupplierInvoice)));
  setPurchaseTab(state.purchaseTab);
}

function openPurchaseOrderModal() {
  byId("purchase-order-form").elements.date.value = today;
  byId("purchase-order-modal").classList.remove("is-hidden");
}

function closePurchaseOrderModal() { byId("purchase-order-modal").classList.add("is-hidden"); }

function openSupplierInvoiceModal() {
  byId("supplier-invoice-form").elements.date.value = today;
  byId("supplier-invoice-form").elements.dueDate.value = today;
  byId("supplier-invoice-modal").classList.remove("is-hidden");
}

function closeSupplierInvoiceModal() { byId("supplier-invoice-modal").classList.add("is-hidden"); }

function openSupplierContactFromPurchase() {
  closePurchaseOrderModal();
  closeSupplierInvoiceModal();
  state.contactTab = "supplier";
  openContactModal();
}

function createPurchaseOrder(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const sequence = String(scoped("purchaseOrders").length + 1).padStart(3, "0");
  const order = { entityId: state.currentEntityId, id: `BC-${sequence}-${String(new Date(`${data.date}T00:00:00Z`).getUTCFullYear())}`, ...data, amount: Number(data.amount), status: "Émis" };
  state.purchaseOrders.unshift(order);
  ensureFolder(order.project, order.supplier);
  event.currentTarget.reset();
  closePurchaseOrderModal();
  renderAll();
}

function createSupplierInvoice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const file = form.elements.invoiceFile.files[0];
  if (!file) return alert("Ajoutez la facture numérisée du fournisseur.");
  const amount = Number(data.amount);
  if (!(amount > 0)) return alert("Le montant de la facture doit être positif.");
  if (data.dueDate < data.date) return alert("L’échéance ne peut pas être antérieure à la date de facture.");
  if (scoped("supplierInvoices").some(invoice => invoice.supplier === data.supplier && invoice.supplierReference === data.supplierReference)) return alert("Cette référence fournisseur est déjà enregistrée pour ce fournisseur.");
  const linkedOrder = state.purchaseOrders.find(item => item.id === data.purchaseOrderId);
  if (linkedOrder && linkedOrder.supplier !== data.supplier) return alert("Le fournisseur doit correspondre à celui du bon de commande.");
  const sequence = String(scoped("supplierInvoices").length + 1).padStart(3, "0");
  const reader = new FileReader();
  reader.onload = () => {
    const invoice = { entityId: state.currentEntityId, id: `FF-${sequence}-${String(invoiceYear({ date: data.date }))}`, ...data, amount, amountPaid: 0, fileName: file.name, fileDataUrl: reader.result };
    delete invoice.invoiceFile;
    state.supplierInvoices.unshift(invoice);
    state.accountingEntries.unshift({ entityId: state.currentEntityId, id: `ACH-${String(scoped("accountingEntries").length + 1).padStart(3, "0")}`, sourceType: "supplier-invoice", sourceId: invoice.id, date: invoice.date, label: `Facture ${invoice.supplierReference} — ${invoice.supplier}`, debit: invoice.category, credit: "Fournisseurs", amount: invoice.amount });
    const order = state.purchaseOrders.find(item => item.id === invoice.purchaseOrderId);
    if (order) order.status = "Facturé";
    ensureFolder(invoice.project, invoice.supplier);
    form.reset();
    closeSupplierInvoiceModal();
    renderAll();
  };
  reader.readAsDataURL(file);
}

function downloadPurchaseOrder(id) {
  const order = state.purchaseOrders.find(item => item.id === id);
  if (order) downloadPurchaseOrderPdf(order);
}

function downloadSupplierInvoice(id) {
  const invoice = state.supplierInvoices.find(item => item.id === id);
  if (!invoice?.fileDataUrl) return alert("La pièce numérisée n’est pas disponible dans cet espace FinanceOS.");
  const link = document.createElement("a");
  link.href = invoice.fileDataUrl;
  link.download = invoice.fileName;
  link.click();
}

function openSupplierSettlement(id) {
  state.selectedSupplierInvoiceId = id;
  state.cashTab = "disbursements";
  navigate("cashdesk");
  renderCashdesk();
}

function setPayrollTab(tab) {
  state.payrollTab = tab;
  document.querySelectorAll("[data-payroll-tab]").forEach(button => {
    const active = button.dataset.payrollTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-payroll-panel]").forEach(panel => panel.classList.toggle("is-hidden", panel.dataset.payrollPanel !== tab));
}

function calculatePayroll(employee, period) {
  const rules = currentPayrollRules();
  const baseSalary = Number(employee.baseSalary) || 0;
  const allowances = Number(employee.allowances) || 0;
  const gross = baseSalary + allowances;
  const cnssEmployee = gross * Number(rules.cnssEmployee) / 100;
  const amuEmployee = gross * Number(rules.amuEmployee) / 100;
  const taxable = Math.max(0, gross - cnssEmployee - amuEmployee);
  const irpp = taxable * Number(rules.irppRate) / 100;
  const net = Math.max(0, gross - cnssEmployee - amuEmployee - irpp);
  const cnssEmployer = gross * Number(rules.cnssEmployer) / 100;
  const amuEmployer = gross * Number(rules.amuEmployer) / 100;
  return { entityId: state.currentEntityId, employeeId: employee.id, employeeName: employee.name, period, baseSalary, allowances, gross, cnssEmployee, amuEmployee, irpp, net, cnssEmployer, amuEmployer, employerCost: gross + cnssEmployer + amuEmployer, status: "Brouillon" };
}

function renderPayroll() {
  const employees = scoped("employees");
  const records = scoped("payrollRecords");
  const latestPeriod = records.map(record => record.period).sort().reverse()[0] || "";
  const latest = records.filter(record => record.period === latestPeriod);
  const gross = latest.reduce((sum, record) => sum + record.gross, 0);
  const net = latest.reduce((sum, record) => sum + record.net, 0);
  const charges = latest.reduce((sum, record) => sum + record.cnssEmployer + record.amuEmployer, 0);
  byId("payroll-summary").innerHTML = [
    ["Employés actifs", employees.filter(employee => employee.status === "Actif").length, "Registre de la société"],
    ["Masse salariale", gross, latestPeriod || "Aucune période"],
    ["Net à payer", net, latestPeriod || "Aucune période"],
    ["Charges patronales", charges, "CNSS + AMU"]
  ].map((item, index) => `<article class="metric-card"><span>${item[0]}</span><strong>${index ? fmt(item[1]) : item[1]}</strong><small>${item[2]}</small></article>`).join("");
  byId("employee-table").innerHTML = `<table><thead><tr><th>Employé</th><th>Poste</th><th>Contrat</th><th>CNSS</th><th>Salaire de base</th><th>Fin prévue</th><th>Statut</th></tr></thead><tbody>${employees.length ? employees.map(employee => `<tr><td><button class="employee-name-button" data-open-employee="${employee.id}"><strong>${employee.title ? `${employee.title} ` : ""}${employee.name}</strong><small>${employee.email || "Sans compte associé"}</small></button></td><td>${employee.position}</td><td>${employee.contractType}${employee.contractReference ? `<small>${employee.contractReference}</small>` : ""}</td><td>${employee.cnssNumber || "-"}</td><td>${fmt(employee.baseSalary)}</td><td>${employee.endDate ? formatDate(employee.endDate) : "-"}</td><td><span class="status ${employee.status === "Actif" ? "paid" : "due"}">${employee.status}</span></td></tr>`).join("") : `<tr><td colspan="7">Aucun employé enregistré.</td></tr>`}</tbody></table>`;
  byId("payroll-run-table").innerHTML = `<table><thead><tr><th>Période</th><th>Employé</th><th>Brut</th><th>CNSS</th><th>AMU</th><th>IRPP</th><th>Net</th><th>Coût employeur</th><th>État</th><th></th></tr></thead><tbody>${records.length ? records.map(record => `<tr><td>${record.period}</td><td><button class="employee-name-button" data-open-employee="${record.employeeId}"><strong>${record.employeeName}</strong></button></td><td>${fmt(record.gross)}</td><td>${fmt(record.cnssEmployee)}</td><td>${fmt(record.amuEmployee)}</td><td>${fmt(record.irpp)}</td><td><strong>${fmt(record.net)}</strong></td><td>${fmt(record.employerCost)}</td><td><span class="status ${record.status === "Validée" ? "paid" : "partial"}">${record.status}</span></td><td><div class="inline-actions compact"><button class="link-button" data-download-payslip="${record.id}">Bulletin</button>${record.status === "Brouillon" ? `<button class="link-button" data-validate-payroll="${record.id}">Valider</button>` : ""}<button class="link-button danger-text" data-delete-payroll="${record.id}">Supprimer</button></div></td></tr>`).join("") : `<tr><td colspan="10">Aucune paie générée.</td></tr>`}</tbody></table>`;
  const rules = currentPayrollRules();
  byId("payroll-rules-summary").innerHTML = [
    ["CNSS salarié", `${rules.cnssEmployee}%`], ["CNSS employeur", `${rules.cnssEmployer}%`],
    ["AMU salarié", `${rules.amuEmployee}%`], ["AMU employeur", `${rules.amuEmployer}%`],
    ["IRPP provisoire", `${rules.irppRate}%`], ["Jours ouvrés", rules.workingDays]
  ].map(row => `<div><strong>${row[0]}</strong><span>${row[1]}</span></div>`).join("");
  byId("payroll-run-form").elements.period.value = `${today.slice(0, 7)}`;
  document.querySelectorAll("[data-download-payslip]").forEach(button => button.addEventListener("click", () => downloadPayslip(button.dataset.downloadPayslip)));
  document.querySelectorAll("[data-validate-payroll]").forEach(button => button.addEventListener("click", () => validatePayrollRecord(button.dataset.validatePayroll)));
  document.querySelectorAll("[data-delete-payroll]").forEach(button => button.addEventListener("click", () => deletePayrollRecord(button.dataset.deletePayroll)));
  document.querySelectorAll("[data-open-employee]").forEach(button => button.addEventListener("click", () => openEmployeeDetail(button.dataset.openEmployee)));
  setPayrollTab(state.payrollTab);
}

function openEmployeeModal(employeeId = "") {
  const employee = scoped("employees").find(item => item.id === employeeId);
  const form = byId("employee-form");
  form.reset();
  state.editingEmployeeId = employee?.id || "";
  byId("employee-modal-title").textContent = employee ? "Modifier le dossier salarié" : "Nouvel employé";
  byId("employee-modal-subtitle").textContent = employee ? "Mettez à jour les informations administratives, contractuelles et bancaires." : "Créez le dossier salarié et associez éventuellement son compte utilisateur.";
  byId("employee-submit-btn").textContent = employee ? "Enregistrer les modifications" : "Enregistrer l’employé";
  const fields = ["title", "name", "email", "phone", "birthDate", "nationalId", "address", "position", "department", "contractType", "contractReference", "startDate", "endDate", "baseSalary", "allowances", "cnssNumber", "bankName", "rib"];
  fields.forEach(field => { if (employee && form.elements[field]) form.elements[field].value = employee[field] ?? ""; });
  if (!employee) form.elements.startDate.value = today;
  byId("employee-contract-file-hint").textContent = employee?.contractFileName ? `Contrat actuel : ${employee.contractFileName}. Sélectionnez un fichier pour le remplacer.` : "PDF ou scan du contrat, facultatif.";
  byId("employee-contract-draft-hint").textContent = employee?.contractDraftFileName ? `Version actuelle : ${employee.contractDraftFileName}. Sélectionnez un fichier pour la remplacer.` : "Version de référence, facultative.";
  byId("employee-modal").classList.remove("is-hidden");
}

function closeEmployeeModal() {
  state.editingEmployeeId = "";
  byId("employee-modal").classList.add("is-hidden");
}

async function addEmployee(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);
  const contractFile = form.elements.contractFile.files[0];
  const contractDraftFile = form.elements.contractDraftFile.files[0];
  delete data.contractFile;
  delete data.contractDraftFile;
  if (data.endDate && data.endDate < data.startDate) return alert("La date de fin prévue ne peut pas être antérieure à la date d’entrée.");
  data.baseSalary = Number(data.baseSalary);
  data.allowances = Number(data.allowances) || 0;
  const contractFileDataUrl = await readFileData(contractFile);
  const contractDraftFileDataUrl = await readFileData(contractDraftFile);
  let employee = scoped("employees").find(item => item.id === state.editingEmployeeId);
  if (employee) {
    Object.assign(employee, data);
  } else {
    const sequence = Math.max(0, ...scoped("employees").map(item => Number(String(item.id).match(/EMP-(\d+)/)?.[1]) || 0)) + 1;
    employee = { entityId: state.currentEntityId, id: `EMP-${String(sequence).padStart(3, "0")}`, ...data, status: "Actif", contractFileName: "", contractFileDataUrl: "", contractDraftFileName: "", contractDraftFileDataUrl: "", endReasonType: "", endReason: "" };
    state.employees.unshift(employee);
  }
  if (contractFileDataUrl) {
    employee.contractFileName = contractFile.name;
    employee.contractFileDataUrl = contractFileDataUrl;
  }
  if (contractDraftFileDataUrl) {
    employee.contractDraftFileName = contractDraftFile.name;
    employee.contractDraftFileDataUrl = contractDraftFileDataUrl;
  }
  state.selectedEmployeeId = employee.id;
  form.reset();
  closeEmployeeModal();
  state.payrollTab = "employees";
  renderAll();
}

function openEmployeeDetail(employeeId) {
  if (!scoped("employees").some(employee => employee.id === employeeId)) return;
  state.selectedEmployeeId = employeeId;
  navigate("employee-detail");
  renderEmployeeDetail();
}

function renderEmployeeDetail() {
  const employee = selectedEmployee();
  if (!employee) {
    byId("employee-detail-title").textContent = "Dossier salarié";
    byId("employee-detail-subtitle").textContent = "Sélectionnez un salarié depuis la liste des employés.";
    byId("employee-detail-summary").innerHTML = "";
    byId("employee-personal-details").innerHTML = `<p class="hint">Aucun salarié sélectionné.</p>`;
    byId("employee-contract-details").innerHTML = "";
    byId("employee-document-actions").innerHTML = "";
    byId("employee-payroll-history").innerHTML = `<p class="hint">Aucun historique.</p>`;
    ["edit-employee-btn", "end-employee-contract-btn", "delete-employee-btn"].forEach(id => { byId(id).disabled = true; });
    return;
  }
  const records = scoped("payrollRecords").filter(record => record.employeeId === employee.id).sort((a, b) => b.period.localeCompare(a.period));
  const latest = records[0];
  byId("employee-detail-title").textContent = `${employee.title ? `${employee.title} ` : ""}${employee.name}`;
  byId("employee-detail-subtitle").textContent = `${employee.position}${employee.department ? ` - ${employee.department}` : ""}`;
  byId("employee-detail-summary").innerHTML = [
    ["Statut", employee.status, employee.endDate ? `Fin : ${formatDate(employee.endDate)}` : "Contrat en cours"],
    ["Salaire de base", fmt(employee.baseSalary), employee.contractType],
    ["Bulletins", records.length, records.length ? `${records.filter(record => record.status === "Validée").length} validé(s)` : "Aucun bulletin"],
    ["Dernier net", latest ? fmt(latest.net) : "-", latest?.period || "Aucune période"]
  ].map(item => `<article class="metric-card"><span>${item[0]}</span><strong>${item[1]}</strong><small>${item[2]}</small></article>`).join("");
  const detailRows = rows => rows.map(([label, value]) => `<div><strong>${label}</strong><span>${value || "-"}</span></div>`).join("");
  byId("employee-personal-details").innerHTML = detailRows([
    ["Matricule", employee.id], ["Titre / civilité", employee.title], ["Nom complet", employee.name], ["Email", employee.email], ["Téléphone", employee.phone],
    ["Date de naissance", employee.birthDate ? formatDate(employee.birthDate) : "-"], ["Pièce d’identité", employee.nationalId], ["Adresse", employee.address], ["Poste", employee.position], ["Département", employee.department], ["CNSS", employee.cnssNumber]
  ]);
  byId("employee-contract-details").innerHTML = detailRows([
    ["Type de contrat", employee.contractType], ["Référence", employee.contractReference], ["Date d’entrée", employee.startDate ? formatDate(employee.startDate) : "-"], ["Fin prévue / effective", employee.endDate ? formatDate(employee.endDate) : "-"],
    ["Motif de fin", employee.endReasonType ? `${employee.endReasonType}${employee.endReason ? ` - ${employee.endReason}` : ""}` : "-"], ["Banque", employee.bankName], ["RIB / IBAN", employee.rib], ["Contrat", employee.contractDraftFileName || "Non attaché"], ["Contrat signé", employee.contractFileName || "Non attaché"]
  ]);
  byId("employee-document-actions").innerHTML = `${employee.contractDraftFileDataUrl ? `<button class="btn ghost" data-download-employee-contract-draft="${employee.id}">Télécharger le contrat</button>` : ""}${employee.contractFileDataUrl ? `<button class="btn ghost" data-download-employee-contract="${employee.id}">Télécharger le contrat signé</button>` : ""}${employee.rib ? `<button class="btn ghost" data-download-employee-rib="${employee.id}">Télécharger la fiche RIB PDF</button>` : ""}` || `<span class="hint">Aucune pièce téléchargeable.</span>`;
  byId("employee-payroll-history").innerHTML = `<table><thead><tr><th>Période</th><th>Brut</th><th>Retenues</th><th>Net</th><th>État</th><th></th></tr></thead><tbody>${records.length ? records.map(record => `<tr><td>${record.period}</td><td>${fmt(record.gross)}</td><td>${fmt(record.cnssEmployee + record.amuEmployee + record.irpp)}</td><td><strong>${fmt(record.net)}</strong></td><td><span class="status ${record.status === "Validée" ? "paid" : "partial"}">${record.status}</span></td><td><div class="inline-actions compact"><button class="link-button" data-detail-payslip="${record.id}">Télécharger</button><button class="link-button danger-text" data-detail-delete-payroll="${record.id}">Supprimer</button></div></td></tr>`).join("") : `<tr><td colspan="6">Aucun bulletin généré pour cet employé.</td></tr>`}</tbody></table>`;
  byId("edit-employee-btn").disabled = false;
  byId("delete-employee-btn").disabled = false;
  byId("end-employee-contract-btn").disabled = employee.status !== "Actif";
  byId("end-employee-contract-btn").textContent = employee.status === "Actif" ? "Mettre fin au contrat" : "Contrat terminé";
  document.querySelectorAll("[data-detail-payslip]").forEach(button => button.addEventListener("click", () => downloadPayslip(button.dataset.detailPayslip)));
  document.querySelectorAll("[data-detail-delete-payroll]").forEach(button => button.addEventListener("click", () => deletePayrollRecord(button.dataset.detailDeletePayroll)));
  document.querySelectorAll("[data-download-employee-contract]").forEach(button => button.addEventListener("click", () => downloadEmployeeContract(button.dataset.downloadEmployeeContract)));
  document.querySelectorAll("[data-download-employee-contract-draft]").forEach(button => button.addEventListener("click", () => downloadEmployeeContractDraft(button.dataset.downloadEmployeeContractDraft)));
  document.querySelectorAll("[data-download-employee-rib]").forEach(button => button.addEventListener("click", () => downloadEmployeeRib(button.dataset.downloadEmployeeRib)));
}

function downloadEmployeeContract(employeeId) {
  const employee = scoped("employees").find(item => item.id === employeeId);
  if (!employee?.contractFileDataUrl) return;
  const link = document.createElement("a");
  link.href = employee.contractFileDataUrl;
  link.download = employee.contractFileName || `contrat-${employee.id}.pdf`;
  link.click();
}

function downloadEmployeeContractDraft(employeeId) {
  const employee = scoped("employees").find(item => item.id === employeeId);
  if (!employee?.contractDraftFileDataUrl) return;
  const link = document.createElement("a");
  link.href = employee.contractDraftFileDataUrl;
  link.download = employee.contractDraftFileName || `contrat-${employee.id}.pdf`;
  link.click();
}

function downloadEmployeeRib(employeeId) {
  const employee = scoped("employees").find(item => item.id === employeeId);
  if (!employee?.rib) return;
  createSystemPdf({ filename: `RIB-${employee.id}.pdf`, title: "INFORMATIONS BANCAIRES DU SALARIE", reference: employee.id, date: today, infoRows: [["Salarie", employee.name], ["Banque", employee.bankName || "-"], ["RIB / IBAN", employee.rib], ["Moyen de paiement", "Virement de salaire"]] });
}

function openEmployeeEndModal() {
  const employee = selectedEmployee();
  if (!employee || employee.status !== "Actif") return;
  const form = byId("employee-end-form");
  form.reset();
  form.elements.endDate.value = today;
  byId("employee-end-modal").classList.remove("is-hidden");
}

function closeEmployeeEndModal() { byId("employee-end-modal").classList.add("is-hidden"); }

function endEmployeeContract(event) {
  event.preventDefault();
  const employee = selectedEmployee();
  if (!employee || employee.status !== "Actif") return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (data.endDate < employee.startDate) return alert("La date de fin ne peut pas être antérieure à la date d’entrée.");
  employee.status = "Contrat terminé";
  employee.endDate = data.endDate;
  employee.endReasonType = data.endReasonType;
  employee.endReason = data.endReason;
  closeEmployeeEndModal();
  renderAll();
}

function deletePayrollRecord(id) {
  const record = state.payrollRecords.find(item => item.id === id && item.entityId === state.currentEntityId);
  if (!record) return;
  const accountingNotice = record.status === "Validée" ? " Les écritures comptables liées seront également supprimées." : "";
  if (!confirm(`Supprimer définitivement le bulletin ${record.period} de ${record.employeeName} ?${accountingNotice}`)) return;
  state.payrollRecords = state.payrollRecords.filter(item => item !== record);
  state.accountingEntries = state.accountingEntries.filter(entry => !(entry.entityId === state.currentEntityId && entry.sourceType === "payroll" && entry.sourceId === record.id));
  renderAll();
}

function deleteSelectedEmployee() {
  const employee = selectedEmployee();
  if (!employee) return;
  const records = scoped("payrollRecords").filter(record => record.employeeId === employee.id);
  if (!confirm(`Supprimer définitivement le dossier de ${employee.name}, ses ${records.length} bulletin(s) et leurs écritures comptables ? Le compte utilisateur éventuel sera conservé.`)) return;
  const recordIds = new Set(records.map(record => record.id));
  state.payrollRecords = state.payrollRecords.filter(record => !(record.entityId === state.currentEntityId && record.employeeId === employee.id));
  state.accountingEntries = state.accountingEntries.filter(entry => !(entry.entityId === state.currentEntityId && entry.sourceType === "payroll" && recordIds.has(entry.sourceId)));
  state.employees = state.employees.filter(item => item !== employee);
  state.selectedEmployeeId = "";
  state.payrollTab = "employees";
  navigate("payroll");
  renderAll();
}

function generatePayroll(event) {
  event.preventDefault();
  const period = new FormData(event.currentTarget).get("period");
  const employees = scoped("employees").filter(employee => employee.status === "Actif" && employee.startDate.slice(0, 7) <= period);
  if (!employees.length) return alert("Ajoutez au moins un employé actif avant de générer la paie.");
  const validatedEmployeeIds = new Set(scoped("payrollRecords").filter(record => record.period === period && record.status === "Validée").map(record => record.employeeId));
  state.payrollRecords = state.payrollRecords.filter(record => !(record.entityId === state.currentEntityId && record.period === period && record.status === "Brouillon"));
  employees.filter(employee => !validatedEmployeeIds.has(employee.id)).forEach(employee => {
    const record = calculatePayroll(employee, period);
    record.id = `PAYROLL-${period}-${employee.id}`;
    state.payrollRecords.unshift(record);
  });
  renderAll();
}

function validatePayrollRecord(id) {
  const record = state.payrollRecords.find(item => item.id === id && item.entityId === state.currentEntityId);
  if (!record || record.status === "Validée") return;
  record.status = "Validée";
  const sequence = Math.max(0, ...scoped("accountingEntries").map(entry => Number(String(entry.id).match(/^PAIE-(\d+)$/)?.[1]) || 0)) + 1;
  state.accountingEntries.unshift({ entityId: state.currentEntityId, id: `PAIE-${String(sequence).padStart(3, "0")}`, sourceType: "payroll", sourceId: record.id, date: `${record.period}-28`, label: `Paie ${record.period} — ${record.employeeName}`, debit: "Charges de personnel", credit: "Personnel — rémunérations dues", amount: record.gross });
  state.accountingEntries.unshift({ entityId: state.currentEntityId, id: `PAIE-${String(sequence + 1).padStart(3, "0")}`, sourceType: "payroll", sourceId: record.id, date: `${record.period}-28`, label: `Charges sociales ${record.period} — ${record.employeeName}`, debit: "Charges sociales patronales", credit: "CNSS / AMU à payer", amount: record.cnssEmployer + record.amuEmployer });
  renderAll();
}

function downloadPayslip(id) {
  const record = state.payrollRecords.find(item => item.id === id && item.entityId === state.currentEntityId);
  if (record) downloadPayslipPdf(record);
}

function savePayrollSettings(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const rules = currentPayrollRules();
  Object.keys(rules).forEach(key => { rules[key] = Number(data[key]); });
  renderAll();
}

function renderCashdesk() {
  const accounts = scoped("accounts");
  const projects = scoped("projects");
  const payableInvoices = scoped("supplierInvoices").filter(invoice => supplierInvoiceStatus(invoice) !== "Réglée");
  const hasAccounts = accounts.length > 0;
  byId("cash-operation-form").innerHTML = `
    <label>Compte<select name="accountId">${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}</select></label>
    <label>Type<select name="type"><option>Entrée</option><option>Transfert bancaire</option></select></label>
    <label>Compte destination<select name="targetAccountId"><option value="">Aucun</option>${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}</select></label>
    <label>Montant<input name="amount" type="number" value="50000"></label>
    <label>Libellé<input name="label" value="Dépense interne / fonctionnement"></label>
    <p class="hint full">Aucune sortie n’est autorisée ici. Les dépenses, chèques et paiements fournisseurs passent par un décaissement.</p>
    <button class="btn primary full" type="submit" ${hasAccounts && !isDayClosed() ? "" : "disabled"}>Enregistrer l’opération</button>`;
  byId("disbursement-form").innerHTML = `
    <label>Ordonnateur<input name="orderedBy" value="${currentUser()?.name || "Admin Finance"}" readonly></label>
    <label>Facture fournisseur<select name="supplierInvoiceId"><option value="">Décaissement sans facture fournisseur</option>${payableInvoices.map(invoice => `<option value="${invoice.id}" ${state.selectedSupplierInvoiceId === invoice.id ? "selected" : ""}>${invoice.id} — ${invoice.supplier} — reste ${fmt(Number(invoice.amount) - (Number(invoice.amountPaid) || 0))}</option>`).join("")}</select></label>
    <label>Bénéficiaire<input name="beneficiary" value=""></label>
    <label>Dossier<select name="project"><option value="">Aucun dossier</option>${projects.map(p => `<option>${p.name}</option>`).join("")}</select></label>
    <label>Source<select name="sourceId">${accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}</select></label>
    <label>Moyen<select name="paymentMethod"><option>Virement</option><option>Espèces</option><option>Chèque</option><option>Mobile money</option></select></label>
    <label>Montant<input name="amount" type="number" value="0"></label>
    <label class="full">Motif<input name="reason" value=""></label>
    <p class="hint full">${hasAccounts ? "La fiche sera générée après validation." : "Créez d’abord une caisse ou un compte bancaire."}</p>
    <button class="btn primary full" type="submit" ${hasAccounts && !isDayClosed() ? "" : "disabled"}>Lever la fiche</button>`;
  renderVoucher();
  const operations = scoped("cashOperations");
  byId("cash-operations-table").innerHTML = `<table><thead><tr><th>Date</th><th>Compte</th><th>Destination</th><th>Type</th><th>Libellé</th><th>Montant</th><th>Trace</th></tr></thead><tbody>${operations.length ? operations.map(op => `<tr><td>${op.date}</td><td>${accountName(op.accountId)}</td><td>${op.targetAccountId ? accountName(op.targetAccountId) : "-"}</td><td>${op.type}</td><td>${op.label}</td><td>${fmt(op.amount)}</td><td>${op.trace}</td></tr>`).join("") : `<tr><td colspan="7">Aucune opération enregistrée.</td></tr>`}</tbody></table>`;
  const disbursements = scoped("disbursements");
  byId("disbursement-table").innerHTML = `<table><thead><tr><th>Fiche</th><th>Date</th><th>Bénéficiaire</th><th>Facture fournisseur</th><th>Source</th><th>Moyen</th><th>Montant</th><th>Traçabilité</th><th></th></tr></thead><tbody>${disbursements.length ? disbursements.map(item => `<tr><td>${item.id}</td><td>${formatDate(item.date || today)}</td><td>${item.beneficiary}</td><td>${item.supplierInvoiceId || "-"}</td><td>${accountName(item.sourceId)}</td><td>${item.paymentMethod || "-"}</td><td>${fmt(item.amount)}</td><td><span class="status ${item.scanName ? "paid" : "warn"}">${item.scanName || "Scan attendu"}</span></td><td><button class="link-button" data-download-voucher="${item.id}">Télécharger</button></td></tr>`).join("") : `<tr><td colspan="9">Aucun décaissement.</td></tr>`}</tbody></table>`;
  document.querySelectorAll("[data-download-voucher]").forEach(button => button.addEventListener("click", () => {
    const item = state.disbursements.find(disbursement => disbursement.id === button.dataset.downloadVoucher);
    if (item) downloadVoucherPdf(item);
  }));
  const supplierSelect = byId("disbursement-form").elements.supplierInvoiceId;
  const applySupplierInvoice = () => {
    const invoice = payableInvoices.find(item => item.id === supplierSelect.value);
    if (!invoice) return;
    const form = byId("disbursement-form");
    form.elements.beneficiary.value = invoice.supplier;
    form.elements.amount.value = Math.max(0, Number(invoice.amount) - (Number(invoice.amountPaid) || 0));
    form.elements.reason.value = `Règlement facture fournisseur ${invoice.supplierReference}`;
    form.elements.project.value = invoice.project || "";
  };
  supplierSelect.addEventListener("change", applySupplierInvoice);
  if (supplierSelect.value) applySupplierInvoice();
  setCashTab(state.cashTab);
}

function addCashOperation(event) {
  event.preventDefault();
  if (blockIfDayClosed()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.accountId) return alert("Créez d’abord une caisse ou un compte bancaire.");
  const amount = Number(data.amount);
  if (data.type === "Entrée") data.targetAccountId = "";
  const account = state.accounts.find(a => a.id === data.accountId);
  const target = state.accounts.find(a => a.id === data.targetAccountId);
  if (!(amount > 0)) return alert("Le montant doit être positif.");
  if (data.type === "Transfert bancaire" && (!target || target.id === account?.id)) return alert("Choisissez un compte de destination interne différent du compte source.");
  if (data.type === "Transfert bancaire" && account.balance < amount) return alert("Solde insuffisant.");
  if (account) account.balance += data.type === "Entrée" ? amount : -amount;
  if (data.type === "Transfert bancaire" && target) target.balance += amount;
  state.cashOperations.unshift({ entityId: state.currentEntityId, id: `OP-${String(scoped("cashOperations").length + 1).padStart(3, "0")}`, accountId: data.accountId, targetAccountId: data.targetAccountId, type: data.type, amount, date: today, label: data.label, trace: "Manuel" });
  renderAll();
}

function createDisbursement(event) {
  event.preventDefault();
  if (blockIfDayClosed()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.sourceId) return alert("Créez d’abord une caisse ou un compte bancaire.");
  const amount = Number(data.amount);
  if (!(amount > 0)) return alert("Le montant doit être positif.");
  const account = state.accounts.find(a => a.id === data.sourceId);
  if (!account || account.balance < amount) return alert("Solde insuffisant.");
  const supplierInvoice = state.supplierInvoices.find(invoice => invoice.id === data.supplierInvoiceId && invoice.entityId === state.currentEntityId);
  if (data.supplierInvoiceId && !supplierInvoice) return alert("La facture fournisseur sélectionnée est introuvable.");
  const remaining = supplierInvoice ? Math.max(0, Number(supplierInvoice.amount) - (Number(supplierInvoice.amountPaid) || 0)) : 0;
  if (supplierInvoice && amount > remaining) return alert(`Le montant dépasse le reste à payer de ${fmt(remaining)}.`);
  account.balance -= amount;
  const disbursement = { entityId: state.currentEntityId, id: `DEC-${String(scoped("disbursements").length + 1).padStart(3, "0")}`, ...data, date: today, project: data.project || "Aucun dossier", amount, status: "À scanner", scanName: "" };
  ensureFolder(disbursement.project, disbursement.beneficiary);
  state.disbursements.unshift(disbursement);
  state.cashOperations.unshift({ entityId: state.currentEntityId, id: `OP-${String(scoped("cashOperations").length + 1).padStart(3, "0")}`, accountId: data.sourceId, type: "Sortie", amount, date: today, label: data.reason, trace: disbursement.id });
  if (supplierInvoice) {
    supplierInvoice.amountPaid = (Number(supplierInvoice.amountPaid) || 0) + amount;
    state.accountingEntries.unshift({ entityId: state.currentEntityId, id: `REG-${String(scoped("accountingEntries").length + 1).padStart(3, "0")}`, sourceType: "supplier-invoice", sourceId: supplierInvoice.id, date: today, label: `Règlement ${supplierInvoice.supplierReference} — ${supplierInvoice.supplier}`, debit: "Fournisseurs", credit: account.name, amount });
  } else {
    state.accountingEntries.unshift({ entityId: state.currentEntityId, id: `DEC-${String(scoped("accountingEntries").length + 1).padStart(3, "0")}`, sourceType: "disbursement", sourceId: disbursement.id, date: today, label: data.reason, debit: "Charge à catégoriser", credit: account.name, amount });
  }
  state.selectedSupplierInvoiceId = "";
  renderAll();
}

function renderVoucher() {
  const d = scoped("disbursements")[0] || { id: "DEC-...", beneficiary: "", project: "", sourceId: scoped("accounts")[0]?.id, amount: 0, reason: "", scanName: "" };
  byId("voucher-document").innerHTML = voucherMarkup(d);
}

function voucherMarkup(d) {
  return `${documentBrandHeader()}<h2 class="voucher-title">Fiche de décaissement ${d.id}</h2><div class="voucher-grid">
    <strong>Date</strong><span>${formatDate(d.date || today)}</span><strong>Ordonnateur</strong><span>${d.orderedBy || "Admin Finance"}</span><strong>Bénéficiaire</strong><span>${d.beneficiary}</span><strong>Facture fournisseur</strong><span>${d.supplierInvoiceId || "Non liée"}</span><strong>Dossier</strong><span>${d.project}</span><strong>Source</strong><span>${accountName(d.sourceId)}</span><strong>Moyen</strong><span>${d.paymentMethod || "Non renseigné"}</span><strong>Montant</strong><span>${fmt(d.amount)}</span><strong>Motif</strong><span>${d.reason}</span><strong>Traçabilité</strong><span>${d.scanName || "Scan signé non attaché"}</span>
  </div><div class="signature-row triple-signatures"><div class="signature-box"><strong>Ordonnateur</strong><span>Signature</span></div><div class="signature-box"><strong>Caissier</strong><span>Signature</span></div><div class="signature-box beneficiary-signature"><strong>Bénéficiaire</strong><span>(signature, nom et prénom, téléphone)</span></div></div>${documentFooter()}`;
}

function dailyEntries(date = today) {
  const payments = scoped("payments").filter(p => p.date === date).map(p => ({ date: p.date, nature: "Paiement", label: p.invoiceId, accountId: p.destinationId, amount: p.amount, trace: p.id }));
  const ops = scoped("cashOperations").filter(op => op.date === date).map(op => ({ date: op.date, nature: op.type, label: op.label, accountId: op.accountId, amount: ["Sortie", "Sortie par chèque", "Transfert bancaire"].includes(op.type) ? -op.amount : op.amount, trace: op.trace }));
  return [...payments, ...ops];
}

function closureReportMarkup(closure) {
  const computed = closureTotals(closure.date);
  const entries = computed.entries;
  const cash = Number(closure.cash ?? computed.cash);
  const bank = Number(closure.bank ?? computed.bank);
  const total = Number(closure.total ?? computed.total);
  const inflows = entries.filter(e => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const outflows = entries.filter(e => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);
  return `${documentBrandHeader()}
    <h2 class="voucher-title closure-title">Situation de caisse du ${formatDate(closure.date)}</h2>
    <div class="closure-report-meta">
      <span><strong>Référence</strong>${closure.id}</span>
      <span><strong>Société</strong>${currentEntity().name}</span>
      <span><strong>Établi par</strong>${closure.by || "Admin Finance"}</span>
      <span><strong>Type</strong>${closure.early ? "Arrêté anticipé" : "Arrêté journalier"}</span>
    </div>
    <div class="closure-summary-grid">
      <div><span>Total entrées</span><strong>${fmt(inflows)}</strong></div>
      <div><span>Total sorties</span><strong>${fmt(outflows)}</strong></div>
      <div><span>Net caisse</span><strong>${fmt(cash)}</strong></div>
      <div><span>Net banque</span><strong>${fmt(bank)}</strong></div>
      <div><span>Total arrêté</span><strong>${fmt(total)}</strong></div>
    </div>
    ${closure.reason ? `<p class="document-note"><strong>Motif :</strong> ${closure.reason}</p>` : ""}
    <table class="invoice-table closure-table"><thead><tr><th>Date</th><th>Nature</th><th>Compte</th><th>Libellé</th><th>Référence</th><th>Entrée</th><th>Sortie</th></tr></thead><tbody>
      ${entries.length ? entries.map(e => `<tr><td>${e.date}</td><td>${e.nature}</td><td>${accountName(e.accountId)}</td><td>${e.label}</td><td>${e.trace || "-"}</td><td>${e.amount > 0 ? fmt(e.amount) : "-"}</td><td>${e.amount < 0 ? fmt(Math.abs(e.amount)) : "-"}</td></tr>`).join("") : `<tr><td colspan="7">Aucune opération enregistrée à cette date.</td></tr>`}
    </tbody></table>
    <div class="signature-row closure-signatures"><div class="signature-box"><strong>Responsable finance</strong><span>Signature</span></div><div class="signature-box"><strong>Caissier</strong><span>Signature</span></div></div>
    ${documentFooter()}`;
}

function downloadClosureReport(id) {
  const closure = state.closures.find(item => item.id === id);
  if (!closure) return;
  downloadClosurePdf(closure);
}

function renderDailyOps() {
  const { entries, cash, bank } = closureTotals();
  byId("daily-summary").innerHTML = [
    ["Paiements + opérations", entries.length, "Écritures du jour"],
    ["Solde net caisse", cash, "Entrées - sorties"],
    ["Solde net banque", bank, "Entrées - sorties"],
    ["Total arrêté", cash + bank, "Base de clôture"]
  ].map(item => `<article class="metric-card"><span>${item[0]}</span><strong>${typeof item[1] === "number" && item[0] !== "Paiements + opérations" ? fmt(item[1]) : item[1]}</strong><small>${item[2]}</small></article>`).join("");
  byId("daily-entries-table").innerHTML = `<table><thead><tr><th>Date</th><th>Nature</th><th>Compte</th><th>Libellé</th><th>Montant</th></tr></thead><tbody>${entries.map(e => `<tr><td>${e.date}</td><td>${e.nature}</td><td>${accountName(e.accountId)}</td><td>${e.label}</td><td>${fmt(e.amount)}</td></tr>`).join("")}</tbody></table>`;
  byId("closure-list").innerHTML = scoped("closures").map(c => `<div class="activity-item"><div class="row-between"><strong>${c.id}</strong><span>${fmt(c.total)}</span></div><span class="hint">${c.date} - Caisse ${fmt(c.cash)} - Banque ${fmt(c.bank)} - ${c.operations} écriture(s)${c.early ? " - Arrêté anticipé" : ""}</span>${c.reason ? `<span class="hint">Cause : ${c.reason}</span>` : ""}<button class="link-button" data-download-closure="${c.id}">Télécharger l’arrêté</button></div>`).join("");
  document.querySelectorAll("[data-download-closure]").forEach(button => button.addEventListener("click", () => downloadClosureReport(button.dataset.downloadClosure)));
  renderOperationSearch();
  updateCloseAvailability();
}

function renderOperationSearch() {
  const picker = byId("operation-date-picker");
  if (!picker) return;
  picker.value = state.selectedOperationDate || today;
  const date = picker.value || today;
  const { entries, cash, bank, total } = closureTotals(date);
  const closure = scoped("closures").find(item => item.date === date);
  byId("operation-search-results").innerHTML = `
    <div class="operation-search-head">
      <div><strong>${formatDate(date)}</strong><span class="hint">${entries.length} opération(s) retrouvée(s)</span></div>
      ${closure ? `<button class="btn ghost" data-download-closure="${closure.id}">Télécharger l’arrêté</button>` : `<span class="pill">Aucun arrêté enregistré</span>`}
    </div>
    <div class="mini-metrics">
      <span>Caisse <strong>${fmt(cash)}</strong></span>
      <span>Banque <strong>${fmt(bank)}</strong></span>
      <span>Total <strong>${fmt(total)}</strong></span>
    </div>
    <table><thead><tr><th>Date</th><th>Nature</th><th>Compte</th><th>Libellé</th><th>Montant</th></tr></thead><tbody>${entries.length ? entries.map(e => `<tr><td>${e.date}</td><td>${e.nature}</td><td>${accountName(e.accountId)}</td><td>${e.label}</td><td>${fmt(e.amount)}</td></tr>`).join("") : `<tr><td colspan="5">Aucune opération pour cette date.</td></tr>`}</tbody></table>`;
  byId("operation-search-results").querySelectorAll("[data-download-closure]").forEach(button => button.addEventListener("click", () => downloadClosureReport(button.dataset.downloadClosure)));
}

function closeDay() {
  if (!isCloseAvailable()) return;
  if (isDayClosed()) return;
  const { entries, cash, bank } = closureTotals();
  state.closures.unshift({ entityId: state.currentEntityId, id: `ARR-${state.currentEntityId}-${today}`, date: today, total: cash + bank, cash, bank, operations: entries.length, by: "Admin Finance", reportName: `Situation caisse ${today}` });
  state.dayClosedByEntity[state.currentEntityId] = true;
  renderAll();
}

function isCloseAvailable() {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(17, 30, 0, 0);
  return now >= cutoff;
}

function updateCloseAvailability() {
  const button = byId("daily-close-btn");
  const earlyButton = byId("early-close-btn");
  const countdown = byId("close-countdown");
  if (!button || !countdown) return;
  if (isDayClosed()) {
    button.disabled = true;
    button.classList.add("disabled");
    if (earlyButton) {
      earlyButton.disabled = true;
      earlyButton.classList.add("disabled");
    }
    countdown.textContent = "Journée arrêtée";
    countdown.className = "pill ready";
    return;
  }
  const now = new Date();
  const cutoff = new Date();
  cutoff.setHours(17, 30, 0, 0);
  if (earlyButton) {
    earlyButton.disabled = false;
    earlyButton.classList.remove("disabled");
  }
  if (now >= cutoff) {
    button.disabled = false;
    button.classList.remove("disabled");
    countdown.textContent = "Arrêté disponible";
    countdown.className = "pill ready";
    return;
  }
  const diff = cutoff - now;
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  button.disabled = true;
  button.classList.add("disabled");
  countdown.textContent = `Disponible dans ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  countdown.className = "pill danger";
}

function renderAccounts() {
  const accounts = scoped("accounts");
  if (!accounts.some(a => a.id === state.selectedAccountId)) state.selectedAccountId = accounts[0]?.id || "";
  byId("account-cards").innerHTML = accounts.map(account => `<article class="account-card ${account.id === state.selectedAccountId ? "active" : ""}" data-account="${account.id}"><span class="hint">${account.type}</span><h2>${account.name}</h2><strong>${fmt(account.balance)}</strong><p>${scoped("cashOperations").filter(op => op.accountId === account.id).length + scoped("payments").filter(p => p.destinationId === account.id).length} mouvement(s)</p><span class="status ${account.status === "Clôturé" ? "due" : "ready"}">${account.status || "Actif"}</span></article>`).join("");
  document.querySelectorAll("[data-account]").forEach(card => card.addEventListener("click", () => { state.selectedAccountId = card.dataset.account; navigate("account-detail-view"); renderAccountPage(); }));
  const account = accounts.find(a => a.id === state.selectedAccountId);
  byId("account-detail-title").textContent = account ? `État - ${account.name}` : "État du compte";
  const rows = account ? accountMovements(account) : [];
  byId("account-detail").innerHTML = `<table><thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Montant</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.date}</td><td>${r.type}</td><td>${r.label}</td><td>${fmt(r.amount)}</td></tr>`).join("")}</tbody></table>`;
  byId("reconciliation-list").innerHTML = (scoped("statements").length ? scoped("statements") : [{ name: "Aucun relevé importé", date: "-", status: "En attente", matches: 0 }]).map(s => `<div class="activity-item"><div class="row-between"><strong>${s.name}</strong><span class="status ready">${s.status}</span></div><span class="hint">${s.date} - ${s.matches} rapprochement(s) probable(s)</span></div>`).join("");
  renderAccountPage();
}

function accountMovements(account) {
  if (!account) return [];
  return [
    ...scoped("payments").filter(p => p.destinationId === account.id).map(p => ({ date: p.date, label: p.invoiceId, type: "Paiement", amount: p.amount })),
    ...scoped("cashOperations").filter(op => op.accountId === account.id || op.targetAccountId === account.id).map(op => {
      const incomingTransfer = op.targetAccountId === account.id;
      return { date: op.date, label: op.label, type: incomingTransfer ? "Transfert reçu" : op.type, amount: incomingTransfer ? op.amount : (["Sortie", "Sortie par chèque", "Transfert bancaire"].includes(op.type) ? -op.amount : op.amount) };
    })
  ];
}

function renderAccountPage() {
  const account = scoped("accounts").find(a => a.id === state.selectedAccountId);
  if (!account || !byId("account-profile")) return;
  byId("account-page-title").textContent = account.name;
  byId("account-page-subtitle").textContent = account.type === "Banque" ? "Coordonnées bancaires et mouvements détaillés." : "Détail de caisse et mouvements.";
  const detailRows = account.type === "Banque"
    ? [["Titulaire", account.holder], ["Établissement", account.institution], ["Numéro de compte", account.number], ["Domiciliation", account.domiciliation], ["IBAN / RIB", account.rib], ["SWIFT / BIC", account.swift], ["RIP / RIB uploadé", account.ribFileName || "Aucun fichier"], ["Gestionnaire", account.manager], ["Motif clôture", account.closureReason || "-"]]
    : [["Type", "Caisse"], ["Domiciliation", account.domiciliation || "Interne"], ["Responsable", account.manager || "Non renseigné"], ["Motif clôture", account.closureReason || "-"]];
  byId("account-profile").innerHTML = `
    <section class="panel account-profile-card"><div class="panel-head"><h2>Résumé</h2><span class="status ${account.status === "Clôturé" ? "due" : "ready"}">${account.status || account.type}</span></div><strong>${fmt(account.balance)}</strong><p class="hint">Solde actuel</p><div class="account-chart">${accountMovements(account).slice(0, 8).map((move, index) => `<i style="height:${Math.max(12, Math.min(100, Math.abs(move.amount) / Math.max(Math.abs(account.balance), 1) * 100 + 12 + index * 3))}%"></i>`).join("") || "<span class='hint'>Aucun mouvement</span>"}</div></section>
    <section class="panel"><div class="settings-list">${detailRows.map(row => `<div><strong>${row[0]}</strong><span>${row[1] || "-"}</span></div>`).join("")}</div><div class="inline-actions">${account.ribFileName ? `<button class="btn ghost download-rib-btn" type="button">Télécharger le RIP</button>` : ""}<button class="btn ghost close-account-btn" type="button">Clôturer</button><button class="btn ghost danger-text delete-account-btn" type="button">Supprimer</button></div></section>
    <section class="panel full"><div class="panel-head"><h2>Modifier les informations</h2><p>Informations générales et bancaires.</p></div><form id="account-edit-form" class="form-grid">
      <label>Nom<input name="name" value="${account.name || ""}"></label>
      <label>Titulaire<input name="holder" value="${account.holder || ""}"></label>
      <label>Établissement<input name="institution" value="${account.institution || ""}"></label>
      <label>Numéro de compte<input name="number" value="${account.number || ""}"></label>
      <label>Domiciliation<input name="domiciliation" value="${account.domiciliation || ""}"></label>
      <label>IBAN / RIB<input name="rib" value="${account.rib || ""}"></label>
      <label>SWIFT / BIC<input name="swift" value="${account.swift || ""}"></label>
      <label>Gestionnaire<input name="manager" value="${account.manager || ""}"></label>
      <button class="btn primary full" type="submit">Enregistrer les modifications</button>
    </form></section>`;
  const downloadButton = document.querySelector(".download-rib-btn");
  if (downloadButton) downloadButton.addEventListener("click", () => createSystemPdf({ filename: `${account.id}-RIB.pdf`, title: "RELEVE D'IDENTITE BANCAIRE", reference: account.id, date: today, infoRows: [["Titulaire", account.holder || currentEntity().name], ["Banque", account.institution || account.name], ["Numero de compte", account.number || "-"], ["Domiciliation", account.domiciliation || "-"], ["RIB / IBAN", account.rib || "-"], ["SWIFT / BIC", account.swift || "-"]] }));
  document.querySelector(".close-account-btn")?.addEventListener("click", () => closeAccount(account.id));
  document.querySelector(".delete-account-btn")?.addEventListener("click", () => deleteAccount(account.id));
  byId("account-edit-form").addEventListener("submit", saveAccountDetails);
  byId("account-page-movements").innerHTML = `<table><thead><tr><th>Date</th><th>Nature</th><th>Libellé</th><th>Montant</th></tr></thead><tbody>${accountMovements(account).map(r => `<tr><td>${r.date}</td><td>${r.type}</td><td>${r.label}</td><td>${fmt(r.amount)}</td></tr>`).join("")}</tbody></table>`;
}

function saveAccountDetails(event) {
  event.preventDefault();
  const account = state.accounts.find(item => item.id === state.selectedAccountId);
  if (!account) return;
  Object.assign(account, Object.fromEntries(new FormData(event.currentTarget)));
  renderAccounts();
  renderAccountPage();
}

function closeAccount(id) {
  const account = state.accounts.find(item => item.id === id);
  if (!account) return;
  const reason = prompt("Motif de clôture du compte");
  if (!reason) return;
  account.status = "Clôturé";
  account.closureReason = reason;
  renderAll();
  navigate("account-detail-view");
}

function deleteAccount(id) {
  const used = state.payments.some(payment => payment.destinationId === id) || state.cashOperations.some(op => op.accountId === id || op.targetAccountId === id);
  if (used) return alert("Ce compte contient des mouvements. Clôturez-le plutôt que de le supprimer.");
  state.accounts = state.accounts.filter(account => account.id !== id);
  state.selectedAccountId = scoped("accounts")[0]?.id || "";
  navigate("accounts");
  renderAll();
}

function openAccountModal() {
  byId("account-modal").classList.remove("is-hidden");
}

function closeAccountModal() {
  byId("account-modal").classList.add("is-hidden");
}

function addAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const ribFileName = form.elements.ribFile.files[0]?.name || "";
  delete data.ribFile;
  const id = `${data.type === "Banque" ? "bank" : "cash"}-${Date.now().toString().slice(-5)}`;
  state.accounts.unshift({ entityId: state.currentEntityId, id, ...data, ribFileName, balance: Number(data.balance) || 0, status: "Actif", closureReason: "" });
  state.selectedAccountId = id;
  form.reset();
  closeAccountModal();
  renderAll();
}

function folderItems(folderName) {
  const invoices = scoped("invoices").filter(item => item.project === folderName);
  const proformas = scoped("proformas").filter(item => item.project === folderName);
  const disbursements = scoped("disbursements").filter(item => item.project === folderName);
  const operations = scoped("cashOperations").filter(item => disbursements.some(disb => disb.id === item.trace) || item.label?.includes(folderName));
  const receipts = scoped("receipts").filter(receipt => invoices.some(invoice => invoice.id === receipt.invoiceId));
  const purchaseOrders = scoped("purchaseOrders").filter(item => item.project === folderName);
  const supplierInvoices = scoped("supplierInvoices").filter(item => item.project === folderName);
  return { invoices, proformas, disbursements, operations, receipts, purchaseOrders, supplierInvoices };
}

function folderHistory(folderName) {
  const { invoices, proformas, disbursements, operations, receipts, purchaseOrders, supplierInvoices } = folderItems(folderName);
  return [
    ...proformas.flatMap(proforma => (proforma.history || []).map(item => ({ date: item.date, title: item.action, detail: `Proforma ${proforma.id} - ${item.by}` }))),
    ...proformas.map(proforma => ({ date: proforma.date, title: `Proforma ${proforma.docState}`, detail: `${proforma.id} - ${proforma.client || "Sans client"}` })),
    ...invoices.map(invoice => ({ date: invoice.date, title: `Facture ${invoice.docState || "Brouillon"}`, detail: `${invoice.id} - ${fmt(invoiceTotal(invoice))}` })),
    ...receipts.map(receipt => ({ date: receipt.date, title: `Reçu généré`, detail: `${receipt.id} - ${fmt(receipt.amount)}` })),
    ...disbursements.map(disb => ({ date: today, title: `Décaissement ${disb.status}`, detail: `${disb.id} - ${disb.reason} - ${fmt(disb.amount)}` })),
    ...purchaseOrders.map(order => ({ date: order.date, title: "Bon de commande émis", detail: `${order.id} - ${order.supplier} - ${fmt(order.amount)}` })),
    ...supplierInvoices.map(invoice => ({ date: invoice.date, title: `Facture fournisseur ${supplierInvoiceStatus(invoice)}`, detail: `${invoice.supplierReference} - ${invoice.supplier} - ${fmt(invoice.amount)}` })),
    ...operations.map(op => ({ date: op.date, title: `Opération ${op.type}`, detail: `${op.label} - ${fmt(op.amount)}` }))
  ].sort((a, b) => b.date.localeCompare(a.date));
}

function folderFiles(folderName) {
  const { invoices, proformas, disbursements, receipts, purchaseOrders, supplierInvoices } = folderItems(folderName);
  return [
    ...proformas.map(item => ({ name: `${item.id}.pdf`, label: `Proforma ${item.id}`, action: () => downloadFinancialPdf(item, "PROFORMA") })),
    ...proformas.filter(item => item.acceptanceName).map(item => ({ name: `${item.id}-acceptation.pdf`, label: `Acceptation ${item.id}`, action: () => createSystemPdf({ filename: `${item.id}-acceptation.pdf`, title: "PIECE D'ACCEPTATION", reference: item.id, date: item.date, infoRows: [["Fichier rattache", item.acceptanceName], ["Client", item.client]] }) })),
    ...invoices.map(item => ({ name: `${item.id}.pdf`, label: `Facture ${item.id}`, action: () => downloadFinancialPdf(item, "FACTURE") })),
    ...receipts.map(item => ({ name: `${item.id}.pdf`, label: `Reçu ${item.id}`, action: () => downloadReceiptPdf(item) })),
    ...disbursements.map(item => ({ name: `${item.id}.pdf`, label: `Fiche décaissement ${item.id}`, action: () => downloadVoucherPdf(item) })),
    ...disbursements.filter(item => item.scanName).map(item => ({ name: `${item.id}-scan.pdf`, label: `Scan signé ${item.id}`, action: () => createSystemPdf({ filename: `${item.id}-scan.pdf`, title: "SCAN SIGNE", reference: item.id, date: item.date || today, infoRows: [["Fichier rattache", item.scanName], ["Beneficiaire", item.beneficiary]] }) })),
    ...purchaseOrders.map(item => ({ name: `${item.id}.pdf`, label: `Bon de commande ${item.id}`, action: () => downloadPurchaseOrderPdf(item) })),
    ...supplierInvoices.map(item => ({ name: item.fileName, label: `Facture fournisseur ${item.supplierReference}`, dataUrl: item.fileDataUrl }))
  ];
}

function renderFolders() {
  byId("folder-grid").innerHTML = scoped("projects").map(project => {
    const invoices = scoped("invoices").filter(i => i.project === project.name);
    const proformas = scoped("proformas").filter(i => i.project === project.name);
    const disbursements = scoped("disbursements").filter(i => i.project === project.name);
    const invoiced = invoices.reduce((s, i) => s + invoiceTotal(i), 0);
    const paid = invoices.reduce((s, i) => s + i.paid, 0);
    const progress = invoiced ? Math.round(paid / invoiced * 100) : 0;
    return `<article class="project-card folder-card" data-folder="${project.name}"><h2>${project.name}</h2><p>${project.client}</p><div class="progress"><span style="width:${progress}%"></span></div><div class="row-between"><span>Proformas</span><strong>${proformas.length}</strong></div><div class="row-between"><span>Factures</span><strong>${invoices.length}</strong></div><div class="row-between"><span>Décaissements</span><strong>${disbursements.length}</strong></div><div class="row-between"><span>Pièces</span><strong>${folderFiles(project.name).length}</strong></div></article>`;
  }).join("");
  document.querySelectorAll("[data-folder]").forEach(card => card.addEventListener("click", () => {
    state.selectedFolderName = card.dataset.folder;
    navigate("folder-detail");
    renderFolderDetail();
  }));
}

function renderFolderDetail() {
  const folder = selectedFolder();
  if (!folder || !byId("folder-title")) return;
  const items = folderItems(folder.name);
  const files = folderFiles(folder.name);
  const history = folderHistory(folder.name);
  const invoiced = items.invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
  const paid = items.invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
  byId("folder-title").textContent = folder.name;
  byId("folder-subtitle").textContent = `${folder.client} - dossier complet`;
  byId("folder-summary").innerHTML = [
    ["Proformas", items.proformas.length, "Documents commerciaux"],
    ["Factures", items.invoices.length, fmt(invoiced)],
    ["Encaissements", items.receipts.length, fmt(paid)],
    ["Pièces", files.length, "Téléchargeables"]
  ].map(item => `<article class="metric-card"><span>${item[0]}</span><strong>${item[1]}</strong><small>${item[2]}</small></article>`).join("");
  byId("folder-history").innerHTML = history.map(item => `<div class="activity-item"><div class="row-between"><strong>${item.title}</strong><span>${item.date}</span></div><span class="hint">${item.detail}</span></div>`).join("") || `<p class="hint">Aucun historique.</p>`;
  byId("folder-files").innerHTML = files.map((file, index) => `<div class="activity-item"><div class="row-between"><strong>${file.label}</strong><button class="link-button" data-folder-file="${index}">Télécharger</button></div><span class="hint">${file.name}</span></div>`).join("") || `<p class="hint">Aucune pièce.</p>`;
  document.querySelectorAll("[data-folder-file]").forEach(button => button.addEventListener("click", () => {
    const file = files[Number(button.dataset.folderFile)];
    if (file.dataUrl) {
      const link = document.createElement("a");
      link.href = file.dataUrl;
      link.download = file.name;
      link.click();
    } else if (file.action) file.action();
  }));
  const rows = [
    ...items.proformas.map(item => [item.date, "Proforma", item.id, item.docState, fmt(invoiceTotal(item))]),
    ...items.invoices.map(item => [item.date, "Facture", item.id, item.docState, fmt(invoiceTotal(item))]),
    ...items.disbursements.map(item => [today, "Décaissement", item.id, item.status, fmt(item.amount)]),
    ...items.purchaseOrders.map(item => [item.date, "Bon de commande", item.id, item.status, fmt(item.amount)]),
    ...items.supplierInvoices.map(item => [item.date, "Facture fournisseur", item.supplierReference, supplierInvoiceStatus(item), fmt(item.amount)]),
    ...items.operations.map(item => [item.date, item.type, item.id, item.trace, fmt(item.amount)])
  ];
  byId("folder-operations").innerHTML = `<table><thead><tr><th>Date</th><th>Nature</th><th>Référence</th><th>Statut / trace</th><th>Montant</th></tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderReports() {
  const invoices = scoped("invoices");
  const payments = scoped("payments");
  const operations = scoped("cashOperations");
  const supplierDebt = scoped("supplierInvoices").reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount) - (Number(invoice.amountPaid) || 0)), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + invoiceTotal(i), 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const totalOpsIn = operations.filter(op => op.type === "Entrée").reduce((s, op) => s + op.amount, 0);
  const totalOpsOut = operations.filter(op => op.type === "Sortie").reduce((s, op) => s + op.amount, 0);
  const max = Math.max(totalInvoiced, totalPaid, totalOpsIn, totalOpsOut, 1);
  byId("report-charts").innerHTML = `
    <article class="chart-card">
      <div class="panel-head"><h2>Encaissement</h2><p>Facturé vs payé</p></div>
      <div class="donut" style="--value:${Math.min(100, Math.round(totalPaid / Math.max(totalInvoiced, 1) * 100))}"><span>${Math.min(100, Math.round(totalPaid / Math.max(totalInvoiced, 1) * 100))}%</span></div>
    </article>
    <article class="chart-card">
      <div class="panel-head"><h2>Flux</h2><p>Entrées et sorties</p></div>
      <div class="vertical-bars">
        ${[["Facturé", totalInvoiced], ["Payé", totalPaid], ["Entrées", totalOpsIn], ["Sorties", totalOpsOut]].map(item => `<div><i style="height:${Math.max(8, item[1] / max * 100)}%"></i><span>${item[0]}</span></div>`).join("")}
      </div>
    </article>
    <article class="chart-card wide">
      <div class="panel-head"><h2>Répartition des comptes</h2><p>Soldes caisse et banque</p></div>
      <div class="horizontal-chart">
        ${scoped("accounts").map(account => `<div><span>${account.name}</span><strong>${fmt(account.balance)}</strong><div class="bar-track"><span style="width:${Math.max(6, account.balance / Math.max(...scoped("accounts").map(a => a.balance), 1) * 100)}%"></span></div></div>`).join("")}
      </div>
    </article>`;
  const rows = [
    ["Société", currentEntity().name, "Tableau de bord par société"],
    ["Factures émises", fmt(totalInvoiced), "Volume global"],
    ["Factures impayées", invoices.filter(i => invoiceStatus(i) !== "Payée").length, "À relancer"],
    ["Paiements confirmés", fmt(totalPaid), "Tous moyens"],
    ["Dette fournisseurs", fmt(supplierDebt), "Factures à régler"],
    ["Arrêtés générés", scoped("closures").length, "Opérations journalières"]
  ];
  byId("report-body").innerHTML = `<table><thead><tr><th>Indicateur</th><th>Valeur</th><th>Lecture</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td><strong>${r[1]}</strong></td><td>${r[2]}</td></tr>`).join("")}</tbody></table>`;
}

function renderSettingsPreview() {
  const signer = documentSigner("invoice");
  byId("settings-preview").innerHTML = `${documentBrandHeader()}<div class="signature-preview"><span>Signataire facture</span><small>${signer?.signatureTitle || "Titre à configurer"}</small><strong>${signer?.name || "À configurer"}</strong></div><p class="hint">${currentSettings().footer.replaceAll("\n", "<br>")}</p>`;
}

function renderSignerSettings() {
  const form = byId("settings-form");
  if (!form) return;
  const settings = currentSettings();
  settings.signers = settings.signers || { invoice: DEFAULT_EMAIL, proforma: DEFAULT_EMAIL, receipt: DEFAULT_EMAIL, payroll: DEFAULT_EMAIL };
  if (!("payroll" in settings.signers)) settings.signers.payroll = DEFAULT_EMAIL;
  const users = scoped("users").filter(user => user.status === "Actif");
  const options = selectedEmail => `<option value="">Choisir un utilisateur actif</option>${users.map(user => `<option value="${user.email}" ${selectedEmail === user.email ? "selected" : ""}>${user.name} — ${user.role}</option>`).join("")}`;
  form.elements.invoiceSignerEmail.innerHTML = options(settings.signers.invoice);
  form.elements.proformaSignerEmail.innerHTML = options(settings.signers.proforma);
  form.elements.receiptSignerEmail.innerHTML = options(settings.signers.receipt);
  form.elements.payrollSignerEmail.innerHTML = options(settings.signers.payroll);
  const payrollForm = byId("payroll-settings-form");
  const rules = currentPayrollRules();
  Object.keys(rules).forEach(key => { if (payrollForm.elements[key]) payrollForm.elements[key].value = rules[key]; });
}

function renderUsers() {
  byId("users-list").innerHTML = scoped("users").map((user, index) => {
    const access = (user.access || roleAccess(user.role)).split(",").filter(Boolean);
    return `<div class="user-card">
      <div class="user-card-head">
        <div><strong>${user.name}</strong><span>${user.email}</span></div>
        <span class="status ${user.status === "Actif" ? "paid" : "warn"}">${user.status}</span>
      </div>
      <span class="hint">${user.role}</span>
      <div class="access-chips">${access.map(item => `<small>${accessScreens.find(([id]) => id === item)?.[1] || item}</small>`).join("")}</div>
      <div class="inline-actions compact">
        <button class="link-button" data-user-password="${index}">Modifier mot de passe</button>
        <button class="link-button danger-text" data-delete-user="${index}">Supprimer</button>
      </div>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-delete-user]").forEach(button => button.addEventListener("click", () => deleteUser(Number(button.dataset.deleteUser))));
  document.querySelectorAll("[data-user-password]").forEach(button => button.addEventListener("click", () => updateUserPassword(Number(button.dataset.userPassword))));
  renderUserAccessOptions(byId("user-form").elements.role.value || "Admin");
  setSettingsTab(state.settingsTab);
}

async function addUser(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const data = Object.fromEntries(formData);
  data.access = formData.getAll("access").join(",") || roleAccess(data.role);
  data.entityIds = [state.currentEntityId];
  try {
    const payload = await apiRequest("/api/users", { method: "POST", body: JSON.stringify(data) });
    state.users = payload.users;
    event.currentTarget.reset();
    renderUsers();
  } catch (error) {
    alert(error.message);
  }
}

const accessScreens = [
  ["dashboard", "Tableau de bord"], ["invoices", "Factures clients"], ["proformas", "Proformas"],
  ["contacts", "Contacts"], ["purchases", "Achats fournisseurs"], ["payroll", "Gestion de la paie"], ["payments", "Paiements clients"],
  ["cashdesk", "Caisse et décaissements"], ["dailyops", "Opérations journalières"], ["accounts", "Caisses et banques"],
  ["folders", "Dossiers"], ["reports", "Rapports"], ["settings", "Paramètres"], ["profile", "Profil"]
];

function renderUserAccessOptions(role) {
  const container = byId("user-access-options");
  if (!container) return;
  const defaults = roleAccess(role).split(",");
  container.innerHTML = accessScreens.map(([id, label]) => `<label class="access-check"><input type="checkbox" name="access" value="${id}" ${defaults.includes(id) ? "checked" : ""}><span>${label}</span></label>`).join("");
}

function setSettingsTab(tab) {
  state.settingsTab = tab;
  document.querySelectorAll("[data-settings-tab]").forEach(button => {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-settings-panel]").forEach(panel => panel.classList.toggle("is-hidden", panel.dataset.settingsPanel !== tab));
}

function roleAccess(role) {
  const matrix = {
    Admin: "dashboard,invoices,proformas,contacts,purchases,payroll,payments,cashdesk,dailyops,accounts,folders,reports,settings,profile",
    "Manager financier": "dashboard,invoices,proformas,contacts,purchases,payroll,payments,cashdesk,dailyops,accounts,folders,reports,profile",
    Caissier: "dashboard,cashdesk,dailyops,accounts,folders",
    Commercial: "dashboard,proformas,contacts,folders,profile",
    Auditeur: "dashboard,invoices,proformas,purchases,payroll,payments,cashdesk,dailyops,accounts,folders,reports,profile"
  };
  return matrix[role] || matrix.Auditeur;
}

function applyRoleAccess() {
  const user = currentUser();
  const access = (user?.access || roleAccess(user?.role || "Admin")).split(",");
  document.querySelectorAll(".nav-item[data-view]").forEach(item => {
    item.classList.toggle("is-hidden", !access.includes(item.dataset.view));
  });
}

async function updateUserPassword(index) {
  const user = scoped("users")[index];
  if (!user) return;
  const password = prompt(`Nouveau mot de passe pour ${user.name}`);
  if (!password) return;
  if (password.length < 8) return alert("Le mot de passe doit contenir au moins 8 caractères.");
  try {
    await apiRequest(`/api/users/${user.id}/password`, { method: "PATCH", body: JSON.stringify({ password }) });
    alert("Mot de passe mis à jour.");
  } catch (error) { alert(error.message); }
}

async function deleteUser(index) {
  const users = scoped("users");
  const user = users[index];
  if (!user) return;
  const assignedDocuments = Object.entries(currentSettings().signers || {}).filter(([, email]) => email === user.email).map(([kind]) => kind);
  if (assignedDocuments.length) return alert("Cet utilisateur est signataire d’un document. Choisissez d’abord un autre signataire dans les paramètres.");
  if (!confirm(`Supprimer l’accès de ${user.name} à cet espace FinanceOS ?`)) return;
  try {
    await apiRequest(`/api/users/${user.id}`, { method: "DELETE" });
    state.users = state.users.filter(item => item.id !== user.id);
    renderUsers();
  } catch (error) { alert(error.message); }
}

function renderProfile() {
  const form = byId("profile-form");
  if (!form) return;
  const user = currentUser();
  if (user) {
    state.profile.name = user.name;
    state.profile.email = user.email;
    state.profile.signatureTitle = user.signatureTitle || user.role;
  }
  form.elements.name.value = state.profile.name;
  form.elements.email.value = state.profile.email;
  form.elements.signatureTitle.value = state.profile.signatureTitle || "";
  form.elements.bio.value = state.profile.bio;
  const photo = state.profile.photoDataUrl
    ? `<img src="${state.profile.photoDataUrl}" alt="">`
    : `<span>${state.profile.name.slice(0, 2).toUpperCase()}</span>`;
  byId("profile-preview").innerHTML = `
    <div class="profile-avatar">${photo}</div>
    <h2>${state.profile.name}</h2>
    <strong>${state.profile.signatureTitle || "Titre de signature non renseigné"}</strong>
    <p>${state.profile.email}</p>
    <div class="document-info-block"><p>${state.profile.bio || "Aucune biographie renseignée."}</p></div>
    <button id="profile-logout-btn" class="btn primary">Déconnexion</button>`;
  byId("profile-logout-btn").addEventListener("click", () => byId("logout-btn").click());
  const employee = scoped("employees").find(item => item.email && item.email === user?.email);
  const records = employee ? scoped("payrollRecords").filter(record => record.employeeId === employee.id) : [];
  byId("employee-profile-summary").innerHTML = employee ? `<div><strong>Employé</strong><span>${employee.name}</span></div><div><strong>Poste</strong><span>${employee.position}</span></div><div><strong>Salaire de base</strong><span>${fmt(employee.baseSalary)}</span></div><div><strong>Dernier net calculé</strong><span>${records[0] ? fmt(records[0].net) : "Aucune paie"}</span></div>${records.slice(0, 4).map(record => `<div><strong>${record.period}</strong><button class="link-button" data-profile-payslip="${record.id}">Bulletin</button></div>`).join("")}` : `<p class="hint">Aucun dossier employé n’est associé à votre adresse email.</p>`;
  document.querySelectorAll("[data-profile-payslip]").forEach(button => button.addEventListener("click", () => downloadPayslip(button.dataset.profilePayslip)));
}

async function saveProfile(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const user = currentUser();
  state.profile.name = data.name;
  state.profile.email = data.email;
  state.profile.signatureTitle = data.signatureTitle;
  state.profile.bio = data.bio;
  if (user) {
    const previousEmail = user.email;
    user.name = data.name;
    user.email = data.email;
    user.signatureTitle = data.signatureTitle;
    state.currentUserEmail = data.email;
    state.entities.forEach(entity => {
      const signers = entity.settings?.signers;
      if (!signers) return;
      Object.keys(signers).forEach(kind => {
        if (signers[kind] === previousEmail) signers[kind] = data.email;
      });
    });
  }
  try {
    const payload = await apiRequest("/api/profile", { method: "PATCH", body: JSON.stringify({ name: data.name, email: data.email, signatureTitle: data.signatureTitle, bio: data.bio, photoDataUrl: state.profile.photoDataUrl }) });
    Object.assign(user || {}, payload.user);
  } catch (error) { return alert(error.message); }
  renderAll();
}

async function changeOwnPassword(event) {
  event.preventDefault();
  const user = currentUser();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!user) return;
  if (!data.newPassword || data.newPassword.length < 8) return alert("Le nouveau mot de passe doit contenir au moins 8 caractères.");
  if (data.newPassword !== data.confirmPassword) return alert("La confirmation ne correspond pas.");
  try {
    await apiRequest("/api/profile/password", { method: "PATCH", body: JSON.stringify(data) });
    event.currentTarget.reset();
    alert("Mot de passe modifié.");
  } catch (error) { alert(error.message); }
}

function uploadProfilePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  readImageFile(file, photoDataUrl => {
    state.profile.photoDataUrl = photoDataUrl;
    renderProfile();
    apiRequest("/api/profile", { method: "PATCH", body: JSON.stringify({ photoDataUrl }) }).catch(error => alert(error.message));
  });
}

const onboardingSteps = [
  {
    title: "Votre société active",
    subtitle: "Chaque organisation dispose de son propre espace financier.",
    body: "Utilisez ce sélecteur pour passer d’une société à une autre. Factures, proformas, contacts, comptes et rapports restent strictement séparés.",
    target: ".entity-switcher",
    placement: "right"
  },
  {
    title: "Les espaces de travail",
    subtitle: "Toutes les fonctions sont accessibles depuis le menu.",
    body: "Parcourez la facturation, les paiements, la caisse, les dossiers et les rapports. Sur mobile, ce menu reste rangé derrière le bouton Menu.",
    target: ".sidebar nav",
    placement: "right"
  },
  {
    title: "Créer une facture rapidement",
    subtitle: "Le raccourci reste disponible dans la navigation.",
    body: "Créez une facture vierge, sélectionnez ou ajoutez un client, choisissez le compte de règlement puis prévisualisez le document avant émission.",
    target: "#quick-new-invoice",
    placement: "right"
  },
  {
    title: "La synthèse de la société",
    subtitle: "Le tableau de bord ne mélange jamais les organisations.",
    body: "Retrouvez ici la trésorerie, le nombre de factures, les paiements reçus et les écritures de la société actuellement sélectionnée.",
    target: "#entity-overview",
    placement: "bottom"
  },
  {
    title: "Les actions prioritaires",
    subtitle: "Finance OS vous indique ce qui demande une attention.",
    body: "Les alertes de créances, les besoins de configuration et les prochaines actions apparaissent dans cette zone pour faciliter le pilotage quotidien.",
    target: ".highlight-panel",
    placement: "left"
  }
];

function openOnboarding() {
  state.onboardingStep = 0;
  navigate("dashboard");
  byId("onboarding-modal").classList.remove("is-hidden");
  byId("app-shell").classList.add("tour-running");
  renderOnboarding();
}

function renderOnboarding() {
  const step = onboardingSteps[state.onboardingStep];
  document.querySelectorAll(".tour-focus, .tour-parent-focus").forEach(element => element.classList.remove("tour-focus", "tour-parent-focus"));
  const isMobile = window.innerWidth <= 760;
  const targetSelector = isMobile && step.target === ".sidebar nav" ? "#mobile-menu-btn" : step.target;
  const target = document.querySelector(targetSelector);
  if (isMobile && step.target === "#quick-new-invoice") {
    document.querySelector(".sidebar").classList.add("mobile-open");
  } else if (isMobile) {
    document.querySelector(".sidebar").classList.remove("mobile-open");
  }
  if (target) target.classList.add("tour-focus");
  if (target?.closest(".sidebar")) target.closest(".sidebar").classList.add("tour-parent-focus");
  const card = byId("onboarding-modal").querySelector(".onboarding-card");
  card.className = `onboarding-card placement-${step.placement}`;
  byId("onboarding-title").textContent = step.title;
  byId("onboarding-subtitle").textContent = step.subtitle;
  byId("onboarding-body").innerHTML = `<p>${step.body}</p>`;
  byId("onboarding-progress").innerHTML = onboardingSteps.map((_, index) => `<span class="${index === state.onboardingStep ? "active" : ""}"></span>`).join("");
  byId("onboarding-prev").disabled = state.onboardingStep === 0;
  byId("onboarding-next").textContent = state.onboardingStep === onboardingSteps.length - 1 ? "Terminer" : "Suivant";
}

function nextOnboardingStep() {
  if (state.onboardingStep >= onboardingSteps.length - 1) {
    finishOnboarding();
    return;
  }
  state.onboardingStep += 1;
  renderOnboarding();
}

function previousOnboardingStep() {
  if (state.onboardingStep === 0) return;
  state.onboardingStep -= 1;
  renderOnboarding();
}

function finishOnboarding() {
  const user = currentUser();
  if (user) user.onboardingSeen = true;
  document.querySelectorAll(".tour-focus, .tour-parent-focus").forEach(element => element.classList.remove("tour-focus", "tour-parent-focus"));
  byId("app-shell").classList.remove("tour-running");
  document.querySelector(".sidebar").classList.remove("mobile-open");
  byId("onboarding-modal").classList.add("is-hidden");
  persistState();
  apiRequest("/api/profile", { method: "PATCH", body: JSON.stringify({ onboardingSeen: true }) }).catch(console.error);
}

function openClientModal() {
  byId("client-modal").classList.remove("is-hidden");
}

function closeClientModal() {
  byId("client-modal").classList.add("is-hidden");
}

function createClientFromInvoice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const file = form.elements.logoFile.files[0];
  delete data.logoFile;
  readImageFile(file, logoDataUrl => {
    const logo = data.logo || data.company.slice(0, 2).toUpperCase();
    state.contacts.unshift({ entityId: state.currentEntityId, type: "client", ...data, logo, logoDataUrl });
    const invoice = selectedInvoice();
    if (invoice) invoice.client = data.company;
    form.reset();
    form.elements.logo.value = "CL";
    closeClientModal();
    renderAll();
  });
}

function openEarlyCloseModal() {
  if (isDayClosed()) return;
  byId("early-close-modal").classList.remove("is-hidden");
}

function closeEarlyCloseModal() {
  byId("early-close-modal").classList.add("is-hidden");
}

function submitEarlyClose(event) {
  event.preventDefault();
  if (isDayClosed()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const { entries, cash, bank, total } = closureTotals();
  state.closures.unshift({ entityId: state.currentEntityId, id: `ARR-ANT-${state.currentEntityId}-${today}`, date: today, total, cash, bank, operations: entries.length, by: "Admin Finance", early: true, reason: data.reason, reportName: `Situation caisse ${today}` });
  state.dayClosedByEntity[state.currentEntityId] = true;
  event.currentTarget.reset();
  closeEarlyCloseModal();
  alert("Arrêté anticipé confirmé. Aucune nouvelle opération ne pourra être saisie aujourd’hui.");
  renderAll();
}

function saveSettings(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const settings = currentSettings();
  settings.brandName = data.brandName;
  settings.tagline = data.tagline;
  settings.signers = {
    invoice: data.invoiceSignerEmail,
    proforma: data.proformaSignerEmail,
    receipt: data.receiptSignerEmail,
    payroll: data.payrollSignerEmail
  };
  settings.footer = data.footer;
  settings.terms = data.terms;
  renderAll();
}

function uploadLogo(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { currentSettings().logoDataUrl = reader.result; renderAll(); };
  reader.readAsDataURL(file);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function spreadsheetXml(rows, sheetName = "Journal") {
  const body = rows.map((row, rowIndex) => `<Row>${row.map(value => {
    const numeric = typeof value === "number" && Number.isFinite(value);
    const style = rowIndex === 0 ? ' ss:StyleID="Header"' : "";
    return `<Cell${style}><Data ss:Type="${numeric ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
  }).join("")}</Row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#EDEBE6" ss:Pattern="Solid"/></Style></Styles>
  <Worksheet ss:Name="${xmlEscape(sheetName.slice(0, 31))}"><Table>${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>
</Workbook>`;
}

function exportJournal(kind) {
  const definitions = {
    invoices: {
      filename: "journal-factures.xls",
      rows: [["Facture", "Client", "Total", "Payé", "Reste", "Statut"], ...scoped("invoices").map(i => [i.id, i.client, invoiceTotal(i), i.paid, invoiceTotal(i) - i.paid, invoiceStatus(i)])]
    },
    proformas: {
      filename: "journal-proformas.xls",
      rows: [["Proforma", "Client", "Total", "État", "Acceptation"], ...scoped("proformas").map(p => [p.id, p.client, invoiceTotal(p), p.docState, p.acceptanceName || "Non attachée"])]
    },
    payments: {
      filename: "journal-paiements.xls",
      rows: [["Date", "Référence", "Facture", "Montant", "Moyen", "Destination", "Statut"], ...scoped("payments").map(p => [p.date, p.id, p.invoiceId, p.amount, p.method, accountName(p.destinationId), p.status])]
    },
    purchases: {
      filename: "journal-factures-fournisseurs.xls",
      rows: [["Facture", "Fournisseur", "Bon de commande", "Date", "Échéance", "Montant", "Réglé", "Reste", "État"], ...scoped("supplierInvoices").map(invoice => [invoice.supplierReference, invoice.supplier, invoice.purchaseOrderId || "", invoice.date, invoice.dueDate, invoice.amount, invoice.amountPaid || 0, Math.max(0, invoice.amount - (invoice.amountPaid || 0)), supplierInvoiceStatus(invoice)])]
    },
    cash: {
      filename: "journal-operations-caisse-banque.xls",
      rows: [["Date", "Compte", "Destination", "Type", "Libellé", "Montant", "Trace"], ...scoped("cashOperations").map(op => [op.date, accountName(op.accountId), op.targetAccountId ? accountName(op.targetAccountId) : "-", op.type, op.label, op.amount, op.trace])]
    },
    daily: {
      filename: `ecritures-journalieres-${state.selectedOperationDate || today}.xls`,
      rows: [["Date", "Nature", "Compte", "Libellé", "Montant", "Trace"], ...dailyEntries(state.selectedOperationDate || today).map(e => [e.date, e.nature, accountName(e.accountId), e.label, e.amount, e.trace || "-"])]
    },
    reports: {
      filename: "reporting-financier.xls",
      rows: [
        ["Indicateur", "Valeur", "Lecture"],
        ["Société", currentEntity().name, "Tableau de bord par société"],
        ["Factures émises", scoped("invoices").reduce((sum, invoice) => sum + invoiceTotal(invoice), 0), "Volume global"],
        ["Factures impayées", scoped("invoices").filter(i => invoiceStatus(i) !== "Payée").length, "À relancer"],
        ["Paiements confirmés", scoped("payments").reduce((sum, payment) => sum + payment.amount, 0), "Tous moyens"],
        ["Arrêtés générés", scoped("closures").length, "Opérations journalières"]
      ]
    }
  };
  const exportData = definitions[kind];
  if (!exportData) return;
  download(exportData.filename, "application/vnd.ms-excel;charset=utf-8", spreadsheetXml(exportData.rows, "Finance OS"));
}

function pdfText(value) {
  return String(value ?? "")
    .replaceAll("\u202f", " ")
    .replaceAll("\u00a0", " ")
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .replaceAll("’", "'")
    .replaceAll("•", "-")
    .replaceAll("œ", "oe")
    .replaceAll("Œ", "OE");
}

function wrapPdfText(font, value, size, maxWidth) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function dataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function createSystemPdf(options) {
  if (!globalThis.PDFLib) return alert("Le générateur PDF n’est pas disponible. Rechargez l’application.");
  const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const settings = currentSettings();
  let logoImage = null;
  try {
    if (settings.logoDataUrl?.startsWith("data:image/png")) logoImage = await pdf.embedPng(dataUrlBytes(settings.logoDataUrl));
    else if (settings.logoDataUrl?.startsWith("data:image/jpeg") || settings.logoDataUrl?.startsWith("data:image/jpg")) logoImage = await pdf.embedJpg(dataUrlBytes(settings.logoDataUrl));
  } catch (_) {
    logoImage = null;
  }
  const margin = 46;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  let page;
  let y;
  const drawFooter = target => {
    target.drawLine({ start: { x: margin, y: 52 }, end: { x: pageWidth - margin, y: 52 }, thickness: .6, color: rgb(.78, .78, .78) });
    const footerLines = pdfText(settings.footer || currentEntity().name).split("\n").slice(0, 3);
    footerLines.forEach((line, index) => target.drawText(line, { x: margin, y: 37 - index * 10, size: 7.5, font: regular, color: rgb(.25, .31, .38) }));
  };
  const addPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    if (logoImage) {
      const scale = Math.min(120 / logoImage.width, 52 / logoImage.height);
      page.drawImage(logoImage, { x: margin, y: pageHeight - 78, width: logoImage.width * scale, height: logoImage.height * scale });
    }
    drawFooter(page);
    y = pageHeight - 112;
  };
  const ensureSpace = height => { if (y - height < 72) addPage(); };
  addPage();
  page.drawText(pdfText(options.title), { x: margin, y, size: 18, font: bold, color: rgb(.11, .11, .11) });
  if (options.reference) page.drawText(pdfText(options.reference), { x: margin, y: y - 22, size: 9, font: bold, color: rgb(.98, .28, .12) });
  if (options.date) {
    const dateLabel = `Lome, le ${formatDate(options.date)}`;
    page.drawText(pdfText(dateLabel), { x: pageWidth - margin - regular.widthOfTextAtSize(pdfText(dateLabel), 9), y: y - 22, size: 9, font: regular });
  }
  y -= 54;
  (options.infoRows || []).forEach(([label, value]) => {
    ensureSpace(22);
    page.drawText(pdfText(label), { x: margin, y, size: 9, font: bold, color: rgb(.28, .3, .33) });
    const lines = wrapPdfText(regular, value, 9, pageWidth - margin * 2 - 145);
    lines.forEach((line, index) => page.drawText(line, { x: margin + 145, y: y - index * 12, size: 9, font: regular }));
    y -= Math.max(20, lines.length * 12 + 4);
  });
  if (options.headers?.length) {
    y -= 8;
    const usable = pageWidth - margin * 2;
    const widths = options.widths || options.headers.map(() => usable / options.headers.length);
    const drawHeader = () => {
      ensureSpace(30);
      page.drawRectangle({ x: margin, y: y - 22, width: usable, height: 24, color: rgb(.11, .11, .11) });
      let x = margin;
      options.headers.forEach((header, index) => {
        page.drawText(pdfText(header), { x: x + 5, y: y - 14, size: 7.5, font: bold, color: rgb(1, 1, 1), maxWidth: widths[index] - 10 });
        x += widths[index];
      });
      y -= 24;
    };
    drawHeader();
    (options.rows || []).forEach((row, rowIndex) => {
      const cells = row.map((cell, index) => wrapPdfText(regular, cell, 7.5, widths[index] - 10));
      const rowHeight = Math.max(23, Math.max(...cells.map(lines => lines.length)) * 10 + 8);
      if (y - rowHeight < 72) { addPage(); drawHeader(); }
      if (rowIndex % 2) page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: rgb(.96, .96, .95) });
      let x = margin;
      cells.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => page.drawText(line, { x: x + 5, y: y - 14 - lineIndex * 10, size: 7.5, font: regular }));
        page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: .3, color: rgb(.78, .78, .78) });
        x += widths[index];
      });
      page.drawLine({ start: { x: margin + usable, y }, end: { x: margin + usable, y: y - rowHeight }, thickness: .3, color: rgb(.78, .78, .78) });
      page.drawLine({ start: { x: margin, y: y - rowHeight }, end: { x: margin + usable, y: y - rowHeight }, thickness: .3, color: rgb(.78, .78, .78) });
      y -= rowHeight;
    });
  }
  (options.summaryRows || []).forEach(([label, value]) => {
    ensureSpace(25);
    y -= 8;
    page.drawText(pdfText(label), { x: pageWidth - margin - 230, y, size: 10, font: bold });
    page.drawText(pdfText(value), { x: pageWidth - margin - 95, y, size: 10, font: bold, color: rgb(.98, .28, .12) });
    y -= 17;
  });
  (options.notes || []).forEach(note => {
    const lines = wrapPdfText(regular, note, 8, pageWidth - margin * 2);
    ensureSpace(lines.length * 11 + 16);
    y -= 10;
    lines.forEach((line, index) => page.drawText(line, { x: margin, y: y - index * 11, size: 8, font: regular, color: rgb(.25, .28, .32) }));
    y -= lines.length * 11;
  });
  if (options.signatures?.length) {
    ensureSpace(128);
    y -= 24;
    const gap = 10;
    const boxHeight = 96;
    const boxWidth = (pageWidth - margin * 2 - gap * (options.signatures.length - 1)) / options.signatures.length;
    options.signatures.forEach((signature, index) => {
      const x = margin + index * (boxWidth + gap);
      page.drawRectangle({ x, y: y - boxHeight, width: boxWidth, height: boxHeight, borderWidth: .7, borderColor: rgb(.65, .65, .65) });
      const labelLines = wrapPdfText(bold, signature.label, 8.2, boxWidth - 14).slice(0, 2);
      labelLines.forEach((line, lineIndex) => page.drawText(line, { x: x + 7, y: y - 14 - lineIndex * 10, size: 8.2, font: bold }));
      if (signature.name) page.drawText(pdfText(signature.name), { x: x + 7, y: y - 42, size: 8, font: regular, maxWidth: boxWidth - 14 });
      if (signature.details) {
        const detailLines = wrapPdfText(regular, signature.details, 6.8, boxWidth - 14).slice(0, 2);
        detailLines.forEach((line, lineIndex) => page.drawText(line, { x: x + 7, y: y - boxHeight + 10 + lineIndex * 8, size: 6.8, font: regular, color: rgb(.35, .35, .35) }));
      }
    });
    y -= boxHeight + 12;
  }
  const signer = options.signatureKind ? documentSigner(options.signatureKind) : null;
  if (options.signatureKind) {
    ensureSpace(95);
    const signatureX = pageWidth - margin - 210;
    y -= 28;
    page.drawText(pdfText(signer?.signatureTitle || options.signatureLabel || "Signataire autorise"), { x: signatureX, y, size: 9, font: bold, maxWidth: 210 });
    page.drawLine({ start: { x: signatureX, y: y - 48 }, end: { x: signatureX + 190, y: y - 48 }, thickness: .6, color: rgb(.45, .45, .45) });
    page.drawText(pdfText(signer?.name || "A configurer"), { x: signatureX, y: y - 63, size: 9, font: bold });
  }
  const bytes = await pdf.save();
  download(options.filename, "application/pdf", bytes);
}

function downloadFinancialPdf(documentData, title) {
  const isInvoice = title === "FACTURE";
  const account = isInvoice ? paymentAccount(documentData) : null;
  const notes = [];
  if (account) notes.push(`Coordonnees bancaires : ${account.holder || currentEntity().name} | ${account.institution || account.name} | Compte ${account.number || "-"} | RIB/IBAN ${account.rib || "-"} | SWIFT ${account.swift || "-"}`);
  if (!isInvoice) notes.push(currentSettings().terms || "");
  return createSystemPdf({ filename: `${documentData.id}.pdf`, title, reference: documentData.reference, date: documentData.date, infoRows: [["Client", documentData.client], ["Objet", documentData.subject], ["Pour", documentData.purpose], ["Dossier", documentData.project || "Non lie"]], headers: ["Ref", "Designation", "P.U", "Qte", "Cout"], widths: [58, 236, 70, 48, 91], rows: documentData.lines.map(line => line.type === "section" ? ["", line.title, "", "", ""] : [line.ref, line.label, fmt(line.unit), line.qty, fmt(lineTotal(line))]), summaryRows: [["TOTAL", fmt(invoiceTotal(documentData))]], notes, signatureKind: isInvoice ? "invoice" : "proforma", signatureLabel: "Signataire autorise" });
}

function downloadReceiptPdf(receipt) {
  const invoice = state.invoices.find(item => item.id === receipt.invoiceId);
  const signer = documentSigner("receipt");
  return createSystemPdf({ filename: `${receipt.id}.pdf`, title: "RECU DE PAIEMENT", reference: receipt.id, date: receipt.date, infoRows: [["Facture", receipt.invoiceId], ["Reference facture", invoice?.reference || "-"], ["Client", invoice?.client || "-"], ["Montant recu", fmt(receipt.amount)], ["Moyen", receipt.method], ["Compte de reception", accountName(receipt.destinationId)]], notes: ["Nous attestons avoir recu le paiement ci-dessus pour la facture indiquee."], signatures: [{ label: "Signature du client" }, { label: signer?.signatureTitle || "Signataire autorise", name: signer?.name || "A configurer" }] });
}

function downloadVoucherPdf(disbursement) {
  return createSystemPdf({ filename: `${disbursement.id}.pdf`, title: "FICHE DE DECAISSEMENT", reference: disbursement.id, date: disbursement.date || today, infoRows: [["Ordonnateur", disbursement.orderedBy], ["Beneficiaire", disbursement.beneficiary], ["Facture fournisseur", disbursement.supplierInvoiceId || "Non liee"], ["Dossier", disbursement.project], ["Source", accountName(disbursement.sourceId)], ["Moyen", disbursement.paymentMethod || "-"], ["Montant", fmt(disbursement.amount)], ["Motif", disbursement.reason], ["Tracabilite", disbursement.scanName || "Scan signe non attache"]], signatures: [{ label: "Ordonnateur", name: disbursement.orderedBy }, { label: "Caissier" }, { label: "Beneficiaire", name: disbursement.beneficiary, details: "Signature, nom et prenom, telephone" }] });
}

function downloadPurchaseOrderPdf(order) {
  return createSystemPdf({ filename: `${order.id}.pdf`, title: "BON DE COMMANDE", reference: order.id, date: order.date, infoRows: [["Fournisseur", order.supplier], ["Objet", order.purpose], ["Dossier", order.project || "Non lie"]], headers: ["Designation", "Montant estime"], widths: [350, 153], rows: [[order.purpose, fmt(order.amount)]], summaryRows: [["TOTAL", fmt(order.amount)]], signatureKind: "invoice", signatureLabel: "Autorisation de commande" });
}

function downloadPayslipPdf(record) {
  const employee = state.employees.find(item => item.id === record.employeeId);
  return createSystemPdf({ filename: `${record.id}.pdf`, title: "BULLETIN DE PAIE", reference: `Periode ${record.period}`, date: `${record.period}-28`, infoRows: [["Employe", record.employeeName], ["Poste", employee?.position || "-"], ["Contrat", employee?.contractType || "-"], ["Numero CNSS", employee?.cnssNumber || "-"]], headers: ["Element", "Base", "Retenue", "Gain"], widths: [220, 95, 94, 94], rows: [["Salaire de base", fmt(record.baseSalary), "-", fmt(record.baseSalary)], ["Primes fixes", fmt(record.allowances), "-", fmt(record.allowances)], ["CNSS salarie", fmt(record.gross), fmt(record.cnssEmployee), "-"], ["AMU salarie", fmt(record.gross), fmt(record.amuEmployee), "-"], ["IRPP provisoire", fmt(record.gross), fmt(record.irpp), "-"]], summaryRows: [["NET A PAYER", fmt(record.net)]], signatureKind: "payroll", signatureLabel: "Responsable de la paie" });
}

function downloadClosurePdf(closure) {
  const entries = dailyEntries(closure.date);
  return createSystemPdf({ filename: `${closure.id}.pdf`, title: "SITUATION DE CAISSE", reference: closure.id, date: closure.date, infoRows: [["Societe", currentEntity().name], ["Etabli par", closure.by], ["Type", closure.early ? "Arrete anticipe" : "Arrete journalier"]], headers: ["Date", "Nature", "Compte", "Libelle", "Reference", "Entree", "Sortie"], widths: [58, 65, 75, 120, 65, 60, 60], rows: entries.map(entry => [entry.date, entry.nature, accountName(entry.accountId), entry.label, entry.trace || "-", entry.amount > 0 ? fmt(entry.amount) : "-", entry.amount < 0 ? fmt(Math.abs(entry.amount)) : "-"]), summaryRows: [["TOTAL ARRETE", fmt(closure.total)]], notes: closure.reason ? [`Motif : ${closure.reason}`] : [], signatures: [{ label: "Responsable finance", name: closure.by }, { label: "Caissier" }] });
}

function download(filename, mime, content) {
  const blob = content instanceof Uint8Array ? new Blob([content], { type: mime }) : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

let deferredInstallPrompt = null;

function registerPwa() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(console.error);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    byId("install-app-btn")?.classList.remove("is-hidden");
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    byId("install-app-btn")?.classList.add("is-hidden");
  });
}

async function installPwa() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  byId("install-app-btn")?.classList.add("is-hidden");
}

init();
