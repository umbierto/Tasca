import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { supabasePublishableKey, supabaseUrl } from "./supabase-config.js";

const STORAGE_KEY = "tasca-expenses-v1";
const BUDGET_STORAGE_KEY = "tasca-budgets-v1";
const supabase = createClient(supabaseUrl, supabasePublishableKey);
const categories = ["Alimentari", "Casa", "Trasporti", "Salute", "Svago", "Abbigliamento", "Bollette", "Altro"];
const categoryColours = {
  Alimentari: "#2563eb",
  Casa: "#16a36a",
  Trasporti: "#f59e0b",
  Salute: "#e45369",
  Svago: "#8b5cf6",
  Abbigliamento: "#0ea5b7",
  Bollette: "#ea7c24",
  Altro: "#64748b"
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Registrazione offline non riuscita:", error);
    });
  });
}

const elements = {
  form: document.querySelector("#expenseForm"), id: document.querySelector("#expenseId"), amount: document.querySelector("#amount"),
  date: document.querySelector("#date"), category: document.querySelector("#category"), description: document.querySelector("#description"),
  categoryFilter: document.querySelector("#categoryFilter"), monthFilter: document.querySelector("#monthFilter"), list: document.querySelector("#expenseList"),
  total: document.querySelector("#monthlyTotal"), detail: document.querySelector("#summaryDetail"), count: document.querySelector("#expenseCount"),
  currentMonth: document.querySelector("#currentMonthLabel"), submit: document.querySelector("#submitButton"), cancel: document.querySelector("#cancelEdit"),
  clearFilters: document.querySelector("#clearFilters"), template: document.querySelector("#expenseTemplate"), toast: document.querySelector("#toast"),
  chart: document.querySelector("#categoryChart"), chartTotal: document.querySelector("#chartTotal"), chartLegend: document.querySelector("#chartLegend"),
  chartMonthPicker: document.querySelector("#chartMonthPicker"), chartEmpty: document.querySelector("#chartEmpty"),
  budgetForm: document.querySelector("#budgetForm"), budgetAmount: document.querySelector("#budgetAmount"), saveBudget: document.querySelector("#saveBudget"),
  deleteBudget: document.querySelector("#deleteBudget"), budgetMonthPicker: document.querySelector("#budgetMonthPicker"), budgetSpent: document.querySelector("#budgetSpent"),
  budgetTotal: document.querySelector("#budgetTotal"), budgetRemaining: document.querySelector("#budgetRemaining"), budgetPercentage: document.querySelector("#budgetPercentage"),
  budgetProgress: document.querySelector("#budgetProgressBar"), budgetStatus: document.querySelector("#budgetStatus"),
  exportBackup: document.querySelector("#exportBackup"), importBackup: document.querySelector("#importBackup"), importSummary: document.querySelector("#importSummary"), confirmImport: document.querySelector("#confirmImport"),
  authForm: document.querySelector("#authForm"), authEmail: document.querySelector("#authEmail"), authPassword: document.querySelector("#authPassword"),
  authStatus: document.querySelector("#authStatus"), signIn: document.querySelector("#signInButton"), signUp: document.querySelector("#signUpButton"), authAction: document.querySelector("#authAction"),
  menuToggle: document.querySelector("#menuToggle"), menuClose: document.querySelector("#menuClose"), menuScrim: document.querySelector("#menuScrim"), sideMenu: document.querySelector("#sideMenu"),
  profileEmail: document.querySelector("#profileEmail"), profileForm: document.querySelector("#profileForm"), firstName: document.querySelector("#firstName"), lastName: document.querySelector("#lastName"),
  passwordForm: document.querySelector("#passwordForm"), newPassword: document.querySelector("#newPassword"), confirmPassword: document.querySelector("#confirmPassword"),
  appPages: document.querySelector("#appPages"), pageButtons: [...document.querySelectorAll(".mobile-page-nav button")], menuNavButtons: [...document.querySelectorAll(".menu-nav button")]
};

let expenses = loadExpenses();
let budgets = loadBudgets();
let toastTimer;
let currentUser = null;
let pendingBackup = null;
let cloudSyncReady = false;

function localDateISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date - offset).toISOString().slice(0, 10);
}

function loadExpenses() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

function saveExpenses() { localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses)); }
function loadBudgets() {
  try {
    const saved = JSON.parse(localStorage.getItem(BUDGET_STORAGE_KEY));
    if (!saved || Array.isArray(saved) || typeof saved !== "object") return {};
    return Object.fromEntries(Object.entries(saved).filter(([month, amount]) => /^\d{4}-\d{2}$/.test(month) && Number.isFinite(Number(amount)) && Number(amount) > 0).map(([month, amount]) => [month, Number(amount)]));
  } catch { return {}; }
}
function saveBudgets() { localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(budgets)); }
function exportBackup() {
  const backup = {
    app: "Tasca",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    expenses,
    budgets
  };
  const contents = JSON.stringify(backup, null, 2);
  const download = document.createElement("a");
  const fileDate = localDateISO().replaceAll("-", "");
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  download.href = url;
  download.download = `tasca-backup-${fileDate}.json`;
  download.click();
  URL.revokeObjectURL(url);
  showToast("Backup scaricato: conservalo in un luogo sicuro");
}

function validateBackup(backup) {
  if (!backup || backup.app !== "Tasca" || backup.formatVersion !== 1 || !Array.isArray(backup.expenses) || !backup.budgets || Array.isArray(backup.budgets) || typeof backup.budgets !== "object") {
    throw new Error("Il file non è un backup Tasca compatibile.");
  }
  const ids = new Set();
  const importedExpenses = backup.expenses.map(expense => {
    if (!expense || typeof expense.id !== "string" || !expense.id || ids.has(expense.id) || !Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(expense.date) || typeof expense.category !== "string" || !categories.includes(expense.category) || typeof expense.description !== "string" || expense.description.length > 100) {
      throw new Error("Il backup contiene una spesa non valida.");
    }
    ids.add(expense.id);
    return { id: expense.id, amount: Number(expense.amount), date: expense.date, category: expense.category, description: expense.description };
  });
  const importedBudgets = Object.entries(backup.budgets).map(([month, amount]) => {
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error("Il backup contiene un budget non valido.");
    return { month, amount: Number(amount) };
  });
  return { expenses: importedExpenses, budgets: importedBudgets };
}

async function selectBackup(event) {
  const file = event.target.files?.[0];
  pendingBackup = null;
  elements.confirmImport.classList.add("hidden");
  elements.importSummary.classList.add("hidden");
  if (!file) return;
  try {
    pendingBackup = validateBackup(JSON.parse(await file.text()));
    elements.importSummary.textContent = `Backup pronto: ${pendingBackup.expenses.length} spese e ${pendingBackup.budgets.length} budget. Controlla il riepilogo, poi importa.`;
    elements.importSummary.classList.remove("hidden");
    elements.confirmImport.classList.remove("hidden");
  } catch (error) {
    elements.importSummary.textContent = error.message;
    elements.importSummary.classList.remove("hidden");
  }
}

async function importBackup() {
  if (!currentUser) { showToast("Accedi prima di importare un backup"); return; }
  if (!pendingBackup) return;
  const message = `Importare ${pendingBackup.expenses.length} spese e ${pendingBackup.budgets.length} budget nel tuo account? I dati esistenti con lo stesso identificativo saranno aggiornati.`;
  if (!confirm(message)) return;
  elements.confirmImport.disabled = true;
  const expenseRows = pendingBackup.expenses.map(expense => ({
    id: expense.id,
    user_id: currentUser.id,
    amount: expense.amount,
    expense_date: expense.date,
    category: expense.category,
    description: expense.description
  }));
  const budgetRows = pendingBackup.budgets.map(budget => ({
    user_id: currentUser.id,
    budget_month: `${budget.month}-01`,
    amount: budget.amount
  }));
  const expensesResult = expenseRows.length ? await supabase.from("expenses").upsert(expenseRows, { onConflict: "id" }) : { error: null };
  const budgetsResult = !expensesResult.error && budgetRows.length ? await supabase.from("budgets").upsert(budgetRows, { onConflict: "user_id,budget_month" }) : { error: null };
  elements.confirmImport.disabled = false;
  if (expensesResult.error || budgetsResult.error) {
    showToast(`Importazione non riuscita: ${(expensesResult.error || budgetsResult.error).message}`);
    return;
  }
  showToast("Backup importato nel cloud");
  await loadCloudData();
  elements.importSummary.textContent = `Importazione completata: ${expenseRows.length} spese e ${budgetRows.length} budget nel cloud.`;
  elements.confirmImport.classList.add("hidden");
  pendingBackup = null;
}
function formatCurrency(value) { return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value); }
function formatDate(value) { return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function monthName(value) { return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`)); }

function populateSelects() {
  elements.category.innerHTML = `<option value="" disabled selected>Scegli una categoria</option>${categories.map(c => `<option value="${c}">${c}</option>`).join("")}`;
  elements.categoryFilter.innerHTML = `<option value="">Tutte</option>${categories.map(c => `<option value="${c}">${c}</option>`).join("")}`;
}

function getFilteredExpenses() {
  const month = elements.monthFilter.value;
  const category = elements.categoryFilter.value;
  return expenses.filter(expense => (!month || expense.date.startsWith(month)) && (!category || expense.category === category));
}

function getMonthlyCategoryTotals() {
  const month = elements.monthFilter.value;
  if (!month) return [];
  const totals = expenses
    .filter(expense => expense.date.startsWith(month))
    .reduce((result, expense) => {
      result[expense.category] = (result[expense.category] || 0) + expense.amount;
      return result;
    }, {});
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function getMonthExpensesTotal(month) {
  return expenses.filter(expense => expense.date.startsWith(month)).reduce((sum, expense) => sum + expense.amount, 0);
}

function renderBudget() {
  const month = elements.monthFilter.value;
  const monthChanged = elements.budgetAmount.dataset.month !== month;
  const budget = budgets[month];
  const hasBudget = Number.isFinite(budget);
  const spent = month ? getMonthExpensesTotal(month) : 0;
  const percentage = hasBudget ? (spent / budget) * 100 : 0;
  const remaining = hasBudget ? budget - spent : 0;
  const exceeded = hasBudget && spent > budget;

  if (monthChanged) {
    elements.budgetAmount.value = hasBudget ? budget : "";
    elements.budgetAmount.dataset.month = month;
  }
  elements.budgetAmount.disabled = !month;
  elements.saveBudget.disabled = !month;
  elements.saveBudget.textContent = hasBudget ? "Aggiorna budget" : "Salva budget";
  elements.deleteBudget.classList.toggle("hidden", !hasBudget || !month);
  elements.budgetMonthPicker.value = month;
  elements.budgetSpent.textContent = formatCurrency(spent);
  elements.budgetTotal.textContent = hasBudget ? formatCurrency(budget) : "—";
  elements.budgetRemaining.textContent = hasBudget ? formatCurrency(remaining) : "—";
  elements.budgetPercentage.textContent = hasBudget ? `${percentage.toFixed(1).replace(".", ",")}%` : "—";
  elements.budgetRemaining.classList.toggle("over-budget", exceeded);
  elements.budgetPercentage.classList.toggle("over-budget", exceeded);
  elements.budgetProgress.style.width = `${hasBudget ? Math.min(percentage, 100) : 0}%`;
  elements.budgetProgress.classList.toggle("over-budget", exceeded);

  if (!month) elements.budgetStatus.textContent = "Seleziona un mese per impostare un budget.";
  else if (!hasBudget) elements.budgetStatus.textContent = "Nessun budget impostato per questo mese.";
  else if (exceeded) elements.budgetStatus.textContent = `Budget superato di ${formatCurrency(Math.abs(remaining))}.`;
  else elements.budgetStatus.textContent = `Ti restano ${formatCurrency(remaining)} nel budget.`;
  elements.budgetStatus.classList.toggle("over-budget", exceeded);
}

function renderChart() {
  const month = elements.monthFilter.value;
  const entries = getMonthlyCategoryTotals();
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const ctx = elements.chart.getContext("2d");
  elements.chartTotal.textContent = formatCurrency(total);
  elements.chartMonthPicker.value = month;
  elements.chartLegend.innerHTML = "";

  const hasData = entries.length > 0;
  elements.chartEmpty.classList.toggle("hidden", hasData);
  elements.chart.parentElement.parentElement.classList.toggle("hidden", !hasData);
  if (!hasData) {
    if (month) elements.chartEmpty.textContent = "Non ci sono spese registrate per il mese selezionato.";
    else elements.chartEmpty.textContent = "Seleziona un mese per visualizzare la distribuzione delle spese.";
    return;
  }

  const size = Math.max(elements.chart.clientWidth, 1);
  const pixelRatio = window.devicePixelRatio || 1;
  elements.chart.width = size * pixelRatio;
  elements.chart.height = size * pixelRatio;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size, size);

  let startAngle = -Math.PI / 2;
  const centre = size / 2;
  const radius = size / 2 - 8;
  const innerRadius = radius * 0.63;
  entries.forEach((entry, index) => {
    const colour = categoryColours[entry.category] || "#64748b";
    const angle = (entry.amount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(centre, centre, radius, startAngle, startAngle + angle);
    ctx.arc(centre, centre, innerRadius, startAngle + angle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    startAngle += angle;

    const percentage = (entry.amount / total) * 100;
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot"></span><span class="legend-label"></span><span class="legend-value"><span class="legend-amount"></span><small></small></span>`;
    item.querySelector(".legend-dot").style.backgroundColor = colour;
    item.querySelector(".legend-label").textContent = entry.category;
    item.querySelector(".legend-amount").textContent = formatCurrency(entry.amount);
    item.querySelector(".legend-value small").textContent = `${percentage.toFixed(1).replace(".", ",")}%`;
    elements.chartLegend.append(item);
  });
}

function render() {
  const filtered = getFilteredExpenses().sort((a, b) => b.date.localeCompare(a.date));
  const total = filtered.reduce((sum, expense) => sum + expense.amount, 0);
  const selectedMonth = elements.monthFilter.value;
  elements.total.textContent = formatCurrency(total);
  elements.detail.textContent = filtered.length === 0 ? "Nessuna spesa nel periodo selezionato" : `${filtered.length} ${filtered.length === 1 ? "spesa registrata" : "spese registrate"}${selectedMonth ? ` a ${monthName(selectedMonth)}` : " in tutti i periodi"}`;
  elements.count.textContent = `${filtered.length} ${filtered.length === 1 ? "voce" : "voci"}`;
  renderBudget();
  renderChart();
  elements.list.innerHTML = "";

  if (!filtered.length) {
    elements.list.innerHTML = `<div class="empty-state"><strong>Nessuna spesa da mostrare</strong><p>Aggiungi una spesa o modifica i filtri.</p></div>`;
    return;
  }
  filtered.forEach(expense => {
    const node = elements.template.content.cloneNode(true);
    node.querySelector(".expense-description").textContent = expense.description || expense.category;
    node.querySelector(".expense-category").textContent = expense.category;
    node.querySelector(".expense-date").textContent = formatDate(expense.date);
    node.querySelector(".expense-date").dateTime = expense.date;
    node.querySelector(".expense-amount").textContent = formatCurrency(expense.amount);
    node.querySelector(".edit-button").dataset.id = expense.id;
    node.querySelector(".delete-button").dataset.id = expense.id;
    elements.list.append(node);
  });
}

function resetForm() {
  elements.form.reset();
  elements.id.value = "";
  elements.date.value = localDateISO();
  elements.submit.textContent = "Aggiungi spesa";
  elements.cancel.classList.add("hidden");
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function setAuthBusy(isBusy) {
  elements.signIn.disabled = isBusy;
  elements.signUp.disabled = isBusy;
  elements.authAction.disabled = isBusy;
}

function renderAuth() {
  const signedIn = Boolean(currentUser);
  elements.authForm.classList.toggle("hidden", signedIn);
  elements.authAction.querySelector("span:last-child").textContent = signedIn ? "Log out" : "Log in";
  elements.profileForm.classList.toggle("hidden", !signedIn);
  elements.passwordForm.classList.toggle("hidden", !signedIn);
  if (signedIn) {
    const metadata = currentUser.user_metadata || {};
    elements.profileEmail.textContent = currentUser.email;
    elements.firstName.value = metadata.first_name || "";
    elements.lastName.value = metadata.last_name || "";
    elements.authStatus.textContent = cloudSyncReady
      ? `Accesso effettuato come ${currentUser.email}. Le modifiche vengono sincronizzate con il cloud.`
      : `Accesso effettuato come ${currentUser.email}. Controllo i dati nel cloud…`;
  } else {
    elements.profileEmail.textContent = "Accedi per visualizzare e modificare i tuoi dati.";
    elements.authStatus.textContent = "Accedi o crea un account per preparare la sincronizzazione tra i tuoi dispositivi.";
  }
}

function setMenuOpen(isOpen) {
  document.body.classList.toggle("menu-open", isOpen);
  elements.menuToggle.setAttribute("aria-expanded", String(isOpen));
  elements.sideMenu.setAttribute("aria-hidden", String(!isOpen));
  elements.menuScrim.setAttribute("aria-hidden", String(!isOpen));
}

async function updateProfile(event) {
  event.preventDefault();
  if (!currentUser) return;
  const { data, error } = await supabase.auth.updateUser({ data: { first_name: elements.firstName.value.trim(), last_name: elements.lastName.value.trim() } });
  if (error) { showToast(`Profilo non aggiornato: ${error.message}`); return; }
  currentUser = data.user;
  renderAuth();
  showToast("Dati personali aggiornati");
}

async function updatePassword(event) {
  event.preventDefault();
  if (!currentUser || !elements.passwordForm.reportValidity()) return;
  if (elements.newPassword.value !== elements.confirmPassword.value) { showToast("Le due password non coincidono"); return; }
  const { error } = await supabase.auth.updateUser({ password: elements.newPassword.value });
  if (error) { showToast(`Password non aggiornata: ${error.message}`); return; }
  elements.passwordForm.reset();
  showToast("Password aggiornata");
}

function updatePageNavigation() {
  const index = Math.round(elements.appPages.scrollLeft / Math.max(elements.appPages.clientWidth, 1));
  elements.pageButtons.forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === index));
}

function hasLocalData() {
  return expenses.length > 0 || Object.keys(budgets).length > 0;
}

async function loadCloudData() {
  if (!currentUser) return;
  cloudSyncReady = false;
  renderAuth();
  const [expensesResult, budgetsResult] = await Promise.all([
    supabase.from("expenses").select("id, amount, expense_date, category, description").order("expense_date", { ascending: false }),
    supabase.from("budgets").select("budget_month, amount")
  ]);
  if (expensesResult.error || budgetsResult.error) {
    showToast(`Sincronizzazione non disponibile: ${(expensesResult.error || budgetsResult.error).message}`);
    renderAuth();
    return;
  }
  const remoteExpenses = expensesResult.data.map(expense => ({ id: expense.id, amount: Number(expense.amount), date: expense.expense_date, category: expense.category, description: expense.description }));
  const remoteBudgets = Object.fromEntries(budgetsResult.data.map(budget => [budget.budget_month.slice(0, 7), Number(budget.amount)]));
  if (remoteExpenses.length === 0 && Object.keys(remoteBudgets).length === 0 && hasLocalData()) {
    elements.authStatus.textContent = "Il cloud è vuoto ma questo dispositivo contiene dati locali. Usa l'importazione controllata per trasferirli senza rischi.";
    return;
  }
  expenses = remoteExpenses;
  budgets = remoteBudgets;
  saveExpenses();
  saveBudgets();
  cloudSyncReady = true;
  renderAuth();
  render();
}

function canSyncToCloud() { return Boolean(currentUser && cloudSyncReady); }

async function saveExpenseToCloud(entry) {
  if (!canSyncToCloud()) return true;
  const { error } = await supabase.from("expenses").upsert({ id: entry.id, user_id: currentUser.id, amount: entry.amount, expense_date: entry.date, category: entry.category, description: entry.description }, { onConflict: "id" });
  if (error) { showToast(`Spesa non salvata nel cloud: ${error.message}`); return false; }
  return true;
}

async function deleteExpenseFromCloud(id) {
  if (!canSyncToCloud()) return true;
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) { showToast(`Spesa non eliminata nel cloud: ${error.message}`); return false; }
  return true;
}

async function saveBudgetToCloud(month, amount) {
  if (!canSyncToCloud()) return true;
  const { error } = await supabase.from("budgets").upsert({ user_id: currentUser.id, budget_month: `${month}-01`, amount }, { onConflict: "user_id,budget_month" });
  if (error) { showToast(`Budget non salvato nel cloud: ${error.message}`); return false; }
  return true;
}

async function deleteBudgetFromCloud(month) {
  if (!canSyncToCloud()) return true;
  const { error } = await supabase.from("budgets").delete().eq("budget_month", `${month}-01`);
  if (error) { showToast(`Budget non eliminato nel cloud: ${error.message}`); return false; }
  return true;
}

async function signIn() {
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!email || !password) return;
  setAuthBusy(true);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  setAuthBusy(false);
  if (error) showToast(`Accesso non riuscito: ${error.message}`);
}

async function signUp() {
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!elements.authForm.reportValidity()) return;
  setAuthBusy(true);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
  });
  setAuthBusy(false);
  if (error) { showToast(`Creazione account non riuscita: ${error.message}`); return; }
  if (data.session) showToast("Account creato e accesso effettuato");
  else showToast("Controlla la tua email e conferma l'account, poi accedi qui");
}

async function initializeAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error) showToast("Impossibile controllare la sessione Supabase");
  currentUser = data.session?.user ?? null;
  renderAuth();
  if (currentUser) loadCloudData();
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    cloudSyncReady = false;
    renderAuth();
    if (currentUser) loadCloudData();
  });
}

elements.form.addEventListener("submit", async event => {
  event.preventDefault();
  const amount = Number(elements.amount.value);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const entry = { id: elements.id.value || crypto.randomUUID(), amount, date: elements.date.value, category: elements.category.value, description: elements.description.value.trim() };
  const existingIndex = expenses.findIndex(expense => expense.id === entry.id);
  if (!await saveExpenseToCloud(entry)) return;
  if (existingIndex >= 0) { expenses[existingIndex] = entry; showToast("Spesa modificata"); }
  else { expenses.push(entry); showToast("Spesa aggiunta"); }
  saveExpenses(); resetForm(); render();
});

elements.list.addEventListener("click", async event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const expense = expenses.find(item => item.id === button.dataset.id);
  if (!expense) return;
  if (button.classList.contains("delete-button")) {
    if (!confirm(`Eliminare la spesa “${expense.description || expense.category}”?`)) return;
    if (!await deleteExpenseFromCloud(expense.id)) return;
    expenses = expenses.filter(item => item.id !== expense.id);
    saveExpenses(); render(); showToast("Spesa eliminata");
  } else {
    elements.id.value = expense.id; elements.amount.value = expense.amount; elements.date.value = expense.date; elements.category.value = expense.category; elements.description.value = expense.description;
    elements.submit.textContent = "Salva modifiche"; elements.cancel.classList.remove("hidden"); elements.amount.focus();
    document.querySelector(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

elements.cancel.addEventListener("click", resetForm);
elements.monthFilter.addEventListener("input", render);
elements.categoryFilter.addEventListener("change", render);
elements.clearFilters.addEventListener("click", () => { elements.monthFilter.value = ""; elements.categoryFilter.value = ""; render(); });
function selectActiveMonth(month) {
  elements.monthFilter.value = month;
  render();
}
elements.chartMonthPicker.addEventListener("input", event => selectActiveMonth(event.target.value));
elements.budgetMonthPicker.addEventListener("input", event => selectActiveMonth(event.target.value));
elements.budgetForm.addEventListener("submit", async event => {
  event.preventDefault();
  const month = elements.monthFilter.value;
  const amount = Number(elements.budgetAmount.value);
  if (!month || !Number.isFinite(amount) || amount <= 0) return;
  if (!await saveBudgetToCloud(month, amount)) return;
  budgets[month] = amount;
  saveBudgets();
  elements.budgetAmount.dataset.month = month;
  render();
  showToast("Budget salvato");
});
elements.deleteBudget.addEventListener("click", async () => {
  const month = elements.monthFilter.value;
  if (!month || !Object.hasOwn(budgets, month)) return;
  if (!await deleteBudgetFromCloud(month)) return;
  delete budgets[month];
  saveBudgets();
  elements.budgetAmount.value = "";
  elements.budgetAmount.dataset.month = "";
  render();
  showToast("Budget eliminato");
});
elements.exportBackup.addEventListener("click", exportBackup);
elements.importBackup.addEventListener("change", selectBackup);
elements.confirmImport.addEventListener("click", importBackup);
elements.menuToggle.addEventListener("click", () => setMenuOpen(true));
elements.menuClose.addEventListener("click", () => setMenuOpen(false));
elements.menuScrim.addEventListener("click", () => setMenuOpen(false));
elements.profileForm.addEventListener("submit", updateProfile);
elements.passwordForm.addEventListener("submit", updatePassword);
elements.pageButtons.forEach((button, index) => button.addEventListener("click", () => elements.appPages.scrollTo({ left: elements.appPages.clientWidth * index, behavior: "smooth" })));
elements.appPages.addEventListener("scroll", updatePageNavigation, { passive: true });
elements.authForm.addEventListener("submit", event => { event.preventDefault(); signIn(); });
elements.signUp.addEventListener("click", signUp);
elements.authAction.addEventListener("click", async () => {
  if (!currentUser) {
    document.querySelector("#backupSection").scrollIntoView({ behavior: "smooth", block: "start" });
    elements.authEmail.focus();
    return;
  }
  setAuthBusy(true);
  const { error } = await supabase.auth.signOut();
  setAuthBusy(false);
  if (error) showToast(`Uscita non riuscita: ${error.message}`);
});
elements.menuNavButtons.forEach(button => button.addEventListener("click", () => document.querySelector(`#${button.dataset.menuTarget}`).scrollIntoView({ behavior: "smooth", block: "start" })));
window.addEventListener("resize", renderChart);
window.addEventListener("resize", updatePageNavigation);
window.addEventListener("keydown", event => { if (event.key === "Escape") setMenuOpen(false); });
window.addEventListener("focus", loadCloudData);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadCloudData(); });

populateSelects();
elements.date.value = localDateISO();
const currentMonth = localDateISO().slice(0, 7);
elements.monthFilter.value = currentMonth;
elements.currentMonth.textContent = monthName(currentMonth);
render();
initializeAuth();
