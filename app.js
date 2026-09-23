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
const state = { data: null, screen: "dashboard", selectedMonth: CURRENT_MONTH, recordFilter: "all", charts: {}, detail: null, analyticsDetail: null, cloudDb: null, saveTimer: null, housingCalculated: false };

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
function blankLedger() { return { incomes: [], expenses: [], extraIncomes: [], extraExpenses: [], cardTxns: [], transfers: [], settlementReviews: [] }; }
function allMonths() { return [...new Set([...(state.data.months || []), ...Object.keys(state.data.ledgers || {})])].sort(); }
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
  for (const key of data.months) data.ledgers[key] = { ...blankLedger(), ...(data.ledgers[key] || {}) };
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

function loadLocal() {
  let raw = null;
  for (const key of ["sohakPlannerV2", "coupleV8", "coupleV7"]) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    try { raw = JSON.parse(value); break; } catch { /* ignore malformed backup */ }
  }
  state.data = ensureData(raw || defaultData());
  const months = allMonths();
  state.selectedMonth = state.data.currentMonth && months.includes(state.data.currentMonth) ? state.data.currentMonth : (months.at(-1) || CURRENT_MONTH);
  setSaveStatus(raw ? "기존 데이터를 불러왔어요" : "새 플래너 준비 완료", "ok");
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
  const payload = JSON.stringify({ ...state.data, currentMonth: state.selectedMonth, exportedAt: new Date().toISOString() }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `sohak-planner-backup-${TODAY}.json`; link.click(); URL.revokeObjectURL(url);
  toast("백업 파일을 저장했습니다.");
}
function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { try { state.data = ensureData(JSON.parse(reader.result)); state.selectedMonth = state.data.currentMonth || allMonths().at(-1) || CURRENT_MONTH; saveLocal(false); renderAll(); toast("백업 데이터를 복원했습니다."); } catch { toast("백업 파일을 읽을 수 없습니다."); } };
  reader.readAsText(file);
}

function queueSave() {
  setSaveStatus("저장 대기 중", "pending");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveLocal(false), 900);
}

async function initCloud() {
  if (!window.firebase || !window.firebaseConfig?.projectId) return;
  try {
    if (!window.firebase.apps.length) window.firebase.initializeApp(window.firebaseConfig);
    const auth = window.firebase.auth();
    await auth.signInAnonymously();
    state.cloudDb = window.firebase.firestore();
    const path = Array.isArray(window.DOC_PATH) ? window.DOC_PATH : ["coupleFund", "main"];
    const snap = await state.cloudDb.collection(path[0]).doc(path[1]).get();
    if (snap.exists) {
      state.data = ensureData(snap.data());
      state.selectedMonth = state.data.currentMonth || allMonths().at(-1) || CURRENT_MONTH;
      renderAll();
      setSaveStatus("Firebase에서 불러옴", "ok");
    }
  } catch (error) {
    setSaveStatus("로컬 저장 모드", "warning");
  }
}

async function saveCloud() {
  if (!state.cloudDb) return;
  try {
    const path = Array.isArray(window.DOC_PATH) ? window.DOC_PATH : ["coupleFund", "main"];
    await state.cloudDb.collection(path[0]).doc(path[1]).set({ ...state.data, currentMonth: state.selectedMonth, updatedAt: new Date().toISOString() });
    setSaveStatus("Firebase 저장됨", "ok");
  } catch { setSaveStatus("Firebase 저장 실패 · 로컬 저장됨", "warning"); }
}

function allRecords(monthKey = state.selectedMonth) {
  const ledger = state.data.ledgers[monthKey] || blankLedger();
  const records = listMonthTransactions(monthKey, state.data).map((record) => ({ ...record, paymentLabel: paymentLabel(record.payment) }));
  for (const expense of ledger.expenses || []) {
    if (expense.method === "card") continue;
    const day = String(Math.max(1, Number(expense.day) || 1)).padStart(2, "0");
    records.push({ id: expense.id || `${monthKey}:expense:${records.length}`, sourceTransactionId: expense.id || `${monthKey}:expense:${records.length}`, monthKey, date: expense.date || `${monthKey}-${day}`, item: expense.name || "계좌 지출", category: expense.cat || "기타", amount: parseAmount(expense.amount ?? expense.amt), usageOwner: expense.usageOwner || expense.owner || "J", usageOwnerOriginal: expense.usageOwnerOriginal || "", payment: { type: "account", id: expense.acc || expense.ref || "" }, paymentLabel: paymentLabel({ type: "account", id: expense.acc || expense.ref || "" }), source: "accountExpense" });
  }
  for (const extra of ledger.extraExpenses || []) {
    const date = extra.freq === "monthly" ? `${monthKey}-${String(Math.max(1, Number(extra.day) || 1)).padStart(2, "0")}` : (extra.date || `${monthKey}-01`);
    if (!date.startsWith(monthKey)) continue;
    records.push({ id: extra.id || `${monthKey}:extra:${records.length}`, sourceTransactionId: extra.id || `${monthKey}:extra:${records.length}`, monthKey, date, item: extra.name || "기타 지출", category: extra.cat || "기타", amount: parseAmount(extra.amount ?? extra.amt), usageOwner: extra.usageOwner || extra.owner || "J", usageOwnerOriginal: extra.usageOwnerOriginal || "", payment: { type: "account", id: extra.acc || "" }, paymentLabel: "기타 지출", source: "extraExpense" });
  }
  return records.filter((record) => record.amount > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

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
  const recent = allRecords().slice(0, 5);
  $("recentList").innerHTML = recent.length ? recent.map(recordHtml).join("") : `<div class="empty">아직 기록이 없습니다.</div>`;
  const pending = pendingReviews();
  $("attentionList").innerHTML = pending.length ? pending.slice(0, 4).map((item) => `<button class="attention-item" type="button" data-settlement-id="${esc(item.id)}"><span>${esc(item.item || "개인 카드 사용")} · ${esc(ownerName(item.payerOwner))}</span><b>${fmt(item.amount)}</b></button>`).join("") : `<div class="empty">확인이 필요한 정산이 없습니다.</div>`;
  $("attentionList").querySelectorAll("[data-settlement-id]").forEach((el) => el.addEventListener("click", () => { setScreen("settlements"); setTimeout(() => document.querySelector(`[data-review-row="${CSS.escape(el.dataset.settlementId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30); }));
}

function recordHtml(record) {
  const auditLabel = record.usageOwnerOriginal ? " · 확인 필요" : "";
  const auditTitle = record.usageOwnerOriginal ? ` title="기존 표기: ${esc(record.usageOwnerOriginal)}"` : "";
  return `<button class="record-row" type="button" data-record-id="${esc(record.id)}"><div class="record-main"><div class="record-title">${esc(record.item)}</div><div class="record-sub">${esc(record.date)} · ${esc(record.category)}</div></div><span class="pill ${ownerClass(record.usageOwner)} record-purpose"${auditTitle}>${esc(ownerName(record.usageOwner))}${auditLabel}</span><div class="record-meta"><div class="record-sub">${esc(record.paymentLabel || paymentLabel(record.payment))}</div></div><div class="record-amount">－${fmt(record.amount)}</div></button>`;
}

function renderRecords() {
  updateMonthSelects();
  const records = allRecords().filter((record) => state.recordFilter === "all" || state.recordFilter === "settlement" ? (state.recordFilter === "settlement" ? pendingReviews().some((item) => item.sourceTransactionId === record.sourceTransactionId) : true) : record.usageOwner === state.recordFilter);
  $("recordList").innerHTML = records.length ? records.map(recordHtml).join("") : `<div class="empty">이 조건에 맞는 거래가 없습니다.</div>`;
  $("recordList").querySelectorAll("[data-record-id]").forEach((el) => el.addEventListener("click", () => { const record = allRecords().find((item) => item.id === el.dataset.recordId); if (record) openDetail(record.item, [record]); }));
  const reviews = pendingReviews();
  const auditCount = state.data.migrationAudit?.usageOwnerUnresolved?.length || 0;
  const messages = [];
  if (reviews.length) messages.push(`${reviews.length}건의 개인 카드 사용 내역이 정산 검토를 기다리고 있습니다. 과거에 이미 이체했다면 정산 화면에서 완료로 표시해주세요.`);
  if (auditCount) messages.push(`과거 사용 목적 표기 ${auditCount}건은 공동으로 임시 분류했습니다. 자산 화면에서 이름을 설정한 뒤 ‘확인 필요’ 항목을 재검토해주세요.`);
  $("migrationNotice").hidden = messages.length === 0;
  if (messages.length) $("migrationNotice").textContent = messages.join(" ");
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
  renderMonthClose();
}
function settlementHtml(item) {
  const account = accountById(item.beneficiaryAccountId);
  return `<div class="settlement-row ${esc(item.status)}" data-review-row="${esc(item.id)}"><div class="settlement-main"><div class="settlement-title">${esc(item.item || "개인 카드 사용")}</div><div class="settlement-sub">${esc(item.date || item.monthKey)} · ${esc(ownerName(item.payerOwner))} → ${esc(account?.name || "연결 계좌 확인 필요")}</div></div><div><span class="pill ${settlementStatusClass(item.status)}">${settlementStatusLabel(item.status)}</span><div class="settlement-amount">${fmt(item.amount)}</div></div><div class="row-actions">${item.status !== "confirmed" ? `<button type="button" data-settlement-id="${esc(item.id)}" data-settlement-action="confirmed">이체 완료</button>` : ""}${item.status !== "pending" && item.status !== "confirmed" ? `<button type="button" data-settlement-id="${esc(item.id)}" data-settlement-action="pending">이체 필요</button>` : ""}${item.status !== "excluded" ? `<button type="button" data-settlement-id="${esc(item.id)}" data-settlement-action="excluded">대상 아님</button>` : ""}</div></div>`;
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

function fillPaymentOptions() {
  const options = [];
  for (const card of state.data.cards || []) options.push(`<option value="card:${esc(card.id)}">카드 · ${esc(card.name)} · ${esc(ownerName(card.owner))}</option>`);
  for (const account of state.data.accounts || []) options.push(`<option value="account:${esc(account.id)}">계좌 · ${esc(account.name)} · ${esc(ownerName(account.owner))}</option>`);
  $("entryPayment").innerHTML = options.length ? options.join("") : `<option value="unknown:">결제 수단을 먼저 추가하세요</option>`;
}
function openQuickEntry() { fillPaymentOptions(); $("entryDate").value = TODAY; $("entryAmount").value = ""; $("entryItem").value = ""; $("entryCategory").value = "식비"; document.querySelector('input[name="usageOwner"][value="J"]').checked = true; updateEntryPreview(); $("quickEntry").showModal(); setTimeout(() => $("entryAmount").focus(), 30); }
function updateEntryPreview() {
  const amountValue = parseAmount($("entryAmount").value);
  const payment = paymentFromValue($("entryPayment").value);
  const usageOwner = document.querySelector('input[name="usageOwner"]:checked')?.value || "J";
  const result = deriveSettlementForTransaction({ amount: amountValue, usageOwner, payment }, state.data.cards, state.data.accounts);
  const preview = $("entryPreview"); preview.className = "entry-preview";
  if (!amountValue) { preview.textContent = "금액과 결제 수단을 입력하면 처리 방법을 안내합니다."; return; }
  if (result.kind === "joint") { preview.textContent = "공동 생활비로 기록됩니다."; preview.classList.add("good"); return; }
  if (result.kind === "coveredByAllowance") { preview.textContent = `${ownerName(usageOwner)}의 비공개 용돈으로 처리됩니다. 별도 이체가 필요하지 않습니다.`; preview.classList.add("good"); return; }
  if (result.kind === "reimburse") { preview.textContent = `${ownerName(usageOwner)}의 개인 지출입니다. 연결 계좌로 ${fmt(result.amount)} 이체할 항목이 생깁니다.`; preview.classList.add("warn"); return; }
  preview.textContent = "카드의 연결 계좌 또는 용돈 여부를 자산 화면에서 설정해주세요."; preview.classList.add("warn");
}
function addTransactionFromForm(event) {
  event.preventDefault();
  const ledger = currentLedger();
  if (ledger.closed) { toast("마감된 월은 먼저 마감을 해제해주세요."); $("quickEntry").close(); return; }
  const form = new FormData(event.currentTarget);
  const payment = paymentFromValue(form.get("payment"));
  const tx = normalizeTransactionInput({ amount: form.get("amount"), item: form.get("item"), category: form.get("category"), date: form.get("date"), monthKey: state.selectedMonth, usageOwner: form.get("usageOwner"), payment });
  if (!tx.item || tx.amount <= 0) { toast("항목과 금액을 입력해주세요."); return; }
  if (payment.type === "card") ledger.cardTxns.push({ id: tx.id, cardId: payment.id, date: tx.date, item: tx.item, amt: tx.amount, amount: tx.amount, owner: tx.usageOwner, usageOwner: tx.usageOwner, cat: tx.category, payment, monthKey: tx.monthKey });
  else ledger.expenses.push({ id: tx.id, name: tx.item, amt: tx.amount, amount: tx.amount, owner: tx.usageOwner, usageOwner: tx.usageOwner, cat: tx.category, method: "acc", ref: payment.id, acc: payment.id, day: Number(tx.date.slice(-2)) });
  const result = deriveSettlementForTransaction(tx, state.data.cards, state.data.accounts);
  if (result.kind === "reimburse") state.data.settlementReviews.push({ id: `settlement:${tx.id}`, sourceTransactionId: tx.id, monthKey: tx.monthKey, payerOwner: result.payerOwner, beneficiaryAccountId: result.beneficiaryAccountId, amount: result.amount, status: "pending", source: "new", item: tx.item, date: tx.date, category: tx.category, createdAt: new Date().toISOString() });
  if (result.kind === "needsSetup") toast("기록은 저장했지만 결제 수단 설정이 필요합니다."); else toast(result.kind === "coveredByAllowance" ? "용돈 처리로 기록했습니다." : result.kind === "reimburse" ? "정산 필요 항목을 만들었습니다." : "공동 지출로 기록했습니다.");
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
  const months = allMonths(); const trendValues = months.map((monthKey) => totalExpenses(monthKey));
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

function renderAll() { updateMonthSelects(); renderDashboard(); renderRecords(); renderSettlements(); renderAssets(); renderAnalytics(); updateNavBadge(); }
function updateNavBadge() { const count = pendingReviews().length; $("navBadge").textContent = String(count); $("navBadge").hidden = count === 0; }

function bindEvents() {
  document.querySelectorAll("[data-open-screen]").forEach((button) => button.addEventListener("click", () => setScreen(button.dataset.openScreen)));
  $("monthSelect").addEventListener("change", (event) => { state.selectedMonth = event.target.value; state.analyticsDetail = null; renderAll(); });
  $("recordMonthSelect").addEventListener("change", (event) => { state.selectedMonth = event.target.value; state.analyticsDetail = null; renderRecords(); renderSettlements(); });
  $("analyticsMonthSelect").addEventListener("change", (event) => { state.selectedMonth = event.target.value; state.analyticsDetail = null; renderAnalytics(); });
  $("recordFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (!button) return; state.recordFilter = button.dataset.filter; document.querySelectorAll("#recordFilters .segment").forEach((item) => item.classList.toggle("active", item === button)); renderRecords(); });
  $("openQuickEntry").addEventListener("click", openQuickEntry); $("openQuickEntryRecords").addEventListener("click", openQuickEntry);
  $("quickEntryForm").addEventListener("submit", addTransactionFromForm);
  ["entryAmount", "entryItem", "entryPayment"].forEach((id) => $(id).addEventListener("input", updateEntryPreview));
  $("entryPayment").addEventListener("change", updateEntryPreview); document.querySelectorAll('input[name="usageOwner"]').forEach((input) => input.addEventListener("change", updateEntryPreview));
  $("saveBtn").addEventListener("click", async () => { saveLocal(true); await saveCloud(); });
  $("loadBtn").addEventListener("click", () => { loadLocal(); renderAll(); toast("저장된 데이터를 불러왔습니다."); });
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
  document.addEventListener("click", (event) => { const record = event.target.closest("[data-record-id]"); if (record && !$("detailDialog").open) { const item = allRecords().find((entry) => entry.id === record.dataset.recordId); if (item) openDetail(item.item, [item]); } });
}

const savedTheme = localStorage.getItem("sohakPlannerTheme"); if (savedTheme) document.documentElement.dataset.theme = savedTheme;
loadLocal(); bindEvents(); renderAll(); initCloud();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
