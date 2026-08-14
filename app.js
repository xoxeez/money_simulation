/* =========================================================
   우리 둘의 자산 플래너 v5 — app.js
   · 계좌/카드 + 카드 세부내역(가계부) → 결제일 합산 출금
   · 대출: 원리금균등/원금균등/만기일시/원리금체증식(자동)/기타
           + 금리변동 · 거치 · 중도상환 · 수정
   · 수입: 매월 정기수입 + [NEW] 기타수입(1회성/매월)
   · 지출: 매월 고정지출 + [NEW] 기타지출(1회성/매월)
   · 캘린더: 날짜 클릭 상세 + 그 날짜 기준 각자 잔액
   · 주택자금: 담당자 매핑 + 시점별 잔여예산 원장
   · 저장: Firebase(있으면) / localStorage 폴백
========================================================= */
const $ = (id) => document.getElementById(id);
const won = (v) => (Math.round(v)).toLocaleString("ko-KR") + "원";
const eok = (v) => {
    const sign = v < 0 ? "-" : ""; const a = Math.abs(v);
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
const TODAY = new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9);
function ink() { return getComputedStyle(document.body).getPropertyValue('--ink').trim(); }
function gridc() { return getComputedStyle(document.body).getPropertyValue('--line').trim(); }
function cardc() { return getComputedStyle(document.body).getPropertyValue('--card').trim(); }
function chartFont() { if (window.Chart) { Chart.defaults.font.family = "Pretendard"; Chart.defaults.color = ink(); } }

const COL = { a: "#3f7fd1", b: "#23b0be", peri: "#6f7fe0", aqua: "#4fc4d6", plus: "#2bb59a", minus: "#e078a0", gold: "#e0b64f" };
const ACC_ICON = { 예금: "🏦", 주식: "📈", 청약: "🏠", 현금: "💵", 연금: "👛", 기타: "💠" };
const nameOf = { get A() { return $("nameA").value || "본인"; }, get B() { return $("nameB").value || "남자친구"; }, J: "공동" };
function ownerName(o) { return o === "A" ? nameOf.A : o === "B" ? nameOf.B : "공동"; }

/* ---------- 샘플 데이터 ---------- */
let accounts = [
    { id: "ac1", owner: "A", type: "예금", name: "주거래 통장 (국민)", amt: 120000000 },
    { id: "ac2", owner: "A", type: "예금", name: "적금 (카카오)", amt: 40000000 },
    { id: "ac3", owner: "A", type: "주식", name: "증권계좌 (삼성)", amt: 60000000 },
    { id: "ac4", owner: "A", type: "청약", name: "주택청약종합저축", amt: 18000000 },
    { id: "ac5", owner: "B", type: "예금", name: "주거래 통장 (신한)", amt: 90000000 },
    { id: "ac6", owner: "B", type: "주식", name: "증권계좌 (미래에셋)", amt: 45000000 },
    { id: "ac7", owner: "B", type: "청약", name: "주택청약종합저축", amt: 22000000 },
];
let cards = [
    { id: "cd1", owner: "A", name: "국민 체크카드", kind: "체크", acc: "ac1", payDay: 0 },
    { id: "cd2", owner: "A", name: "현대 신용카드", kind: "신용", acc: "ac1", payDay: 14 },
    { id: "cd3", owner: "B", name: "신한 신용카드", kind: "신용", acc: "ac5", payDay: 25 },
];
let cardTxns = [
    { id: "tx1", cardId: "cd2", date: TODAY.slice(0, 8) + "03", item: "장보기 (이마트)", amt: 85000, owner: "J" },
    { id: "tx2", cardId: "cd2", date: TODAY.slice(0, 8) + "07", item: "주유", amt: 60000, owner: "A" },
    { id: "tx3", cardId: "cd2", date: TODAY.slice(0, 8) + "10", item: "데이트 (영화/식사)", amt: 74000, owner: "J" },
    { id: "tx4", cardId: "cd3", date: TODAY.slice(0, 8) + "05", item: "통신비", amt: 88000, owner: "B" },
    { id: "tx5", cardId: "cd3", date: TODAY.slice(0, 8) + "12", item: "구독 (넷플릭스 등)", amt: 32000, owner: "J" },
];
let loans = [
    { id: "ln1", name: "주택담보대출", owner: "A", kind: "bank", principal: 300000000, rate: 4.2, term: 360, repay: "eq", start: "2026-10-25", payDay: 25, fixed: 0, grace: 0, growth: 0, rateType: "fixed", rateChanges: [], prepayments: [] },
    { id: "ln2", name: "보금자리론", owner: "B", kind: "bank", principal: 200000000, rate: 4.0, term: 360, repay: "graduate", start: "2026-09-15", payDay: 15, fixed: 0, grace: 0, growth: 1.5, rateType: "fixed", rateChanges: [], prepayments: [] },
    { id: "ln3", name: "부모님 차용금", owner: "A", kind: "family", principal: 80000000, rate: 0, term: 40, repay: "custom", start: "2026-11-10", payDay: 10, fixed: 2000000, grace: 0, growth: 0, rateType: "fixed", rateChanges: [], prepayments: [] },
];
let incomes = [
    { id: "in1", owner: "A", name: "급여", amt: 3500000, payDay: 25, acc: "ac1" },
    { id: "in2", owner: "B", name: "급여", amt: 4000000, payDay: 21, acc: "ac5" },
];
// [NEW] 기타 수입 — freq: 'once'(date) | 'monthly'(day)
let extraIncomes = [
    { id: "ei1", owner: "A", name: "성과급 (설)", amt: 5000000, freq: "once", date: "2026-09-20", day: 25, acc: "ac1" },
    { id: "ei2", owner: "B", name: "부수입 (프리랜스)", amt: 800000, freq: "monthly", date: TODAY, day: 10, acc: "ac5" },
];
let expenses = [
    { id: "ex1", name: "월세/관리비", amt: 900000, owner: "J", method: "acc", ref: "ac1", day: 5 },
    { id: "ex2", name: "공과금", amt: 200000, owner: "J", method: "acc", ref: "ac5", day: 15 },
];
// [NEW] 기타 지출 — freq: 'once'(date) | 'monthly'(day), acc: 출금계좌
let extraExpenses = [
    { id: "ee1", owner: "J", name: "경조사비 (지인 결혼)", amt: 300000, freq: "once", date: "2026-09-12", day: 1, acc: "ac1" },
    { id: "ee2", owner: "A", name: "부모님 용돈", amt: 500000, freq: "monthly", date: TODAY, day: 5, acc: "ac1" },
];
let cfA = [
    { date: "2026-03-10", label: "계약금", amt: -100000000 },
    { date: "2026-06-20", label: "중도금", amt: -150000000 },
    { date: "2026-09-30", label: "주택담보대출 실행", amt: 350000000 },
    { date: "2026-09-30", label: "잔금", amt: -400000000 },
    { date: "2026-10-05", label: "법무사·취득세", amt: -15000000 },
];
let cfB = [
    { date: "2026-04-01", label: "계약금", amt: -80000000 },
    { date: "2026-08-15", label: "주택담보대출 실행", amt: 300000000 },
    { date: "2026-08-15", label: "잔금", amt: -350000000 },
    { date: "2026-08-20", label: "법무사·취득세", amt: -12000000 },
];

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
function loanCalc(l) {
    const P = l.principal, n = l.term, grace = l.grace || 0;
    const prepays = (l.prepayments || []).slice().sort((a, b) => (a.month || 0) - (b.month || 0));
    function rateAt(i) { let r = l.rate; if (l.rateType === "variable" && Array.isArray(l.rateChanges)) { l.rateChanges.slice().sort((a, b) => a.month - b.month).forEach(rc => { if (i >= rc.month) r = rc.rate; }); } return r / 100 / 12; }
    let gradBase = 0;
    if (l.repay === "graduate") gradBase = solveGraduated(P, l.rate, n, grace, (l.growth || 0) / 100);
    let bal = P, totalInterest = 0, firstPay = 0; const sched = [];
    for (let i = 1; i <= n && bal > 0.5; i++) {
        const r = rateAt(i);
        let interest = bal * r, principal = 0, pay = 0;
        if (i <= grace) { principal = 0; pay = interest; }
        else if (l.repay === "io") { principal = (i === n) ? bal : 0; pay = interest + principal; }
        else if (l.repay === "pr") { const pr = P / (n - grace); principal = Math.min(pr, bal); pay = principal + interest; }
        else if (l.repay === "custom") { pay = l.fixed || 0; principal = Math.min(Math.max(pay - interest, 0), bal); pay = principal + interest; }
        else if (l.repay === "graduate") { const yr = Math.floor((i - 1 - grace) / 12); pay = gradBase * Math.pow(1 + (l.growth || 0) / 100, yr); principal = Math.min(Math.max(pay - interest, 0), bal); pay = principal + interest; }
        else { const m = amort(bal, r, n - i + 1); principal = Math.min(m - interest, bal); pay = principal + interest; }
        bal -= principal; totalInterest += interest;
        prepays.filter(p => p.month === i).forEach(p => { const amt = Math.min(p.amount, bal); bal -= amt; });
        sched.push({ month: i, interest, principal, pay, bal: Math.max(0, bal) });
        if (i === grace + 1) firstPay = pay;
    }
    if (!firstPay && sched.length) firstPay = sched[0].pay;
    return { firstPay, totalInterest, months: sched.length, sched, remain: bal > 0.5 ? bal : 0 };
}
const KIND_LABEL = { bank: "은행", family: "부모님 차용" };
const REPAY_LABEL = { eq: "원리금균등", pr: "원금균등", io: "만기일시", graduate: "원리금체증식", custom: "기타(직접입력)" };

/* ---------- 계좌 ---------- */
function accSum(o) { return accounts.filter(a => a.owner === o).reduce((s, a) => s + (+a.amt || 0), 0); }
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
["accListA", "accListB"].forEach(id => {
    $(id).addEventListener("input", e => {
        const t = e.target, aid = t.dataset.id; if (!aid) return; const a = accounts.find(x => x.id === aid);
        if (t.dataset.k === "amt") { a.amt = parseNum(t.value); t.value = fmtNum(t.value); } else a[t.dataset.k] = t.value;
        $("accSum" + a.owner).textContent = eok(accSum(a.owner)); refreshSummary();
    });
    $(id).addEventListener("change", e => { const t = e.target; if (t.dataset.k === "type") { accounts.find(x => x.id === t.dataset.id).type = t.value; renderAccounts(); } });
    $(id).addEventListener("click", e => { if (e.target.dataset.del) { accounts = accounts.filter(x => x.id !== e.target.dataset.del); renderAccounts(); renderCards(); renderCardLedgers(); refreshSummary(); } });
});
document.querySelectorAll("[data-add-acc]").forEach(b => b.addEventListener("click", () => { accounts.push({ id: uid(), owner: b.dataset.addAcc, type: "예금", name: "새 계좌", amt: 0 }); renderAccounts(); refreshSummary(); }));

/* ---------- 카드 ---------- */
function accOptions(sel) { return accounts.map(a => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${ownerName(a.owner)} · ${a.name}</option>`).join(""); }
function renderCards() {
    const box = $("cardList"); box.innerHTML = "";
    cards.forEach(c => {
        const row = document.createElement("div"); row.className = "item card-item";
        row.innerHTML = `<div class="aico">💳</div>
      <input type="text" value="${c.name}" data-id="${c.id}" data-k="name" class="nm"/>
      <select data-id="${c.id}" data-k="owner"><option value="A" ${c.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${c.owner === "B" ? "selected" : ""}>${nameOf.B}</option></select>
      <select data-id="${c.id}" data-k="acc">${accOptions(c.acc)}</select>
      <select data-id="${c.id}" data-k="kind"><option ${c.kind === "체크" ? "selected" : ""}>체크</option><option ${c.kind === "신용" ? "selected" : ""}>신용</option></select>
      <button class="btn-del" data-del="${c.id}">×</button>`;
        box.appendChild(row);
    });
}
$("cardList").addEventListener("input", e => { const t = e.target, c = cards.find(x => x.id === t.dataset.id); if (!c) return; c[t.dataset.k] = t.value; renderCardLedgers(); });
$("cardList").addEventListener("change", e => { const t = e.target, c = cards.find(x => x.id === t.dataset.id); if (!c) return; c[t.dataset.k] = t.value; if (t.dataset.k === "owner" || t.dataset.k === "kind") { renderCards(); renderCardLedgers(); } refreshSummary(); renderCalendar(); });
$("cardList").addEventListener("click", e => { if (e.target.dataset.del) { cards = cards.filter(x => x.id !== e.target.dataset.del); renderCards(); renderCardLedgers(); renderExpenses(); } });
$("addCard").addEventListener("click", () => { const a = accounts[0]; cards.push({ id: uid(), owner: "A", name: "새 카드", kind: "신용", acc: a ? a.id : "", payDay: 25 }); renderCards(); renderCardLedgers(); });

/* ---------- 카드 세부내역 (가계부) ---------- */
function txnsOfCard(cardId) { return cardTxns.filter(t => t.cardId === cardId); }
function renderCardLedgers() {
    const box = $("cardLedgers"); box.innerHTML = "";
    const credit = cards.filter(c => c.kind === "신용");
    if (!credit.length) { box.innerHTML = `<div style="color:var(--sub);font-size:13px;">신용카드를 추가하면 세부내역을 기록할 수 있어요.</div>`; return; }
    credit.forEach(c => {
        const acc = accounts.find(a => a.id === c.acc);
        const list = txnsOfCard(c.id);
        const total = list.reduce((s, t) => s + t.amt, 0);
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
        <div class="cl-title">💳 ${c.name} <span class="pill pill-muted">${ownerName(c.owner)}</span> <span class="pill pill-muted">결제일 ${c.payDay || "-"}일 · ${acc ? acc.name : "계좌미지정"}</span></div>
        <div class="cl-total">이번달 합계 ${won(total)}</div>
      </div>${rows}
      <button class="btn-add" data-txadd="${c.id}" style="margin-top:8px;">＋ 사용내역 추가</button>`;
        box.appendChild(wrap);
    });
}
$("cardLedgers").addEventListener("input", e => {
    const t = e.target, txid = t.dataset.tx; if (!txid) return; const tx = cardTxns.find(x => x.id === txid);
    if (t.dataset.k === "amt") { tx.amt = parseNum(t.value); t.value = fmtNum(t.value); } else tx[t.dataset.k] = t.value;
    const tot = txnsOfCard(tx.cardId).reduce((s, x) => s + x.amt, 0);
    const wrap = t.closest(".card-ledger"); if (wrap) wrap.querySelector(".cl-total").textContent = "이번달 합계 " + won(tot);
    refreshSummary(); renderCalendar();
});
$("cardLedgers").addEventListener("change", e => { const t = e.target; if (t.dataset.k === "owner" || t.dataset.k === "date") { refreshSummary(); renderCalendar(); } });
$("cardLedgers").addEventListener("click", e => {
    if (e.target.dataset.txadd) { cardTxns.push({ id: uid(), cardId: e.target.dataset.txadd, date: TODAY, item: "새 사용내역", amt: 0, owner: "J" }); renderCardLedgers(); }
    if (e.target.dataset.txdel) { cardTxns = cardTxns.filter(x => x.id !== e.target.dataset.txdel); renderCardLedgers(); refreshSummary(); renderCalendar(); }
});

/* ---------- 대출 렌더 + 모달 ---------- */
function totalDebtRemain() { return loans.reduce((s, l) => s + (loanCalc(l).remain || 0), 0); }
function monthlyPayTotal() { return loans.reduce((s, l) => s + loanCalc(l).firstPay, 0); }
function renderLoans() {
    const box = $("loanList"); box.innerHTML = "";
    loans.forEach(l => {
        const c = loanCalc(l);
        const ownerPill = l.owner === "A" ? "pill-a" : l.owner === "B" ? "pill-b" : "pill-family";
        const kindPill = l.kind === "family" ? "pill-family" : "pill-bank";
        const tags = [`<span class="pill ${ownerPill}">${ownerName(l.owner)}</span>`, `<span class="pill ${kindPill}">${KIND_LABEL[l.kind]}</span>`, `<span class="pill pill-muted">${REPAY_LABEL[l.repay]}</span>`, `<span class="pill pill-muted">매월 ${l.payDay}일</span>`];
        if (l.repay === "graduate") tags.push(`<span class="pill pill-muted">체증 ${l.growth}%/년</span>`);
        if (l.rateType === "variable") tags.push(`<span class="pill pill-muted">변동금리</span>`);
        if (l.grace > 0) tags.push(`<span class="pill pill-muted">거치 ${l.grace}개월</span>`);
        if (l.prepayments && l.prepayments.length) tags.push(`<span class="pill" style="background:var(--plus-bg);color:var(--plus)">중도상환 ${l.prepayments.length}회</span>`);
        const div = document.createElement("div"); div.className = "loan";
        div.innerHTML = `<div class="top">
        <div><div class="title">${l.name}</div><div class="tags">${tags.join("")}</div></div>
        <div class="acts"><button class="btn-edit" data-edit="${l.id}">✏️</button><button class="btn-del" data-del="${l.id}">×</button></div>
      </div>
      <div class="loan-stats">
        <div class="cell"><div class="k">잔여 원금</div><div class="v">${eok(c.remain)}</div></div>
        <div class="cell"><div class="k">연 금리</div><div class="v">${l.rate}%${l.rateType === "variable" ? "~" : ""}</div></div>
        <div class="cell"><div class="k">${l.repay === "graduate" ? "초기 월상환" : "월 상환액"}</div><div class="v" style="color:var(--minus)">${eok(c.firstPay)}</div></div>
        <div class="cell"><div class="k">총 이자</div><div class="v">${eok(c.totalInterest)}</div></div>
      </div>
      <div class="bar"><span style="width:${Math.round((1 - c.remain / l.principal) * 100)}%"></span></div>
      <div class="meta" style="font-size:11.5px;color:var(--sub);margin-top:8px;">원금 ${eok(l.principal)} · 기간 ${Math.round(l.term / 12 * 10) / 10}년(${l.term}개월) · 첫 상환 ${l.start} · 총 상환 ${eok(l.principal + c.totalInterest)}</div>`;
        box.appendChild(div);
    });
    $("loanTotalPill").textContent = "총 부채 " + eok(totalDebtRemain());
}
$("loanList").addEventListener("click", e => {
    if (e.target.dataset.del) { loans = loans.filter(x => x.id !== e.target.dataset.del); renderLoans(); refreshSummary(); renderCalendar(); renderUpcoming(); }
    if (e.target.dataset.edit) openLoanModal(e.target.dataset.edit);
});

let editingLoanId = null, modalRateChanges = [], modalPrepays = [];
function renderRateChanges() { const box = $("rateChangeList"); box.innerHTML = ""; modalRateChanges.forEach((rc, i) => { const row = document.createElement("div"); row.className = "sg-row"; row.innerHTML = `<input type="number" placeholder="개월차" value="${rc.month}" data-rc="${i}" data-k="month"/><input type="number" step="0.1" placeholder="금리 %" value="${rc.rate}" data-rc="${i}" data-k="rate"/><button class="btn-del" data-rcdel="${i}">×</button>`; box.appendChild(row); }); }
function renderPrepays() { const box = $("prepayList"); box.innerHTML = ""; modalPrepays.forEach((p, i) => { const row = document.createElement("div"); row.className = "sg-row"; row.innerHTML = `<input type="number" placeholder="개월차" value="${p.month}" data-pp="${i}" data-k="month"/><input type="text" inputmode="numeric" placeholder="상환액(원)" value="${fmtNum(p.amount)}" data-pp="${i}" data-k="amount"/><button class="btn-del" data-ppdel="${i}">×</button>`; box.appendChild(row); }); }
function updateModalPreview() {
    const l = collectModalLoan(); const c = loanCalc(l);
    $("previewPay").textContent = eok(c.firstPay) + (l.repay === "graduate" ? " (초기)" : "");
    $("previewInt").textContent = eok(c.totalInterest);
    if (l.repay === "custom") {
        const minPay = l.principal * (l.rate / 100 / 12);
        $("customHint").style.display = "block";
        $("customHint").innerHTML = (l.fixed < minPay && l.rate > 0) ? `⚠️ 첫 달 이자(${won(Math.round(minPay))})보다 상환액이 적어 원금이 줄지 않아요.` : `현재 상환액으로 약 <b>${c.months}개월</b> 후 완제 예상.`;
    } else $("customHint").style.display = "none";
}
function collectModalLoan() {
    return { id: editingLoanId || "preview", name: $("lName").value || "새 대출", owner: $("lOwner").value, kind: $("lKind").value, principal: parseNum($("lPrincipal").value), rate: +$("lRate").value || 0, term: +$("lTerm").value || 12, repay: $("lRepay").value, start: $("lStart").value || TODAY, payDay: +$("lPayDay").value || 25, fixed: parseNum($("lFixed").value), grace: +$("lGrace").value || 0, growth: +$("lGrowth").value || 0, rateType: $("lRateType").value, rateChanges: modalRateChanges.slice(), prepayments: modalPrepays.slice() };
}
function syncRepayFields() { const rp = $("lRepay").value; $("lCustomWrap").style.display = rp === "custom" ? "block" : "none"; $("lGrowthWrap").style.display = rp === "graduate" ? "block" : "none"; }
function openLoanModal(id) {
    editingLoanId = id || null;
    const l = id ? loans.find(x => x.id === id) : { name: "", owner: "A", kind: "bank", principal: 300000000, rate: 4.2, term: 360, repay: "eq", start: TODAY, payDay: 25, fixed: 1000000, grace: 0, growth: 1.5, rateType: "fixed", rateChanges: [], prepayments: [] };
    $("loanModalTitle").textContent = id ? "✏️ 대출 수정" : "🏦 대출 등록";
    $("lName").value = l.name; $("lOwner").value = l.owner; $("lKind").value = l.kind;
    $("lPrincipal").value = l.principal; $("lRate").value = l.rate; $("lTerm").value = l.term; $("lRepay").value = l.repay;
    $("lStart").value = l.start; $("lPayDay").value = l.payDay; $("lGrace").value = l.grace || 0; $("lFixed").value = l.fixed || 0;
    $("lGrowth").value = l.growth || 1.5; $("lRateType").value = l.rateType || "fixed";
    syncRepayFields(); $("rateChangeWrap").style.display = l.rateType === "variable" ? "block" : "none";
    modalRateChanges = (l.rateChanges || []).map(x => ({ ...x })); modalPrepays = (l.prepayments || []).map(x => ({ ...x }));
    renderRateChanges(); renderPrepays(); updateModalPreview();
    $("loanModal").classList.add("on");
}
function closeLoanModal() { $("loanModal").classList.remove("on"); }
$("openAddLoan").addEventListener("click", () => openLoanModal(null));
$("cancelLoan").addEventListener("click", closeLoanModal);
$("loanModal").addEventListener("click", e => { if (e.target.id === "loanModal") closeLoanModal(); });
["lName", "lOwner", "lKind", "lPrincipal", "lRate", "lTerm", "lStart", "lPayDay", "lGrace", "lFixed", "lGrowth"].forEach(id => $(id).addEventListener("input", updateModalPreview));
$("lRepay").addEventListener("change", () => { syncRepayFields(); updateModalPreview(); });
$("lRateType").addEventListener("change", () => { $("rateChangeWrap").style.display = $("lRateType").value === "variable" ? "block" : "none"; updateModalPreview(); });
$("lKind").addEventListener("change", () => { if ($("lKind").value === "family") { $("lRate").value = 0; $("lRepay").value = "custom"; syncRepayFields(); } updateModalPreview(); });
$("addRateChange").addEventListener("click", () => { modalRateChanges.push({ month: 60, rate: 5 }); renderRateChanges(); updateModalPreview(); });
$("addPrepay").addEventListener("click", () => { modalPrepays.push({ month: 12, amount: 10000000 }); renderPrepays(); updateModalPreview(); });
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

/* ---------- 정기 수입 ---------- */
function renderIncome() {
    const box = $("incomeList"); box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", `<div class="item" style="grid-template-columns:1.2fr 0.8fr 1fr 0.6fr 1.4fr 34px;background:transparent;border:none;padding:4px 15px;color:var(--sub);font-size:11.5px;font-weight:700;"><div>항목</div><div>담당</div><div>월 금액</div><div>입금일</div><div>입금 계좌</div><div></div></div>`);
    incomes.forEach(inc => {
        const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "1.2fr 0.8fr 1fr 0.6fr 1.4fr 34px";
        row.innerHTML = `<input type="text" value="${inc.name}" data-id="${inc.id}" data-k="name" class="nm"/>
      <select data-id="${inc.id}" data-k="owner"><option value="A" ${inc.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${inc.owner === "B" ? "selected" : ""}>${nameOf.B}</option></select>
      <input type="text" inputmode="numeric" class="amt" value="${fmtNum(inc.amt)}" data-id="${inc.id}" data-k="amt"/>
      <input type="number" value="${inc.payDay}" data-id="${inc.id}" data-k="payDay" min="1" max="31"/>
      <select data-id="${inc.id}" data-k="acc">${accOptions(inc.acc)}</select>
      <button class="btn-del" data-del="${inc.id}">×</button>`;
        box.appendChild(row);
    });
}
$("incomeList").addEventListener("input", e => { const t = e.target, inc = incomes.find(x => x.id === t.dataset.id); if (!inc) return; const k = t.dataset.k; if (k === "amt") { inc.amt = parseNum(t.value); t.value = fmtNum(t.value); } else if (k === "payDay") inc.payDay = +t.value || 1; else inc[k] = t.value; refreshSummary(); });
$("incomeList").addEventListener("change", e => { const t = e.target, inc = incomes.find(x => x.id === t.dataset.id); if (!inc) return; inc[t.dataset.k] = t.value; if (t.dataset.k === "owner") renderIncome(); renderCalendar(); renderUpcoming(); });
$("incomeList").addEventListener("click", e => { if (e.target.dataset.del) { incomes = incomes.filter(x => x.id !== e.target.dataset.del); renderIncome(); refreshSummary(); renderCalendar(); } });
$("addIncome").addEventListener("click", () => { incomes.push({ id: uid(), owner: "A", name: "새 수입", amt: 0, payDay: 25, acc: accounts[0] ? accounts[0].id : "" }); renderIncome(); refreshSummary(); });

/* ---------- [NEW] 기타 수입 / 기타 지출 (공통 렌더) ---------- */
// kind: 'income' | 'expense'
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
      <select data-id="${it.id}" data-k="acc">${accOptions(it.acc)}</select>
      <button class="btn-del" data-del="${it.id}">×</button>`;
        box.appendChild(row);
    });
}
function bindExtra(kind) {
    const list = () => kind === "income" ? extraIncomes : extraExpenses;
    const boxId = kind === "income" ? "extraIncomeList" : "extraExpenseList";
    $(boxId).addEventListener("input", e => {
        const t = e.target, it = list().find(x => x.id === t.dataset.id); if (!it) return; const k = t.dataset.k;
        if (k === "amt") { it.amt = parseNum(t.value); t.value = fmtNum(t.value); }
        else if (k === "day") it.day = +t.value || 1;
        else it[k] = t.value;
        refreshSummary();
    });
    $(boxId).addEventListener("change", e => {
        const t = e.target, it = list().find(x => x.id === t.dataset.id); if (!it) return; const k = t.dataset.k;
        it[k] = k === "day" ? (+t.value || 1) : t.value;
        if (k === "freq" || k === "owner") renderExtra(kind);
        refreshSummary(); renderCalendar(); renderUpcoming();
    });
    $(boxId).addEventListener("click", e => {
        if (e.target.dataset.del) {
            if (kind === "income") extraIncomes = extraIncomes.filter(x => x.id !== e.target.dataset.del);
            else extraExpenses = extraExpenses.filter(x => x.id !== e.target.dataset.del);
            renderExtra(kind); refreshSummary(); renderCalendar(); renderUpcoming();
        }
    });
}
bindExtra("income"); bindExtra("expense");
$("addExtraIncome").addEventListener("click", () => { extraIncomes.push({ id: uid(), owner: "A", name: "새 기타수입", amt: 0, freq: "once", date: TODAY, day: 25, acc: accounts[0] ? accounts[0].id : "" }); renderExtra("income"); refreshSummary(); renderCalendar(); });
$("addExtraExpense").addEventListener("click", () => { extraExpenses.push({ id: uid(), owner: "J", name: "새 기타지출", amt: 0, freq: "once", date: TODAY, day: 1, acc: accounts[0] ? accounts[0].id : "" }); renderExtra("expense"); refreshSummary(); renderCalendar(); });

/* ---------- 고정 지출 ---------- */
function methodOptions(sel) {
    const cardOpts = cards.map(c => `<option value="card:${c.id}" ${sel === "card:" + c.id ? "selected" : ""}>💳 ${c.name}</option>`).join("");
    const accOpts = accounts.map(a => `<option value="acc:${a.id}" ${sel === "acc:" + a.id ? "selected" : ""}>🏦 ${a.name}</option>`).join("");
    return `<optgroup label="카드">${cardOpts}</optgroup><optgroup label="계좌 직접">${accOpts}</optgroup>`;
}
function renderExpenses() {
    const box = $("expenseList"); box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", `<div class="item" style="grid-template-columns:1.3fr 0.7fr 1fr 0.5fr 1.5fr 34px;background:transparent;border:none;padding:4px 15px;color:var(--sub);font-size:11.5px;font-weight:700;"><div>항목</div><div>담당</div><div>월 금액</div><div>결제일</div><div>결제수단</div><div></div></div>`);
    expenses.forEach(ex => {
        const sel = ex.method + ":" + ex.ref;
        const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "1.3fr 0.7fr 1fr 0.5fr 1.5fr 34px";
        row.innerHTML = `<input type="text" value="${ex.name}" data-id="${ex.id}" data-k="name" class="nm"/>
      <select data-id="${ex.id}" data-k="owner"><option value="A" ${ex.owner === "A" ? "selected" : ""}>${nameOf.A}</option><option value="B" ${ex.owner === "B" ? "selected" : ""}>${nameOf.B}</option><option value="J" ${ex.owner === "J" ? "selected" : ""}>공동</option></select>
      <input type="text" inputmode="numeric" class="amt" value="${fmtNum(ex.amt)}" data-id="${ex.id}" data-k="amt"/>
      <input type="number" value="${ex.day}" data-id="${ex.id}" data-k="day" min="1" max="31"/>
      <select data-id="${ex.id}" data-k="pay">${methodOptions(sel)}</select>
      <button class="btn-del" data-del="${ex.id}">×</button>`;
        box.appendChild(row);
    });
}
$("expenseList").addEventListener("input", e => { const t = e.target, ex = expenses.find(x => x.id === t.dataset.id); if (!ex) return; const k = t.dataset.k; if (k === "amt") { ex.amt = parseNum(t.value); t.value = fmtNum(t.value); } else if (k === "day") ex.day = +t.value || 1; else ex[k] = t.value; refreshSummary(); });
$("expenseList").addEventListener("change", e => { const t = e.target, ex = expenses.find(x => x.id === t.dataset.id); if (!ex) return; const k = t.dataset.k; if (k === "pay") { const [m, r] = t.value.split(":"); ex.method = m; ex.ref = r; } else ex[k] = t.value; if (k === "owner") renderExpenses(); refreshSummary(); renderCalendar(); renderUpcoming(); });
$("expenseList").addEventListener("click", e => { if (e.target.dataset.del) { expenses = expenses.filter(x => x.id !== e.target.dataset.del); renderExpenses(); refreshSummary(); renderCalendar(); } });
$("addExpense").addEventListener("click", () => { expenses.push({ id: uid(), name: "새 지출", amt: 0, owner: "J", method: "acc", ref: accounts[0] ? accounts[0].id : "", day: 1 }); renderExpenses(); refreshSummary(); });

/* ---------- 이벤트 빌드 ---------- */
function ymd(d) { return d.toISOString().slice(0, 10); }
function nthDayOfMonth(y, m, day) { const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(day, last)); }
function buildEvents() {
    const ev = [];
    // 대출 상환
    loans.forEach(l => { const c = loanCalc(l); const start = new Date(l.start); c.sched.forEach((s, i) => { const d = new Date(start); d.setMonth(start.getMonth() + i); ev.push({ date: ymd(d), label: `${l.name} 상환`, sub: `${ownerName(l.owner)} · ${REPAY_LABEL[l.repay]}`, amt: -Math.round(s.pay), type: "loan", owner: l.owner, cash: true }); }); });
    // 기타 수입/지출 1회성
    extraIncomes.filter(x => x.freq === "once").forEach(x => { const acc = accounts.find(a => a.id === x.acc); ev.push({ date: x.date, label: x.name, sub: `${ownerName(x.owner)} 기타수입 · ${acc ? acc.name : ""}`, amt: +x.amt, type: "extra-income", owner: x.owner, cash: true }); });
    extraExpenses.filter(x => x.freq === "once").forEach(x => { const acc = accounts.find(a => a.id === x.acc); ev.push({ date: x.date, label: x.name, sub: `${ownerName(x.owner)} 기타지출 · ${acc ? acc.name : ""}`, amt: -x.amt, type: "extra-expense", owner: x.owner, cash: true }); });
    // 월 반복 (오늘 기준 -2 ~ +12개월)
    const base = new Date(TODAY); base.setDate(1);
    for (let m = -2; m <= 12; m++) {
        const dt = new Date(base.getFullYear(), base.getMonth() + m, 1), y = dt.getFullYear(), mo = dt.getMonth();
        // 정기 수입
        incomes.forEach(inc => { const d = nthDayOfMonth(y, mo, inc.payDay); const acc = accounts.find(a => a.id === inc.acc); ev.push({ date: ymd(d), label: inc.name, sub: `${ownerName(inc.owner)} 수입 · ${acc ? acc.name : ""}`, amt: +inc.amt, type: "income", owner: inc.owner, cash: true }); });
        // 기타 수입 매월
        extraIncomes.filter(x => x.freq === "monthly").forEach(x => { const d = nthDayOfMonth(y, mo, x.day); const acc = accounts.find(a => a.id === x.acc); ev.push({ date: ymd(d), label: x.name, sub: `${ownerName(x.owner)} 기타수입(매월) · ${acc ? acc.name : ""}`, amt: +x.amt, type: "extra-income", owner: x.owner, cash: true }); });
        // 계좌 직접 고정지출
        expenses.filter(e => e.method === "acc").forEach(ex => { const acc = accounts.find(a => a.id === ex.ref); ev.push({ date: ymd(nthDayOfMonth(y, mo, ex.day)), label: ex.name, sub: `${ownerName(ex.owner)} 지출 · ${acc ? acc.name : "계좌"}`, amt: -ex.amt, type: "expense", owner: ex.owner, cash: true }); });
        // 기타 지출 매월
        extraExpenses.filter(x => x.freq === "monthly").forEach(x => { const acc = accounts.find(a => a.id === x.acc); ev.push({ date: ymd(nthDayOfMonth(y, mo, x.day)), label: x.name, sub: `${ownerName(x.owner)} 기타지출(매월) · ${acc ? acc.name : ""}`, amt: -x.amt, type: "extra-expense", owner: x.owner, cash: true }); });
        // 카드: 결제일 합산 출금 + 사용내역(정보)
        cards.forEach(c => {
            const acc = accounts.find(a => a.id === c.acc);
            const recur = expenses.filter(e => e.method === "card" && e.ref === c.id);
            const items = [];
            recur.forEach(ex => items.push({ label: ex.name, amt: ex.amt, owner: ex.owner, sub: "고정지출" }));
            const monthTx = cardTxns.filter(t => t.cardId === c.id && t.date.slice(0, 7) === ymd(dt).slice(0, 7));
            monthTx.forEach(t => { items.push({ label: t.item, amt: t.amt, owner: t.owner, sub: "카드사용" }); ev.push({ date: t.date, label: `${t.item}`, sub: `${ownerName(t.owner)} · ${c.name} 사용(비현금)`, amt: -t.amt, type: "carduse", owner: t.owner, cash: false, cardName: c.name }); });
            const total = items.reduce((s, x) => s + x.amt, 0);
            if (total > 0) { const payDay = c.kind === "신용" && c.payDay > 0 ? c.payDay : (recur[0] ? recur[0].day : 1); ev.push({ date: ymd(nthDayOfMonth(y, mo, payDay)), label: `${c.name} 결제`, sub: `${acc ? acc.name : "계좌"}에서 합산 출금 · ${items.length}건`, amt: -total, type: "cardpay", owner: c.owner, cash: true, items: items }); }
        });
    }
    // 주택 자금
    [...cfA.map(e => ({ ...e, h: $("houseA").value, o: $("houseAOwner").value })), ...cfB.map(e => ({ ...e, h: $("houseB").value, o: $("houseBOwner").value }))].forEach(e => { ev.push({ date: e.date, label: `${e.h} · ${e.label}`, sub: `${ownerName(e.o)} 주택자금`, amt: e.amt, type: "house", owner: e.o, cash: true }); });
    return ev.sort((a, b) => a.date.localeCompare(b.date));
}
function ownerShare(ev, owner) {
    if (!ev.cash) return 0;
    if (ev.type === "cardpay" && ev.items) { let s = 0; ev.items.forEach(it => { if (it.owner === owner) s += it.amt; else if (it.owner === "J") s += it.amt / 2; }); return -s; }
    if (ev.owner === owner) return ev.amt;
    if (ev.owner === "J") return ev.amt / 2;
    return 0;
}
function balanceAsOf(owner, dateStr, events) {
    let bal = accSum(owner);
    events.forEach(ev => { if (!ev.cash) return; const sh = ownerShare(ev, owner); if (ev.date > TODAY && ev.date <= dateStr) bal += sh; else if (ev.date <= TODAY && ev.date > dateStr) bal -= sh; });
    return bal;
}

/* ---------- 캘린더 ---------- */
let calYear, calMonth, selectedDate = null, cachedEvents = [];
(function initCal() { const d = new Date(TODAY); calYear = d.getFullYear(); calMonth = d.getMonth(); })();
function renderCalDow() { const dow = ["일", "월", "화", "수", "목", "금", "토"]; $("calDow").innerHTML = dow.map((x, i) => `<div class="cal-dow" style="color:${i === 0 ? 'var(--minus)' : i === 6 ? 'var(--a)' : 'var(--sub)'}">${x}</div>`).join(""); }
function renderCalendar() {
    cachedEvents = buildEvents(); renderCalDow();
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
    <div class="desc" style="margin:10px 0 0;">※ 잔액은 오늘 계좌 합계를 기준으로 미래/과거의 현금흐름을 반영한 <b>예상치</b>입니다. (카드 사용은 결제일에만 현금 반영)</div>`;
    box.innerHTML = html;
}
$("calPrev").addEventListener("click", () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
$("calNext").addEventListener("click", () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
$("calToday").addEventListener("click", () => { const d = new Date(TODAY); calYear = d.getFullYear(); calMonth = d.getMonth(); selectedDate = TODAY; renderCalendar(); renderDayDetail(TODAY); });

function renderUpcoming() {
    const box = $("upcomingList"); box.innerHTML = "";
    const events = buildEvents().filter(e => e.cash && e.date >= TODAY).slice(0, 14);
    if (!events.length) { box.innerHTML = `<div style="color:var(--sub);font-size:13px;padding:8px 0;">예정된 일정이 없어요.</div>`; return; }
    events.forEach(e => { const row = document.createElement("div"); row.className = "tl-row"; row.innerHTML = `<div class="date">${e.date}</div><div class="label">${e.label} <span style="color:var(--sub);font-size:11.5px;">${e.sub || ""}</span></div><div class="val ${e.amt >= 0 ? "plus" : "minus"}">${e.amt >= 0 ? "＋" : "－"}${won(Math.abs(e.amt))}</div>`; box.appendChild(row); });
}

/* ---------- 주택 자금 ---------- */
function renderCf(list, boxId) {
    const box = $(boxId); box.innerHTML = "";
    list.forEach((e, i) => { const row = document.createElement("div"); row.className = "item"; row.style.gridTemplateColumns = "130px 1fr 130px 34px"; row.style.padding = "10px 12px"; row.innerHTML = `<input type="date" value="${e.date}" data-i="${i}" data-k="date"/><input type="text" value="${e.label}" data-i="${i}" data-k="label" placeholder="항목"/><input type="text" inputmode="numeric" value="${fmtNum(e.amt)}" data-i="${i}" data-k="amt" style="text-align:right;"/><button class="btn-del" data-del="${i}">×</button>`; box.appendChild(row); });
}
function getCf(id) { return id === "cfListA" ? cfA : cfB; }
["cfListA", "cfListB"].forEach(boxId => {
    $(boxId).addEventListener("input", e => { const t = e.target; if (t.dataset.i === undefined) return; const list = getCf(boxId), i = +t.dataset.i, k = t.dataset.k; if (k === "amt") { list[i].amt = parseNum(t.value); t.value = fmtNum(t.value); } else list[i][k] = t.value; });
    $(boxId).addEventListener("click", e => { if (e.target.dataset.del !== undefined) { getCf(boxId).splice(+e.target.dataset.del, 1); renderCf(getCf(boxId), boxId); } });
});
$("addCfA").addEventListener("click", () => { cfA.push({ date: TODAY, label: "새 항목", amt: 0 }); cfA.sort((a, b) => a.date.localeCompare(b.date)); renderCf(cfA, "cfListA"); });
$("addCfB").addEventListener("click", () => { cfB.push({ date: TODAY, label: "새 항목", amt: 0 }); cfB.sort((a, b) => a.date.localeCompare(b.date)); renderCf(cfB, "cfListB"); });
$("houseA").addEventListener("input", () => { $("hLabelA").textContent = $("houseA").value; });
$("houseB").addEventListener("input", () => { $("hLabelB").textContent = $("houseB").value; });

let houseFlowChart;
function calcHouse() {
    const budgetA = parseNum($("budgetA").value), budgetB = parseNum($("budgetB").value);
    const ledger = (budget, list) => { const s = [...list].sort((x, y) => x.date.localeCompare(y.date)); let bal = budget; const rows = s.map(e => { const up = e.date >= TODAY; if (up) bal += (+e.amt || 0); return { ...e, up, bal: up ? bal : null }; }); return { rows, final: bal }; };
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
function debtOf(o) { return loans.filter(l => l.owner === o).reduce((s, l) => s + loanCalc(l).remain, 0) + loans.filter(l => l.owner === "J").reduce((s, l) => s + loanCalc(l).remain / 2, 0); }
// 매월 반복 수입/지출 합계 (기타 매월 포함, 이번달 카드사용 포함)
function monthlyIncomeTotal() { return incomes.reduce((s, i) => s + i.amt, 0) + extraIncomes.filter(x => x.freq === "monthly").reduce((s, x) => s + x.amt, 0); }
function monthlyExpenseTotal() {
    let s = expenses.reduce((a, e) => a + e.amt, 0);
    s += extraExpenses.filter(x => x.freq === "monthly").reduce((a, x) => a + x.amt, 0);
    const ym = TODAY.slice(0, 7);
    s += cardTxns.filter(t => t.date.slice(0, 7) === ym).reduce((a, t) => a + t.amt, 0);
    return s;
}
function refreshSummary() {
    const totalAsset = accounts.reduce((s, a) => s + (+a.amt || 0), 0);
    const debtRemain = totalDebtRemain();
    $("heroNet").textContent = eok(totalAsset - debtRemain);
    $("heroAsset").textContent = eok(totalAsset);
    $("heroDebt").textContent = eok(debtRemain);
    const incTot = monthlyIncomeTotal();
    const expTot = monthlyExpenseTotal();
    const payTot = monthlyPayTotal();
    const flow = incTot - expTot - payTot;
    $("heroFlow").textContent = (flow >= 0 ? "＋" : "－") + eok(Math.abs(flow));
    $("heroFlow").style.color = flow >= 0 ? "var(--plus)" : "var(--minus)";
    const netA = accSum("A") - debtOf("A"), netB = accSum("B") - debtOf("B");
    $("kNetA").textContent = eok(netA); $("kNetADesc").textContent = `자산 ${eok(accSum("A"))} · 부채 ${eok(debtOf("A"))}`;
    $("kNetB").textContent = eok(netB); $("kNetBDesc").textContent = `자산 ${eok(accSum("B"))} · 부채 ${eok(debtOf("B"))}`;
    $("kLoan").textContent = eok(debtRemain) + ` / ${loans.length}건`;
    const up = buildEvents().filter(e => e.type === "loan" && e.date >= TODAY)[0];
    $("kLoanNext").textContent = up ? `다음 ${up.date}` : "예정 없음";
    const ym = TODAY.slice(0, 7);
    $("kMonthPay").textContent = eok(buildEvents().filter(e => e.type === "loan" && e.date.slice(0, 7) === ym).reduce((s, e) => s + Math.abs(e.amt), 0));
    drawHome();
}
function drawHome() {
    if (!window.Chart) return; chartFont();
    const types = {}; accounts.forEach(a => types[a.type] = (types[a.type] || 0) + (+a.amt || 0)); const tl = Object.keys(types);
    if (assetChart) assetChart.destroy();
    assetChart = new Chart($("assetChart"), { type: "doughnut", data: { labels: tl.map(t => (ACC_ICON[t] || "") + " " + t), datasets: [{ data: tl.map(t => types[t]), backgroundColor: [COL.a, COL.b, COL.peri, COL.aqua, COL.plus, COL.gold, "#9db8d4"], borderWidth: 2, borderColor: cardc() }] }, options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.label + ": " + eok(c.parsed) } } }, cutout: "60%", maintainAspectRatio: false } });
    if (balanceChart) balanceChart.destroy();
    balanceChart = new Chart($("balanceChart"), { type: "bar", data: { labels: [nameOf.A, nameOf.B], datasets: [{ label: "자산", data: [accSum("A"), accSum("B")], backgroundColor: COL.plus, borderRadius: 6 }, { label: "부채", data: [debtOf("A"), debtOf("B")], backgroundColor: COL.minus, borderRadius: 6 }] }, options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + eok(c.parsed.y) } } }, scales: { y: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, x: { grid: { display: false } } }, maintainAspectRatio: false } });
    const incTot = monthlyIncomeTotal(), expTot = monthlyExpenseTotal(), payTot = monthlyPayTotal();
    if (flowChartHome) flowChartHome.destroy();
    flowChartHome = new Chart($("flowChart"), { type: "bar", data: { labels: ["월 현금흐름"], datasets: [{ label: "수입", data: [incTot], backgroundColor: COL.plus, borderRadius: 6 }, { label: "생활비", data: [-expTot], backgroundColor: COL.minus, borderRadius: 6 }, { label: "대출상환", data: [-payTot], backgroundColor: COL.peri, borderRadius: 6 }] }, options: { indexAxis: "y", plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.dataset.label + ": " + won(Math.abs(c.parsed.x)) } } }, scales: { x: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, y: { grid: { display: false } } }, maintainAspectRatio: false } });
}
function drawFlowCharts() {
    if (!window.Chart) return; chartFont();
    const ym = TODAY.slice(0, 7);
    const items = [...expenses.map(e => ({ name: e.name, amt: e.amt })), ...extraExpenses.filter(x => x.freq === "monthly").map(x => ({ name: x.name + " (기타)", amt: x.amt })), ...cardTxns.filter(t => t.date.slice(0, 7) === ym).map(t => ({ name: t.item, amt: t.amt }))];
    if (expenseChart) expenseChart.destroy();
    expenseChart = new Chart($("expenseChart"), { type: "doughnut", data: { labels: items.map(e => e.name), datasets: [{ data: items.map(e => e.amt), backgroundColor: [COL.a, COL.b, COL.peri, COL.aqua, COL.plus, COL.gold, COL.minus, "#9db8d4", "#b7cfc5", "#c9b6e8"], borderWidth: 2, borderColor: cardc() }] }, options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => c.label + ": " + won(c.parsed) } } }, cutout: "58%", maintainAspectRatio: false } });
    const burden = { A: 0, B: 0 };
    const addBurden = (owner, amt) => { if (owner === "J") { burden.A += amt / 2; burden.B += amt / 2; } else if (burden[owner] !== undefined) burden[owner] += amt; };
    expenses.forEach(e => addBurden(e.owner, e.amt));
    extraExpenses.filter(x => x.freq === "monthly").forEach(x => addBurden(x.owner, x.amt));
    cardTxns.filter(t => t.date.slice(0, 7) === ym).forEach(t => addBurden(t.owner, t.amt));
    loans.forEach(l => addBurden(l.owner, loanCalc(l).firstPay));
    if (burdenChart) burdenChart.destroy();
    burdenChart = new Chart($("burdenChart"), { type: "bar", data: { labels: [nameOf.A, nameOf.B], datasets: [{ label: "월 부담(생활비+상환)", data: [burden.A, burden.B], backgroundColor: [COL.a, COL.b], borderRadius: 6 }] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => won(c.parsed.y) } } }, scales: { y: { ticks: { callback: v => eok(v) }, grid: { color: gridc() } }, x: { grid: { display: false } } }, maintainAspectRatio: false } });
}

function syncNames() { document.querySelectorAll(".nA").forEach(el => el.textContent = nameOf.A); document.querySelectorAll(".nB").forEach(el => el.textContent = nameOf.B); }
function rerenderAll() { renderAccounts(); renderCards(); renderCardLedgers(); renderIncome(); renderExtra("income"); renderExpenses(); renderExtra("expense"); renderLoans(); refreshSummary(); }
$("nameA").addEventListener("input", () => { syncNames(); rerenderAll(); });
$("nameB").addEventListener("input", () => { syncNames(); rerenderAll(); });

/* ---------- 탭 ---------- */
document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active"); $("tab-" + btn.dataset.tab).classList.add("active");
    setTimeout(() => { if (btn.dataset.tab === "home") drawHome(); if (btn.dataset.tab === "flow") drawFlowCharts(); if (btn.dataset.tab === "calendar") renderCalendar(); }, 30);
}));

/* ---------- 다크모드 ---------- */
$("themeBtn").addEventListener("click", () => {
    const html = document.documentElement, dark = html.getAttribute("data-theme") === "dark";
    html.setAttribute("data-theme", dark ? "light" : "dark");
    $("themeBtn").textContent = dark ? "🌙" : "☀️";
    setTimeout(() => { chartFont(); drawHome(); drawFlowCharts(); if ($("houseResults").style.display === "block") calcHouse(); }, 60);
});

/* ---------- 데이터 수집/적용 ---------- */
function collect() { return { nameA: $("nameA").value, nameB: $("nameB").value, accounts, cards, cardTxns, loans, incomes, extraIncomes, expenses, extraExpenses, cfA, cfB, houseA: $("houseA").value, houseB: $("houseB").value, budgetA: parseNum($("budgetA").value), budgetB: parseNum($("budgetB").value), houseAOwner: $("houseAOwner").value, houseBOwner: $("houseBOwner").value, updatedAt: new Date().toISOString() }; }
function applyData(d) {
    if (!d) return;
    if (d.nameA) $("nameA").value = d.nameA; if (d.nameB) $("nameB").value = d.nameB;
    if (Array.isArray(d.accounts)) accounts = d.accounts; if (Array.isArray(d.cards)) cards = d.cards; if (Array.isArray(d.cardTxns)) cardTxns = d.cardTxns;
    if (Array.isArray(d.loans)) loans = d.loans; if (Array.isArray(d.incomes)) incomes = d.incomes; if (Array.isArray(d.extraIncomes)) extraIncomes = d.extraIncomes;
    if (Array.isArray(d.expenses)) expenses = d.expenses; if (Array.isArray(d.extraExpenses)) extraExpenses = d.extraExpenses;
    if (Array.isArray(d.cfA)) cfA = d.cfA; if (Array.isArray(d.cfB)) cfB = d.cfB;
    if (d.houseA) $("houseA").value = d.houseA; if (d.houseB) $("houseB").value = d.houseB;
    if (d.budgetA != null) $("budgetA").value = d.budgetA; if (d.budgetB != null) $("budgetB").value = d.budgetB;
    if (d.houseAOwner) $("houseAOwner").value = d.houseAOwner; if (d.houseBOwner) $("houseBOwner").value = d.houseBOwner;
    bootRender();
}

/* ---------- 저장/불러오기 (Firebase or localStorage) ---------- */
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
    const data = collect(); localStorage.setItem("coupleV5", JSON.stringify(data));
    if (!db) { setStatus("로컬에 저장 완료 · " + new Date().toLocaleString("ko-KR"), "ok"); return; }
    try { await db.collection(typeof DOC_PATH !== "undefined" ? DOC_PATH[0] : "coupleFund").doc(typeof DOC_PATH !== "undefined" ? DOC_PATH[1] : "main").set(data); setStatus("클라우드 저장 완료 · " + new Date().toLocaleString("ko-KR"), "ok"); }
    catch (e) { setStatus("클라우드 저장 실패: " + e.message, "err"); }
}
async function loadFromCloud(silent) {
    if (!db) { const s = localStorage.getItem("coupleV5"); if (s) { applyData(JSON.parse(s)); if (!silent) setStatus("로컬 데이터 불러옴", "ok"); } else if (!silent) setStatus("저장된 데이터 없음", "ok"); return; }
    try { const snap = await db.collection(typeof DOC_PATH !== "undefined" ? DOC_PATH[0] : "coupleFund").doc(typeof DOC_PATH !== "undefined" ? DOC_PATH[1] : "main").get(); if (snap.exists) { applyData(snap.data()); setStatus("클라우드 불러오기 완료 · " + new Date().toLocaleString("ko-KR"), "ok"); } else if (!silent) setStatus("클라우드에 데이터 없음", "ok"); }
    catch (e) { if (!silent) setStatus("불러오기 실패: " + e.message, "err"); }
}
$("saveBtn").addEventListener("click", saveData);
$("loadBtn").addEventListener("click", () => loadFromCloud(false));

/* ---------- 시작 ---------- */
function bootRender() {
    syncNames();
    renderAccounts(); renderCards(); renderCardLedgers(); renderLoans(); renderIncome(); renderExtra("income"); renderExpenses(); renderExtra("expense");
    renderCf(cfA, "cfListA"); renderCf(cfB, "cfListB");
    $("hLabelA").textContent = $("houseA").value; $("hLabelB").textContent = $("houseB").value;
    refreshSummary(); renderCalendar(); renderUpcoming();
}
(function boot() {
    bootRender();
    const s = localStorage.getItem("coupleV5"); if (s) { try { applyData(JSON.parse(s)); } catch (e) { } }
    initFirebase();
})();
