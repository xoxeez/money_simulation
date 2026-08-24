/* =========================================================
   소학행을 위한 자산 플래너 v9.4 — app.js
   [v9.4 변경]
   · 담당자별 월 부담을 막대 2개로 분리: ①생활비 부담 ②대출 상환 포함 부담
   · 각 막대 클릭 시 세부 항목(항목명+금액) 표시 (대출 포함 여부 구분)
   [v9.3] 부담=지출 합계 일치 · 차트 클릭 세부내역
   [v9.2] 삭제 버그(id 자동부여) · 대출 기타(직접입력) 회차 스케줄
   [v9.1] 샘플 데이터 제거 · 카드 결제일 자동 · 대출 출금계좌
========================================================= */
const $ = (id) => document.getElementById(id);
const won = (v) => (Math.round(fin(+v))).toLocaleString("ko-KR") + "원";
const eok = (v0) => {
    const v = fin(+v0); const sign = v < 0 ? "-" : ""; const a = Math.abs(v);
    if (a >= 100000000) return sign + (a / 100000000).toFixed(2).replace(/\.?0+$/, "") + "억";
    if (a >= 10000) return sign + Math.round(a / 10000).toLocaleString() + "만";
    return won(v);
};
function fmtNum(v) {
    if (v === "" || v == null) return "";
    const s = String(v).trim(); const neg = s.startsWith("-");
    const d = s.replace(/[^0-9]/g, "");
    if (d === "") return neg ? "-" : "";
    return (neg ? "-" : "") + Number(d).toLocaleString("ko-KR");
}
function parseNum(str) {
    if (str == null) return 0;
    const s = String(str).replace(/,/g, "").trim();
    if (s === "" || s === "-") return 0;
    const n = Number(s); return isNaN(n) ? 0 : n;
}
const fin = (v) => (Number.isFinite(v) ? v : 0);
const num = (v) => { if (typeof v === "number") return Number.isFinite(v) ? v : 0; return parseNum(v); };
const TODAY = ymd(new Date());
const REAL_MONTH = TODAY.slice(0, 7);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
function ensureIds(arr) {
    if (!Array.isArray(arr)) return arr;
    const seen = new Set();
    arr.forEach(x => { if (!x || typeof x !== "object") return; if (!x.id || seen.has(x.id)) x.id = uid(); seen.add(x.id); });
    return arr;
}
function ink() { return getComputedStyle(document.body).getPropertyValue('--ink').trim(); }
function gridc() { return getComputedStyle(document.body).getPropertyValue('--line').trim(); }
function cardc() { return getComputedStyle(document.body).getPropertyValue('--card').trim(); }
function chartFont() { if (window.Chart) { Chart.defaults.font.family = "Pretendard"; Chart.defaults.color = ink(); } }
function attachComma(el) {
    if (!el) return;
    el.value = fmtNum(el.value);
    el.addEventListener("input", () => { el.value = fmtNum(el.value); try { el.selectionStart = el.selectionEnd = el.value.length; } catch (e) { } });
}
function attachAllComma() { document.querySelectorAll("input.comma").forEach(attachComma); }
const COL = { a: "#3f7fd1", b: "#23b0be", peri: "#6f7fe0", aqua: "#4fc4d6", plus: "#2bb59a", minus: "#e078a0", gold: "#e0b64f" };
const CHART_PALETTE = ["#3f7fd1", "#23b0be", "#6f7fe0", "#4fc4d6", "#2bb59a", "#e0b64f", "#e078a0", "#9db8d4", "#b7cfc5", "#c9b6e8", "#8fd0c4", "#f0c987"];
const ACC_ICON = { 예금: "🏦", 주식: "📈", 청약: "🏠", 현금: "💵", 연금: "👛", 기타: "💠" };
const nameOf = { get A() { return $("nameA").value || "본인"; }, get B() { return $("nameB").value || "남자친구"; }, J: "공동" };
function ownerName(o) { return o === "A" ? nameOf.A : o === "B" ? nameOf.B : "공동"; }
function ANCHOR() { const v = $("planDate") ? $("planDate").value : ""; return v || TODAY; }
/* ---------- 전역(공통) 데이터 ---------- */
let accounts = [];
let cards = [];
let loans = [];
let cfA = [];
let cfB = [];
/* ---------- 월별 가계부(ledger) ---------- */
function blankLedger() { return { incomes: [], expenses: [], extraIncomes: [], extraExpenses: [], cardTxns: [] }; }
function numifyLedger(L) {
    if (!L) return;
    ["incomes", "expenses", "extraIncomes", "extraExpenses", "cardTxns"].forEach(n => { if (!Array.isArray(L[n])) L[n] = []; ensureIds(L[n]); });
    (L.incomes || []).forEach(x => { x.amt = num(x.amt); x.payDay = +x.payDay || 1; });
    (L.expenses || []).forEach(x => { x.amt = num(x.amt); x.day = +x.day || 1; });
    (L.extraIncomes || []).forEach(x => { x.amt = num(x.amt); x.day = +x.day || 1; });
    (L.extraExpenses || []).forEach(x => { x.amt = num(x.amt); x.day = +x.day || 1; });
    (L.cardTxns || []).forEach(x => { x.amt = num(x.amt); });
}
function numifyAll() {
    ensureIds(accounts); ensureIds(cards); ensureIds(loans);
    accounts.forEach(a => a.amt = num(a.amt));
    loans.forEach(l => { l.principal = num(l.principal); l.fixed = num(l.fixed); (l.customRepays || []).forEach(e => { e.principal = num(e.principal); e.interest = num(e.interest); }); });
    cfA.forEach(e => e.amt = num(e.amt)); cfB.forEach(e => e.amt = num(e.amt));
    Object.keys(ledgers).forEach(k => numifyLedger(ledgers[k]));
    cards.forEach(c => { c.acc = validAccForOwner(c.acc, c.owner); });
    loans.forEach(l => { l.acc = validAccForOwner(l.acc, l.owner); });
}
let ledgers = { [REAL_MONTH]: blankLedger() };
let months = [REAL_MONTH];
let currentMonth = REAL_MONTH;
let incomes, expenses, extraIncomes, extraExpenses, cardTxns;
function bindMonth() { const L = ledgers[currentMonth]; incomes = L.incomes; expenses = L.expenses; extraIncomes = L.extraIncomes; extraExpenses = L.extraExpenses; cardTxns = L.cardTxns; }
function setLedgerArr(name, arr) {
    ledgers[currentMonth][name] = arr;
    if (name === "incomes") incomes = arr; else if (name === "expenses") expenses = arr;
    else if (name === "extraIncomes") extraIncomes = arr; else if (name === "extraExpenses") extraExpenses = arr;
    else if (name === "cardTxns") cardTxns = arr;
    return arr;
}
bindMonth();
function monthLabel(key) { const [y, m] = key.split("-"); return `${y}년 ${+m}월`; }
function ledgerDefaultDate() { return currentMonth === REAL_MONTH ? TODAY : currentMonth + "-01"; }
function inCurMonth(dateStr) { return !!dateStr && dateStr.slice(0, 7) === currentMonth; }
function cloneArr(arr) { return (arr || []).map(o => ({ ...o, id: uid() })); }
function renderMonthBar() {
    months.sort();
    const sel = $("monthSelect");
    if (sel) sel.innerHTML = months.map(k => `<option value="${k}" ${k === currentMonth ? "selected" : ""}>${monthLabel(k)} 가계부${k === REAL_MONTH ? " (이번 달)" : ""}</option>`).join("");
    const lab = monthLabel(currentMonth);
    if ($("mbTitle")) $("mbTitle").textContent = lab + " 가계부";
    ["flowMonthLabel"].forEach(id => { if ($(id)) $(id).textContent = lab; });
    ["flowMonthMini", "flowMonthLabel2", "flowMonthLabel3", "kMonthPayLabel", "cardLedgerMonth"].forEach(id => { if ($(id)) $(id).textContent = (currentMonth === REAL_MONTH ? "이번 달" : lab); });
}
function rerenderMonthViews() {
    renderIncome(); renderExtra("income"); renderExpenses(); renderExtra("expense"); renderCardLedgers();
    refreshSummary(); renderCalendar(); renderUpcoming();
}
function switchMonth(key) {
    if (!ledgers[key]) return;
    currentMonth = key; bindMonth();
    const [y, m] = key.split("-"); calYear = +y; calMonth = +m - 1; selectedDate = null;
    renderMonthBar(); rerenderMonthViews();
}
function createMonth(y, m) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!ledgers[key]) {
        const prev = months.filter(k => k < key).sort().pop();
        const L = blankLedger();
        if (prev) { L.incomes = cloneArr(ledgers[prev].incomes); L.expenses = cloneArr(ledgers[prev].expenses); }
        numifyLedger(L);
        ledgers[key] = L; months.push(key);
    }
    switchMonth(key);
}
function deleteMonth() {
    if (months.length <= 1) { alert("마지막 가계부는 삭제할 수 없어요."); return; }
    if (!confirm(monthLabel(currentMonth) + " 가계부를 삭제할까요?")) return;
    delete ledgers[currentMonth];
    months = months.filter(k => k !== currentMonth); months.sort();
    currentMonth = months[months.length - 1]; bindMonth();
    const [y, m] = currentMonth.split("-"); calYear = +y; calMonth = +m - 1;
    renderMonthBar(); rerenderMonthViews();
}
function toggleCreatePanel(open) {
    const p = $("createPanel"); if (!p) return;
    const show = (open === undefined) ? (p.style.display === "none") : open;
    p.style.display = show ? "block" : "none";
    const btn = $("openCreateMonth"); if (btn) btn.classList.toggle("on", show);
    if (show) {
        const [cy, cm] = currentMonth.split("-").map(Number);
        let ny2 = cy, nm2 = cm + 1; if (nm2 > 12) { nm2 = 1; ny2++; }
        if ($("newYear")) $("newYear").value = String(ny2);
        if ($("newMonth")) $("newMonth").value = String(nm2);
        if (p.scrollIntoView) p.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}
function initMonthControls() {
    const ny = $("newYear"), nm = $("newMonth"); const nowY = +REAL_MONTH.slice(0, 4), nowM = +REAL_MONTH.slice(5, 7);
    if (ny) { ny.innerHTML = ""; for (let y = nowY - 2; y <= nowY + 3; y++) ny.insertAdjacentHTML("beforeend", `<option value="${y}" ${y === nowY ? "selected" : ""}>${y}년</option>`); }
    if (nm) { nm.innerHTML = ""; for (let m = 1; m <= 12; m++) nm.insertAdjacentHTML("beforeend", `<option value="${m}" ${m === nowM ? "selected" : ""}>${m}월</option>`); }
    if ($("openCreateMonth")) $("openCreateMonth").addEventListener("click", () => toggleCreatePanel());
    if ($("cancelCreate")) $("cancelCreate").addEventListener("click", () => toggleCreatePanel(false));
    if ($("createMonth")) $("createMonth").addEventListener("click", () => {
        const y = +$("newYear").value, m = +$("newMonth").value;
        const key = `${y}-${String(m).padStart(2, "0")}`;
        const exists = !!ledgers[key];
        createMonth(y, m);
        toggleCreatePanel(false);
        if (exists) setStatus(`${monthLabel(key)} 가계부는 이미 있어서 그 달로 이동했어요.`, "ok");
    });
    if ($("deleteMonth")) $("deleteMonth").addEventListener("click", deleteMonth);
    if ($("monthSelect")) $("monthSelect").addEventListener("change", e => switchMonth(e.target.value));
    if ($("closeMonthBtn")) $("closeMonthBtn").addEventListener("click", closeMonth);
    if ($("undoCloseBtn")) $("undoCloseBtn").addEventListener("click", undoCloseMonth);
}
/* ---------- 대출 엔진 ---------- */
function amort(bal, r, months) { if (months <= 0) return bal; return r === 0 ? bal / months : bal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1); }
function solveGraduated(P, annualRate, n, grace, growth) {
    const r0 = annualRate / 100 / 12;
    function endBal(base) {
        let bal = P;
        for (let i = 1; i <= n; i++) {
            const interest = bal * r0;
            if (i <= grace) { continue; }
            const yr = Math.floor((i - 1 - grace) / 12);
            let pay = base * Math.pow(1 + growth, yr);
            let principal = pay - interest; if (principal > bal) principal = bal;
            bal -= principal; if (bal <= 0) return 0;
        }
        return bal;
    }
    let lo = 0, hi = P;
    for (let it = 0; it < 100; it++) { const mid = (lo + hi) / 2; if (endBal(mid) > 0) lo = mid; else hi = mid; }
    return hi;
}
function loanCalcCustom(l) {
    const P = num(l.principal);
    const pd = Math.max(1, Math.min(31, +l.payDay || 1));
    const entries = (l.customRepays || []).slice()
        .map(e => ({ ym: (e.ym || "").slice(0, 7), principal: num(e.principal), interest: num(e.interest) }))
        .filter(e => /^\d{4}-\d{2}$/.test(e.ym))
        .sort((a, b) => a.ym.localeCompare(b.ym));
    let bal = P, totalInterest = 0, firstPay = 0; const sched = [];
    entries.forEach((e, i) => {
        let principal = Math.min(e.principal, bal); let interest = e.interest;
        bal -= principal; totalInterest += interest;
        const pay = principal + interest;
        if (i === 0) firstPay = pay;
        const last = new Date(+e.ym.slice(0, 4), +e.ym.slice(5, 7), 0).getDate();
        const day = String(Math.min(pd, last)).padStart(2, "0");
        sched.push({ month: i + 1, ym: e.ym, date: `${e.ym}-${day}`, interest, principal, pay, bal: Math.max(0, bal) });
    });
    let remain = P; const tkey = TODAY.slice(0, 7);
    sched.forEach(s => { if (s.ym <= tkey) remain = s.bal; });
    if (!Number.isFinite(firstPay)) firstPay = 0;
    return { firstPay, totalInterest, months: sched.length, sched, remain: remain > 0.5 ? remain : 0 };
}
function loanCalc(l) {
    if (l.repay === "custom") return loanCalcCustom(l);
    const P = num(l.principal), n = Math.max(0, Math.round(+l.term || 0)), grace = Math.max(0, Math.round(+l.grace || 0));
    const baseRate = +l.rate || 0, growth = (+l.growth || 0) / 100;
    const prepays = (l.prepayments || []).slice().map(p => ({ month: +p.month || 0, amount: num(p.amount) })).sort((a, b) => a.month - b.month);
    const rateChanges = (l.rateChanges || []).slice().map(rc => ({ month: +rc.month || 0, rate: +rc.rate || 0 })).sort((a, b) => a.month - b.month);
    function rateAt(i) { let r = baseRate; if (l.rateType === "variable") { rateChanges.forEach(rc => { if (i >= rc.month) r = rc.rate; }); } return r / 100 / 12; }
    if (P <= 0 || n <= 0) return { firstPay: 0, totalInterest: 0, months: 0, sched: [], remain: P > 0 ? P : 0 };
    let gradBase = 0;
    if (l.repay === "graduate") gradBase = solveGraduated(P, baseRate, n, grace, growth) || 0;
    let bal = P, totalInterest = 0, firstPay = 0; const sched = [];
    for (let i = 1; i <= n && bal > 0.5; i++) {
        const r = rateAt(i);
        let interest = bal * r, principal = 0, pay = 0;
        if (i <= grace) { principal = 0; pay = interest; }
        else if (l.repay === "io") { principal = (i === n) ? bal : 0; pay = interest + principal; }
        else if (l.repay === "pr") { const pr = P / Math.max(1, (n - grace)); principal = Math.min(pr, bal); pay = principal + interest; }
        else if (l.repay === "graduate") { const yr = Math.floor((i - 1 - grace) / 12); pay = gradBase * Math.pow(1 + growth, yr); principal = Math.min(Math.max(pay - interest, 0), bal); pay = principal + interest; }
        else { const m = amort(bal, r, n - i + 1); principal = Math.min(m - interest, bal); pay = principal + interest; }
        if (!Number.isFinite(principal)) principal = 0;
        if (!Number.isFinite(interest)) interest = 0;
        if (!Number.isFinite(pay)) pay = 0;
        bal -= principal; totalInterest += interest;
        prepays.filter(p => p.month === i).forEach(p => { const amt = Math.min(p.amount, bal); if (Number.isFinite(amt)) bal -= amt; });
        sched.push({ month: i, interest, principal, pay, bal: Math.max(0, bal) });
        if (i === grace + 1) firstPay = pay;
    }
    if (!firstPay && sched.length) firstPay = sched[0].pay;
    if (!Number.isFinite(firstPay)) firstPay = 0;
    if (!Number.isFinite(totalInterest)) totalInterest = 0;
    let remain = P;
    const startValid = l.start && !isNaN(new Date(l.start).getTime());
    if (startValid) {
        const startDate = new Date(l.start);
        for (let i = 0; i < sched.length; i++) { const d = new Date(startDate); d.setMonth(startDate.getMonth() + i); if (d.toISOString().slice(0, 10) <= TODAY) remain = sched[i].bal; else break; }
    } else if (sched.length) { remain = P; }
    if (!Number.isFinite(remain)) remain = 0;
    return { firstPay, totalInterest, months: sched.length, sched, remain: remain > 0.5 ? remain : 0 };
}
function loanSchedWithDates(l) {
    const c = loanCalc(l);
    if (l.repay === "custom") return c.sched.map(s => ({ ...s }));
    const start = new Date(l.start);
    return c.sched.map((s, i) => { const d = new Date(start); d.setMonth(start.getMonth() + i); return { ...s, date: d.toISOString().slice(0, 10) }; });
}
/* [v9.4] 특정 달에 실제 상환하는 대출 금액 */
function loanPayInMonth(l, monthKey) {
    let sum = 0;
    loanSchedWithDates(l).forEach(s => { if (s.date.slice(0, 7) === monthKey) sum += Math.round(s.pay); });
    return sum;
}
const KIND_LABEL = { bank: "은행", family: "부모님 차용" };
const REPAY_LABEL = { eq: "원리금균등", pr: "원금균등", io: "만기일시", graduate: "원리금체증식", custom: "기타(직접입력)" };
/* ---------- 담당자 기반 필터 ---------- */
function accountsForOwner(owner) { return (!owner || owner === "J") ? accounts : accounts.filter(a => a.owner === owner); }
function cardsForOwner(owner) { return (!owner || owner === "J") ? cards : cards.filter(c => c.owner === owner); }
function accOptions(sel, owner) {
    const list = accountsForOwner(owner);
    if (!list.length) return `<option value="">계좌 없음</option>`;
    return list.map(a => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${ownerName(a.owner)} · ${a.name}</option>`).join("");
}
function validAccForOwner(id, owner) { const list = accountsForOwner(owner); return list.some(a => a.id === id) ? id : (list[0] ? list[0].id : ""); }
function methodOptions(sel, owner) {
    const cs = cardsForOwner(owner), as = accountsForOwner(owner);
    const cardOpts = cs.map(c => `<option value="card:${c.id}" ${sel === "card:" + c.id ? "selected" : ""}>💳 ${c.name}</option>`).join("");
    const accOpts = as.map(a => `<option value="acc:${a.id}" ${sel === "acc:" + a.id ? "selected" : ""}>🏦 ${a.name}</option>`).join("");
    return `${cs.length ? `<optgroup label="카드">${cardOpts}</optgroup>` : ""}${as.length ? `<optgroup label="계좌 직접">${accOpts}</optgroup>` : ""}`;
}
function validMethodForOwner(method, ref, owner) {
    if (method === "card") { const cs = cardsForOwner(owner); if (cs.some(c => c.id === ref)) return { method, ref }; }
    else { const as = accountsForOwner(owner); if (as.some(a => a.id === ref)) return { method, ref }; }
    const cs = cardsForOwner(owner), as = accountsForOwner(owner);
    if (cs[0]) return { method: "card", ref: cs[0].id };
    if (as[0]) return { method: "acc", ref: as[0].id };
    return { method: "acc", ref: "" };
}
/* ---------- 계좌 ---------- */
function accSum(o) { return accounts.filter(a => a.owner === o).reduce((s, a) => s + num(a.amt), 0); }
function renderAccounts() {
    ["A", "B"].forEach(o => {
        const box = $("accList" + o); box.innerHTML = "";
        accounts.forEach(a => {
            if (a.owner !== o) return;
            const row = document.createElement("div"); row.className = "item acc-item";
            row.innerHTML = `<div class="aico">${ACC_ICON[a.type] || "💠"}</div>
        <input type="text" value="${a.name}" data-id="${a.id}" data-k="name" class="nm"/>
        <select data-id="${a.id}" data-k="type" style="color:var(--sub);">${Object.keys(ACC_ICON).map(t => `<option ${t === a.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input type="text" inputmode="numeric" class="amt" value="${fmtNum(a.amt)}" data-id="${a.id}" data-k="amt"/>
        <button class="btn-del" data-del="${a.id}">×</button>`;
            box.appendChild(row);
        });
        $("accSum" + o).textContent = eok(accSum(o));
    });
}
function afterAccountChange() { renderAccounts(); renderPlan(); renderCards(); renderCardLedgers(); renderIncome(); renderExtra("income"); renderExpenses(); renderExtra("expense"); refreshSummary(); }
["accListA", "accListB"].forEach(id => {
    $(id).addEventListener("input", e => {
        const t = e.target, aid = t.dataset.id; if (!aid) return; const a = accounts.find(x => x.id === aid);
        if (t.dataset.k === "amt") { a.amt = parseNum(t.value); t.value = fmtNum(t.value); } else a[t.dataset.k] = t.value;
        $("accSum" + a.owner).textContent = eok(accSum(a.owner)); if ($("planSum" + a.owner)) $("planSum" + a.owner).textContent = eok(accSum(a.owner)); refreshSummary();
    });
    $(id).addEventListener("change", e => {
        const t = e.target, aid = t.dataset.id; if (!aid) return; const a = accounts.find(x => x.id === aid); if (!a) return;
        if (t.dataset.k === "amt") { a.amt = parseNum(t.value); t.value = fmtNum(a.amt); refreshSummary(); }
        else if (t.dataset.k === "type") { a.type = t.value; renderAccounts(); }
    });
    $(id).addEventListener("click", e => { if (e.target.dataset.del) { accounts = accounts.filter(x => x.id !== e.target.dataset.del); afterAccountChange(); } });
});
document.querySelectorAll("[data-add-acc]").forEach(b => b.addEventListener("click", () => { accounts.push({ id: uid(), owner: b.dataset.addAcc, type: "예금", name: "새 계좌", amt: 0 }); afterAccountChange(); }));
/* ---------- Plan 탭 ---------- */
function renderPlan() {
    ["A", "B"].forEach(o => {
        const box = $("planList" + o); if (!box) return; box.innerHTML = "";
        accounts.forEach(a => {
            if (a.owner !== o) return;
            const row = document.createElement("div"); row.className = "item plan-item";
            row.innerHTML = `<div class="aico">${ACC_ICON[a.type] || "💠"}</div>
        <div><div class="nm">${a.name}</div><div class="meta">${a.type}</div></div>
        <input type="text" inputmode="numeric" class="amt" value="${fmtNum(a.amt)}" data-id="${a.id}" data-k="amt"/>`;
            box.appendChild(row);
        });
        if ($("planSum" + o)) $("planSum" + o).textContent = eok(accSum(o));
    });
    renderPlanSummary();
}
function renderPlanSummary() {
    const el = $("planSummary"); if (!el) return;
    const total = accounts.reduce((s, a) => s + num(a.amt), 0);
    el.innerHTML = `<div>📌 기준일 <b>${ANCHOR()}</b></div><div>💰 기준일 계좌 총잔고 <b>${eok(total)}</b></div><div style="color:var(--sub);font-size:11.5px;">이 잔고에서 출발해 수입·지출·상환·카드결제가 반영됩니다.</div>`;
}
["planListA", "planListB"].forEach(id => {
    const box = $(id); if (!box) return;
    const handler = e => {
        const t = e.target, aid = t.dataset.id; if (!aid) return; const a = accounts.find(x => x.id === aid); if (!a) return;
        a.amt = parseNum(t.value); t.value = fmtNum(a.amt);
        if ($("planSum" + a.owner)) $("planSum" + a.owner).textContent = eok(accSum(a.owner));
        if ($("accSum" + a.owner)) $("accSum" + a.owner).textContent = eok(accSum(a.owner));
        renderPlanSummary(); refreshSummary();
    };
    box.addEventListener("input", handler); box.addEventListener("change", handler);
});
if ($("planDate")) { $("planDate").value = TODAY; $("planDate").addEventListener("change", () => { renderPlanSummary(); renderCalendar(); refreshSummary(); }); }
let planMode = false;
function setPlanMode(on) {
    planMode = on;
    const btn = $("planToggle"); const tab = document.querySelector(".tab-plan");
    if (btn) btn.classList.toggle("on", on);
    if (tab) tab.style.display = on ? "" : "none";
    if (on) { renderPlan(); const pt = document.querySelector('.tab-btn[data-tab="plan"]'); if (pt) pt.click(); }
    else { const pt = document.querySelector('.tab-btn[data-tab="plan"]'); if (pt && pt.classList.contains("active")) document.querySelector('.tab-btn[data-tab="home"]').click(); }
}
if ($("planToggle")) $("planToggle").addEventListener("click", () => setPlanMode(!planMode));
/* ---------- 카드 ---------- */
function renderCards() {
    const head = $("cardHead"); if (head) head.innerHTML = `<div></div><div>카드명</div><div>담당</div><div>결제 계좌</div><div>종류</div><div>결제일</div><div></div>`;
    const box = $("cardList"); box.innerHTML = "";
    cards.forEach(c => {
        const row = document.createElement("div"); row.className = "item card-item";
        row.innerHTML = `<div class="aico">💳</div>
      <input type="text" value="${c.name}" data-id="${c.id}" data-k="name" class="nm"/>
      <select data-id="${c.id}" data-k="owner"><option value="A" ${c.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${c.owner === "B" ? "selected" : ""}>${nameOf.B}</option></select>
      <select data-id="${c.id}" data-k="acc">${accOptions(c.acc, c.owner)}</select>
      <select data-id="${c.id}" data-k="kind"><option ${c.kind === "체크" ? "selected" : ""}>체크</option><option ${c.kind === "신용" ? "selected" : ""}>신용</option></select>
      <input type="number" class="payday" data-id="${c.id}" data-k="payDay" value="${c.payDay || 0}" min="0" max="31" title="매월 결제일 (0=즉시/체크)"/>
      <button class="btn-del" data-del="${c.id}">×</button>`;
        box.appendChild(row);
    });
}
$("cardList").addEventListener("input", e => {
    const t = e.target, c = cards.find(x => x.id === t.dataset.id); if (!c) return;
    if (t.dataset.k === "payDay") { c.payDay = Math.max(0, Math.min(31, +t.value || 0)); renderCardLedgers(); refreshSummary(); renderCalendar(); }
    else { c[t.dataset.k] = t.value; renderCardLedgers(); }
});
$("cardList").addEventListener("change", e => {
    const t = e.target, c = cards.find(x => x.id === t.dataset.id); if (!c) return;
    if (t.dataset.k === "payDay") { c.payDay = Math.max(0, Math.min(31, +t.value || 0)); }
    else c[t.dataset.k] = t.value;
    if (t.dataset.k === "owner") { c.acc = validAccForOwner(c.acc, c.owner); renderCards(); }
    renderCardLedgers(); renderExpenses(); refreshSummary(); renderCalendar();
});
$("cardList").addEventListener("click", e => { if (e.target.dataset.del) { cards = cards.filter(x => x.id !== e.target.dataset.del); renderCards(); renderCardLedgers(); renderExpenses(); refreshSummary(); renderCalendar(); } });
$("addCard").addEventListener("click", () => { const a = accounts[0]; cards.push({ id: uid(), owner: "A", name: "새 카드", kind: "신용", acc: validAccForOwner(a ? a.id : "", "A"), payDay: 14 }); renderCards(); renderCardLedgers(); renderExpenses(); });
/* ---------- 카드 세부내역 ---------- */
function txnsOfCard(cardId) { return cardTxns.filter(t => t.cardId === cardId); }
function renderCardLedgers() {
    const box = $("cardLedgers"); if (!box) return; box.innerHTML = "";
    const credit = cards.filter(c => c.kind === "신용");
    if (!credit.length) { box.innerHTML = `<div style="color:var(--sub);font-size:13px;">신용카드를 추가하면 세부내역을 기록할 수 있어요.</div>`; return; }
    credit.forEach(c => {
        c.acc = validAccForOwner(c.acc, c.owner);
        const acc = accounts.find(a => a.id === c.acc);
        const list = txnsOfCard(c.id);
        const total = list.reduce((s, t) => s + num(t.amt), 0);
        const wrap = document.createElement("div"); wrap.className = "card-ledger";
        let rows = `<div class="txn-head"><div>사용일</div><div>항목</div><div>담당</div><div>금액</div><div></div></div>`;
        list.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
            rows += `<div class="txn-row">
        <input type="date" value="${t.date}" data-tx="${t.id}" data-k="date"/>
        <input type="text" value="${t.item}" data-tx="${t.id}" data-k="item" placeholder="항목"/>
        <select data-tx="${t.id}" data-k="owner"><option value="A" ${t.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${t.owner === "B" ? "selected" : ""}>${nameOf.B}</option><option value="J" ${t.owner === "J" ? "selected" : ""}>공동</option></select>
        <input type="text" inputmode="numeric" class="amt" value="${fmtNum(t.amt)}" data-tx="${t.id}" data-k="amt"/>
        <button class="btn-del" data-txdel="${t.id}">×</button></div>`;
        });
        wrap.innerHTML = `<div class="cl-head">
        <div class="cl-title">💳 ${c.name} <span class="pill pill-muted">${ownerName(c.owner)}</span> <span class="pill pill-muted">결제일 ${c.payDay ? c.payDay + "일" : "즉시"} · ${acc ? acc.name : "계좌미지정"}</span></div>
        <div class="cl-total">${monthLabel(currentMonth)} 합계 ${won(total)}</div>
      </div>${rows}
      <button class="btn-add" data-txadd="${c.id}" style="margin-top:8px;">＋ 사용내역 추가</button>`;
        box.appendChild(wrap);
    });
}
function cardLedgerAmt(t, tx) { tx.amt = parseNum(t.value); t.value = fmtNum(tx.amt); const tot = txnsOfCard(tx.cardId).reduce((s, x) => s + num(x.amt), 0); const wrap = t.closest(".card-ledger"); if (wrap) wrap.querySelector(".cl-total").textContent = monthLabel(currentMonth) + " 합계 " + won(tot); }
$("cardLedgers").addEventListener("input", e => {
    const t = e.target, txid = t.dataset.tx; if (!txid) return; const tx = cardTxns.find(x => x.id === txid);
    if (t.dataset.k === "amt") cardLedgerAmt(t, tx); else tx[t.dataset.k] = t.value;
    refreshSummary(); renderCalendar();
});
$("cardLedgers").addEventListener("change", e => {
    const t = e.target, txid = t.dataset.tx; if (!txid) return; const tx = cardTxns.find(x => x.id === txid); if (!tx) return;
    if (t.dataset.k === "amt") cardLedgerAmt(t, tx); else tx[t.dataset.k] = t.value;
    refreshSummary(); renderCalendar();
});
$("cardLedgers").addEventListener("click", e => {
    if (e.target.dataset.txadd) { cardTxns.push({ id: uid(), cardId: e.target.dataset.txadd, date: ledgerDefaultDate(), item: "새 사용내역", amt: 0, owner: "J" }); renderCardLedgers(); }
    if (e.target.dataset.txdel) { setLedgerArr("cardTxns", cardTxns.filter(x => x.id !== e.target.dataset.txdel)); renderCardLedgers(); refreshSummary(); renderCalendar(); }
});
/* ---------- 대출 렌더 + 모달 ---------- */
function totalDebtRemain() { return loans.reduce((s, l) => s + fin(loanCalc(l).remain), 0); }
function monthlyPayTotal() { return loans.reduce((s, l) => s + fin(loanCalc(l).firstPay), 0); }
function renderLoans() {
    const box = $("loanList"); box.innerHTML = "";
    loans.forEach(l => {
        const c = loanCalc(l);
        const ownerPill = l.owner === "A" ? "pill-a" : l.owner === "B" ? "pill-b" : "pill-family";
        const kindPill = l.kind === "family" ? "pill-family" : "pill-bank";
        const firstDate = l.repay === "custom" ? (loanSchedWithDates(l)[0] ? loanSchedWithDates(l)[0].date : "-") : l.start;
        const tags = [`<span class="pill ${ownerPill}">${ownerName(l.owner)}</span>`, `<span class="pill ${kindPill}">${KIND_LABEL[l.kind]}</span>`, `<span class="pill pill-muted">${REPAY_LABEL[l.repay]}</span>`];
        if (l.repay !== "custom") tags.push(`<span class="pill pill-muted">매월 ${l.payDay}일</span>`);
        else tags.push(`<span class="pill pill-muted">${c.months}회 직접입력</span>`);
        if (l.repay === "graduate") tags.push(`<span class="pill pill-muted">체증 ${l.growth}%/년</span>`);
        if (l.rateType === "variable") tags.push(`<span class="pill pill-muted">변동금리</span>`);
        if (l.grace > 0) tags.push(`<span class="pill pill-muted">거치 ${l.grace}개월</span>`);
        if (l.prepayments && l.prepayments.length) tags.push(`<span class="pill" style="background:var(--plus-bg);color:var(--plus)">중도상환 ${l.prepayments.length}회</span>`);
        const wAcc = accounts.find(a => a.id === validAccForOwner(l.acc, l.owner));
        if (wAcc) tags.push(`<span class="pill pill-muted">💸 ${wAcc.name}</span>`);
        const div = document.createElement("div"); div.className = "loan";
        div.innerHTML = `<div class="top">
        <div><div class="title">${l.name}</div><div class="tags">${tags.join("")}</div></div>
        <div class="acts"><button class="detail-btn" data-detail="${l.id}">📅 상세보기</button><button class="btn-edit" data-edit="${l.id}">✏️</button><button class="btn-del" data-del="${l.id}">×</button></div>
      </div>
      <div class="loan-stats">
        <div class="cell"><div class="k">잔여 원금</div><div class="v">${eok(c.remain)}</div></div>
        <div class="cell"><div class="k">연 금리</div><div class="v">${l.repay === "custom" ? "직접입력" : l.rate + "%" + (l.rateType === "variable" ? "~" : "")}</div></div>
        <div class="cell"><div class="k">${l.repay === "graduate" ? "초기 월상환" : l.repay === "custom" ? "첫 상환액" : "월 상환액"}</div><div class="v" style="color:var(--minus)">${eok(c.firstPay)}</div></div>
        <div class="cell"><div class="k">총 이자</div><div class="v">${eok(c.totalInterest)}</div></div>
      </div>
      <div class="bar"><span style="width:${Math.round((1 - c.remain / num(l.principal)) * 100)}%"></span></div>
      <div class="meta" style="font-size:11.5px;color:var(--sub);margin-top:8px;">원금 ${eok(l.principal)} · ${l.repay === "custom" ? `${c.months}회 직접입력` : `기간 ${Math.round(l.term / 12 * 10) / 10}년(${l.term}개월)`} · 첫 상환 ${firstDate} · 총 상환 ${eok(num(l.principal) + c.totalInterest)}</div>`;
        box.appendChild(div);
    });
    $("loanTotalPill").textContent = "총 부채 " + eok(totalDebtRemain());
}
$("loanList").addEventListener("click", e => {
    if (e.target.dataset.del) { loans = loans.filter(x => x.id !== e.target.dataset.del); renderLoans(); refreshSummary(); renderCalendar(); renderUpcoming(); }
    if (e.target.dataset.edit) openLoanModal(e.target.dataset.edit);
    if (e.target.dataset.detail) openSchedModal(e.target.dataset.detail);
});
let schedLoanId = null;
function openSchedModal(id) {
    schedLoanId = id; const l = loans.find(x => x.id === id); if (!l) return;
    $("schedTitle").textContent = `📅 ${l.name} 상환 스케줄`;
    const c = loanCalc(l);
    $("schedSummary").innerHTML = `
    <div class="box"><div class="k">월 상환액${l.repay === "graduate" ? "(초기)" : l.repay === "custom" ? "(첫 회차)" : ""}</div><div class="v" style="color:var(--minus)">${won(Math.round(c.firstPay))}</div></div>
    <div class="box"><div class="k">총 상환기간</div><div class="v">${c.months}회</div></div>
    <div class="box"><div class="k">총 이자</div><div class="v">${eok(c.totalInterest)}</div></div>
    <div class="box"><div class="k">총 상환액</div><div class="v">${eok(num(l.principal) + c.totalInterest)}</div></div>`;
    renderSchedTable();
    $("schedModal").classList.add("on");
}
function renderSchedTable() {
    const l = loans.find(x => x.id === schedLoanId); if (!l) return;
    const rows = loanSchedWithDates(l);
    const range = $("schedRange") ? $("schedRange").value : "12";
    let view = rows;
    if (range !== "all") { const future = rows.filter(r => r.date >= TODAY); view = future.slice(0, +range); }
    let html = `<thead><tr><th>회차 / 날짜</th><th>납입금</th><th>원금</th><th>이자</th><th>잔여원금</th></tr></thead><tbody>`;
    let lastYear = null;
    view.forEach(r => {
        const yr = r.date.slice(0, 4);
        if (yr !== lastYear) { html += `<tr class="year-sep"><td colspan="5">${yr}년</td></tr>`; lastYear = yr; }
        const done = r.date < TODAY;
        html += `<tr class="${done ? "done" : ""}"><td>${r.month}회 · ${r.date}${done ? " ✓" : ""}</td><td>${won(Math.round(r.pay))}</td><td class="p">${won(Math.round(r.principal))}</td><td class="i">${won(Math.round(r.interest))}</td><td>${won(Math.round(r.bal))}</td></tr>`;
    });
    if (!view.length) html += `<tr><td colspan="5" style="text-align:center;color:var(--sub);padding:16px;">표시할 회차가 없어요.</td></tr>`;
    html += `</tbody>`;
    $("schedTable").innerHTML = html;
}
if ($("schedRange")) $("schedRange").addEventListener("change", renderSchedTable);
if ($("closeSched")) $("closeSched").addEventListener("click", () => $("schedModal").classList.remove("on"));
$("schedModal").addEventListener("click", e => { if (e.target.id === "schedModal") $("schedModal").classList.remove("on"); });
let editingLoanId = null, modalRateChanges = [], modalPrepays = [], modalCustomRepays = [];
function renderRateChanges() { const box = $("rateChangeList"); box.innerHTML = ""; modalRateChanges.forEach((rc, i) => { const row = document.createElement("div"); row.className = "sg-row"; row.innerHTML = `<input type="number" placeholder="개월차" value="${rc.month}" data-rc="${i}" data-k="month"/><input type="number" step="0.1" placeholder="금리 %" value="${rc.rate}" data-rc="${i}" data-k="rate"/><button class="btn-del" data-rcdel="${i}">×</button>`; box.appendChild(row); }); }
function renderPrepays() { const box = $("prepayList"); box.innerHTML = ""; modalPrepays.forEach((p, i) => { const row = document.createElement("div"); row.className = "sg-row"; row.innerHTML = `<input type="number" placeholder="개월차" value="${p.month}" data-pp="${i}" data-k="month"/><input type="text" inputmode="numeric" placeholder="상환액(원)" value="${fmtNum(p.amount)}" data-pp="${i}" data-k="amount"/><button class="btn-del" data-ppdel="${i}">×</button>`; box.appendChild(row); }); }
function renderCustomRepays() {
    const box = $("customRepayList"); if (!box) return; box.innerHTML = "";
    modalCustomRepays.forEach((r, i) => {
        const row = document.createElement("div"); row.className = "sg-row cr-row";
        row.innerHTML = `<input type="month" value="${r.ym || ""}" data-cr="${i}" data-k="ym"/><input type="text" inputmode="numeric" placeholder="원금(원)" value="${fmtNum(r.principal)}" data-cr="${i}" data-k="principal"/><input type="text" inputmode="numeric" placeholder="이자(원)" value="${fmtNum(r.interest)}" data-cr="${i}" data-k="interest"/><button class="btn-del" data-crdel="${i}">×</button>`;
        box.appendChild(row);
    });
}
function updateModalPreview() {
    const l = collectModalLoan(); const c = loanCalc(l);
    $("previewPay").textContent = eok(c.firstPay) + (l.repay === "graduate" ? " (초기)" : l.repay === "custom" ? " (첫 회차)" : "");
    $("previewInt").textContent = eok(c.totalInterest);
    if (l.repay === "custom") {
        $("customHint").style.display = "block";
        const list = l.customRepays || [];
        const totPrin = list.reduce((s, e) => s + num(e.principal), 0);
        const totInt = list.reduce((s, e) => s + num(e.interest), 0);
        $("customHint").innerHTML = list.length
            ? `총 <b>${list.length}회</b> · 원금 합계 ${won(totPrin)} + 이자 합계 ${won(totInt)} = <b>${won(totPrin + totInt)}</b> · 잔여원금 ${won(c.remain)}`
            : `⚠️ 아래 <b>＋ 회차 추가</b>로 상환 월(YYYY-MM)·원금·이자를 입력하세요.`;
    } else $("customHint").style.display = "none";
}
function collectModalLoan() {
    return { id: editingLoanId || "preview", name: $("lName").value || "새 대출", owner: $("lOwner").value, kind: $("lKind").value, principal: parseNum($("lPrincipal").value), rate: +$("lRate").value || 0, term: +$("lTerm").value || 12, repay: $("lRepay").value, start: $("lStart").value || TODAY, payDay: +$("lPayDay").value || 25, fixed: 0, grace: +$("lGrace").value || 0, growth: +$("lGrowth").value || 0, rateType: $("lRateType").value, rateChanges: modalRateChanges.slice(), prepayments: modalPrepays.slice(), customRepays: modalCustomRepays.slice(), acc: ($("lWithdrawAcc") ? $("lWithdrawAcc").value : "") };
}
function fillWithdrawAccOptions(owner, selected) {
    const el = $("lWithdrawAcc"); if (!el) return;
    el.innerHTML = accOptions(validAccForOwner(selected, owner), owner);
}
function syncRepayFields() { const rp = $("lRepay").value; $("lCustomWrap").style.display = rp === "custom" ? "block" : "none"; $("lGrowthWrap").style.display = rp === "graduate" ? "block" : "none"; }
function openLoanModal(id) {
    editingLoanId = id || null;
    const l = id ? loans.find(x => x.id === id) : { name: "", owner: "A", kind: "bank", principal: 0, rate: 4.2, term: 360, repay: "eq", start: TODAY, payDay: 25, grace: 0, growth: 1.5, rateType: "fixed", rateChanges: [], prepayments: [], customRepays: [], acc: "" };
    $("loanModalTitle").textContent = id ? "✏️ 대출 수정" : "🏦 대출 등록";
    $("lName").value = l.name; $("lOwner").value = l.owner; $("lKind").value = l.kind;
    $("lPrincipal").value = fmtNum(l.principal); $("lRate").value = l.rate; $("lTerm").value = l.term; $("lRepay").value = l.repay;
    $("lStart").value = l.start; $("lPayDay").value = l.payDay; $("lGrace").value = l.grace || 0;
    $("lGrowth").value = l.growth || 1.5; $("lRateType").value = l.rateType || "fixed";
    fillWithdrawAccOptions(l.owner, l.acc);
    modalRateChanges = (l.rateChanges || []).map(x => ({ ...x })); modalPrepays = (l.prepayments || []).map(x => ({ ...x }));
    modalCustomRepays = (l.customRepays || []).map(x => ({ ...x }));
    syncRepayFields(); $("rateChangeWrap").style.display = l.rateType === "variable" ? "block" : "none";
    renderRateChanges(); renderPrepays(); renderCustomRepays(); updateModalPreview();
    $("loanModal").classList.add("on");
}
function closeLoanModal() { $("loanModal").classList.remove("on"); }
$("openAddLoan").addEventListener("click", () => openLoanModal(null));
$("cancelLoan").addEventListener("click", closeLoanModal);
$("loanModal").addEventListener("click", e => { if (e.target.id === "loanModal") closeLoanModal(); });
["lName", "lOwner", "lKind", "lPrincipal", "lRate", "lTerm", "lStart", "lPayDay", "lGrace", "lGrowth"].forEach(id => { if ($(id)) $(id).addEventListener("input", updateModalPreview); });
$("lRepay").addEventListener("change", () => { syncRepayFields(); updateModalPreview(); });
$("lOwner").addEventListener("change", () => { fillWithdrawAccOptions($("lOwner").value, $("lWithdrawAcc") ? $("lWithdrawAcc").value : ""); updateModalPreview(); });
$("lRateType").addEventListener("change", () => { $("rateChangeWrap").style.display = $("lRateType").value === "variable" ? "block" : "none"; updateModalPreview(); });
$("lKind").addEventListener("change", () => { if ($("lKind").value === "family") { $("lRate").value = 0; $("lRepay").value = "custom"; syncRepayFields(); } updateModalPreview(); });
$("addRateChange").addEventListener("click", () => { modalRateChanges.push({ month: 60, rate: 5 }); renderRateChanges(); updateModalPreview(); });
$("addPrepay").addEventListener("click", () => { modalPrepays.push({ month: 12, amount: 10000000 }); renderPrepays(); updateModalPreview(); });
$("addCustomRepay").addEventListener("click", () => { const base = ($("lStart").value || TODAY).slice(0, 7); modalCustomRepays.push({ ym: base, principal: 0, interest: 0 }); renderCustomRepays(); updateModalPreview(); });
$("customRepayList").addEventListener("input", e => { const t = e.target; if (t.dataset.cr === undefined) return; const k = t.dataset.k; if (k === "ym") { modalCustomRepays[+t.dataset.cr].ym = t.value; } else { modalCustomRepays[+t.dataset.cr][k] = parseNum(t.value); t.value = fmtNum(t.value); } updateModalPreview(); });
$("customRepayList").addEventListener("click", e => { if (e.target.dataset.crdel !== undefined) { modalCustomRepays.splice(+e.target.dataset.crdel, 1); renderCustomRepays(); updateModalPreview(); } });
$("rateChangeList").addEventListener("input", e => { const t = e.target; if (t.dataset.rc === undefined) return; modalRateChanges[+t.dataset.rc][t.dataset.k] = +t.value || 0; updateModalPreview(); });
$("rateChangeList").addEventListener("click", e => { if (e.target.dataset.rcdel !== undefined) { modalRateChanges.splice(+e.target.dataset.rcdel, 1); renderRateChanges(); updateModalPreview(); } });
$("prepayList").addEventListener("input", e => { const t = e.target; if (t.dataset.pp === undefined) return; const k = t.dataset.k; modalPrepays[+t.dataset.pp][k] = k === "amount" ? parseNum(t.value) : (+t.value || 0); if (k === "amount") t.value = fmtNum(t.value); updateModalPreview(); });
$("prepayList").addEventListener("click", e => { if (e.target.dataset.ppdel !== undefined) { modalPrepays.splice(+e.target.dataset.ppdel, 1); renderPrepays(); updateModalPreview(); } });
$("saveLoan").addEventListener("click", () => {
    const data = collectModalLoan(); delete data.id;
    if (editingLoanId) { const l = loans.find(x => x.id === editingLoanId); Object.assign(l, data); }
    else loans.push({ id: uid(), ...data });
    closeLoanModal(); renderLoans(); refreshSummary(); renderCalendar(); renderUpcoming();
});
/* ---------- 고정 수입 ---------- */
function renderIncome() {
    const box = $("incomeList"); box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", `<div class="item" style="grid-template-columns:1.2fr 0.8fr 1fr 0.6fr 1.4fr 34px;background:transparent;border:none;padding:4px 15px;color:var(--sub);font-size:11.5px;font-weight:700;"><div>항목</div><div>담당</div><div>월 금액</div><div>입금일</div><div>입금 계좌</div><div></div></div>`);
    incomes.forEach(inc => {
        const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "1.2fr 0.8fr 1fr 0.6fr 1.4fr 34px";
        row.innerHTML = `<input type="text" value="${inc.name}" data-id="${inc.id}" data-k="name" class="nm"/>
      <select data-id="${inc.id}" data-k="owner"><option value="A" ${inc.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${inc.owner === "B" ? "selected" : ""}>${nameOf.B}</option></select>
      <input type="text" inputmode="numeric" class="amt" value="${fmtNum(inc.amt)}" data-id="${inc.id}" data-k="amt"/>
      <input type="number" value="${inc.payDay}" data-id="${inc.id}" data-k="payDay" min="1" max="31"/>
      <select data-id="${inc.id}" data-k="acc">${accOptions(inc.acc, inc.owner)}</select>
      <button class="btn-del" data-del="${inc.id}">×</button>`;
        box.appendChild(row);
    });
}
function incomeSet(t) {
    const inc = incomes.find(x => x.id === t.dataset.id); if (!inc) return null; const k = t.dataset.k;
    if (k === "amt") { inc.amt = parseNum(t.value); t.value = fmtNum(inc.amt); }
    else if (k === "payDay") { inc.payDay = +t.value || 1; }
    else inc[k] = t.value;
    return { inc, k };
}
$("incomeList").addEventListener("input", e => { if (e.target.dataset.id === undefined) return; incomeSet(e.target); refreshSummary(); });
$("incomeList").addEventListener("change", e => {
    if (e.target.dataset.id === undefined) return; const r = incomeSet(e.target); if (!r) return;
    if (r.k === "owner") { r.inc.acc = validAccForOwner(r.inc.acc, r.inc.owner); renderIncome(); }
    refreshSummary(); renderCalendar(); renderUpcoming();
});
$("incomeList").addEventListener("click", e => { if (e.target.dataset.del) { setLedgerArr("incomes", incomes.filter(x => x.id !== e.target.dataset.del)); renderIncome(); refreshSummary(); renderCalendar(); } });
$("addIncome").addEventListener("click", () => { incomes.push({ id: uid(), owner: "A", name: "새 수입", amt: 0, payDay: 25, acc: validAccForOwner("", "A") }); renderIncome(); refreshSummary(); });
/* ---------- 기타 수입/지출 ---------- */
function renderExtra(kind) {
    const list = kind === "income" ? extraIncomes : extraExpenses;
    const boxId = kind === "income" ? "extraIncomeList" : "extraExpenseList";
    const box = $(boxId); box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", `<div class="item" style="grid-template-columns:1.2fr 0.7fr 0.9fr 0.8fr 1fr 1.2fr 34px;background:transparent;border:none;padding:4px 15px;color:var(--sub);font-size:11.5px;font-weight:700;"><div>항목</div><div>담당</div><div>금액</div><div>반복</div><div>발생일/날짜</div><div>${kind === "income" ? "입금" : "출금"} 계좌</div><div></div></div>`);
    list.forEach(it => {
        const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "1.2fr 0.7fr 0.9fr 0.8fr 1fr 1.2fr 34px";
        const dateField = it.freq === "once"
            ? `<input type="date" value="${it.date}" data-id="${it.id}" data-k="date"/>`
            : `<input type="number" value="${it.day}" data-id="${it.id}" data-k="day" min="1" max="31" title="매월 며칠"/>`;
        row.innerHTML = `<input type="text" value="${it.name}" data-id="${it.id}" data-k="name" class="nm"/>
      <select data-id="${it.id}" data-k="owner"><option value="A" ${it.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${it.owner === "B" ? "selected" : ""}>${nameOf.B}</option><option value="J" ${it.owner === "J" ? "selected" : ""}>공동</option></select>
      <input type="text" inputmode="numeric" class="amt" value="${fmtNum(it.amt)}" data-id="${it.id}" data-k="amt"/>
      <select data-id="${it.id}" data-k="freq"><option value="once" ${it.freq === "once" ? "selected" : ""}>1회성</option><option value="monthly" ${it.freq === "monthly" ? "selected" : ""}>매월</option></select>
      ${dateField}
      <select data-id="${it.id}" data-k="acc">${accOptions(it.acc, it.owner)}</select>
      <button class="btn-del" data-del="${it.id}">×</button>`;
        box.appendChild(row);
    });
}
function bindExtra(kind) {
    const list = () => kind === "income" ? extraIncomes : extraExpenses;
    const arrName = kind === "income" ? "extraIncomes" : "extraExpenses";
    const boxId = kind === "income" ? "extraIncomeList" : "extraExpenseList";
    const setVal = (t) => {
        const it = list().find(x => x.id === t.dataset.id); if (!it) return null; const k = t.dataset.k;
        if (k === "amt") { it.amt = parseNum(t.value); t.value = fmtNum(it.amt); }
        else if (k === "day") { it.day = +t.value || 1; }
        else it[k] = t.value;
        return { it, k };
    };
    $(boxId).addEventListener("input", e => { if (e.target.dataset.id === undefined) return; setVal(e.target); refreshSummary(); });
    $(boxId).addEventListener("change", e => {
        if (e.target.dataset.id === undefined) return; const r = setVal(e.target); if (!r) return;
        if (r.k === "owner") r.it.acc = validAccForOwner(r.it.acc, r.it.owner);
        if (r.k === "freq" || r.k === "owner") renderExtra(kind);
        refreshSummary(); renderCalendar(); renderUpcoming();
    });
    $(boxId).addEventListener("click", e => {
        if (e.target.dataset.del) { setLedgerArr(arrName, list().filter(x => x.id !== e.target.dataset.del)); renderExtra(kind); refreshSummary(); renderCalendar(); renderUpcoming(); }
    });
}
bindExtra("income"); bindExtra("expense");
$("addExtraIncome").addEventListener("click", () => { extraIncomes.push({ id: uid(), owner: "A", name: "새 기타수입", amt: 0, freq: "once", date: ledgerDefaultDate(), day: 25, acc: validAccForOwner("", "A") }); renderExtra("income"); refreshSummary(); renderCalendar(); });
$("addExtraExpense").addEventListener("click", () => { extraExpenses.push({ id: uid(), owner: "J", name: "새 기타지출", amt: 0, freq: "once", date: ledgerDefaultDate(), day: 1, acc: validAccForOwner("", "J") }); renderExtra("expense"); refreshSummary(); renderCalendar(); });
/* ---------- 고정 지출 ---------- */
function cardOf(id) { return cards.find(c => c.id === id); }
function renderExpenses() {
    const box = $("expenseList"); box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", `<div class="item" style="grid-template-columns:1.3fr 0.7fr 1fr 0.5fr 1.5fr 34px;background:transparent;border:none;padding:4px 15px;color:var(--sub);font-size:11.5px;font-weight:700;"><div>항목</div><div>담당</div><div>월 금액</div><div>결제일</div><div>결제수단</div><div></div></div>`);
    expenses.forEach(ex => {
        const sel = ex.method + ":" + ex.ref;
        const isCard = ex.method === "card";
        const card = isCard ? cardOf(ex.ref) : null;
        const dayField = isCard
            ? `<input type="text" class="payday card-day" value="${card ? (card.payDay ? card.payDay + "일" : "즉시") : "-"}" data-id="${ex.id}" data-k="dayView" title="카드 결제일은 계좌·카드 탭에서 지정합니다" readonly disabled/>`
            : `<input type="number" value="${ex.day}" data-id="${ex.id}" data-k="day" min="1" max="31"/>`;
        const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "1.3fr 0.7fr 1fr 0.5fr 1.5fr 34px";
        row.innerHTML = `<input type="text" value="${ex.name}" data-id="${ex.id}" data-k="name" class="nm"/>
      <select data-id="${ex.id}" data-k="owner"><option value="A" ${ex.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${ex.owner === "B" ? "selected" : ""}>${nameOf.B}</option><option value="J" ${ex.owner === "J" ? "selected" : ""}>공동</option></select>
      <input type="text" inputmode="numeric" class="amt" value="${fmtNum(ex.amt)}" data-id="${ex.id}" data-k="amt"/>
      ${dayField}
      <select data-id="${ex.id}" data-k="pay">${methodOptions(sel, ex.owner)}</select>
      <button class="btn-del" data-del="${ex.id}">×</button>`;
        box.appendChild(row);
    });
}
function expenseSet(t) {
    const ex = expenses.find(x => x.id === t.dataset.id); if (!ex) return null; const k = t.dataset.k;
    if (k === "amt") { ex.amt = parseNum(t.value); t.value = fmtNum(ex.amt); }
    else if (k === "day") { ex.day = +t.value || 1; }
    else if (k === "dayView") { }
    else if (k === "pay") { const [m, r] = t.value.split(":"); ex.method = m; ex.ref = r; }
    else ex[k] = t.value;
    return { ex, k };
}
$("expenseList").addEventListener("input", e => { if (e.target.dataset.id === undefined) return; expenseSet(e.target); refreshSummary(); });
$("expenseList").addEventListener("change", e => {
    if (e.target.dataset.id === undefined) return; const r = expenseSet(e.target); if (!r) return;
    if (r.k === "owner") { const v = validMethodForOwner(r.ex.method, r.ex.ref, r.ex.owner); r.ex.method = v.method; r.ex.ref = v.ref; renderExpenses(); }
    if (r.k === "pay") { renderExpenses(); }
    refreshSummary(); renderCalendar(); renderUpcoming();
});
$("expenseList").addEventListener("click", e => { if (e.target.dataset.del) { setLedgerArr("expenses", expenses.filter(x => x.id !== e.target.dataset.del)); renderExpenses(); refreshSummary(); renderCalendar(); } });
$("addExpense").addEventListener("click", () => { const v = validMethodForOwner("acc", "", "J"); expenses.push({ id: uid(), name: "새 지출", amt: 0, owner: "J", method: v.method, ref: v.ref, day: 1 }); renderExpenses(); refreshSummary(); });
/* ---------- 이벤트 빌드 (월 단위) ---------- */
function ymd(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; }
function nthDayOfMonth(y, m, day) { const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(day, last)); }
function eventsForMonth(y, mo) {
    const key = `${y}-${String(mo + 1).padStart(2, "0")}`;
    const L = ledgers[key];
    const ev = [];
    loans.forEach(l => { loanSchedWithDates(l).forEach(s => { const d = new Date(s.date); if (d.getFullYear() === y && d.getMonth() === mo) ev.push({ date: s.date, label: `${l.name} 상환`, sub: `${ownerName(l.owner)} · ${REPAY_LABEL[l.repay]}`, amt: -Math.round(s.pay), type: "loan", owner: l.owner, cash: true }); }); });
    [...cfA.map(e => ({ ...e, h: $("houseA").value, o: $("houseAOwner").value })), ...cfB.map(e => ({ ...e, h: $("houseB").value, o: $("houseBOwner").value }))].forEach(e => { const d = new Date(e.date); if (d.getFullYear() === y && d.getMonth() === mo) ev.push({ date: e.date, label: `${e.h} · ${e.label}`, sub: `${ownerName(e.o)} 주택자금`, amt: num(e.amt), type: "house", owner: e.o, cash: true }); });
    if (L) {
        L.incomes.forEach(inc => { const d = nthDayOfMonth(y, mo, +inc.payDay || 1); const acc = accounts.find(a => a.id === inc.acc); ev.push({ date: ymd(d), label: inc.name, sub: `${ownerName(inc.owner)} 수입 · ${acc ? acc.name : ""}`, amt: num(inc.amt), type: "income", owner: inc.owner, cash: true }); });
        L.extraIncomes.forEach(x => { if (x.freq === "monthly") { const d = nthDayOfMonth(y, mo, +x.day || 1); const acc = accounts.find(a => a.id === x.acc); ev.push({ date: ymd(d), label: x.name, sub: `${ownerName(x.owner)} 기타수입(매월) · ${acc ? acc.name : ""}`, amt: num(x.amt), type: "extra-income", owner: x.owner, cash: true }); } else if (x.date && x.date.slice(0, 7) === key) { const acc = accounts.find(a => a.id === x.acc); ev.push({ date: x.date, label: x.name, sub: `${ownerName(x.owner)} 기타수입 · ${acc ? acc.name : ""}`, amt: num(x.amt), type: "extra-income", owner: x.owner, cash: true }); } });
        L.expenses.filter(e => e.method === "acc").forEach(ex => { const acc = accounts.find(a => a.id === ex.ref); ev.push({ date: ymd(nthDayOfMonth(y, mo, +ex.day || 1)), label: ex.name, sub: `${ownerName(ex.owner)} 지출 · ${acc ? acc.name : "계좌"}`, amt: -num(ex.amt), type: "expense", owner: ex.owner, cash: true }); });
        L.extraExpenses.forEach(x => { if (x.freq === "monthly") { const acc = accounts.find(a => a.id === x.acc); ev.push({ date: ymd(nthDayOfMonth(y, mo, +x.day || 1)), label: x.name, sub: `${ownerName(x.owner)} 기타지출(매월) · ${acc ? acc.name : ""}`, amt: -num(x.amt), type: "extra-expense", owner: x.owner, cash: true }); } else if (x.date && x.date.slice(0, 7) === key) { const acc = accounts.find(a => a.id === x.acc); ev.push({ date: x.date, label: x.name, sub: `${ownerName(x.owner)} 기타지출 · ${acc ? acc.name : ""}`, amt: -num(x.amt), type: "extra-expense", owner: x.owner, cash: true }); } });
        cards.forEach(c => {
            const acc = accounts.find(a => a.id === c.acc);
            const recur = L.expenses.filter(e => e.method === "card" && e.ref === c.id);
            const items = [];
            recur.forEach(ex => items.push({ label: ex.name, amt: num(ex.amt), owner: ex.owner, sub: "고정지출" }));
            const monthTx = L.cardTxns.filter(t => t.cardId === c.id);
            monthTx.forEach(t => { items.push({ label: t.item, amt: num(t.amt), owner: t.owner, sub: "카드사용" }); ev.push({ date: t.date, label: `${t.item}`, sub: `${ownerName(t.owner)} · ${c.name} 사용(비현금)`, amt: -num(t.amt), type: "carduse", owner: t.owner, cash: false, cardName: c.name }); });
            const total = items.reduce((s, x) => s + x.amt, 0);
            if (total > 0) { const payDay = c.kind === "신용" && +c.payDay > 0 ? +c.payDay : (recur[0] ? +recur[0].day || 1 : 1); ev.push({ date: ymd(nthDayOfMonth(y, mo, payDay)), label: `${c.name} 결제`, sub: `${acc ? acc.name : "계좌"}에서 합산 출금 · ${items.length}건`, amt: -total, type: "cardpay", owner: c.owner, cash: true, items: items }); }
        });
    }
    return ev.sort((a, b) => a.date.localeCompare(b.date));
}
function futureEvents() {
    const ev = []; const base = new Date(TODAY); base.setDate(1);
    for (let m = 0; m <= 12; m++) { const dt = new Date(base.getFullYear(), base.getMonth() + m, 1); ev.push(...eventsForMonth(dt.getFullYear(), dt.getMonth())); }
    return ev.filter(e => e.cash && e.date >= TODAY).sort((a, b) => a.date.localeCompare(b.date));
}
function loanRepayEvents() { const ev = []; loans.forEach(l => { loanSchedWithDates(l).forEach(s => { ev.push({ date: s.date, amt: -Math.round(s.pay) }); }); }); return ev.sort((a, b) => a.date.localeCompare(b.date)); }
function ownerShare(ev, owner) {
    if (!ev.cash) return 0;
    if (ev.type === "cardpay" && ev.items) { let s = 0; ev.items.forEach(it => { if (it.owner === owner) s += it.amt; else if (it.owner === "J") s += it.amt / 2; }); return -s; }
    if (ev.owner === owner) return ev.amt;
    if (ev.owner === "J") return ev.amt / 2;
    return 0;
}
function balanceAsOf(owner, dateStr, events) {
    const anchor = ANCHOR();
    let bal = accSum(owner);
    events.forEach(ev => { if (!ev.cash) return; const sh = ownerShare(ev, owner); if (ev.date > anchor && ev.date <= dateStr) bal += sh; else if (ev.date <= anchor && ev.date > dateStr) bal -= sh; });
    return fin(bal);
}
/* ---------- 캘린더 ---------- */
let calYear, calMonth, selectedDate = null, cachedEvents = [];
(function initCal() { const d = new Date(TODAY); calYear = d.getFullYear(); calMonth = d.getMonth(); })();
function renderCalDow() { const dow = ["일", "월", "화", "수", "목", "금", "토"]; $("calDow").innerHTML = dow.map((x, i) => `<div class="cal-dow" style="color:${i === 0 ? 'var(--minus)' : i === 6 ? 'var(--a)' : 'var(--sub)'}">${x}</div>`).join(""); }
function renderCalendar() {
    cachedEvents = eventsForMonth(calYear, calMonth); renderCalDow();
    $("calTitle").textContent = `${calYear}년 ${calMonth + 1}월`;
    const startDow = new Date(calYear, calMonth, 1).getDay();
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    const byDate = {}; cachedEvents.forEach(e => { if (e.cash) (byDate[e.date] = byDate[e.date] || []).push(e); });
    const body = $("calBody"); body.innerHTML = ""; let monthNet = 0;
    for (let i = 0; i < startDow; i++) { const c = document.createElement("div"); c.className = "cal-cell empty"; body.appendChild(c); }
    for (let day = 1; day <= days; day++) {
        const ds = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const cell = document.createElement("div"); cell.className = "cal-cell" + (ds === TODAY ? " today" : "") + (ds === selectedDate ? " selected" : ""); cell.dataset.date = ds;
        let html = `<div class="d">${day}</div>`; const evs = byDate[ds];
        if (evs) {
            let net = 0; html += `<div class="ev">`;
            evs.slice(0, 2).forEach(e => { html += `<span class="ev-tag ${e.amt >= 0 ? "ev-plus" : "ev-minus"}">${e.amt >= 0 ? "＋" : "－"}${eok(Math.abs(e.amt))}</span>`; });
            if (evs.length > 2) html += `<span class="ev-tag ev-info">＋${evs.length - 2}건</span>`;
            evs.forEach(e => net += e.amt);
            html += `</div><div class="cal-net" style="color:${net >= 0 ? "var(--plus)" : "var(--minus)"}">${net >= 0 ? "＋" : "－"}${eok(Math.abs(net))}</div>`;
            monthNet += net;
        }
        cell.innerHTML = html; body.appendChild(cell);
    }
    $("calMonthNet").textContent = (monthNet >= 0 ? "＋" : "－") + eok(Math.abs(monthNet));
    $("calMonthNet").style.color = monthNet >= 0 ? "var(--plus)" : "var(--minus)";
    if (selectedDate) renderDayDetail(selectedDate);
}
$("calBody").addEventListener("click", e => { const cell = e.target.closest(".cal-cell"); if (!cell || cell.classList.contains("empty")) return; selectedDate = cell.dataset.date; renderCalendar(); renderDayDetail(selectedDate); $("dayDetail").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
function renderDayDetail(ds) {
    const box = $("dayDetail"); box.style.display = "block";
    const evs = cachedEvents.filter(e => e.date === ds);
    const d = new Date(ds); const dowName = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    let plus = 0, minus = 0; evs.forEach(e => { if (!e.cash) return; if (e.amt >= 0) plus += e.amt; else minus += e.amt; });
    let html = `<div class="dh"><div class="dt">📌 ${ds} (${dowName})</div><button class="btn ghost sm" onclick="document.getElementById('dayDetail').style.display='none';">닫기</button></div>`;
    if (!evs.length) html += `<div style="color:var(--sub);font-size:13px;padding:10px 0;">이 날짜엔 등록된 일정이 없어요.</div>`;
    else {
        evs.forEach(e => {
            const em = e.type === "loan" ? "🏦" : (e.type === "income" || e.type === "extra-income") ? "💰" : e.type === "house" ? "🏠" : e.type === "cardpay" ? "💳" : e.type === "carduse" ? "🧾" : "💸";
            const note = e.cash ? "" : `<span class="tag-note">비현금·카드사용</span>`;
            html += `<div class="dd-row"><div>${em}</div><div><div class="lbl">${e.label}${note}</div><div class="sub">${e.sub || ""}</div></div><div class="val" style="color:${e.amt >= 0 ? "var(--plus)" : "var(--minus)"}">${e.amt >= 0 ? "＋" : "－"}${won(Math.abs(e.amt))}</div></div>`;
            if (e.type === "cardpay" && e.items) e.items.forEach(it => { html += `<div class="dd-row" style="padding-left:36px;opacity:.8;"><div style="font-size:11px;color:var(--sub);">└</div><div><div class="lbl" style="font-size:12.5px;">${it.label}</div><div class="sub">${ownerName(it.owner)} · ${it.sub}</div></div><div class="val" style="font-size:12.5px;color:var(--sub);">－${won(it.amt)}</div></div>`; });
        });
        html += `<div class="dd-summary"><div class="box"><div class="k">유입</div><div class="v" style="color:var(--plus)">＋${eok(plus)}</div></div><div class="box"><div class="k">지출</div><div class="v" style="color:var(--minus)">－${eok(Math.abs(minus))}</div></div><div class="box"><div class="k">순흐름</div><div class="v" style="color:${plus + minus >= 0 ? "var(--plus)" : "var(--minus)"}">${plus + minus >= 0 ? "＋" : "－"}${eok(Math.abs(plus + minus))}</div></div></div>`;
    }
    const balA = balanceAsOf("A", ds, cachedEvents), balB = balanceAsOf("B", ds, cachedEvents);
    const dayNetA = evs.reduce((s, e) => s + ownerShare(e, "A"), 0), dayNetB = evs.reduce((s, e) => s + ownerShare(e, "B"), 0);
    html += `<div class="bal-strip">
      <div class="bal-box a"><div class="who"><span class="dot dot-a"></span>${nameOf.A} 예상 잔액 (이 날짜 기준)</div><div class="amt">${won(balA)}</div><div class="delta" style="color:${dayNetA >= 0 ? "var(--plus)" : "var(--minus)"}">${dayNetA === 0 ? "당일 변동 없음" : (dayNetA >= 0 ? "＋" : "－") + won(Math.abs(dayNetA)) + " 당일"}</div></div>
      <div class="bal-box b"><div class="who"><span class="dot dot-b"></span>${nameOf.B} 예상 잔액 (이 날짜 기준)</div><div class="amt">${won(balB)}</div><div class="delta" style="color:${dayNetB >= 0 ? "var(--plus)" : "var(--minus)"}">${dayNetB === 0 ? "당일 변동 없음" : (dayNetB >= 0 ? "＋" : "－") + won(Math.abs(dayNetB)) + " 당일"}</div></div>
    </div>
    <div class="desc" style="margin:10px 0 0;">※ 잔액은 <b>기준일(${ANCHOR()})</b> 계좌 잔고에서 출발해 이 달의 현금흐름을 반영한 <b>예상치</b>입니다. (카드 사용은 결제일에만 현금 반영)</div>`;
    box.innerHTML = html;
}
$("calPrev").addEventListener("click", () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
$("calNext").addEventListener("click", () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
$("calToday").addEventListener("click", () => { const d = new Date(TODAY); calYear = d.getFullYear(); calMonth = d.getMonth(); selectedDate = TODAY; renderCalendar(); renderDayDetail(TODAY); });
function renderUpcoming() {
    const box = $("upcomingList"); box.innerHTML = "";
    const events = futureEvents().slice(0, 14);
    if (!events.length) { box.innerHTML = `<div style="color:var(--sub);font-size:13px;padding:8px 0;">예정된 일정이 없어요.</div>`; return; }
    events.forEach(e => { const row = document.createElement("div"); row.className = "tl-row"; row.innerHTML = `<div class="date">${e.date}</div><div class="label">${e.label} <span style="color:var(--sub);font-size:11.5px;">${e.sub || ""}</span></div><div class="val ${e.amt >= 0 ? "plus" : "minus"}">${e.amt >= 0 ? "＋" : "－"}${won(Math.abs(e.amt))}</div>`; box.appendChild(row); });
}
/* ---------- [v9] 월별 통장 잔고 계산 & 월 마감 ---------- */
function loanRepayInMonth(l, monthKey) { return loanPayInMonth(l, monthKey); }
function computeAccountDeltas(monthKey) {
    const L = ledgers[monthKey];
    const delta = {}; accounts.forEach(a => delta[a.id] = 0);
    const add = (accId, amt) => { if (accId != null && delta[accId] !== undefined) delta[accId] += amt; };
    if (!L) return delta;
    const inMonth = (d) => !!d && d.slice(0, 7) === monthKey;
    (L.incomes || []).forEach(i => add(i.acc, num(i.amt)));
    (L.extraIncomes || []).forEach(x => { if (x.freq === "monthly" || inMonth(x.date)) add(x.acc, num(x.amt)); });
    (L.expenses || []).filter(e => e.method === "acc").forEach(e => add(e.ref, -num(e.amt)));
    (L.extraExpenses || []).forEach(x => { if (x.freq === "monthly" || inMonth(x.date)) add(x.acc, -num(x.amt)); });
    cards.forEach(c => {
        const recur = (L.expenses || []).filter(e => e.method === "card" && e.ref === c.id).reduce((s, e) => s + num(e.amt), 0);
        const txn = (L.cardTxns || []).filter(t => t.cardId === c.id).reduce((s, t) => s + num(t.amt), 0);
        const total = recur + txn;
        if (total > 0) add(validAccForOwner(c.acc, c.owner), -total);
    });
    loans.forEach(l => { const pay = loanPayInMonth(l, monthKey); if (pay > 0) add(validAccForOwner(l.acc, l.owner), -pay); });
    return delta;
}
function accountBaseFor(monthKey) {
    const L = ledgers[monthKey];
    if (L && L.closed && L.startBalances) return { ...L.startBalances };
    const base = {}; accounts.forEach(a => base[a.id] = num(a.amt)); return base;
}
function renderMonthClose() {
    const box = $("mcBalanceList"); if (!box) return;
    const L = ledgers[currentMonth]; const closed = !!(L && L.closed);
    const base = accountBaseFor(currentMonth);
    const deltas = computeAccountDeltas(currentMonth);
    let html = `<div class="mc-head"><div>계좌</div><div>기준 잔고</div><div>이 달 증감</div><div>예상 잔고</div></div>`;
    let tStart = 0, tEnd = 0;
    ["A", "B"].forEach(o => {
        const list = accounts.filter(a => a.owner === o);
        if (!list.length) return;
        html += `<div class="mc-owner"><span class="dot dot-${o.toLowerCase()}"></span>${ownerName(o)}</div>`;
        list.forEach(a => {
            const start = base[a.id] != null ? base[a.id] : num(a.amt);
            const d = deltas[a.id] || 0; const end = start + d;
            tStart += start; tEnd += end;
            html += `<div class="mc-row">
        <div class="mc-name">${ACC_ICON[a.type] || "💠"} ${a.name}</div>
        <div class="mc-start">${won(start)}</div>
        <div class="mc-delta ${d >= 0 ? "plus" : "minus"}">${d === 0 ? "―" : (d > 0 ? "＋" : "－") + won(Math.abs(d))}</div>
        <div class="mc-end">${won(end)}</div>
      </div>`;
        });
    });
    const dTot = tEnd - tStart;
    html += `<div class="mc-row mc-total"><div class="mc-name">합계</div><div class="mc-start">${won(tStart)}</div><div class="mc-delta ${dTot >= 0 ? "plus" : "minus"}">${dTot === 0 ? "―" : (dTot > 0 ? "＋" : "－") + won(Math.abs(dTot))}</div><div class="mc-end">${won(tEnd)}</div></div>`;
    box.innerHTML = html;
    const st = $("mcStatus"); if (st) { st.textContent = closed ? "마감 완료 ✓" : "진행 중"; st.className = "pill " + (closed ? "pill-a" : "pill-muted"); }
    if ($("closeMonthBtn")) $("closeMonthBtn").style.display = closed ? "none" : "";
    if ($("undoCloseBtn")) $("undoCloseBtn").style.display = closed ? "" : "none";
    if ($("mcMonthLabel")) $("mcMonthLabel").textContent = (currentMonth === REAL_MONTH ? "이번 달" : monthLabel(currentMonth));
    if ($("mcHint")) $("mcHint").innerHTML = closed
        ? `✅ <b>${monthLabel(currentMonth)}</b> 마감 완료! 예상 잔고가 각 통장의 새 잔고로 확정되어 다음 달로 이어졌어요. 되돌리려면 <b>마감 취소</b>를 눌러주세요.`
        : `💡 <b>월 마감 완료!</b>를 누르면 위 <b>예상 잔고</b>가 각 통장의 새 잔고로 확정되고, 다음 달 가계부가 자동으로 만들어져요. (대출 상환은 각 대출에 지정한 <b>출금 계좌</b>에서 빠져나가요)`;
}
function closeMonth() {
    const L = ledgers[currentMonth]; if (!L) return;
    if (L.closed) { setStatus("이미 마감된 달이에요.", "ok"); return; }
    if (!confirm(monthLabel(currentMonth) + " 가계부를 마감할까요?\n예상 잔고가 각 통장의 새 잔고로 확정되고, 다음 달 가계부가 만들어져요.")) return;
    const start = {}; accounts.forEach(a => start[a.id] = num(a.amt));
    const deltas = computeAccountDeltas(currentMonth);
    L.startBalances = start; L.closed = true; L.closedAt = new Date().toISOString();
    accounts.forEach(a => a.amt = num(a.amt) + (deltas[a.id] || 0));
    fireConfetti();
    const [y, m] = currentMonth.split("-").map(Number); let ny = y, nm = m + 1; if (nm > 12) { nm = 1; ny++; }
    createMonth(ny, nm);
    renderAccounts(); renderPlan(); refreshSummary();
    try { saveData(); } catch (e) { }
}
function undoCloseMonth() {
    const L = ledgers[currentMonth]; if (!L || !L.closed) return;
    if (!confirm(monthLabel(currentMonth) + " 마감을 취소할까요?\n통장 잔고가 마감 전 상태로 되돌아가요.")) return;
    if (L.startBalances) accounts.forEach(a => { if (L.startBalances[a.id] !== undefined) a.amt = num(L.startBalances[a.id]); });
    L.closed = false; delete L.startBalances; delete L.closedAt;
    renderAccounts(); renderPlan(); refreshSummary(); renderMonthClose();
    try { saveData(); } catch (e) { }
}
function fireConfetti() {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let W = canvas.width = window.innerWidth, H = canvas.height = window.innerHeight;
    const colors = ["#3f7fd1", "#23b0be", "#6f7fe0", "#4fc4d6", "#2bb59a", "#e078a0", "#e0b64f"];
    const parts = [];
    for (let i = 0; i < 180; i++) parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.25 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 9, vy: Math.random() * -7 - 4, g: 0.16 + Math.random() * 0.12,
        size: 6 + Math.random() * 7, color: colors[i % colors.length], rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35, shape: Math.random() < 0.5 ? "rect" : "circle"
    });
    let t = 0;
    (function frame() {
        t++; ctx.clearRect(0, 0, W, H);
        parts.forEach(p => {
            p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, 1 - t / 150);
            if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
            ctx.restore();
        });
        if (t < 150) requestAnimationFrame(frame); else canvas.remove();
    })();
}
/* ---------- 주택 자금 ---------- */
function renderCf(list, boxId) {
    const box = $(boxId); box.innerHTML = "";
    list.forEach((e, i) => { const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "130px 1fr 130px 34px"; row.style.padding = "10px 12px"; row.innerHTML = `<input type="date" value="${e.date}" data-i="${i}" data-k="date"/><input type="text" value="${e.label}" data-i="${i}" data-k="label" placeholder="항목"/><input type="text" inputmode="numeric" value="${fmtNum(e.amt)}" data-i="${i}" data-k="amt" style="text-align:right;"/><button class="btn-del" data-del="${i}">×</button>`; box.appendChild(row); });
}
function getCf(id) { return id === "cfListA" ? cfA : cfB; }
["cfListA", "cfListB"].forEach(boxId => {
    const setCf = (t) => { const list = getCf(boxId), i = +t.dataset.i, k = t.dataset.k; if (k === "amt") { list[i].amt = parseNum(t.value); t.value = fmtNum(list[i].amt); } else list[i][k] = t.value; };
    $(boxId).addEventListener("input", e => { if (e.target.dataset.i === undefined) return; setCf(e.target); });
    $(boxId).addEventListener("change", e => { if (e.target.dataset.i === undefined) return; setCf(e.target); renderCalendar(); });
    $(boxId).addEventListener("click", e => { if (e.target.dataset.del !== undefined) { getCf(boxId).splice(+e.target.dataset.del, 1); renderCf(getCf(boxId), boxId); renderCalendar(); } });
});
$("addCfA").addEventListener("click", () => { cfA.push({ date: TODAY, label: "새 항목", amt: 0 }); cfA.sort((a, b) => a.date.localeCompare(b.date)); renderCf(cfA, "cfListA"); });
$("addCfB").addEventListener("click", () => { cfB.push({ date: TODAY, label: "새 항목", amt: 0 }); cfB.sort((a, b) => a.date.localeCompare(b.date)); renderCf(cfB, "cfListB"); });
$("houseA").addEventListener("input", () => { $("hLabelA").textContent = $("houseA").value; });
$("houseB").addEventListener("input", () => { $("hLabelB").textContent = $("houseB").value; });
["houseAValue", "houseBValue"].forEach(id => $(id).addEventListener("input", () => { refreshSummary(); renderHouseAssetNote(); }));
["houseAOwner", "houseBOwner"].forEach(id => $(id).addEventListener("change", () => { refreshSummary(); renderHouseAssetNote(); renderCalendar(); }));
function houseValueTotal() { return parseNum($("houseAValue").value) + parseNum($("houseBValue").value); }
function houseAssetOf(owner) {
    const av = parseNum($("houseAValue").value), bv = parseNum($("houseBValue").value);
    const ao = $("houseAOwner").value, bo = $("houseBOwner").value; let s = 0;
    s += ao === owner ? av : (ao === "J" ? av / 2 : 0);
    s += bo === owner ? bv : (bo === "J" ? bv / 2 : 0);
    return s;
}
function assetOf(owner) { return accSum(owner) + houseAssetOf(owner); }
function renderHouseAssetNote() {
    const el = $("houseAssetNote"); if (!el) return;
    const av = parseNum($("houseAValue").value), bv = parseNum($("houseBValue").value);
    el.innerHTML = `🏡 주택 자산가치 합계 <b>${eok(av + bv)}</b> · ${$("houseA").value} <b>${eok(av)}</b> (${ownerName($("houseAOwner").value)}) · ${$("houseB").value} <b>${eok(bv)}</b> (${ownerName($("houseBOwner").value)}) — 상단 총자산에 포함됩니다.`;
}
let houseFlowChart;
function calcHouse() {
    const budgetA = parseNum($("budgetA").value), budgetB = parseNum($("budgetB").value);
    const ledger = (budget, list) => { const s = [...list].sort((x, y) => x.date.localeCompare(y.date)); let bal = budget; const rows = s.map(e => { const up = e.date >= TODAY; if (up) bal += num(e.amt); return { ...e, up, bal: up ? bal : null }; }); return { rows, final: bal }; };
    const A = ledger(budgetA, cfA), B = ledger(budgetB, cfB);
    $("rHouseA").textContent = $("houseA").value; $("rHouseB").textContent = $("houseB").value;
    const setBal = (id, d, v, budget) => { $(id).textContent = eok(v); $(id).style.color = v < 0 ? "var(--minus)" : "var(--plus)"; $(d).textContent = (v < 0 ? `부족액 ${won(Math.abs(v))}` : `여유 ${won(v)}`) + ` · 시작예산 ${eok(budget)}`; };
    setBal("rBalA", "rBalADesc", A.final, budgetA); setBal("rBalB", "rBalBDesc", B.final, budgetB);
    const fillLedger = (rows, tbId, budget) => {
        let html = `<tr style="color:var(--sub);font-size:11px;"><td style="text-align:left;padding:6px 4px;">날짜</td><td style="text-align:left;">항목</td><td style="text-align:right;">금액</td><td style="text-align:right;">잔여예산</td></tr>`;
        html += `<tr><td style="padding:6px 4px;color:var(--sub);">오늘</td><td>보유 예산</td><td style="text-align:right;">-</td><td style="text-align:right;font-weight:800;">${eok(budget)}</td></tr>`;
        rows.forEach(r => { if (r.up) html += `<tr style="border-top:1px solid var(--line);"><td style="padding:6px 4px;">${r.date}</td><td>${r.label} <span style="color:var(--peri);font-size:10px;">예정</span></td><td style="text-align:right;color:${r.amt < 0 ? "var(--minus)" : "var(--plus)"};font-weight:700;">${r.amt >= 0 ? "＋" : "－"}${eok(Math.abs(r.amt))}</td><td style="text-align:right;font-weight:800;color:${r.bal < 0 ? "var(--minus)" : "inherit"};">${eok(r.bal)}</td></tr>`; else html += `<tr style="border-top:1px solid var(--line);opacity:.5;"><td style="padding:6px 4px;">${r.date}</td><td>${r.label} <span style="font-size:10px;">완료</span></td><td style="text-align:right;">${r.amt >= 0 ? "＋" : "－"}${eok(Math.abs(r.amt))}</td><td style="text-align:right;">반영됨</td></tr>`; });
        $(tbId).innerHTML = html;
    };
    fillLedger(A.rows, "ledgerA", budgetA); fillLedger(B.rows, "ledgerB", budgetB);
    const allUp = Array.from(new Set([...A.rows, ...B.rows].filter(r => r.up).map(r => r.date))).sort();
    const series = (rows, budget) => { let last = budget; const map = {}; rows.filter(r => r.up).forEach(r => map[r.date] = r.bal); return allUp.map(d => { if (map[d] !== undefined) last = map[d]; return last; }); };
    chartFont(); if (houseFlowChart) houseFlowChart.destroy();
    houseFlowChart = new Chart($("houseFlowChart"), { type: "line", data: { labels: ["오늘", ...allUp], datasets: [{ label: `${nameOf.A} · ${$("houseA").value}`, data: [budgetA, ...series(A.rows, budgetA)], borderColor: COL.a, backgroundColor: "rgba(63,127,209,.12)", fill: true, tension: .25 }, { label: `${nameOf.B} · ${$("houseB").value}`, data: [budgetB, ...series(B.rows, budgetB)], borderColor: COL.b, backgroundColor: "rgba(35,176,190,.12)", fill: true, tension: .25 }] }, options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + won(c.parsed.y) } } }, scales: { y: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, x: { grid: { color: gridc() } } }, maintainAspectRatio: false } });
    $("houseResults").style.display = "block"; $("houseResults").scrollIntoView({ behavior: "smooth" });
}
$("calcHouse").addEventListener("click", calcHouse);
/* ---------- 요약/차트 ---------- */
let assetChart, balanceChart, flowChartHome, expenseChart, burdenChart;
function debtOf(o) { return loans.filter(l => l.owner === o).reduce((s, l) => s + fin(loanCalc(l).remain), 0) + loans.filter(l => l.owner === "J").reduce((s, l) => s + fin(loanCalc(l).remain) / 2, 0); }
function monthIncomeTotal() {
    let s = incomes.reduce((a, i) => a + num(i.amt), 0);
    extraIncomes.forEach(x => { if (x.freq === "monthly") s += num(x.amt); else if (inCurMonth(x.date)) s += num(x.amt); });
    return s;
}
function monthExpenseTotal() {
    let s = expenses.reduce((a, e) => a + num(e.amt), 0);
    extraExpenses.forEach(x => { if (x.freq === "monthly") s += num(x.amt); else if (inCurMonth(x.date)) s += num(x.amt); });
    s += cardTxns.reduce((a, t) => a + num(t.amt), 0);
    return s;
}
function monthNetFlow() {
    const [y, mo] = currentMonth.split("-");
    return eventsForMonth(+y, +mo - 1).filter(e => e.cash).reduce((s, e) => s + num(e.amt), 0);
}
function refreshSummary() {
    const accountsTotal = accounts.reduce((s, a) => s + num(a.amt), 0);
    const houseTotal = houseValueTotal();
    const totalAsset = accountsTotal + houseTotal;
    const debtRemain = totalDebtRemain();
    $("heroNet").textContent = eok(totalAsset - debtRemain);
    $("heroAsset").textContent = eok(totalAsset);
    $("heroDebt").textContent = eok(debtRemain);
    const flow = fin(monthNetFlow());
    $("heroFlow").textContent = (flow >= 0 ? "＋" : "－") + eok(Math.abs(flow));
    $("heroFlow").style.color = flow >= 0 ? "var(--plus)" : "var(--minus)";
    const netA = assetOf("A") - debtOf("A"), netB = assetOf("B") - debtOf("B");
    $("kNetA").textContent = eok(netA); $("kNetADesc").textContent = `자산 ${eok(assetOf("A"))} · 부채 ${eok(debtOf("A"))}`;
    $("kNetB").textContent = eok(netB); $("kNetBDesc").textContent = `자산 ${eok(assetOf("B"))} · 부채 ${eok(debtOf("B"))}`;
    $("kLoan").textContent = eok(debtRemain) + ` / ${loans.length}건`;
    const nextPay = loanRepayEvents().filter(e => e.date >= TODAY)[0];
    $("kLoanNext").textContent = nextPay ? `다음 ${nextPay.date}` : "예정 없음";
    const monthPay = loanRepayEvents().filter(e => e.date.slice(0, 7) === currentMonth).reduce((s, e) => s + Math.abs(e.amt), 0);
    $("kMonthPay").textContent = eok(monthPay);
    renderHouseAssetNote(); renderPlanSummary();
    renderMonthClose();
    drawHome();
}
function drawHome() {
    if (!window.Chart) return; chartFont();
    const types = {}; accounts.forEach(a => types[a.type] = (types[a.type] || 0) + num(a.amt));
    const hv = houseValueTotal(); if (hv > 0) types["주택"] = (types["주택"] || 0) + hv;
    const tl = Object.keys(types);
    if (assetChart) assetChart.destroy();
    assetChart = new Chart($("assetChart"), { type: "doughnut", data: { labels: tl.map(t => t === "주택" ? "🏡 주택(보유)" : ((ACC_ICON[t] || "") + " " + t)), datasets: [{ data: tl.map(t => types[t]), backgroundColor: [COL.a, COL.b, COL.peri, COL.aqua, COL.plus, COL.gold, "#9db8d4", "#c9b6e8"], borderWidth: 2, borderColor: cardc() }] }, options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.label + ": " + eok(c.parsed) } } }, cutout: "60%", maintainAspectRatio: false } });
    if (balanceChart) balanceChart.destroy();
    balanceChart = new Chart($("balanceChart"), { type: "bar", data: { labels: [nameOf.A, nameOf.B], datasets: [{ label: "자산", data: [assetOf("A"), assetOf("B")], backgroundColor: COL.plus, borderRadius: 6 }, { label: "부채", data: [debtOf("A"), debtOf("B")], backgroundColor: COL.minus, borderRadius: 6 }] }, options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + eok(c.parsed.y) } } }, scales: { y: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, x: { grid: { display: false } } }, maintainAspectRatio: false } });
    const incTot = monthIncomeTotal(), expTot = monthExpenseTotal(), payTot = monthlyPayTotal();
    if (flowChartHome) flowChartHome.destroy();
    flowChartHome = new Chart($("flowChart"), { type: "bar", data: { labels: ["월 현금흐름"], datasets: [{ label: "수입", data: [incTot], backgroundColor: COL.plus, borderRadius: 6 }, { label: "생활비", data: [-expTot], backgroundColor: COL.minus, borderRadius: 6 }, { label: "대출상환", data: [-payTot], backgroundColor: COL.peri, borderRadius: 6 }] }, options: { indexAxis: "y", plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + won(Math.abs(c.parsed.x)) } } }, scales: { x: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, y: { grid: { display: false } } }, maintainAspectRatio: false } });
}
/* [v9.3] 지출(생활비) 항목 집합 — owner 포함, 대출 제외 */
function monthlyExpenseItems() {
    const items = [];
    expenses.forEach(e => items.push({ name: e.name, amt: num(e.amt), owner: e.owner || "J", kind: e.method === "card" ? "카드고정" : "계좌지출" }));
    extraExpenses.filter(x => x.freq === "monthly" || inCurMonth(x.date)).forEach(x => items.push({ name: x.name + " (기타)", amt: num(x.amt), owner: x.owner || "J", kind: "기타지출" }));
    cardTxns.forEach(t => items.push({ name: t.item, amt: num(t.amt), owner: t.owner || "J", kind: "카드사용" }));
    return items.filter(it => it.amt !== 0);
}
/* [v9.4] 이번 달 대출 상환 항목(담당자별) */
function monthlyLoanItems() {
    return loans.map(l => ({ name: `${l.name} 상환`, amt: loanPayInMonth(l, currentMonth), owner: l.owner || "J", kind: "대출상환" })).filter(it => it.amt > 0);
}
/* [v9.4] 담당자별 부담: 생활비 / 대출포함 각각 breakdown 저장 */
let burdenData = { A: { living: [], loan: [] }, B: { living: [], loan: [] } };
function splitToOwner(store, owner, name, amt, kind) {
    if (owner === "J") { store.A.push({ name, amt: amt / 2, joint: true, kind }); store.B.push({ name, amt: amt / 2, joint: true, kind }); }
    else if (store[owner]) store[owner].push({ name, amt, joint: false, kind });
}
function drawFlowCharts() {
    if (!window.Chart) return; chartFont();
    const items = monthlyExpenseItems();
    const loanItems = monthlyLoanItems();
    const totalExp = items.reduce((s, x) => s + x.amt, 0);
    /* --- 지출 구성 도넛 --- */
    if (expenseChart) expenseChart.destroy();
    expenseChart = new Chart($("expenseChart"), {
        type: "doughnut",
        data: { labels: items.map(e => e.name), datasets: [{ data: items.map(e => e.amt), backgroundColor: items.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]), borderWidth: 2, borderColor: cardc() }] },
        options: {
            plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.label}: ${won(c.parsed)} (${ownerName(items[c.dataIndex].owner)})` } } },
            cutout: "58%", maintainAspectRatio: false,
            onClick: (evt, els) => { if (els.length) showItemDetail(items[els[0].index]); }
        }
    });
    /* --- 담당자별 부담: 생활비 / 대출포함 2개 막대 --- */
    const living = { A: 0, B: 0 };
    const loanShare = { A: 0, B: 0 };
    const liveStore = { A: [], B: [] }, loanStore = { A: [], B: [] };
    items.forEach(it => { splitToOwner(liveStore, it.owner, it.name, it.amt, it.kind); if (it.owner === "J") { living.A += it.amt / 2; living.B += it.amt / 2; } else if (living[it.owner] !== undefined) living[it.owner] += it.amt; });
    loanItems.forEach(it => { splitToOwner(loanStore, it.owner, it.name, it.amt, it.kind); if (it.owner === "J") { loanShare.A += it.amt / 2; loanShare.B += it.amt / 2; } else if (loanShare[it.owner] !== undefined) loanShare[it.owner] += it.amt; });
    burdenData = {
        A: { living: liveStore.A.sort((a, b) => b.amt - a.amt), loan: loanStore.A.sort((a, b) => b.amt - a.amt) },
        B: { living: liveStore.B.sort((a, b) => b.amt - a.amt), loan: loanStore.B.sort((a, b) => b.amt - a.amt) }
    };
    const totalIncl = { A: living.A + loanShare.A, B: living.B + loanShare.B };
    if (burdenChart) burdenChart.destroy();
    burdenChart = new Chart($("burdenChart"), {
        type: "bar",
        data: {
            labels: [nameOf.A, nameOf.B],
            datasets: [
                { label: "생활비 부담", data: [living.A, living.B], backgroundColor: [COL.a, COL.b], borderRadius: 6 },
                { label: "대출 상환 포함 부담", data: [totalIncl.A, totalIncl.B], backgroundColor: [withAlpha(COL.a, .45), withAlpha(COL.b, .45)], borderRadius: 6 }
            ]
        },
        options: {
            plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${won(c.parsed.y)}` + (c.datasetIndex === 1 ? " (클릭 시 세부)" : " (클릭 시 세부)") } } },
            scales: { y: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, x: { grid: { display: false } } },
            maintainAspectRatio: false,
            onClick: (evt, els) => { if (els.length) { const owner = els[0].index === 0 ? "A" : "B"; const withLoan = els[0].datasetIndex === 1; showBurdenDetail(owner, withLoan); } }
        }
    });
    if ($("burdenTotalNote")) $("burdenTotalNote").innerHTML =
        `<div>🏠 <b>생활비 부담</b> · ${nameOf.A} ${won(living.A)} + ${nameOf.B} ${won(living.B)} = <b>${won(living.A + living.B)}</b> (지출 합계 ${won(totalExp)} 일치)</div>
     <div style="margin-top:4px;">🏦 <b>대출 상환 포함</b> · ${nameOf.A} ${won(totalIncl.A)} + ${nameOf.B} ${won(totalIncl.B)} = <b>${won(totalIncl.A + totalIncl.B)}</b></div>
     <div style="margin-top:4px;color:var(--sub);">막대(생활비/대출포함)를 클릭하면 세부내역이 보여요.</div>`;
    if ($("burdenDetail")) { $("burdenDetail").style.display = "none"; $("burdenDetail").innerHTML = ""; }
    if ($("expenseDetail")) { $("expenseDetail").style.display = "none"; $("expenseDetail").innerHTML = ""; }
}
function withAlpha(hex, a) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return `rgba(${r},${g},${b},${a})`; }
/* [v9.4] 담당자 막대 클릭 → 생활비 or 대출포함 세부내역 */
function showBurdenDetail(owner, withLoan) {
    const box = $("burdenDetail"); if (!box) return;
    const living = burdenData[owner].living || [];
    const loan = burdenData[owner].loan || [];
    const list = withLoan ? living.concat(loan) : living;
    const livingSum = living.reduce((s, x) => s + x.amt, 0);
    const loanSum = loan.reduce((s, x) => s + x.amt, 0);
    const total = withLoan ? livingSum + loanSum : livingSum;
    const title = withLoan ? "대출 상환 포함 부담" : "생활비 부담";
    let html = `<div class="bd-head"><span class="dot dot-${owner.toLowerCase()}"></span>${ownerName(owner)} · ${title} · 합계 <b>${won(total)}</b> <span class="bd-close" onclick="document.getElementById('burdenDetail').style.display='none';">✕</span></div>`;
    if (!list.length) html += `<div class="bd-empty">이 담당자의 항목이 없어요.</div>`;
    else {
        html += `<div class="bd-sub">🏠 생활비 <b>${won(livingSum)}</b></div>`;
        living.length ? living.forEach(it => { html += `<div class="bd-row"><span class="bd-name">${it.name}${it.joint ? ` <span class="bd-tag">공동 ½</span>` : ""} <span class="bd-kind">${it.kind}</span></span><span class="bd-amt">${won(it.amt)}</span></div>`; }) : (html += `<div class="bd-empty">생활비 항목 없음</div>`);
        if (withLoan) {
            html += `<div class="bd-sub" style="margin-top:10px;">🏦 대출 상환 <b>${won(loanSum)}</b></div>`;
            loan.length ? loan.forEach(it => { html += `<div class="bd-row"><span class="bd-name">${it.name}${it.joint ? ` <span class="bd-tag">공동 ½</span>` : ""} <span class="bd-kind">${it.kind}</span></span><span class="bd-amt">${won(it.amt)}</span></div>`; }) : (html += `<div class="bd-empty">이 달 대출 상환 없음</div>`);
        }
    }
    box.innerHTML = html; box.style.display = "block";
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function showItemDetail(it) {
    const box = $("expenseDetail"); if (!box) return;
    box.innerHTML = `<div class="bd-head">📊 항목 상세 <span class="bd-close" onclick="document.getElementById('expenseDetail').style.display='none';">✕</span></div>
    <div class="bd-row"><span class="bd-name">${it.name} <span class="bd-kind">${it.kind}</span></span><span class="bd-amt">${won(it.amt)}</span></div>
    <div class="bd-row"><span class="bd-name">담당</span><span class="bd-amt">${ownerName(it.owner)}</span></div>`;
    box.style.display = "block";
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function syncNames() { document.querySelectorAll(".nA").forEach(el => el.textContent = nameOf.A); document.querySelectorAll(".nB").forEach(el => el.textContent = nameOf.B); }
function rerenderAll() { renderAccounts(); renderPlan(); renderCards(); renderCardLedgers(); renderIncome(); renderExtra("income"); renderExpenses(); renderExtra("expense"); renderLoans(); refreshSummary(); }
$("nameA").addEventListener("input", () => { syncNames(); rerenderAll(); });
$("nameB").addEventListener("input", () => { syncNames(); rerenderAll(); });
/* ---------- 탭 ---------- */
document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active"); $("tab-" + btn.dataset.tab).classList.add("active");
    setTimeout(() => { if (btn.dataset.tab === "home") drawHome(); if (btn.dataset.tab === "flow") drawFlowCharts(); if (btn.dataset.tab === "calendar") renderCalendar(); if (btn.dataset.tab === "plan") renderPlan(); }, 30);
}));
/* ---------- 다크모드 ---------- */
$("themeBtn").addEventListener("click", () => {
    const html = document.documentElement, dark = html.getAttribute("data-theme") === "dark";
    html.setAttribute("data-theme", dark ? "light" : "dark");
    $("themeBtn").textContent = dark ? "🌙" : "☀️";
    setTimeout(() => { chartFont(); drawHome(); drawFlowCharts(); if ($("houseResults").style.display === "block") calcHouse(); }, 60);
});
/* ---------- 데이터 수집/적용 ---------- */
function collect() { return { nameA: $("nameA").value, nameB: $("nameB").value, accounts, cards, loans, ledgers, months, currentMonth, cfA, cfB, planDate: $("planDate") ? $("planDate").value : TODAY, planMode, houseA: $("houseA").value, houseB: $("houseB").value, budgetA: parseNum($("budgetA").value), budgetB: parseNum($("budgetB").value), houseAValue: parseNum($("houseAValue").value), houseBValue: parseNum($("houseBValue").value), houseAOwner: $("houseAOwner").value, houseBOwner: $("houseBOwner").value, updatedAt: new Date().toISOString() }; }
function applyData(d) {
    if (!d) return;
    if (d.nameA) $("nameA").value = d.nameA; if (d.nameB) $("nameB").value = d.nameB;
    if (Array.isArray(d.accounts)) accounts = d.accounts; if (Array.isArray(d.cards)) cards = d.cards; if (Array.isArray(d.loans)) loans = d.loans;
    if (Array.isArray(d.cfA)) cfA = d.cfA; if (Array.isArray(d.cfB)) cfB = d.cfB;
    if (d.ledgers && d.months) {
        ledgers = d.ledgers; months = d.months.slice();
        Object.keys(ledgers).forEach(k => { const L = ledgers[k]; ["incomes", "expenses", "extraIncomes", "extraExpenses", "cardTxns"].forEach(n => { if (!Array.isArray(L[n])) L[n] = []; }); });
        currentMonth = (d.currentMonth && ledgers[d.currentMonth]) ? d.currentMonth : months.sort()[months.length - 1];
    } else {
        const key = d.currentMonth || REAL_MONTH;
        ledgers = {}; ledgers[key] = { incomes: d.incomes || [], expenses: d.expenses || [], extraIncomes: d.extraIncomes || [], extraExpenses: d.extraExpenses || [], cardTxns: d.cardTxns || [] };
        months = [key]; currentMonth = key;
    }
    numifyAll();
    bindMonth();
    if (d.houseA) $("houseA").value = d.houseA; if (d.houseB) $("houseB").value = d.houseB;
    if (d.budgetA != null) $("budgetA").value = fmtNum(d.budgetA); if (d.budgetB != null) $("budgetB").value = fmtNum(d.budgetB);
    if (d.houseAValue != null) $("houseAValue").value = fmtNum(d.houseAValue); if (d.houseBValue != null) $("houseBValue").value = fmtNum(d.houseBValue);
    if (d.houseAOwner) $("houseAOwner").value = d.houseAOwner; if (d.houseBOwner) $("houseBOwner").value = d.houseBOwner;
    if ($("planDate")) $("planDate").value = d.planDate || TODAY;
    const [cy, cm] = currentMonth.split("-"); calYear = +cy; calMonth = +cm - 1;
    bootRender();
    if (d.planMode) setPlanMode(true);
}
/* ---------- 저장/불러오기 ---------- */
let db = null;
function setStatus(text, state) { $("fbStatus").textContent = text; $("fbDot").style.background = state === "err" ? "var(--minus)" : "var(--plus)"; }
function initFirebase() {
    if (typeof firebaseConfig === "undefined" || typeof firebase === "undefined") { setStatus("로컬 저장 모드 (firebase-config.js 없음)", "ok"); return; }
    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        firebase.auth().signInAnonymously().then(() => { setStatus("Firebase 연결됨 · " + firebaseConfig.projectId, "ok"); loadFromCloud(true); }).catch(e => setStatus("로그인 실패: " + e.message, "err"));
    } catch (e) { setStatus("Firebase 오류: " + e.message, "err"); }
}
async function saveData() {
    const data = collect(); localStorage.setItem("coupleV8", JSON.stringify(data));
    if (!db) { setStatus("로컬에 저장 완료 · " + new Date().toLocaleString("ko-KR"), "ok"); return; }
    try { await db.collection(typeof DOC_PATH !== "undefined" ? DOC_PATH[0] : "coupleFund").doc(typeof DOC_PATH !== "undefined" ? DOC_PATH[1] : "main").set(data); setStatus("클라우드 저장 완료 · " + new Date().toLocaleString("ko-KR"), "ok"); }
    catch (e) { setStatus("클라우드 저장 실패: " + e.message, "err"); }
}
async function loadFromCloud(silent) {
    if (!db) { const s = localStorage.getItem("coupleV8") || localStorage.getItem("coupleV7"); if (s) { applyData(JSON.parse(s)); if (!silent) setStatus("로컬 데이터 불러옴", "ok"); } else if (!silent) setStatus("저장된 데이터 없음", "ok"); return; }
    try { const snap = await db.collection(typeof DOC_PATH !== "undefined" ? DOC_PATH[0] : "coupleFund").doc(typeof DOC_PATH !== "undefined" ? DOC_PATH[1] : "main").get(); if (snap.exists) { applyData(snap.data()); setStatus("클라우드 불러오기 완료 · " + new Date().toLocaleString("ko-KR"), "ok"); } else if (!silent) setStatus("클라우드에 데이터 없음", "ok"); }
    catch (e) { if (!silent) setStatus("불러오기 실패: " + e.message, "err"); }
}
$("saveBtn").addEventListener("click", saveData);
$("loadBtn").addEventListener("click", () => loadFromCloud(false));
/* ---------- 시작 ---------- */
function bootRender() {
    numifyAll();
    syncNames(); bindMonth(); renderMonthBar();
    renderAccounts(); renderPlan(); renderCards(); renderCardLedgers(); renderLoans();
    renderIncome(); renderExtra("income"); renderExpenses(); renderExtra("expense");
    renderCf(cfA, "cfListA"); renderCf(cfB, "cfListB");
    $("hLabelA").textContent = $("houseA").value; $("hLabelB").textContent = $("houseB").value;
    const [cy, cm] = currentMonth.split("-"); calYear = +cy; calMonth = +cm - 1;
    refreshSummary(); renderCalendar(); renderUpcoming();
}
(function boot() {
    attachAllComma();
    if ($("planDate") && !$("planDate").value) $("planDate").value = TODAY;
    initMonthControls();
    bootRender();
    const s = localStorage.getItem("coupleV8"); if (s) { try { applyData(JSON.parse(s)); } catch (e) { } }
    initFirebase();
})();
