import {
  buildOpenMonthReviews,
  buildHousingSeries,
  calculateHousingLedger,
  createCloseSnapshot,
  deriveSettlementForTransaction,
  listMonthTransactions,
  migrateLegacyData,
  normalizeTransactionInput,
  summarizeMonth
} from "./domain.mjs";

const $ = (id) => document.getElementById(id);
const TODAY = (() => { const date = new Date(); const pad = (value) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; })();
const CURRENT_MONTH = TODAY.slice(0, 7);
const COLORS = ["#2868d7", "#159e9b", "#7659c9", "#e28c43", "#bd4c65", "#6f8ea9", "#8d63bc", "#a2b85b"];
const CATEGORIES = ["식비", "주거/공과", "교통", "통신", "데이트/여가", "쇼핑", "의료", "교육", "경조사", "저축/투자", "기타"];
const state = { data: null, screen: "dashboard", selectedMonth: CURRENT_MONTH, recordFilter: "all", recordTypeFilter: "all", settlementTransferId: null, charts: {}, detail: null, analyticsDetail: null, cloudDb: null, saveTimer: null, housingCalculated: false, editingRecord: null };
const RECORD_TYPES = [
  ["all", "전체"], ["recurring-income", "정기 수입"], ["recurring-expense", "정기 지출"],
  ["once-income", "비정기 수입"], ["once-expense", "비정기 지출"], ["transfer", "계좌 이체"]
];

function deepClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fmt(value) { return `${Math.round(parseAmount(value)).toLocaleString("ko-KR")}원`; }
function fmtShort(value) {
  const n = parseAmount(value);
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, "")}억`;
  if (Math.abs(n) >= 10000) return `${Math.round(n / 10000).toLocaleString("ko-KR")}만`;
  return fmt(n);
}
function inputNumber(value) { return parseAmount(value).toLocaleString("ko-KR"); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function monthLabel(key) { const [y, m] = String(key).split("-"); return `${y}년 ${Number(m)}월`; }
function ownerName(owner) { return owner === "A" ? (state.data?.nameA || "나") : owner === "B" ? (state.data?.nameB || "상대방") : "공동"; }
function ownerClass(owner) { return owner === "A" ? "person-a" : owner === "B" ? "person-b" : "joint"; }
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600); }
function setSaveStatus(text, kind = "") { const el = $("saveStatus"); el.textContent = text; el.dataset.kind = kind; }
function currentLedger() { return state.data.ledgers[state.selectedMonth] || (state.data.ledgers[state.selectedMonth] = blankLedger()); }
function blankLedger() { return { incomes: [], expenses: [], extraIncomes: [], extraExpenses: [], cardTxns: [], transfers: [], settlementReviews: [], cashflowOccurrences: {} }; }
function allMonths() {
  const months = new Set([...(state.data.months || []), ...Object.keys(state.data.ledgers || {})]);
  if (state.data.cashflowRules?.length) {
    const [year, month] = CURRENT_MONTH.split("-").map(Number);
    const horizonDate = new Date(year, month - 1 + 12, 1);
    const horizon = `${horizonDate.getFullYear()}-${String(horizonDate.getMonth() + 1).padStart(2, "0")}`;
    months.add(CURRENT_MONTH);
    for (const rule of state.data.cashflowRules) {
      let cursor = rule.startMonth || CURRENT_MONTH;
      const end = rule.endMonth && rule.endMonth < horizon ? rule.endMonth : horizon;
      while (cursor <= end) {
        months.add(cursor); cursor = nextMonthKey(cursor);
      }
    }
  }
  return [...months].sort();
}
function nextMonthKey(key) { const [year, month] = key.split("-").map(Number); const next = new Date(year, month, 1); return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`; }
function previousMonthKey(key) { const [year, month] = key.split("-").map(Number); const previous = new Date(year, month - 2, 1); return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`; }
function ruleAppliesInMonth(rule, monthKey) { return monthKey >= (rule.startMonth || monthKey) && (!rule.endMonth || monthKey <= rule.endMonth); }
function accountById(id) { return (state.data.accounts || []).find((item) => item.id === id); }
function cardById(id) { return (state.data.cards || []).find((item) => item.id === id); }
function paymentLabel(payment) {
  if (!payment) return "결제 수단 미설정";
  if (payment.type === "card") { const card = cardById(payment.id); return card ? `카드 · ${card.name}` : "카드 미설정"; }
  if (payment.type === "account") { const account = accountById(payment.id); return account ? `계좌 · ${account.name}` : "계좌 미설정"; }
  return "결제 수단 미설정";
}
function paymentFromValue(value) {
  const [type, id] = String(value || "").split(":");
  return { type: type || "unknown", id: id || "" };
}

function defaultData() {
  return migrateLegacyData({ schemaVersion: 2, nameA: "나", nameB: "상대방", accounts: [], cards: [], months: [CURRENT_MONTH], ledgers: { [CURRENT_MONTH]: blankLedger() }, settlementReviews: [] }, { today: TODAY });
}

function ensureData(raw) {
  const data = migrateLegacyData(raw || defaultData(), { today: TODAY });
  data.nameA ||= "나";
  data.nameB ||= "상대방";
  data.accounts ||= [];
  data.cards ||= [];
  data.cfA ||= [];
  data.cfB ||= [];
  data.settlementReviews ||= [];
  if (!Array.isArray(data.cashflowRules)) data.cashflowRules = [];
  for (const key of data.months) {
    const ledger = data.ledgers[key] = { ...blankLedger(), ...(data.ledgers[key] || {}) };
    if (!ledger.cashflowOccurrences || typeof ledger.cashflowOccurrences !== "object") ledger.cashflowOccurrences = {};
    for (const collection of ["incomes", "extraIncomes", "extraExpenses", "transfers"]) {
      ledger[collection].forEach((item, index) => { if (!item.id) item.id = `${key}:${collection}:${index}`; });
    }
    ledger.cardTxns.forEach((item, index) => { if (!item.id) item.id = `${key}:card:${index}`; });
    let legacyCardIndex = ledger.cardTxns.filter((item) => parseAmount(item.amount ?? item.amt) > 0).length;
    ledger.expenses.forEach((item, index) => {
      if (item.method === "card" && !item.id) item.id = `${key}:fixed:${legacyCardIndex++}`;
      else if (!item.id) item.id = `${key}:expense:${index}`;
    });
  }
  const reviews = buildOpenMonthReviews(data);
  const reviewIds = new Set(data.settlementReviews.map((item) => item.sourceTransactionId));
  data.settlementReviews.push(...reviews.filter((item) => !reviewIds.has(item.sourceTransactionId)));
  return data;
}

function syncPeopleInputs() {
  if (!state.data) return;
  const inputA = $("nameAInput");
  const inputB = $("nameBInput");
  if (inputA && document.activeElement !== inputA) inputA.value = state.data.nameA || "나";
  if (inputB && document.activeElement !== inputB) inputB.value = state.data.nameB || "상대방";
  const purposeA = $("purposeA");
  const purposeB = $("purposeB");
  if (purposeA) purposeA.textContent = state.data.nameA || "나";
  if (purposeB) purposeB.textContent = state.data.nameB || "상대방";
  const recordFilterA = document.querySelector('#recordFilters [data-filter="A"]');
  const recordFilterB = document.querySelector('#recordFilters [data-filter="B"]');
  if (recordFilterA) recordFilterA.textContent = state.data.nameA || "나";
  if (recordFilterB) recordFilterB.textContent = state.data.nameB || "상대방";
  const audit = state.data.migrationAudit?.usageOwnerUnresolved || [];
  const notice = $("ownerAuditNotice");
  if (notice) {
    notice.hidden = audit.length === 0;
    if (audit.length) {
      const examples = audit.slice(0, 3).map((item) => `‘${item.original}’`).join(", ");
      notice.textContent = `과거 데이터에서 확인이 필요한 사용 목적 ${audit.length}건이 있습니다. ${examples}${audit.length > 3 ? " 외" : ""} 표기는 공동으로 임시 분류했으니 거래 기록에서 실제 사용자를 확인해주세요.`;
    }
  }
}

function parseStoredJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function storeSourceBackup(key, data, source = "legacy") {
  if (parseStoredJson(localStorage.getItem(key))) return true;
  try {
    localStorage.setItem(key, JSON.stringify({ format: "sohakPlannerSourceBackup", source, capturedAt: new Date().toISOString(), data }));
    return true;
  } catch { return false; }
}

function storedDataCount(data) {
  if (!data || typeof data !== "object") return 0;
  const fields = ["incomes", "expenses", "extraIncomes", "extraExpenses", "cardTxns", "transfers"];
  let count = ["accounts", "cards", "loans", "goals", "cfA", "cfB", "cashflowRules"].reduce((total, key) => total + (Array.isArray(data[key]) ? data[key].length : 0), 0);
  const ledgers = data.ledgers && typeof data.ledgers === "object" ? Object.values(data.ledgers) : [];
  for (const ledger of ledgers) for (const key of fields) count += Array.isArray(ledger?.[key]) ? ledger[key].length : 0;
  if (!ledgers.length) for (const key of fields) count += Array.isArray(data[key]) ? data[key].length : 0;
  return count;
}

function readSourceBackup(key) {
  const stored = parseStoredJson(localStorage.getItem(key));
  if (!stored) return null;
  return stored.format === "sohakPlannerSourceBackup"
    ? stored
    : { format: "sohakPlannerSourceBackup", source: "legacy-backup", capturedAt: null, data: stored };
}

function loadLocal() {
  const candidates = [];
  for (const key of ["sohakPlannerV2", "coupleV8", "coupleV7"]) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    const parsed = parseStoredJson(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) candidates.push({ key, data: parsed });
  }
  let selected = candidates[0] || null;
  if (selected?.key === "sohakPlannerV2" && storedDataCount(selected.data) === 0) {
    selected = candidates.slice(1).find((candidate) => storedDataCount(candidate.data) > 0) || selected;
  }
  const raw = selected?.data || null;
  const sourceKey = selected?.key || null;
  const sourceBackupStored = !raw || sourceKey === "sohakPlannerV2" || storeSourceBackup("sohakPlannerV2:localBackup", raw, sourceKey);
  state.data = ensureData(raw || defaultData());
  const months = allMonths();
  state.selectedMonth = state.data.currentMonth && months.includes(state.data.currentMonth) ? state.data.currentMonth : (months.at(-1) || CURRENT_MONTH);
  if (raw && sourceKey !== "sohakPlannerV2") saveLocal(false);
  setSaveStatus(raw ? (sourceKey === "sohakPlannerV2" ? "기존 데이터를 불러왔어요" : `${sourceKey} 데이터에서 복구했어요`) : "새 플래너 준비 완료", sourceBackupStored ? "ok" : "warning");
  if (!sourceBackupStored) toast("원본 데이터를 브라우저에 백업하지 못했습니다. 저장 공간을 확인하고 백업 파일을 내려받아주세요.");
}

function saveLocal(showToast = true) {
  if (!state.data) return;
  const payload = { ...state.data, currentMonth: state.selectedMonth, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem("sohakPlannerV2:lastBackup", JSON.stringify(payload));
    localStorage.setItem("sohakPlannerV2", JSON.stringify(payload));
    setSaveStatus("저장됨 · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), "ok");
    if (showToast) toast("현재 데이터가 저장되었습니다.");
  } catch (error) {
    setSaveStatus("로컬 저장 실패", "error");
    toast("저장 공간을 확인해주세요.");
  }
}

function exportBackup() {
  const payload = JSON.stringify({
    format: "sohakPlannerBackup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { ...state.data, currentMonth: state.selectedMonth },
    sourceSnapshots: {
      local: readSourceBackup("sohakPlannerV2:localBackup"),
      cloud: readSourceBackup("sohakPlannerV2:cloudBackup")
    }
  }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `sohak-planner-backup-${TODAY}.json`; link.click(); URL.revokeObjectURL(url);
  toast("백업 파일을 저장했습니다.");
}
function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const isEnvelope = parsed?.format === "sohakPlannerBackup" && parsed.version === 1;
      const source = isEnvelope ? parsed.data : parsed;
      if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Invalid backup");
      if (isEnvelope) {
        for (const [name, key] of [["local", "sohakPlannerV2:localBackup"], ["cloud", "sohakPlannerV2:cloudBackup"]]) {
          const snapshot = parsed.sourceSnapshots?.[name];
          if (snapshot?.data && typeof snapshot.data === "object") {
            try { localStorage.setItem(key, JSON.stringify(snapshot)); } catch { /* current data can still be restored */ }
          }
        }
      }
      state.data = ensureData(source);
      const months = allMonths();
      state.selectedMonth = months.includes(state.data.currentMonth) ? state.data.currentMonth : (months.at(-1) || CURRENT_MONTH);
      saveLocal(false); renderAll(); toast("백업 데이터를 복원했습니다.");
    } catch { toast("백업 파일을 읽을 수 없습니다."); }
  };
  reader.readAsText(file);
}

function queueSave() {
  setSaveStatus("저장 대기 중", "pending");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveLocal(false), 900);
}

async function initCloud() {
  if (!window.firebase || !window.firebaseConfig?.projectId) {
    setSaveStatus("Firebase 설정을 찾지 못해 로컬 저장 모드로 실행합니다", "warning");
    return;
  }
  try {
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.firebaseConfig);
    const auth = window.firebase.auth();
    await auth.signInAnonymously();
    state.cloudDb = window.firebase.firestore();
    await loadCloud();
  } catch (error) {
    setSaveStatus("로컬 저장 모드", "warning");
  }
}

function cloudDocumentPath() {
  return Array.isArray(window.DOC_PATH) ? window.DOC_PATH : ["coupleFund", "main"];
}

async function loadCloud(showToast = false) {
  if (!state.cloudDb) {
    if (showToast) {
      loadLocal();
      renderAll();
      toast("Firebase에 연결되지 않아 이 기기의 데이터를 불러왔습니다.");
    }
    return;
  }
  try {
    const path = cloudDocumentPath();
    const snap = await state.cloudDb.collection(path[0]).doc(path[1]).get();
    if (!snap.exists) {
      setSaveStatus("Firebase에 저장된 데이터가 없습니다", "warning");
      if (showToast) toast("Firebase에 저장된 데이터가 없습니다.");
      return;
    }
    const raw = snap.data();
    const sourceBackupStored = storeSourceBackup("sohakPlannerV2:cloudBackup", raw, "firestore");
    state.data = ensureData(raw);
    const months = allMonths();
    state.selectedMonth = months.includes(state.data.currentMonth) ? state.data.currentMonth : (months.at(-1) || CURRENT_MONTH);
    saveLocal(false);
    renderAll();
    setSaveStatus(sourceBackupStored ? "Firebase에서 불러옴" : "Firebase에서 불러왔지만 원본 백업 저장 공간이 부족합니다", sourceBackupStored ? "ok" : "warning");
    if (showToast) toast("Firebase 데이터를 불러왔습니다.");
  } catch (error) {
    setSaveStatus("Firebase 불러오기 실패 · 로컬 데이터 유지", "warning");
    if (showToast) toast("Firebase 데이터를 불러오지 못했습니다.");
  }
}

async function saveCloud() {
  if (!state.cloudDb) return;
  try {
    const path = cloudDocumentPath();
    await state.cloudDb.collection(path[0]).doc(path[1]).set({ ...state.data, currentMonth: state.selectedMonth, updatedAt: new Date().toISOString() });
    setSaveStatus("Firebase 저장됨", "ok");
  } catch { setSaveStatus("Firebase 저장 실패 · 로컬 저장됨", "warning"); }
}

function allRecords(monthKey = state.selectedMonth) {
  const ledger = state.data.ledgers[monthKey] || blankLedger();
  const records = listMonthTransactions(monthKey, state.data).map((record) => ({ ...record, kind: "expense", frequency: record.source === "fixedExpense" && !String(record.id).startsWith("tx-") ? "monthly" : "once", paymentLabel: paymentLabel(record.payment) }));
  for (const expense of ledger.expenses || []) {
    if (expense.method === "card") continue;
    const day = String(Math.max(1, Number(expense.day) || 1)).padStart(2, "0");
    records.push({ id: expense.id || `${monthKey}:expense:${records.length}`, sourceTransactionId: expense.id || `${monthKey}:expense:${records.length}`, sourceIndex: (ledger.expenses || []).indexOf(expense), monthKey, date: expense.date || `${monthKey}-${day}`, item: expense.name || "계좌 지출", category: expense.cat || "기타", amount: parseAmount(expense.amount ?? expense.amt), usageOwner: expense.usageOwner || expense.owner || "J", usageOwnerOriginal: expense.usageOwnerOriginal || "", payment: { type: "account", id: expense.acc || expense.ref || "" }, paymentLabel: paymentLabel({ type: "account", id: expense.acc || expense.ref || "" }), source: "accountExpense", kind: "expense", frequency: expense.freq || (String(expense.id || "").startsWith("tx-") ? "once" : "monthly") });
  }
  for (const extra of ledger.extraExpenses || []) {
    const date = extra.freq === "monthly" ? `${monthKey}-${String(Math.max(1, Number(extra.day) || 1)).padStart(2, "0")}` : (extra.date || `${monthKey}-01`);
    if (!date.startsWith(monthKey)) continue;
    const payment = extra.payment || { type: "account", id: extra.acc || "" };
    records.push({ id: extra.id || `${monthKey}:extra:${records.length}`, sourceTransactionId: extra.id || `${monthKey}:extra:${records.length}`, sourceIndex: (ledger.extraExpenses || []).indexOf(extra), monthKey, date, item: extra.name || "기타 지출", category: extra.cat || "기타", amount: parseAmount(extra.amount ?? extra.amt), usageOwner: extra.usageOwner || extra.owner || "J", usageOwnerOriginal: extra.usageOwnerOriginal || "", payment, paymentLabel: paymentLabel(payment), source: "extraExpense", kind: "expense", frequency: extra.freq || "once" });
  }
  for (const rule of state.data.cashflowRules || []) {
    if (rule.kind !== "expense" || !ruleAppliesInMonth(rule, monthKey)) continue;
    const occurrence = ledger.cashflowOccurrences?.[rule.id];
    if (occurrence?.status !== "actual") continue;
    const day = String(Math.min(Number(rule.day) || 1, daysInMonth(monthKey))).padStart(2, "0");
    const payment = rule.payment || { type: "account", id: rule.accountId || "" };
    const id = `${rule.id}@${monthKey}`;
    records.push({ id, sourceTransactionId: id, monthKey, date: `${monthKey}-${day}`, item: rule.name || "정기 지출", category: rule.category || "기타", amount: parseAmount(occurrence.amount ?? rule.amount), ruleAmount: parseAmount(rule.amount), usageOwner: rule.usageOwner || "J", payment, paymentLabel: paymentLabel(payment), source: "cashflowRule", ruleId: rule.id, ruleStartMonth: rule.startMonth || monthKey, kind: "expense", frequency: "monthly" });
  }
  return records.filter((record) => record.amount > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function cashflowRecords(monthKey = state.selectedMonth) {
  const ledger = state.data.ledgers[monthKey] || blankLedger();
  const records = allRecords(monthKey);
  for (const [index, income] of (ledger.incomes || []).entries()) {
    const date = income.date || `${monthKey}-${String(Math.min(Number(income.payDay) || 1, daysInMonth(monthKey))).padStart(2, "0")}`;
    const payment = { type: "account", id: income.acc || "" };
    records.push({ id: income.id || `${monthKey}:income:${index}`, monthKey, date, item: income.name || "정기 수입", category: "수입", amount: parseAmount(income.amount ?? income.amt), usageOwner: income.usageOwner || income.owner || "J", payment, paymentLabel: paymentLabel(payment), source: "legacyIncome", sourceIndex: index, kind: "income", frequency: "monthly" });
  }
  for (const [index, income] of (ledger.extraIncomes || []).entries()) {
    const date = income.freq === "monthly" ? `${monthKey}-${String(Math.min(Number(income.day) || 1, daysInMonth(monthKey))).padStart(2, "0")}` : (income.date || `${monthKey}-01`);
    if (!date.startsWith(monthKey)) continue;
    const payment = { type: "account", id: income.acc || "" };
    records.push({ id: income.id || `${monthKey}:extraIncome:${index}`, monthKey, date, item: income.name || "기타 수입", category: "수입", amount: parseAmount(income.amount ?? income.amt), usageOwner: income.usageOwner || income.owner || "J", payment, paymentLabel: paymentLabel(payment), source: "extraIncome", sourceIndex: index, kind: "income", frequency: income.freq || "once" });
  }
  for (const [index, transfer] of (ledger.transfers || []).entries()) {
    const from = accountById(transfer.from); const to = accountById(transfer.to);
    const day = String(Math.min(Number(transfer.day) || 1, daysInMonth(monthKey))).padStart(2, "0");
    records.push({ id: transfer.id || `${monthKey}:transfer:${index}`, monthKey, date: transfer.date || `${monthKey}-${day}`, item: transfer.name || "계좌 이체", category: "계좌 이체", amount: parseAmount(transfer.amount ?? transfer.amt), usageOwner: "J", paymentLabel: `${from?.name || "출금 계좌 선택"} → ${to?.name || "입금 계좌 선택"}`, source: "transfer", sourceIndex: index, kind: "transfer", frequency: transfer.auto ? "monthly" : "once", fromAccountId: transfer.from || "", toAccountId: transfer.to || "", settlementReviewId: transfer.settlementReviewId || "" });
  }
  for (const rule of state.data.cashflowRules || []) {
    if (!ruleAppliesInMonth(rule, monthKey) || rule.kind === "expense") continue;
    const day = String(Math.min(Number(rule.day) || 1, daysInMonth(monthKey))).padStart(2, "0");
    const id = `${rule.id}@${monthKey}`;
    if (rule.kind === "income") {
      const occurrence = ledger.cashflowOccurrences?.[rule.id];
      const payment = { type: "account", id: rule.accountId || "" };
      records.push({ id, monthKey, date: `${monthKey}-${day}`, item: rule.name || "정기 수입", category: "수입", amount: parseAmount(occurrence?.status === "actual" ? occurrence.amount ?? rule.amount : rule.amount), ruleAmount: parseAmount(rule.amount), usageOwner: rule.usageOwner || "J", payment, paymentLabel: paymentLabel(payment), source: "cashflowRule", ruleId: rule.id, ruleStartMonth: rule.startMonth || monthKey, kind: "income", frequency: "monthly", status: occurrence?.status || "planned" });
    } else {
      const from = accountById(rule.fromAccountId); const to = accountById(rule.toAccountId);
      const occurrence = ledger.cashflowOccurrences?.[rule.id];
      records.push({ id, monthKey, date: `${monthKey}-${day}`, item: rule.name || "정기 이체", category: "계좌 이체", amount: parseAmount(occurrence?.status === "actual" ? occurrence.amount ?? rule.amount : rule.amount), ruleAmount: parseAmount(rule.amount), usageOwner: "J", paymentLabel: `${from?.name || "출금 계좌 선택"} → ${to?.name || "입금 계좌 선택"}`, source: "cashflowRule", ruleId: rule.id, ruleStartMonth: rule.startMonth || monthKey, kind: "transfer", frequency: "monthly", status: occurrence?.status || "planned", fromAccountId: rule.fromAccountId || "", toAccountId: rule.toAccountId || "" });
    }
  }
  for (const rule of state.data.cashflowRules || []) {
    if (rule.kind !== "expense" || !ruleAppliesInMonth(rule, monthKey)) continue;
    const id = `${rule.id}@${monthKey}`;
    const existing = records.find((record) => record.id === id);
    const occurrence = ledger.cashflowOccurrences?.[rule.id];
    const status = occurrence?.status || "planned";
    if (existing) { existing.status = status; existing.ruleAmount = parseAmount(rule.amount); existing.amount = parseAmount(status === "actual" ? occurrence.amount ?? rule.amount : rule.amount); }
    else {
      const day = String(Math.min(Number(rule.day) || 1, daysInMonth(monthKey))).padStart(2, "0");
      const payment = rule.payment || { type: "account", id: rule.accountId || "" };
      records.push({ id, sourceTransactionId: id, monthKey, date: `${monthKey}-${day}`, item: rule.name || "정기 지출", category: rule.category || "기타", amount: parseAmount(status === "actual" ? occurrence.amount ?? rule.amount : rule.amount), ruleAmount: parseAmount(rule.amount), usageOwner: rule.usageOwner || "J", payment, paymentLabel: paymentLabel(payment), source: "cashflowRule", ruleId: rule.id, ruleStartMonth: rule.startMonth || monthKey, kind: "expense", frequency: "monthly", status });
    }
  }
  return records.filter((record) => record.amount > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function daysInMonth(monthKey) { const [year, month] = monthKey.split("-").map(Number); return new Date(year, month, 0).getDate(); }

function monthReviews(monthKey = state.selectedMonth) { return (state.data.settlementReviews || []).filter((item) => item.monthKey === monthKey); }
function pendingReviews(monthKey = state.selectedMonth) { return monthReviews(monthKey).filter((item) => !["confirmed", "excluded"].includes(item.status)); }
function totalExpenses(monthKey = state.selectedMonth) { return allRecords(monthKey).reduce((sum, record) => sum + record.amount, 0); }
function accountTotal() { return (state.data.accounts || []).reduce((sum, account) => sum + parseAmount(account.amt), 0); }

function updateMonthSelects() {
  const months = allMonths();
  for (const id of ["monthSelect", "recordMonthSelect", "analyticsMonthSelect"]) {
    const select = $(id); if (!select) continue;
    const current = id === "recordMonthSelect" ? state.selectedMonth : state.selectedMonth;
    select.innerHTML = months.map((key) => `<option value="${esc(key)}" ${key === current ? "selected" : ""}>${esc(monthLabel(key))}${state.data.ledgers[key]?.closed ? " · 마감" : ""}</option>`).join("");
  }
  $("dashboardPeriod").textContent = monthLabel(state.selectedMonth);
  $("monthCloseTitle").textContent = `${monthLabel(state.selectedMonth)} 월 마감`;
}

function setScreen(screen) {
  state.screen = screen;
  document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("active", el.id === screen));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.openScreen === screen));
  if (screen === "dashboard") renderDashboard();
  if (screen === "records") renderRecords();
  if (screen === "settlements") renderSettlements();
  if (screen === "assets") renderAssets();
  if (screen === "analytics") renderAnalytics();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderKpis() {
  const total = totalExpenses();
  const reviews = pendingReviews().reduce((sum, item) => sum + parseAmount(item.amount), 0);
  const records = allRecords();
  const personalA = records.filter((item) => item.usageOwner === "A").reduce((sum, item) => sum + item.amount, 0);
  const personalB = records.filter((item) => item.usageOwner === "B").reduce((sum, item) => sum + item.amount, 0);
  const boxes = [
    ["관리 자산", fmtShort(accountTotal()), "계좌 잔액 합계", ""],
    ["이번 달 지출", fmtShort(total), `${records.length}건 기록`, ""],
    ["정산 대기", fmtShort(reviews), `${pendingReviews().length}건 확인 필요`, "clickable", "settlements"],
    ["개인 사용", `${fmtShort(personalA + personalB)}`, `${ownerName("A")} ${fmtShort(personalA)} · ${ownerName("B")} ${fmtShort(personalB)}`, ""]
  ];
  $("dashboardKpis").innerHTML = boxes.map(([label, value, note, cls, target]) => `<div class="kpi ${cls}" ${target ? `data-open-screen="${target}" role="button" tabindex="0"` : ""}><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></div>`).join("");
  $("dashboardKpis").querySelectorAll("[data-open-screen]").forEach((el) => { el.addEventListener("click", () => setScreen(el.dataset.openScreen)); el.addEventListener("keydown", (e) => { if (e.key === "Enter") setScreen(el.dataset.openScreen); }); });
}

function chartDefaults() {
  if (!window.Chart) return {};
  Chart.defaults.font.family = "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  return { plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8 } } } };
}
function destroyChart(key) { if (state.charts[key]) { state.charts[key].destroy(); state.charts[key] = null; } }

function renderDashboardCharts() {
  if (!window.Chart) return;
  const records = allRecords();
  const categoryMap = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  records.forEach((record) => { categoryMap[record.category] = (categoryMap[record.category] || 0) + record.amount; });
  const categories = Object.entries(categoryMap).filter(([, value]) => value > 0);
  destroyChart("expense");
  state.charts.expense = new Chart($("chartExpense"), { type: "doughnut", data: { labels: categories.map(([key]) => key), datasets: [{ data: categories.map(([, value]) => value), backgroundColor: COLORS, borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(), borderWidth: 3 }] }, options: { ...chartDefaults(), cutout: "62%", maintainAspectRatio: false, onClick: (_event, elements) => { if (!elements.length) return; const category = categories[elements[0].index][0]; openDetail(`${category} 내역`, records.filter((record) => record.category === category)); } } });

  const personValues = ["A", "B"].map((owner) => records.filter((record) => record.usageOwner === owner).reduce((sum, record) => sum + record.amount, 0) + records.filter((record) => record.usageOwner === "J").reduce((sum, record) => sum + record.amount / 2, 0));
  destroyChart("burden");
  state.charts.burden = new Chart($("chartBurden"), { type: "bar", data: { labels: [ownerName("A"), ownerName("B")], datasets: [{ label: "부담액", data: personValues, backgroundColor: ["#2868d7", "#159e9b"], borderRadius: 6, barThickness: 38 }] }, options: { ...chartDefaults(), maintainAspectRatio: false, plugins: { ...chartDefaults().plugins, legend: { display: false }, tooltip: { callbacks: { label: (ctx) => fmt(ctx.raw) } } }, scales: { y: { beginAtZero: true, ticks: { callback: (value) => fmtShort(value) }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--line").trim() } }, x: { grid: { display: false } } }, onClick: (_event, elements) => { if (!elements.length) return; const owner = elements[0].index === 0 ? "A" : "B"; openDetail(`${ownerName(owner)} 부담 내역`, records.filter((record) => record.usageOwner === owner || record.usageOwner === "J")); } } });
}

function renderDashboard() {
  updateMonthSelects(); renderKpis(); renderDashboardCharts();
  const recent = cashflowRecords().slice(0, 5);
  $("recentList").innerHTML = recent.length ? recent.map(recordHtml).join("") : `<div class="empty">아직 기록이 없습니다.</div>`;
  const pending = pendingReviews();
  $("attentionList").innerHTML = pending.length ? pending.slice(0, 4).map((item) => `<button class="attention-item" type="button" data-settlement-id="${esc(item.id)}"><span>${esc(item.item || "개인 카드 사용")} · ${esc(ownerName(item.payerOwner))}</span><b>${fmt(item.amount)}</b></button>`).join("") : `<div class="empty">확인이 필요한 정산이 없습니다.</div>`;
  $("attentionList").querySelectorAll("[data-settlement-id]").forEach((el) => el.addEventListener("click", () => { setScreen("settlements"); setTimeout(() => document.querySelector(`[data-review-row="${CSS.escape(el.dataset.settlementId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30); }));
}

function recordHtml(record) {
  const auditLabel = record.usageOwnerOriginal ? " · 확인 필요" : "";
  const auditTitle = record.usageOwnerOriginal ? ` title="기존 표기: ${esc(record.usageOwnerOriginal)}"` : "";
  const kind = record.kind || "expense";
  const signs = { expense: "－", income: "＋", transfer: "↔" };
  const labels = { expense: "지출", income: "수입", transfer: "이체" };
  const occurrenceLabel = record.status === "actual" ? " · 완료" : record.status === "skipped" ? " · 건너뜀" : record.source === "cashflowRule" ? " · 예정" : "";
  return `<button class="record-row ${record.status === "skipped" ? "record-skipped" : ""}" type="button" data-record-id="${esc(record.id)}" data-record-kind="${kind}"><div class="record-main"><div class="record-title">${esc(record.item)}</div><div class="record-sub">${esc(record.date)} · ${labels[kind]}${kind === "expense" ? ` · ${esc(record.category)}` : ""}${record.frequency === "monthly" ? " · 매월" : ""}${occurrenceLabel}</div></div><span class="pill ${ownerClass(record.usageOwner)} record-purpose"${auditTitle}>${kind === "transfer" ? "계좌 이동" : `${esc(ownerName(record.usageOwner))}${auditLabel}`}</span><div class="record-meta"><div class="record-sub">${esc(record.paymentLabel || paymentLabel(record.payment))}</div></div><div class="record-amount ${kind}">${signs[kind]}${fmt(record.amount)}</div></button>`;
}

function recordTypeMatches(record, type = state.recordTypeFilter) {
  if (type === "all") return true;
  if (type === "transfer") return record.kind === "transfer";
  if (type === "recurring-income") return record.kind === "income" && record.frequency === "monthly";
  if (type === "recurring-expense") return record.kind === "expense" && record.frequency === "monthly";
  if (type === "once-income") return record.kind === "income" && record.frequency !== "monthly";
  if (type === "once-expense") return record.kind === "expense" && record.frequency !== "monthly";
  return true;
}

function renderRecordTypeTabs(records) {
  for (const [type] of RECORD_TYPES) {
    const tab = document.querySelector(`#recordTypeTabs [data-record-type="${type}"]`);
    if (!tab) continue;
    const count = records.filter((record) => type === "all" || recordTypeMatches(record, type)).length;
    tab.querySelector("[data-type-count]").textContent = String(count);
    const active = state.recordTypeFilter === type;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function renderRecords() {
  ensureCashflowRuleReviews(state.selectedMonth);
  updateMonthSelects();
  const all = cashflowRecords();
  renderRecordTypeTabs(all);
  const typed = all.filter((record) => recordTypeMatches(record));
  const records = typed.filter((record) => state.recordFilter === "all" || state.recordFilter === "settlement" ? (state.recordFilter === "settlement" ? pendingReviews().some((item) => item.sourceTransactionId === (record.sourceTransactionId || record.id)) : true) : record.usageOwner === state.recordFilter);
  const typeLabel = RECORD_TYPES.find(([type]) => type === state.recordTypeFilter)?.[1] || "거래";
  const visibleTotal = records.reduce((sum, record) => sum + parseAmount(record.amount), 0);
  const plannedCount = records.filter((record) => record.status === "planned").length;
  $("recordSummary").textContent = `${monthLabel(state.selectedMonth)} · ${typeLabel} ${records.length}건 · ${fmt(visibleTotal)}${plannedCount ? ` (예정 ${plannedCount}건 포함)` : ""}`;
  $("recordList").setAttribute("role", "tabpanel");
  $("recordList").setAttribute("aria-labelledby", $("recordTypeTabs").querySelector('[aria-selected="true"]')?.id || "recordTabAll");
  $("recordList").innerHTML = records.length ? records.map(recordHtml).join("") : `<div class="empty">이 조건에 맞는 거래가 없습니다.</div>`;
  $("recordList").querySelectorAll("[data-record-id]").forEach((el) => el.addEventListener("click", (event) => { event.stopPropagation(); const record = cashflowRecords().find((item) => String(item.id) === el.dataset.recordId); if (record) openEditEntry(record); }));
  const reviews = pendingReviews();
  const auditCount = state.data.migrationAudit?.usageOwnerUnresolved?.length || 0;
  const importSummary = state.data.migrationAudit?.importSummary;
  const messages = [];
  if (importSummary && !state.data.migrationAudit.importSummaryAcknowledgedAt) {
    messages.push(`기존 데이터 확인: ${importSummary.monthCount}개월 · 계좌 ${importSummary.accountCount}개 · 카드 ${importSummary.cardCount}개 · 대출 ${importSummary.loanCount}건 · 목표 ${importSummary.goalCount}개 · 수입 ${importSummary.incomeCount}건 · 지출 ${importSummary.expenseCount}건 · 카드 내역 ${importSummary.cardTransactionCount}건 · 이체 ${importSummary.transferCount}건`);
    if (importSummary.unmappedLedgerCount) messages.push(`월 형식이 맞지 않아 별도로 보존한 장부 ${importSummary.unmappedLedgerCount}개가 있습니다.`);
  }
  if (reviews.length) messages.push(`${reviews.length}건의 개인 카드 사용 내역이 정산 검토를 기다리고 있습니다. 과거에 이미 이체했다면 정산 화면에서 완료로 표시해주세요.`);
  if (auditCount) messages.push(`과거 사용 목적 표기 ${auditCount}건은 공동으로 임시 분류했습니다. 자산 화면에서 이름을 설정한 뒤 ‘확인 필요’ 항목을 재검토해주세요.`);
  $("migrationNotice").hidden = messages.length === 0;
  if (messages.length) {
    const acknowledgeButton = importSummary && !state.data.migrationAudit.importSummaryAcknowledgedAt
      ? `<br><button class="outline-btn small" id="ackMigrationSummary" type="button">가져온 데이터 확인</button>`
      : "";
    $("migrationNotice").innerHTML = `${messages.map(esc).join("<br>")}${acknowledgeButton}`;
    $("ackMigrationSummary")?.addEventListener("click", () => {
      state.data.migrationAudit.importSummaryAcknowledgedAt = new Date().toISOString();
      queueSave(); renderRecords();
    });
  }
}

function settlementStatusLabel(status) { return status === "confirmed" ? "이체 완료" : status === "excluded" ? "대상 아님" : status === "pending" ? "이체 필요" : "검토 필요"; }
function settlementStatusClass(status) { return status === "confirmed" ? "success" : status === "excluded" ? "neutral" : status === "pending" ? "danger" : "warning"; }
function renderSettlements() {
  updateMonthSelects();
  const reviews = monthReviews();
  const pending = reviews.filter((item) => !["confirmed", "excluded"].includes(item.status));
  const confirmed = reviews.filter((item) => item.status === "confirmed");
  const pendingTotal = pending.reduce((sum, item) => sum + parseAmount(item.amount), 0);
  $("settlementSummary").innerHTML = [["검토 필요", pending.filter((item) => item.status === "review").length, "warning"], ["이체 필요", pending.filter((item) => item.status === "pending").length, "danger"], ["이체 완료", confirmed.length, "success"]].map(([label, value, color]) => `<div class="summary-box"><span class="label">${label}</span><div class="value ${color}">${value}건</div></div>`).join("");
  $("settlementCount").textContent = `${pending.length}건 · ${fmt(pendingTotal)}`;
  $("settlementList").innerHTML = reviews.length ? reviews.sort((a, b) => String(b.date).localeCompare(String(a.date))).map(settlementHtml).join("") : `<div class="empty">이 달에는 정산 항목이 없습니다.</div>`;
  $("settlementList").querySelectorAll("[data-settlement-action]").forEach((button) => button.addEventListener("click", () => updateSettlement(button.dataset.settlementId, button.dataset.settlementAction)));
  $("settlementList").querySelectorAll("[data-settlement-transfer]").forEach((button) => button.addEventListener("click", () => openSettlementTransfer(button.dataset.settlementTransfer)));
  renderMonthClose();
}
function settlementHtml(item) {
  const account = accountById(item.beneficiaryAccountId);
  const linkedTransfer = (state.data.ledgers[item.monthKey]?.transfers || []).find((transfer) => transfer.id === item.transferId || transfer.settlementReviewId === item.id);
  return `<div class="settlement-row ${esc(item.status)}" data-review-row="${esc(item.id)}"><div class="settlement-main"><div class="settlement-title">${esc(item.item || "개인 카드 사용")}</div><div class="settlement-sub">${esc(item.date || item.monthKey)} · ${esc(ownerName(item.payerOwner))} → ${esc(account?.name || "연결 계좌 확인 필요")}${linkedTransfer ? " · 이체 내역 연결됨" : ""}</div></div><div><span class="pill ${settlementStatusClass(item.status)}">${settlementStatusLabel(item.status)}</span><div class="settlement-amount">${fmt(item.amount)}</div></div><div class="row-actions">${item.status === "pending" && !linkedTransfer ? `<button type="button" data-settlement-transfer="${esc(item.id)}">용돈 이체 기록</button>` : ""}${item.status !== "confirmed" ? `<button type="button" data-settlement-id="${esc(item.id)}" data-settlement-action="confirmed">이체 완료로 표시</button>` : ""}${item.status !== "pending" && item.status !== "confirmed" ? `<button type="button" data-settlement-id="${esc(item.id)}" data-settlement-action="pending">이체 필요</button>` : ""}${item.status !== "excluded" ? `<button type="button" data-settlement-id="${esc(item.id)}" data-settlement-action="excluded">대상 아님</button>` : ""}</div></div>`;
}

function openSettlementTransfer(reviewId) {
  const review = (state.data.settlementReviews || []).find((item) => item.id === reviewId);
  if (!review || review.status !== "pending") return;
  if (state.data.ledgers[review.monthKey]?.closed) { toast("마감된 월은 먼저 마감을 해제해주세요."); return; }
  if (!accountById(review.beneficiaryAccountId)) { toast("카드 결제 계좌 설정을 먼저 확인해주세요."); return; }
  const sourceAccounts = (state.data.accounts || []).filter((account) => account.id !== review.beneficiaryAccountId);
  if (!sourceAccounts.length) { toast("정산금을 보낼 출금 계좌를 먼저 추가해주세요."); return; }
  state.selectedMonth = review.monthKey;
  state.recordFilter = "all";
  state.recordTypeFilter = "transfer";
  openQuickEntry();
  $("entryKind").value = "transfer";
  $("entryFrequency").value = "once";
  $("entryAmount").value = inputNumber(review.amount);
  $("entryItem").value = `개인 사용 정산 · ${review.item || "카드 사용"}`;
  $("entryDate").value = dateInSelectedMonth();
  const ownedAccounts = sourceAccounts.filter((account) => String(account.owner) === String(review.payerOwner));
  const preferredSource = ownedAccounts.find((account) => account.isAllowance || account.fundingType === "privateAllowance" || String(account.type || "").includes("용돈")) || ownedAccounts[0];
  fillEntryOptions("transfer", preferredSource?.id || sourceAccounts[0].id, review.beneficiaryAccountId);
  $("entryTransferTo").value = review.beneficiaryAccountId;
  updateEntryFields();
  state.settlementTransferId = review.id;
  updateEntryPreview();
  toast("용돈에서 실제로 출금할 계좌를 확인한 뒤 이체를 기록해주세요.");
}

function updateSettlement(id, status) {
  const item = (state.data.settlementReviews || []).find((review) => review.id === id);
  if (!item) return;
  item.status = status; item.confirmedAt = status === "confirmed" ? new Date().toISOString() : null;
  queueSave(); renderAll(); toast(status === "confirmed" ? "이체 완료로 표시했습니다." : "정산 상태를 변경했습니다.");
}

function renderMonthClose() {
  const ledger = currentLedger();
  const closed = !!ledger.closed;
  $("monthCloseState").textContent = closed ? "마감 완료" : "진행 중";
  $("monthCloseState").className = `pill ${closed ? "success" : "warning"}`;
  $("monthCloseBody").innerHTML = closed ? `<p class="month-close-copy">${esc(monthLabel(state.selectedMonth))}은 마감 당시의 스냅샷으로 보존됩니다. 새 카드 설정은 이 월의 결과에 영향을 주지 않습니다.</p><button class="outline-btn small" id="reopenMonthBtn" type="button">마감 해제</button>` : `<p class="month-close-copy">정산 검토 ${pendingReviews().length}건을 확인한 뒤 이 달의 결과를 고정할 수 있습니다. 마감 후에는 거래가 읽기 전용이 됩니다.</p><button class="primary-btn small" id="closeSelectedMonthBtn" type="button">${esc(monthLabel(state.selectedMonth))} 마감하기</button>`;
  $("closeSelectedMonthBtn")?.addEventListener("click", () => closeMonth(state.selectedMonth));
  $("reopenMonthBtn")?.addEventListener("click", () => reopenMonth(state.selectedMonth));
}
function closeMonth(monthKey) {
  const ledger = state.data.ledgers[monthKey];
  if (!ledger || ledger.closed) return;
  if (pendingReviews(monthKey).some((item) => item.status === "review")) { toast("검토 필요 항목을 먼저 확인해주세요."); setScreen("settlements"); return; }
  ledger.closeSnapshot = createCloseSnapshot(monthKey, state.data);
  ledger.closed = true;
  queueSave(); renderAll(); toast(`${monthLabel(monthKey)}을 마감했습니다.`);
}
function reopenMonth(monthKey) {
  if (!confirm(`${monthLabel(monthKey)} 마감을 해제할까요? 기존 스냅샷은 보존됩니다.`)) return;
  state.data.ledgers[monthKey].closed = false;
  queueSave(); renderAll(); toast("마감을 해제했습니다. 필요한 항목을 다시 확인해주세요.");
}

function renderAssets() {
  syncPeopleInputs();
  const accounts = state.data.accounts || [];
  $("accountTotal").textContent = fmt(accountTotal());
  $("accountList").innerHTML = accounts.length ? accounts.map((account) => `<div class="asset-row"><div class="asset-icon">▣</div><div class="asset-main"><div class="asset-title">${esc(account.name || "이름 없는 계좌")}</div><div class="asset-sub">${esc(ownerName(account.owner))} · ${esc(account.type || "예금")}</div></div><div class="asset-total">${fmt(account.amt)}</div></div>`).join("") : `<div class="empty">관리할 계좌를 추가해주세요.</div>`;
  const cards = state.data.cards || [];
  $("cardList").innerHTML = cards.length ? cards.map((card) => { const accountOptions = accounts.map((account) => `<option value="${esc(account.id)}" ${String(card.fundingAccountId || card.acc || "") === String(account.id) ? "selected" : ""}>${esc(account.name)}</option>`).join(""); const fundingType = card.fundingType || (card.isAllowance ? "privateAllowance" : "managed"); return `<div class="asset-row card-setting-row"><div class="asset-icon">▰</div><div class="asset-main"><div class="asset-title">${esc(card.name || "이름 없는 카드")}</div><div class="asset-sub">${esc(ownerName(card.owner))} · <span class="pill ${fundingType === "privateAllowance" ? "success" : "neutral"}">${fundingType === "privateAllowance" ? "용돈 카드" : "관리 카드"}</span></div></div><div class="card-controls"><select data-card-id="${esc(card.id)}" data-card-key="fundingType" aria-label="카드 자금 성격"><option value="managed" ${fundingType === "managed" ? "selected" : ""}>관리 계좌</option><option value="privateAllowance" ${fundingType === "privateAllowance" ? "selected" : ""}>비공개 용돈</option><option value="external" ${fundingType === "external" ? "selected" : ""}>외부 계좌</option></select><select data-card-id="${esc(card.id)}" data-card-key="owner" aria-label="카드 소유자"><option value="A" ${card.owner === "A" ? "selected" : ""}>${esc(ownerName("A"))}</option><option value="B" ${card.owner === "B" ? "selected" : ""}>${esc(ownerName("B"))}</option></select>${fundingType === "managed" ? `<select data-card-id="${esc(card.id)}" data-card-key="fundingAccountId" aria-label="연결 계좌"><option value="">연결 계좌 선택</option>${accountOptions}</select>` : ""}<button type="button" data-card-delete="${esc(card.id)}" aria-label="카드 삭제">×</button></div></div>`; }).join("") : `<div class="empty">카드를 추가해주세요.</div>`;
  $("cardList").querySelectorAll("[data-card-key]").forEach((control) => control.addEventListener("change", () => { const card = cardById(control.dataset.cardId); if (!card) return; card[control.dataset.cardKey] = control.value; if (control.dataset.cardKey === "fundingType" && control.value === "privateAllowance") card.allowanceOwner = card.owner; queueSave(); renderAssets(); renderRecords(); toast("카드 설정을 저장했습니다."); }));
  $("cardList").querySelectorAll("[data-card-delete]").forEach((button) => button.addEventListener("click", () => { state.data.cards = state.data.cards.filter((card) => card.id !== button.dataset.cardDelete); queueSave(); renderAssets(); toast("카드를 삭제했습니다."); }));
  renderLoansAndGoals();
  renderHousing();
  renderHousingCashFlows();
  if (state.housingCalculated) renderHousingResults(false);
}

function renderLoansAndGoals() {
  const loans = state.data.loans || [];
  $("loanList").innerHTML = loans.length ? loans.map((loan) => `<div class="asset-row"><div class="asset-icon">−</div><div class="asset-main"><div class="asset-title">${esc(loan.name || "대출")}</div><div class="asset-sub">${esc(ownerName(loan.owner || "J"))} · ${esc(loan.repay || "상환 방식 미설정")} · ${loan.rate ? `${esc(loan.rate)}%` : "금리 미설정"}</div></div><div class="asset-total">${fmt(loan.remain ?? loan.principal ?? 0)}</div></div>`).join("") : `<div class="empty">등록된 대출이 없습니다.</div>`;
  const goals = state.data.goals || [];
  $("goalList").innerHTML = goals.length ? goals.map((goal) => { const target = parseAmount(goal.target); const saved = parseAmount(goal.saved); const percent = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0; return `<div class="asset-row"><div class="asset-icon">◎</div><div class="asset-main"><div class="asset-title">${esc(goal.name || "공동 목표")}</div><div class="asset-sub">${goal.date ? esc(goal.date) : "목표일 미설정"} · ${percent}% 달성</div></div><div class="asset-total">${fmt(saved)} / ${fmt(target)}</div></div>`; }).join("") : `<div class="empty">등록된 목표가 없습니다.</div>`;
}

function renderHousing() {
  const houses = [
    { prefix: "A", name: state.data.houseA || "주택 A", owner: state.data.houseAOwner || "J", budget: parseAmount(state.data.budgetA), value: parseAmount(state.data.houseAValue) },
    { prefix: "B", name: state.data.houseB || "주택 B", owner: state.data.houseBOwner || "J", budget: parseAmount(state.data.budgetB), value: parseAmount(state.data.houseBValue) }
  ];
  $("houseList").innerHTML = houses.map((house) => `<div class="house-card"><h4>⌂ ${esc(house.name)}</h4><label>주택 이름<input data-house-key="house${house.prefix}" value="${esc(house.name)}"></label><label>담당자<select data-house-key="house${house.prefix}Owner"><option value="J" ${house.owner === "J" ? "selected" : ""}>공동</option><option value="A" ${house.owner === "A" ? "selected" : ""}>${esc(ownerName("A"))}</option><option value="B" ${house.owner === "B" ? "selected" : ""}>${esc(ownerName("B"))}</option></select></label><label>보유 예산<input data-house-key="budget${house.prefix}" inputmode="numeric" value="${inputNumber(house.budget)}"></label><label>현재 자산가치<input data-house-key="house${house.prefix}Value" inputmode="numeric" value="${inputNumber(house.value)}"></label></div>`).join("");
  $("houseList").querySelectorAll("[data-house-key]").forEach((control) => control.addEventListener("change", () => { const key = control.dataset.houseKey; state.data[key] = /^(budget|house.*Value)$/.test(key) ? parseAmount(control.value) : control.value; queueSave(); renderHousing(); renderHousingCashFlows(); }));
}

function housingEntries(prefix) {
  const key = prefix === "A" ? "cfA" : "cfB";
  if (!Array.isArray(state.data[key])) state.data[key] = [];
  return state.data[key];
}

function renderHousingCashFlows() {
  for (const prefix of ["A", "B"]) {
    const list = housingEntries(prefix);
    const box = $(`cfList${prefix}`);
    $(`houseFlowTitle${prefix}`).textContent = state.data[`house${prefix}`] || `주택 ${prefix}`;
    box.innerHTML = list.length ? list.map((entry, index) => `<div class="housing-entry"><input type="date" data-house-entry="${prefix}" data-index="${index}" data-key="date" value="${esc(entry.date || TODAY)}" aria-label="주택 ${prefix} 자금 날짜"><input type="text" data-house-entry="${prefix}" data-index="${index}" data-key="label" value="${esc(entry.label || "항목")}" placeholder="항목" aria-label="주택 ${prefix} 자금 항목"><input class="entry-amount" type="text" inputmode="numeric" data-house-entry="${prefix}" data-index="${index}" data-key="amt" value="${inputNumber(entry.amt)}" placeholder="금액" aria-label="주택 ${prefix} 자금 금액"><button class="delete-entry" type="button" data-house-delete="${prefix}" data-index="${index}" aria-label="항목 삭제">×</button></div>`).join("") : `<div class="housing-empty">아직 입력된 자금 흐름이 없습니다.</div>`;
    box.querySelectorAll("[data-house-entry]").forEach((control) => control.addEventListener("input", () => {
      const entry = housingEntries(control.dataset.houseEntry)[Number(control.dataset.index)]; if (!entry) return;
      entry[control.dataset.key] = control.dataset.key === "amt" ? parseAmount(control.value) : control.value;
      if (control.dataset.key === "amt") control.value = inputNumber(entry.amt);
      queueSave();
    }));
    box.querySelectorAll("[data-house-delete]").forEach((button) => button.addEventListener("click", () => { housingEntries(button.dataset.houseDelete).splice(Number(button.dataset.index), 1); queueSave(); renderHousingCashFlows(); }));
  }
}

function addHousingEntry(prefix) {
  const list = housingEntries(prefix);
  list.push({ date: TODAY, label: "새 항목", amt: 0 });
  list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  queueSave(); renderHousingCashFlows();
}

function housingLedgerHtml(ledger, budget) {
  let html = `<table><thead><tr><th>날짜</th><th>항목</th><th>금액</th><th>잔여예산</th></tr></thead><tbody><tr><td>${esc(TODAY)}</td><td>보유 예산</td><td>—</td><td><b>${fmtShort(budget)}</b></td></tr>`;
  for (const row of ledger.rows) {
    const amountText = `${row.amt >= 0 ? "＋" : "－"}${fmtShort(Math.abs(row.amt))}`;
    html += row.up ? `<tr><td>${esc(row.date)}</td><td>${esc(row.label)} <span class="pill warning">예정</span></td><td style="color:${row.amt < 0 ? "var(--danger)" : "var(--positive)"};font-weight:750">${amountText}</td><td style="font-weight:800;color:${row.bal < 0 ? "var(--danger)" : "inherit"}">${fmtShort(row.bal)}</td></tr>` : `<tr class="past-row"><td>${esc(row.date)}</td><td>${esc(row.label)} <span class="pill neutral">완료</span></td><td>${amountText}</td><td>반영됨</td></tr>`;
  }
  return `${html}</tbody></table>`;
}

function renderHousingResults(scroll = false) {
  const budgetA = parseAmount(state.data.budgetA); const budgetB = parseAmount(state.data.budgetB);
  const ledgerA = calculateHousingLedger(budgetA, housingEntries("A"), TODAY); const ledgerB = calculateHousingLedger(budgetB, housingEntries("B"), TODAY);
  $("housingResults").hidden = false;
  $("resultHouseA").textContent = state.data.houseA || "주택 A"; $("resultHouseB").textContent = state.data.houseB || "주택 B";
  const setBalance = (valueId, descId, result, budget) => { const value = $(valueId); value.textContent = fmtShort(result.final); value.style.color = result.final < 0 ? "var(--danger)" : "var(--positive)"; $(descId).textContent = `${result.final < 0 ? `부족액 ${fmt(Math.abs(result.final))}` : `여유 ${fmt(result.final)}`} · 시작예산 ${fmtShort(budget)}`; };
  setBalance("resultBalanceA", "resultBalanceADesc", ledgerA, budgetA); setBalance("resultBalanceB", "resultBalanceBDesc", ledgerB, budgetB);
  $("housingLedgerA").innerHTML = housingLedgerHtml(ledgerA, budgetA); $("housingLedgerB").innerHTML = housingLedgerHtml(ledgerB, budgetB);
  if (window.Chart) {
    const series = buildHousingSeries(ledgerA, ledgerB); destroyChart("house");
    state.charts.house = new Chart($("houseFlowChart"), { type: "line", data: { labels: ["오늘", ...series.dates], datasets: [{ label: `${state.data.nameA || "나"} · ${state.data.houseA || "주택 A"}`, data: [budgetA, ...series.a], borderColor: "#2868d7", backgroundColor: "rgba(40,104,215,.12)", fill: true, tension: .25 }, { label: `${state.data.nameB || "상대방"} · ${state.data.houseB || "주택 B"}`, data: [budgetB, ...series.b], borderColor: "#159e9b", backgroundColor: "rgba(21,158,155,.12)", fill: true, tension: .25 }] }, options: { ...chartDefaults(), maintainAspectRatio: false, scales: { y: { ticks: { callback: (value) => fmtShort(value) }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--line").trim() } }, x: { grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--line").trim() } } }, plugins: { ...chartDefaults().plugins, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${fmt(context.raw)}` } } } } });
  }
  if (scroll) $("housingResults").scrollIntoView({ behavior: "smooth", block: "start" });
}

function calculateHousing() { state.housingCalculated = true; renderHousingResults(true); queueSave(); toast("주택 자금 흐름을 계산했습니다."); }

function addAccount() {
  const name = prompt("계좌 이름을 입력하세요.", "생활비 계좌"); if (!name) return;
  const owner = prompt(`소유자를 입력하세요. A=${ownerName("A")}, B=${ownerName("B")}`, "A").toUpperCase() === "B" ? "B" : "A";
  const value = prompt("현재 잔액을 입력하세요.", "0");
  state.data.accounts.push({ id: `acc-${Date.now().toString(36)}`, owner, name, type: "예금", amt: parseAmount(value) });
  queueSave(); renderAll(); toast("계좌를 추가했습니다.");
}
function addCard() {
  const name = prompt("카드 이름을 입력하세요.", "새 카드"); if (!name) return;
  const owner = prompt(`소유자를 입력하세요. A=${ownerName("A")}, B=${ownerName("B")}`, "A").toUpperCase() === "B" ? "B" : "A";
  state.data.cards.push({ id: `card-${Date.now().toString(36)}`, owner, name, kind: "신용", fundingType: "managed", fundingAccountId: state.data.accounts.find((account) => account.owner === owner)?.id || "", payDay: 15 });
  queueSave(); renderAll(); toast("카드를 추가했습니다.");
}
function addLoan() {
  const name = prompt("대출 이름을 입력하세요.", "주택담보대출"); if (!name) return;
  const principal = prompt("대출 원금을 입력하세요.", "0");
  const owner = prompt(`명의를 입력하세요. A=${ownerName("A")}, B=${ownerName("B")}, J=공동`, "J").toUpperCase();
  state.data.loans.push({ id: `loan-${Date.now().toString(36)}`, name, owner: owner === "A" || owner === "B" ? owner : "J", principal: parseAmount(principal), remain: parseAmount(principal), rate: 0, repay: "eq" });
  queueSave(); renderAll(); toast("대출을 추가했습니다.");
}
function addGoal() {
  const name = prompt("목표 이름을 입력하세요.", "여행 자금"); if (!name) return;
  const target = prompt("목표 금액을 입력하세요.", "0");
  state.data.goals.push({ id: `goal-${Date.now().toString(36)}`, name, target: parseAmount(target), saved: 0, date: "", accIds: [] });
  queueSave(); renderAll(); toast("목표를 추가했습니다.");
}

function entryAccountOptions(selected = "") {
  const accounts = state.data.accounts || [];
  return accounts.length ? accounts.map((account) => `<option value="${esc(account.id)}" ${String(account.id) === String(selected) ? "selected" : ""}>계좌 · ${esc(account.name)} · ${esc(ownerName(account.owner))}</option>`).join("") : `<option value="">계좌를 먼저 추가하세요</option>`;
}

function fillEntryOptions(kind, selectedPayment = "", selectedTo = "") {
  const options = [];
  if (kind === "expense") {
    for (const card of state.data.cards || []) options.push({ value: `card:${card.id}`, label: `카드 · ${card.name} · ${ownerName(card.owner)}` });
    for (const account of state.data.accounts || []) options.push({ value: `account:${account.id}`, label: `계좌 · ${account.name} · ${ownerName(account.owner)}` });
  } else if (kind === "income") {
    for (const account of state.data.accounts || []) options.push({ value: account.id, label: `입금 계좌 · ${account.name} · ${ownerName(account.owner)}` });
  } else {
    for (const account of state.data.accounts || []) options.push({ value: account.id, label: `출금 · ${account.name} · ${ownerName(account.owner)}` });
  }
  const payment = $("entryPayment");
  payment.innerHTML = options.length ? options.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("") : `<option value="">${kind === "expense" ? "계좌 또는 카드를 먼저 추가하세요" : "계좌를 먼저 추가하세요"}</option>`;
  if (options.some((item) => item.value === String(selectedPayment))) payment.value = String(selectedPayment);
  if (kind === "transfer") {
    const source = payment.value;
    $("entryTransferTo").innerHTML = state.data.accounts?.length ? state.data.accounts.map((account) => `<option value="${esc(account.id)}" ${String(account.id) === String(selectedTo) ? "selected" : ""}>입금 · ${esc(account.name)} · ${esc(ownerName(account.owner))}</option>`).join("") : `<option value="">계좌를 먼저 추가하세요</option>`;
    if (selectedTo && state.data.accounts.some((account) => String(account.id) === String(selectedTo))) $("entryTransferTo").value = String(selectedTo);
    if (!$("entryTransferTo").value || $("entryTransferTo").value === source) {
      const alternative = [...(state.data.accounts || [])].find((account) => String(account.id) !== source);
      if (alternative) $("entryTransferTo").value = String(alternative.id);
    }
  }
}

function updateEntryFields() {
  const kind = $("entryKind").value;
  const monthly = $("entryFrequency").value === "monthly";
  $("entryDateField").hidden = monthly;
  $("entryDayField").hidden = !monthly;
  $("entryCategoryField").hidden = kind !== "expense";
  $("entryTransferToField").hidden = kind !== "transfer";
  $("entryPurposeField").hidden = kind === "transfer";
  $("entryPaymentLabel").textContent = kind === "income" ? "입금 계좌" : kind === "transfer" ? "보내는 계좌" : "결제 수단";
  $("entryPurposeLegend").textContent = kind === "income" ? "누구의 수입인가요?" : "누구를 위한 지출인가요?";
  fillEntryOptions(kind, $("entryPayment").value, $("entryTransferTo").value);
  $("entryDialogTitle").textContent = state.editingRecord ? "거래 수정" : `${kind === "expense" ? "지출" : kind === "income" ? "수입" : "계좌 이체"} ${monthly ? "정기 항목" : "기록"}`;
  updateEntryPreview();
}

function dateInSelectedMonth() {
  const day = Math.min(Number(TODAY.slice(-2)) || 1, daysInMonth(state.selectedMonth));
  return `${state.selectedMonth}-${String(day).padStart(2, "0")}`;
}

function openQuickEntry() {
  state.settlementTransferId = null;
  state.editingRecord = null;
  $("quickEntryForm").reset();
  $("entryKind").disabled = false; $("entryFrequency").disabled = false;
  $("entryOccurrenceActions").hidden = true; $("entryOccurrenceActions").innerHTML = "";
  $("deleteEntryBtn").hidden = true; $("saveEntryBtn").textContent = "저장";
  $("entryDate").value = dateInSelectedMonth(); $("entryDay").value = Number(dateInSelectedMonth().slice(-2));
  $("entryAmount").value = ""; $("entryItem").value = ""; $("entryCategory").value = "식비";
  document.querySelector('input[name="usageOwner"][value="J"]').checked = true;
  updateEntryFields(); $("quickEntry").showModal(); setTimeout(() => $("entryAmount").focus(), 30);
}

function openEditEntry(record) {
  state.editingRecord = deepClone(record);
  $("entryKind").value = record.kind || "expense";
  $("entryFrequency").value = record.frequency || "once";
  $("entryKind").disabled = true; $("entryFrequency").disabled = true;
  $("entryAmount").value = inputNumber(record.ruleAmount ?? record.amount); $("entryItem").value = record.item || "";
  $("entryCategory").value = CATEGORIES.includes(record.category) ? record.category : "기타";
  $("entryDate").value = record.date || dateInSelectedMonth();
  $("entryDay").value = Number(String(record.date || "").slice(-2)) || 1;
  const selected = record.kind === "transfer" ? record.fromAccountId : record.kind === "income" ? record.payment?.id : `${record.payment?.type || "account"}:${record.payment?.id || ""}`;
  fillEntryOptions(record.kind || "expense", selected, record.toAccountId || "");
  const owner = ["A", "B", "J"].includes(record.usageOwner) ? record.usageOwner : "J";
  document.querySelector(`input[name="usageOwner"][value="${owner}"]`).checked = true;
  $("deleteEntryBtn").hidden = false; $("saveEntryBtn").textContent = "수정 저장";
  const occurrenceActions = $("entryOccurrenceActions");
  occurrenceActions.hidden = record.source !== "cashflowRule";
  if (record.source === "cashflowRule") {
    const status = state.data.ledgers[record.monthKey]?.cashflowOccurrences?.[record.ruleId]?.status || "planned";
    const occurrenceAmount = state.data.ledgers[record.monthKey]?.cashflowOccurrences?.[record.ruleId]?.amount ?? record.amount;
    occurrenceActions.innerHTML = `<div><b>${esc(monthLabel(record.monthKey))} 회차</b><span>${status === "actual" ? "완료로 처리됨 · 실제 금액을 수정할 수 있습니다." : status === "skipped" ? "이번 달은 건너뜀" : "예정 금액을 확인하고 실제 처리 또는 건너뛰기를 선택해주세요."}</span><label class="occurrence-amount">실제 금액<input id="entryOccurrenceAmount" type="number" min="1" step="1" inputmode="numeric" value="${esc(occurrenceAmount)}"></label></div><div class="occurrence-buttons">${status === "skipped" ? `<button type="button" data-occurrence-status="planned">건너뛰기 취소</button>` : `<button type="button" data-occurrence-status="actual">${status === "actual" ? "실제 금액 저장" : "실제 처리 완료"}</button>${status === "planned" ? `<button type="button" data-occurrence-status="skipped">이번 달 건너뛰기</button>` : `<button type="button" data-occurrence-status="planned">완료 취소</button>`}`}</div>`;
  } else occurrenceActions.innerHTML = "";
  updateEntryFields(); $("quickEntry").showModal(); setTimeout(() => $("entryAmount").focus(), 30);
}

function setOccurrenceStatus(status) {
  const record = state.editingRecord;
  if (!record || record.source !== "cashflowRule") return;
  const ledger = ensureLedger(record.monthKey);
  if (ledger.closed) { toast("마감된 월은 먼저 마감을 해제해주세요."); return; }
  if (!ledger.cashflowOccurrences || typeof ledger.cashflowOccurrences !== "object") ledger.cashflowOccurrences = {};
  if (status === "planned") delete ledger.cashflowOccurrences[record.ruleId];
  else {
    const amount = parseAmount($("entryOccurrenceAmount")?.value);
    if (status === "actual" && amount <= 0) { toast("실제 처리 금액을 입력해주세요."); return; }
    ledger.cashflowOccurrences[record.ruleId] = { status, ...(status === "actual" ? { amount } : {}), updatedAt: new Date().toISOString() };
  }
  $("quickEntry").close(); state.editingRecord = null; queueSave(); renderAll();
  toast(status === "actual" ? "이번 달 항목을 실제 처리로 표시했습니다." : status === "skipped" ? "이번 달 항목을 건너뛰기로 표시했습니다." : "이번 달 항목을 예정으로 되돌렸습니다.");
}

function updateEntryPreview() {
  const amountValue = parseAmount($("entryAmount").value);
  const kind = $("entryKind").value;
  const preview = $("entryPreview"); preview.className = "entry-preview";
  if (!amountValue) { preview.textContent = "유형과 계좌를 선택하면 거래 처리 방법을 안내합니다."; return; }
  if (kind === "income") { preview.textContent = $("entryPayment").value ? `${paymentLabel({ type: "account", id: $("entryPayment").value })}에 수입을 기록합니다.` : "수입이 입금될 계좌를 선택해주세요."; preview.classList.add("good"); return; }
  if (kind === "transfer") {
    const from = accountById($("entryPayment").value); const to = accountById($("entryTransferTo").value);
    if (!from || !to || from.id === to.id) { preview.textContent = "서로 다른 출금 계좌와 입금 계좌를 선택해주세요."; preview.classList.add("warn"); return; }
    preview.textContent = `${from.name}에서 ${to.name}(으)로 ${fmt(amountValue)} 이체를 기록합니다.`; preview.classList.add("good"); return;
  }
  const payment = paymentFromValue($("entryPayment").value);
  const usageOwner = document.querySelector('input[name="usageOwner"]:checked')?.value || "J";
  const result = deriveSettlementForTransaction({ amount: amountValue, usageOwner, payment }, state.data.cards, state.data.accounts);
  if (result.kind === "joint") { preview.textContent = "공동 생활비 지출로 기록됩니다."; preview.classList.add("good"); return; }
  if (result.kind === "coveredByAllowance") { preview.textContent = `${ownerName(usageOwner)}의 비공개 용돈으로 처리됩니다. 별도 이체가 필요하지 않습니다.`; preview.classList.add("good"); return; }
  if (result.kind === "reimburse") { preview.textContent = `${ownerName(usageOwner)}의 개인 지출입니다. 연결 계좌로 ${fmt(result.amount)} 이체할 항목이 생깁니다.`; preview.classList.add("warn"); return; }
  preview.textContent = "카드의 연결 계좌 또는 용돈 여부를 자산 화면에서 설정해주세요."; preview.classList.add("warn");
}

function ensureLedger(monthKey) {
  if (!state.data.ledgers[monthKey]) state.data.ledgers[monthKey] = blankLedger();
  if (!state.data.months.includes(monthKey)) state.data.months.push(monthKey);
  state.data.months.sort();
  return state.data.ledgers[monthKey];
}

function syncSettlementForExpense(tx, monthKey, forceReview = false) {
  const result = deriveSettlementForTransaction(tx, state.data.cards, state.data.accounts);
  const reviews = state.data.settlementReviews || (state.data.settlementReviews = []);
  const index = reviews.findIndex((item) => item.sourceTransactionId === tx.id);
  if (result.kind !== "reimburse") {
    if (index >= 0 && reviews[index].status !== "confirmed") reviews.splice(index, 1);
    return result;
  }
  const existing = index >= 0 ? reviews[index] : null;
  const review = { ...(existing || {}), id: existing?.id || `settlement:${tx.id}`, sourceTransactionId: tx.id, monthKey, payerOwner: result.payerOwner, beneficiaryAccountId: result.beneficiaryAccountId, amount: result.amount, status: forceReview ? "review" : (existing?.status || "pending"), source: tx.source || existing?.source || "cashflow", item: tx.item, date: tx.date, category: tx.category, createdAt: existing?.createdAt || new Date().toISOString() };
  if (index >= 0) reviews[index] = review; else reviews.push(review);
  return result;
}

function ensureCashflowRuleReviews(monthKey) {
  const monthLedger = state.data.ledgers[monthKey];
  if (monthLedger?.closed) return;
  const eligible = new Set();
  for (const rule of state.data.cashflowRules || []) {
    if (rule.kind !== "expense" || !ruleAppliesInMonth(rule, monthKey) || monthLedger?.cashflowOccurrences?.[rule.id]?.status !== "actual") continue;
    const id = `${rule.id}@${monthKey}`;
    if (rule.payment?.type !== "card") continue;
    eligible.add(id);
    const day = String(Math.min(Number(rule.day) || 1, daysInMonth(monthKey))).padStart(2, "0");
    const occurrenceAmount = monthLedger.cashflowOccurrences?.[rule.id]?.amount ?? rule.amount;
    syncSettlementForExpense({ id, source: "cashflowRule", amount: parseAmount(occurrenceAmount), usageOwner: rule.usageOwner || "J", payment: rule.payment, item: rule.name, date: `${monthKey}-${day}`, category: rule.category || "기타" }, monthKey);
  }
  state.data.settlementReviews = (state.data.settlementReviews || []).filter((item) => item.source !== "cashflowRule" || item.monthKey !== monthKey || eligible.has(item.sourceTransactionId));
}

function findCollectionRecord(record) {
  const ledger = state.data.ledgers[record.monthKey]; if (!ledger) return null;
  const collectionName = ({ legacyIncome: "incomes", extraIncome: "extraIncomes", extraExpense: "extraExpenses", accountExpense: "expenses", transfer: "transfers", cardTxn: "cardTxns", fixedExpense: "expenses" })[record.source];
  if (!collectionName) return null;
  const collection = ledger[collectionName] || [];
  let index = collection.findIndex((item) => String(item.id || "") === String(record.id));
  if (index < 0 && Number.isInteger(record.sourceIndex)) index = record.sourceIndex;
  if (index < 0 && record.source === "cardTxn") index = Number(String(record.id).split(":card:").at(-1));
  if (index < 0 && record.source === "fixedExpense") index = (ledger.cardTxns || []).filter((item) => parseAmount(item.amount ?? item.amt) > 0).length + (ledger.expenses || []).filter((item) => item.method === "card").findIndex((item) => String(item.id || "") === String(record.id));
  return index >= 0 && index < collection.length ? { collection, index, item: collection[index], collectionName, ledger } : null;
}

function clearOwnerAudit(record) {
  if (!record.usageOwnerOriginal) return;
  const auditSource = record.source === "cardTxn" ? "cardTxn" : ["accountExpense", "fixedExpense"].includes(record.source) ? "expense" : record.source;
  const ids = new Set([String(record.id)]);
  const ledger = state.data.ledgers[record.monthKey];
  if (auditSource === "expense" && ledger) {
    const index = (ledger.expenses || []).findIndex((item) => String(item.id || "") === String(record.id));
    if (index >= 0) ids.add(`${record.monthKey}:expense:${index}`);
  }
  const audits = state.data.migrationAudit?.usageOwnerUnresolved || [];
  const matches = audits.filter((item) => item.source === auditSource && item.monthKey === record.monthKey && item.original === record.usageOwnerOriginal);
  state.data.migrationAudit.usageOwnerUnresolved = audits.filter((item) => !(
    item.source === auditSource && item.monthKey === record.monthKey && item.original === record.usageOwnerOriginal && (ids.has(String(item.sourceId)) || matches.length === 1)
  ));
  if (ledger) for (const collection of [ledger.incomes, ledger.expenses, ledger.extraIncomes, ledger.extraExpenses, ledger.cardTxns, ledger.transfers]) {
    for (const item of collection || []) if (String(item.id || "") === String(record.id)) delete item.usageOwnerOriginal;
  }
}

function removeRuleOccurrences(ruleId, fromMonth = "0000-00") {
  for (const [monthKey, ledger] of Object.entries(state.data.ledgers || {})) {
    if (monthKey >= fromMonth && ledger.cashflowOccurrences) delete ledger.cashflowOccurrences[ruleId];
  }
  state.data.settlementReviews = (state.data.settlementReviews || []).filter((item) => !(item.source === "cashflowRule" && String(item.sourceTransactionId).startsWith(`${ruleId}@`) && item.monthKey >= fromMonth));
}

function saveEditedRecord(record, fields) {
  if (record.source === "cashflowRule") {
    const ruleIndex = (state.data.cashflowRules || []).findIndex((item) => item.id === record.ruleId);
    const rule = state.data.cashflowRules[ruleIndex];
    if (!rule) return false;
    let activeRule = rule;
    if (record.monthKey > (rule.startMonth || record.monthKey)) {
      const prior = { ...rule, endMonth: previousMonthKey(record.monthKey) };
      const next = { ...rule, ...fields.rule, id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, startMonth: record.monthKey, endMonth: rule.endMonth || "" };
      state.data.cashflowRules.splice(ruleIndex, 1, prior, next);
      for (const [monthKey, ledger] of Object.entries(state.data.ledgers || {})) {
        if (monthKey < record.monthKey) continue;
        const occurrence = ledger.cashflowOccurrences?.[rule.id];
        if (occurrence) {
          ledger.cashflowOccurrences[next.id] = occurrence;
          delete ledger.cashflowOccurrences[rule.id];
        }
      }
      state.data.settlementReviews = (state.data.settlementReviews || []).map((review) => {
        const prefix = `${rule.id}@`;
        if (review.source !== "cashflowRule" || !String(review.sourceTransactionId).startsWith(prefix) || review.monthKey < record.monthKey) return review;
        const sourceTransactionId = `${next.id}@${review.monthKey}`;
        return { ...review, id: `settlement:${sourceTransactionId}`, sourceTransactionId, status: "review" };
      });
      activeRule = next;
    } else Object.assign(rule, fields.rule);
    if (activeRule.kind === "expense" && activeRule.payment?.type === "card") {
      const id = `${activeRule.id}@${record.monthKey}`;
      const day = String(Math.min(Number(activeRule.day) || 1, daysInMonth(record.monthKey))).padStart(2, "0");
      const occurrenceAmount = state.data.ledgers[record.monthKey]?.cashflowOccurrences?.[activeRule.id]?.amount ?? activeRule.amount;
      syncSettlementForExpense({ id, source: "cashflowRule", amount: parseAmount(occurrenceAmount), usageOwner: activeRule.usageOwner || "J", payment: activeRule.payment, item: activeRule.name, date: `${record.monthKey}-${day}`, category: activeRule.category || "기타" }, record.monthKey, true);
    }
    return true;
  }
  const found = findCollectionRecord(record); if (!found) return false;
  const { item, collection, index, collectionName, ledger } = found;
  if (record.source === "transfer") {
    Object.assign(item, { name: fields.item, amt: fields.amount, amount: fields.amount, from: fields.from, to: fields.to, day: fields.day, date: fields.date, auto: record.frequency === "monthly" });
    if (item.settlementReviewId) {
      const linkedReview = (state.data.settlementReviews || []).find((review) => review.id === item.settlementReviewId);
      if (linkedReview) {
        const complete = parseAmount(fields.amount) === parseAmount(linkedReview.amount) && fields.to === linkedReview.beneficiaryAccountId;
        linkedReview.transferredFromAccountId = fields.from;
        linkedReview.transferId = complete ? item.id : "";
        linkedReview.status = complete ? "confirmed" : "pending";
        linkedReview.confirmedAt = complete ? new Date().toISOString() : null;
      }
    }
  }
  else if (record.source === "legacyIncome" || record.source === "extraIncome") Object.assign(item, { name: fields.item, amt: fields.amount, amount: fields.amount, owner: fields.owner, usageOwner: fields.owner, acc: fields.accountId, date: record.source === "extraIncome" && record.frequency !== "monthly" ? fields.date : item.date, day: fields.day, payDay: fields.day, freq: record.source === "extraIncome" ? record.frequency : "monthly" });
  else {
    const nowCard = fields.payment.type === "card";
    const replacement = { ...item, name: fields.item, item: fields.item, amt: fields.amount, amount: fields.amount, owner: fields.owner, usageOwner: fields.owner, cat: fields.category, category: fields.category, date: fields.date, day: fields.day, payment: fields.payment, method: nowCard ? "card" : "acc", ref: fields.payment.id, acc: nowCard ? item.acc || "" : fields.payment.id, cardId: nowCard ? fields.payment.id : item.cardId };
    if (record.source === "extraExpense" && nowCard) {
      collection.splice(index, 1);
      ledger.cardTxns.push({ ...replacement, id: record.id });
    } else if (record.source === "cardTxn" && !nowCard) {
      collection.splice(index, 1);
      ledger.extraExpenses.push({ ...replacement, id: record.id, freq: "once" });
    } else Object.assign(item, replacement);
    if (nowCard) syncSettlementForExpense({ id: record.id, amount: fields.amount, usageOwner: fields.owner, payment: fields.payment, item: fields.item, date: fields.date, category: fields.category, source: "edit" }, record.monthKey, true);
    else {
      const reviewIndex = state.data.settlementReviews.findIndex((entry) => entry.sourceTransactionId === record.id);
      if (reviewIndex >= 0 && state.data.settlementReviews[reviewIndex].status !== "confirmed") state.data.settlementReviews.splice(reviewIndex, 1);
    }
  }
  clearOwnerAudit(record);
  return true;
}

function deleteCashflowRecord(record) {
  if (state.data.ledgers[record.monthKey]?.closed) { toast("마감된 월은 먼저 마감을 해제해주세요."); return; }
  if (!confirm(`‘${record.item}’ 기록을 삭제할까요? 연결된 정산 검토도 함께 삭제됩니다.`)) return;
  if (record.source === "cashflowRule") {
    const rule = (state.data.cashflowRules || []).find((item) => item.id === record.ruleId);
    if (!rule) { toast("정기 항목을 찾을 수 없습니다."); return; }
    if (record.monthKey > (rule.startMonth || record.monthKey)) {
      rule.endMonth = previousMonthKey(record.monthKey);
      removeRuleOccurrences(record.ruleId, record.monthKey);
    } else {
      state.data.cashflowRules = state.data.cashflowRules.filter((item) => item.id !== record.ruleId);
      removeRuleOccurrences(record.ruleId);
    }
  } else {
    const found = findCollectionRecord(record);
    if (!found) { toast("기록을 찾을 수 없습니다."); return; }
    if (record.source === "transfer" && found.item.settlementReviewId) {
      const linkedReview = (state.data.settlementReviews || []).find((item) => item.id === found.item.settlementReviewId);
      if (linkedReview) { linkedReview.status = "pending"; linkedReview.confirmedAt = null; linkedReview.transferId = ""; }
    }
    clearOwnerAudit(record);
    found.collection.splice(found.index, 1);
    state.data.settlementReviews = (state.data.settlementReviews || []).filter((item) => item.sourceTransactionId !== record.id);
  }
  $("quickEntry").close(); state.editingRecord = null; queueSave(); renderAll(); toast("거래를 삭제했습니다.");
}

function addTransactionFromForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const kind = state.editingRecord?.kind || form.get("kind"); const frequency = state.editingRecord?.frequency || form.get("frequency");
  const amountValue = parseAmount(form.get("amount")); const item = String(form.get("item") || "").trim();
  const category = form.get("category") || "기타"; const owner = form.get("usageOwner") || "J";
  const paymentValue = String(form.get("payment") || ""); const day = Math.min(31, Math.max(1, Number(form.get("day")) || 1));
  const date = frequency === "monthly" ? `${state.selectedMonth}-${String(Math.min(day, daysInMonth(state.selectedMonth))).padStart(2, "0")}` : String(form.get("date") || "");
  const payment = kind === "expense" ? paymentFromValue(paymentValue) : null;
  const fromAccountId = kind === "transfer" ? paymentValue : ""; const toAccountId = String(form.get("toAccount") || "");
  if (!item || amountValue <= 0) { toast("항목과 0보다 큰 금액을 입력해주세요."); return; }
  if (kind === "expense" && (!payment?.id || (payment.type !== "account" && payment.type !== "card"))) { toast("지출 계좌 또는 카드를 선택해주세요."); return; }
  if (kind === "income" && !accountById(paymentValue)) { toast("수입이 입금될 계좌를 선택해주세요."); return; }
  if (kind === "transfer" && (!accountById(fromAccountId) || !accountById(toAccountId) || fromAccountId === toAccountId)) { toast("서로 다른 출금 계좌와 입금 계좌를 선택해주세요."); return; }
  const monthKey = frequency === "monthly" ? state.selectedMonth : date.slice(0, 7);
  if (frequency === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("거래일을 선택해주세요."); return; }
  const ledger = ensureLedger(monthKey);
  if (ledger.closed) { toast("마감된 월은 먼저 마감을 해제해주세요."); return; }
  const rule = { kind, name: item, amount: amountValue, category, usageOwner: owner, day, startMonth: state.selectedMonth, accountId: kind === "income" ? paymentValue : "", fromAccountId, toAccountId };
  if (kind === "expense") rule.payment = payment;
  const fields = { kind, item, amount: amountValue, category, owner, day: Number(date.slice(-2)) || day, date, accountId: paymentValue, payment, from: fromAccountId, to: toAccountId, rule };
  if (state.editingRecord) {
    const record = state.editingRecord;
    if (record.frequency !== "monthly" && date.slice(0, 7) !== record.monthKey) { toast("거래 날짜는 기존 기록과 같은 월 안에서 변경해주세요."); return; }
    if (!saveEditedRecord(record, fields)) { toast("기록을 찾지 못해 수정하지 못했습니다."); return; }
    $("quickEntry").close(); state.editingRecord = null; queueSave(); renderAll(); toast("거래를 수정했습니다."); return;
  }
  if (frequency === "monthly") {
    state.data.cashflowRules.push({ id: `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...fields.rule });
    toast("매월 반복되는 정기 항목으로 등록했습니다.");
  } else {
    const id = `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    if (kind === "income") ledger.extraIncomes.push({ id, name: item, amt: amountValue, amount: amountValue, owner, usageOwner: owner, freq: "once", date, day: Number(date.slice(-2)), acc: paymentValue });
    else if (kind === "transfer") {
      const settlement = state.settlementTransferId && (state.data.settlementReviews || []).find((entry) => entry.id === state.settlementTransferId);
      ledger.transfers.push({ id, name: item, from: fromAccountId, to: toAccountId, amt: amountValue, amount: amountValue, date, day: Number(date.slice(-2)), auto: false, ...(settlement ? { settlementReviewId: settlement.id } : {}) });
      if (settlement) {
        settlement.transferId = id;
        settlement.transferredFromAccountId = fromAccountId;
        settlement.status = amountValue === parseAmount(settlement.amount) && toAccountId === settlement.beneficiaryAccountId ? "confirmed" : "pending";
        settlement.confirmedAt = settlement.status === "confirmed" ? new Date().toISOString() : null;
      }
    }
    else if (payment.type === "card") {
      const tx = { id, cardId: payment.id, date, item, amt: amountValue, amount: amountValue, owner, usageOwner: owner, cat: category, payment, monthKey };
      ledger.cardTxns.push(tx);
      const result = syncSettlementForExpense({ ...tx, id, source: "cashflow" }, monthKey);
      if (result.kind === "needsSetup") toast("기록은 저장했지만 카드의 결제 계좌 설정이 필요합니다.");
      else if (result.kind === "coveredByAllowance") toast("용돈 처리로 기록했습니다.");
      else if (result.kind === "reimburse") toast("정산 검토 항목을 만들었습니다.");
    } else ledger.extraExpenses.push({ id, name: item, amt: amountValue, amount: amountValue, owner, usageOwner: owner, cat: category, freq: "once", date, day: Number(date.slice(-2)), acc: payment.id, payment });
    if (state.recordFilter !== "all") state.recordFilter = "all";
    state.recordTypeFilter = kind === "transfer" ? "transfer" : `${frequency === "monthly" ? "recurring" : "once"}-${kind}`;
    state.selectedMonth = monthKey;
    toast(state.settlementTransferId ? "정산 이체 내역을 기록했습니다." : kind === "income" ? "수입을 기록했습니다." : kind === "transfer" ? "계좌 이체를 기록했습니다." : "지출을 기록했습니다.");
  }
  state.settlementTransferId = null;
  $("quickEntry").close(); queueSave(); renderAll();
}

function renderAnalytics() {
  updateMonthSelects();
  renderAnalyticsDetail(state.analyticsDetail?.title, state.analyticsDetail?.records);
  if (!window.Chart) return;
  const accounts = state.data.accounts || [];
  const types = {}; accounts.forEach((account) => { types[account.type || "기타"] = (types[account.type || "기타"] || 0) + parseAmount(account.amt); });
  destroyChart("assets");
  state.charts.assets = new Chart($("chartAssets"), { type: "doughnut", data: { labels: Object.keys(types).length ? Object.keys(types) : ["자산 없음"], datasets: [{ data: Object.keys(types).length ? Object.values(types) : [1], backgroundColor: COLORS, borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(), borderWidth: 3 }] }, options: { ...chartDefaults(), cutout: "62%", maintainAspectRatio: false, onClick: (_event, elements) => { if (!elements.length || !Object.keys(types).length) return; const type = Object.keys(types)[elements[0].index]; const detailRecords = accounts.filter((account) => (account.type || "기타") === type).map((account) => ({ id: `asset:${account.id}`, item: account.name, date: "현재", category: account.type || "기타", amount: parseAmount(account.amt), usageOwner: account.owner, paymentLabel: "자산" })); openAnalyticsDetail(`${type} 계좌`, detailRecords); } } });
  const months = allMonths().filter((monthKey) => monthKey <= CURRENT_MONTH); const trendValues = months.map((monthKey) => totalExpenses(monthKey));
  destroyChart("trend");
  state.charts.trend = new Chart($("chartTrend"), { type: "line", data: { labels: months.map(monthLabel), datasets: [{ label: "월 지출", data: trendValues, borderColor: "#2868d7", backgroundColor: "rgba(40,104,215,.12)", fill: true, tension: .3, pointRadius: 4, pointHoverRadius: 6 }] }, options: { ...chartDefaults(), maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: (value) => fmtShort(value) }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--line").trim() } }, x: { grid: { display: false } } }, onClick: (_event, elements) => { if (!elements.length) return; const key = months[elements[0].index]; openAnalyticsDetail(`${monthLabel(key)} 지출`, allRecords(key)); } } });
}

function analyticsSummaryHtml() {
  const records = allRecords();
  const total = records.reduce((sum, record) => sum + record.amount, 0);
  const joint = records.filter((record) => record.usageOwner === "J").reduce((sum, record) => sum + record.amount, 0);
  const pending = pendingReviews();
  const categories = Object.entries(records.reduce((result, record) => { result[record.category] = (result[record.category] || 0) + record.amount; return result; }, {})).sort((a, b) => b[1] - a[1]);
  const topCategory = categories[0];
  return `<div class="analysis-summary"><div class="analysis-summary-grid"><div class="analysis-stat"><span>이번 달 지출</span><strong>${fmtShort(total)}</strong><small>${records.length}건의 기록</small></div><div class="analysis-stat"><span>공동 지출</span><strong>${fmtShort(joint)}</strong><small>전체의 ${total ? Math.round(joint / total * 100) : 0}%</small></div><div class="analysis-stat"><span>정산 대기</span><strong>${fmtShort(pending.reduce((sum, item) => sum + parseAmount(item.amount), 0))}</strong><small>${pending.length}건 확인 필요</small></div></div><div class="analysis-insight"><b>${topCategory ? `${esc(topCategory[0])} 비중이 가장 큽니다.` : "아직 분석할 지출이 없습니다."}</b><span>${topCategory ? `${fmt(topCategory[1])} · 전체의 ${total ? Math.round(topCategory[1] / total * 100) : 0}%` : "기록을 추가하면 카테고리와 정산 흐름을 요약합니다."}</span></div><p class="analysis-help">자산 구성 도넛을 클릭하면 해당 계좌 목록이, 월별 지출 추이의 점을 클릭하면 해당 월 거래 목록이 아래에 표시됩니다.</p></div>`;
}

function renderAnalyticsDetail(title = "", records = null) {
  const box = $("analyticsDetail");
  if (!box) return;
  if (!records) {
    box.className = "analysis-summary-wrap";
    box.innerHTML = analyticsSummaryHtml();
    return;
  }
  box.className = "analysis-detail";
  box.innerHTML = `<div class="analysis-detail-head"><div><b>${esc(title || "선택한 내역")}</b><span>${records.length}건 · ${fmt(records.reduce((sum, record) => sum + parseAmount(record.amount), 0))}</span></div><button type="button" class="text-btn" data-analysis-reset>요약으로</button></div>${records.length ? `<div class="record-list analysis-detail-list">${records.map((record) => recordHtml(record)).join("")}</div>` : `<div class="detail-empty">연결된 내역이 없습니다.</div>`}`;
  box.querySelector("[data-analysis-reset]")?.addEventListener("click", () => { state.analyticsDetail = null; renderAnalyticsDetail(); });
  box.querySelectorAll("[data-record-id]").forEach((el) => el.addEventListener("click", () => { const record = records.find((item) => String(item.id) === String(el.dataset.recordId)); if (record) openDetail(record.item, [record]); }));
}

function openAnalyticsDetail(title, records = []) {
  state.analyticsDetail = { title, records };
  renderAnalyticsDetail(title, records);
}

function openDetail(title, records = []) {
  $("detailTitle").textContent = title;
  $("detailBody").innerHTML = records.length ? `<div class="record-list">${records.map(recordHtml).join("")}</div>` : `<div class="detail-empty">연결된 내역이 없습니다.</div>`;
  $("detailDialog").showModal();
}

function renderAll() { ensureCashflowRuleReviews(state.selectedMonth); updateMonthSelects(); renderDashboard(); renderRecords(); renderSettlements(); renderAssets(); renderAnalytics(); updateNavBadge(); }
function updateNavBadge() { const count = pendingReviews().length; $("navBadge").textContent = String(count); $("navBadge").hidden = count === 0; }

function bindEvents() {
  document.querySelectorAll("[data-open-screen]").forEach((button) => button.addEventListener("click", () => setScreen(button.dataset.openScreen)));
  $("monthSelect").addEventListener("change", (event) => { state.selectedMonth = event.target.value; state.analyticsDetail = null; renderAll(); });
  $("recordMonthSelect").addEventListener("change", (event) => { state.selectedMonth = event.target.value; state.analyticsDetail = null; renderAll(); });
  $("analyticsMonthSelect").addEventListener("change", (event) => { state.selectedMonth = event.target.value; state.analyticsDetail = null; renderAnalytics(); });
  $("recordFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (!button) return; state.recordFilter = button.dataset.filter; document.querySelectorAll("#recordFilters .segment").forEach((item) => item.classList.toggle("active", item === button)); renderRecords(); });
  $("recordTypeTabs").addEventListener("click", (event) => { const tab = event.target.closest("[data-record-type]"); if (!tab) return; state.recordTypeFilter = tab.dataset.recordType; renderRecords(); });
  $("recordTypeTabs").addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; const tabs = [...$("recordTypeTabs").querySelectorAll("[data-record-type]")]; const current = tabs.indexOf(event.target.closest("[data-record-type]")); if (current < 0) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; tabs[next].click(); tabs[next].focus(); });
  $("openQuickEntry").addEventListener("click", openQuickEntry); $("openQuickEntryRecords").addEventListener("click", openQuickEntry);
  $("quickEntryForm").addEventListener("submit", addTransactionFromForm);
  $("quickEntry").addEventListener("close", () => { state.settlementTransferId = null; });
  $("entryOccurrenceActions").addEventListener("click", (event) => { const button = event.target.closest("[data-occurrence-status]"); if (button) setOccurrenceStatus(button.dataset.occurrenceStatus); });
  ["entryAmount", "entryItem", "entryPayment"].forEach((id) => $(id).addEventListener("input", updateEntryPreview));
  $("entryPayment").addEventListener("change", () => { if ($("entryKind").value === "transfer") updateEntryFields(); else updateEntryPreview(); });
  $("entryTransferTo").addEventListener("change", updateEntryPreview);
  $("entryKind").addEventListener("change", updateEntryFields); $("entryFrequency").addEventListener("change", updateEntryFields);
  document.querySelectorAll('input[name="usageOwner"]').forEach((input) => input.addEventListener("change", updateEntryPreview));
  $("deleteEntryBtn").addEventListener("click", () => { if (state.editingRecord) deleteCashflowRecord(state.editingRecord); });
  $("saveBtn").addEventListener("click", async () => { saveLocal(true); await saveCloud(); });
  $("loadBtn").addEventListener("click", async () => { await loadCloud(true); });
  $("exportBtn").addEventListener("click", exportBackup);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (event) => importBackup(event.target.files?.[0]));
  $("themeBtn").addEventListener("click", () => { const html = document.documentElement; const dark = html.dataset.theme === "dark"; html.dataset.theme = dark ? "light" : "dark"; localStorage.setItem("sohakPlannerTheme", html.dataset.theme); renderAll(); });
  $("closeMonthBtn").addEventListener("click", () => setScreen("settlements"));
  $("settlementMonthAction").addEventListener("click", () => setScreen("settlements"));
  $("addAccountBtn").addEventListener("click", addAccount); $("addCardBtn").addEventListener("click", addCard); $("addLoanBtn").addEventListener("click", addLoan); $("addGoalBtn").addEventListener("click", addGoal);
  [["nameAInput", "nameA", "나"], ["nameBInput", "nameB", "상대방"]].forEach(([id, key, fallback]) => {
    const input = $(id);
    input.addEventListener("input", () => {
      state.data[key] = input.value.trim() || fallback;
      syncPeopleInputs();
      queueSave();
    });
    input.addEventListener("change", () => { state.data[key] = input.value.trim() || fallback; renderAll(); });
  });
  $("addCfA").addEventListener("click", () => addHousingEntry("A")); $("addCfB").addEventListener("click", () => addHousingEntry("B")); $("calcHousingBtn").addEventListener("click", calculateHousing);
  $("closeDetail").addEventListener("click", () => $("detailDialog").close());
  document.addEventListener("click", (event) => { const record = event.target.closest("[data-record-id]"); if (record && !$("detailDialog").open) { const item = cashflowRecords().find((entry) => String(entry.id) === record.dataset.recordId); if (item) openDetail(item.item, [item]); } });
}

const savedTheme = localStorage.getItem("sohakPlannerTheme"); if (savedTheme) document.documentElement.dataset.theme = savedTheme;
loadLocal(); bindEvents(); renderAll(); initCloud();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
