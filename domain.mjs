export const SCHEMA_VERSION = 2;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const localYmd = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const amount = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export function monthKeyFromDate(date, fallback = "") {
  const value = String(date || "");
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : fallback;
}

export function stableSettlementId(sourceTransactionId) {
  return `settlement:${sourceTransactionId}`;
}

function normalizePayment(tx) {
  if (tx?.payment?.type) return tx.payment;
  if (tx?.cardId) return { type: "card", id: tx.cardId };
  if (tx?.method === "card" && tx?.ref) return { type: "card", id: tx.ref };
  if (tx?.accountId) return { type: "account", id: tx.accountId };
  if (tx?.method === "acc" && tx?.ref) return { type: "account", id: tx.ref };
  return { type: "unknown", id: "" };
}

export function deriveSettlementForTransaction(tx, cards = [], accounts = []) {
  const usageOwner = tx?.usageOwner || tx?.owner || "J";
  const value = Math.max(0, amount(tx?.amount ?? tx?.amt));
  if (value <= 0) return { kind: "none" };
  if (usageOwner === "J") return { kind: "joint" };

  const payment = normalizePayment(tx);
  if (payment.type === "card") {
    const card = cards.find((item) => item.id === payment.id);
    if (!card) return { kind: "needsSetup", reason: "card" };
    const fundingType = card.fundingType || (card.acc || card.fundingAccountId ? "managed" : "external");
    const allowanceOwner = card.allowanceOwner || (card.isAllowance ? card.owner : "");
    if (fundingType === "privateAllowance" && allowanceOwner === usageOwner) {
      return { kind: "coveredByAllowance" };
    }
    const accountId = card.fundingAccountId || card.acc || "";
    if (accountId && accounts.some((item) => item.id === accountId)) {
      return { kind: "reimburse", beneficiaryAccountId: accountId, amount: value, payerOwner: usageOwner };
    }
    return { kind: "needsSetup", reason: "fundingAccount" };
  }

  if (payment.type === "account") {
    const account = accounts.find((item) => item.id === payment.id);
    if (!account) return { kind: "needsSetup", reason: "account" };
    const isPrivateAllowance = account.visibility === "private" || account.fundingType === "privateAllowance";
    if (isPrivateAllowance && account.owner === usageOwner) return { kind: "coveredByAllowance" };
    if (account.owner === usageOwner && account.isAllowance) return { kind: "coveredByAllowance" };
    return { kind: "reimburse", beneficiaryAccountId: account.id, amount: value, payerOwner: usageOwner };
  }

  return { kind: "needsSetup", reason: "paymentSource" };
}

function normalizeCard(card) {
  const result = { ...card };
  if (!result.fundingType) {
    result.fundingType = result.isAllowance ? "privateAllowance" : (result.acc ? "managed" : "external");
  }
  if (!result.fundingAccountId && result.acc) result.fundingAccountId = result.acc;
  if (!result.allowanceOwner && result.isAllowance) result.allowanceOwner = result.owner;
  return result;
}

function normalizeLedger(ledger) {
  const result = { ...(ledger || {}) };
  for (const key of ["incomes", "expenses", "extraIncomes", "extraExpenses", "cardTxns", "transfers", "settlementReviews"]) {
    if (!Array.isArray(result[key])) result[key] = [];
  }
  return result;
}

export function migrateLegacyData(raw = {}, { today = localYmd() } = {}) {
  const source = clone(raw) || {};
  const data = {
    ...source,
    schemaVersion: SCHEMA_VERSION,
    migratedAt: source.migratedAt || new Date().toISOString(),
    migrationToday: today,
    accounts: Array.isArray(source.accounts) ? source.accounts : [],
    cards: Array.isArray(source.cards) ? source.cards.map(normalizeCard) : [],
    loans: Array.isArray(source.loans) ? source.loans : [],
    goals: Array.isArray(source.goals) ? source.goals : [],
    months: Array.isArray(source.months) ? [...source.months] : Object.keys(source.ledgers || {}),
    ledgers: {}
  };
  data.months = [...new Set(data.months.filter((key) => /^\d{4}-\d{2}$/.test(key)))].sort();
  if (!data.months.length) data.months = [String(today).slice(0, 7)];

  for (const monthKey of data.months) {
    const ledger = normalizeLedger(source.ledgers?.[monthKey]);
    for (const tx of ledger.cardTxns) {
      if (!tx.usageOwner) tx.usageOwner = tx.owner || "J";
      if (!tx.payment) tx.payment = { type: "card", id: tx.cardId || "" };
      tx.amount = amount(tx.amount ?? tx.amt);
      tx.monthKey = tx.monthKey || monthKeyFromDate(tx.date, monthKey);
    }
    for (const expense of ledger.expenses) {
      if (!expense.usageOwner) expense.usageOwner = expense.owner || "J";
      if (expense.method === "card" && !expense.payment) expense.payment = { type: "card", id: expense.ref || "" };
      expense.amount = amount(expense.amount ?? expense.amt);
      expense.monthKey = expense.monthKey || monthKey;
    }
    if (ledger.closed && !ledger.closeSnapshot) {
      ledger.closeSnapshot = { version: 1, source: "legacy", capturedAt: source.updatedAt || new Date().toISOString(), monthKey };
    }
    data.ledgers[monthKey] = ledger;
  }
  for (const monthKey of data.months) {
    const ledger = data.ledgers[monthKey];
    if (ledger.closed && ledger.closeSnapshot && !ledger.closeSnapshot.summary) {
      ledger.closeSnapshot.summary = summarizeMonth(monthKey, data);
    }
  }
  if (!Array.isArray(data.settlementReviews)) data.settlementReviews = [];
  return data;
}

function legacyCardTransactions(monthKey, ledger) {
  const transactions = [];
  for (const tx of ledger.cardTxns || []) {
    const date = tx.date || `${monthKey}-01`;
    transactions.push({
      id: tx.id || `${monthKey}:card:${transactions.length}`,
      sourceTransactionId: tx.id || `${monthKey}:card:${transactions.length}`,
      monthKey,
      date,
      item: tx.item || "카드 사용",
      category: tx.cat || "기타",
      amount: amount(tx.amount ?? tx.amt),
      usageOwner: tx.usageOwner || tx.owner || "J",
      payment: tx.payment || { type: "card", id: tx.cardId || "" },
      source: "cardTxn"
    });
  }
  for (const expense of ledger.expenses || []) {
    if (expense.method !== "card") continue;
    const date = expense.date || `${monthKey}-${String(Math.max(1, Number(expense.day) || 1)).padStart(2, "0")}`;
    transactions.push({
      id: expense.id || `${monthKey}:fixed:${transactions.length}`,
      sourceTransactionId: expense.id || `${monthKey}:fixed:${transactions.length}`,
      monthKey,
      date,
      item: expense.name || "카드 고정 지출",
      category: expense.cat || "기타",
      amount: amount(expense.amount ?? expense.amt),
      usageOwner: expense.usageOwner || expense.owner || "J",
      payment: expense.payment || { type: "card", id: expense.ref || "" },
      source: "fixedExpense"
    });
  }
  return transactions.filter((tx) => tx.amount > 0);
}

export function buildOpenMonthReviews(data = {}) {
  const reviews = [];
  const existing = new Set((data.settlementReviews || []).map((item) => item.sourceTransactionId));
  for (const monthKey of data.months || Object.keys(data.ledgers || {})) {
    const ledger = data.ledgers?.[monthKey];
    if (!ledger || ledger.closed) continue;
    for (const tx of legacyCardTransactions(monthKey, ledger)) {
      if (existing.has(tx.sourceTransactionId)) continue;
      const result = deriveSettlementForTransaction(tx, data.cards || [], data.accounts || []);
      if (result.kind !== "reimburse") continue;
      existing.add(tx.sourceTransactionId);
      reviews.push({
        id: stableSettlementId(tx.sourceTransactionId),
        sourceTransactionId: tx.sourceTransactionId,
        monthKey,
        payerOwner: result.payerOwner,
        beneficiaryAccountId: result.beneficiaryAccountId,
        amount: result.amount,
        status: "review",
        source: "migration",
        item: tx.item,
        date: tx.date,
        category: tx.category,
        createdAt: new Date().toISOString()
      });
    }
  }
  return reviews;
}

function recordsForMonth(monthKey, data) {
  const ledger = data.ledgers?.[monthKey] || {};
  return legacyCardTransactions(monthKey, ledger);
}

export function listMonthTransactions(monthKey, data = {}) {
  return recordsForMonth(monthKey, data).map(clone);
}

export function summarizeMonth(monthKey, data = {}) {
  const ledger = data.ledgers?.[monthKey] || {};
  if (ledger.closed && ledger.closeSnapshot?.summary) return clone(ledger.closeSnapshot.summary);
  const all = recordsForMonth(monthKey, data);
  const total = all.reduce((sum, tx) => sum + tx.amount, 0);
  const joint = all.filter((tx) => tx.usageOwner === "J").reduce((sum, tx) => sum + tx.amount, 0);
  const personalA = all.filter((tx) => tx.usageOwner === "A").reduce((sum, tx) => sum + tx.amount, 0);
  const personalB = all.filter((tx) => tx.usageOwner === "B").reduce((sum, tx) => sum + tx.amount, 0);
  return { monthKey, cardExpense: total, joint, personalA, personalB, count: all.length };
}

export function createCloseSnapshot(monthKey, data = {}) {
  const accounts = (data.accounts || []).map((account) => ({ id: account.id, owner: account.owner, name: account.name, type: account.type, amount: amount(account.amount ?? account.amt) }));
  return {
    version: 2,
    source: "current",
    capturedAt: new Date().toISOString(),
    monthKey,
    summary: { ...summarizeMonth(monthKey, data), accountTotal: accounts.reduce((sum, account) => sum + account.amount, 0) },
    accounts,
    settlementReviews: (data.settlementReviews || []).filter((item) => item.monthKey === monthKey).map(clone)
  };
}

export function normalizeTransactionInput(input = {}) {
  return {
    id: input.id || `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date || localYmd(),
    monthKey: monthKeyFromDate(input.date, input.monthKey || localYmd().slice(0, 7)),
    item: String(input.item || "").trim(),
    category: input.category || "기타",
    amount: amount(input.amount),
    usageOwner: input.usageOwner || "J",
    payment: input.payment || { type: "card", id: "" },
    source: "new"
  };
}

export function calculateHousingLedger(budget, entries = [], today = localYmd()) {
  const initial = amount(budget);
  let balance = initial;
  const rows = [...entries].map((entry) => ({ ...entry, date: String(entry.date || today), label: entry.label || "주택 자금", amt: amount(entry.amt ?? entry.amount) })).sort((a, b) => a.date.localeCompare(b.date));
  for (const row of rows) {
    row.up = row.date >= today;
    if (row.up) balance += row.amt;
    row.bal = row.up ? balance : null;
  }
  return { initial, rows, final: balance };
}

export function buildHousingSeries(ledgerA, ledgerB) {
  const dates = [...new Set([...(ledgerA?.rows || []), ...(ledgerB?.rows || [])].filter((row) => row.up).map((row) => row.date))].sort();
  const series = (ledger, fallback) => {
    let last = ledger?.initial ?? fallback;
    const byDate = Object.fromEntries((ledger?.rows || []).filter((row) => row.up).map((row) => [row.date, row.bal]));
    return dates.map((date) => { if (byDate[date] != null) last = byDate[date]; return last; });
  };
  return { dates, a: series(ledgerA, 0), b: series(ledgerB, 0) };
}
