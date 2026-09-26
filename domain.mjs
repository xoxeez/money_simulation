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

/**
 * Convert the owner labels used by older versions into the stable A/B/J keys.
 * Unknown labels are intentionally returned as joint and marked for review so
 * a migration can never silently assign a private expense to the wrong person.
 */
export function normalizeLegacyOwner(value, { nameA = "나", nameB = "상대방" } = {}) {
  const original = String(value ?? "").trim();
  if (!original) return { owner: "J", needsReview: false, original };
  const normalized = original.toLowerCase().replace(/\s+/g, "");
  if (["a", "ownera", "persona", "본인", "나", "me", "self"].includes(normalized)) return { owner: "A", needsReview: false, original };
  if (["b", "ownerb", "personb", "상대", "상대방", "partner", "other"].includes(normalized)) return { owner: "B", needsReview: false, original };
  if (["j", "joint", "공동", "공통", "함께", "couple"].includes(normalized)) return { owner: "J", needsReview: false, original };
  if (normalized === String(nameA).trim().toLowerCase().replace(/\s+/g, "")) return { owner: "A", needsReview: false, original };
  if (normalized === String(nameB).trim().toLowerCase().replace(/\s+/g, "")) return { owner: "B", needsReview: false, original };
  return { owner: "J", needsReview: true, original };
}

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
  const nameA = String(source.nameA || "나").trim() || "나";
  const nameB = String(source.nameB || "상대방").trim() || "상대방";
  const sourceLedgers = source.ledgers && typeof source.ledgers === "object" && !Array.isArray(source.ledgers) ? source.ledgers : {};
  const isMonthKey = (key) => {
    const match = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
    return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
  };
  const fallbackMonth = isMonthKey(source.currentMonth) ? source.currentMonth : String(today).slice(0, 7);
  const ledgerFields = ["incomes", "expenses", "extraIncomes", "extraExpenses", "cardTxns", "transfers"];
  const hasMonthlyLedgers = Object.keys(sourceLedgers).some(isMonthKey);
  const hasFlatLedgerData = ledgerFields.some((key) => Array.isArray(source[key]));
  const monthKeys = [
    ...(Array.isArray(source.months) ? source.months : []),
    ...Object.keys(sourceLedgers),
    ...(isMonthKey(source.currentMonth) ? [source.currentMonth] : [])
  ];
  if (!hasMonthlyLedgers && hasFlatLedgerData) monthKeys.push(fallbackMonth);
  const months = [...new Set(monthKeys.filter(isMonthKey))].sort();
  if (!months.length) months.push(fallbackMonth);
  const unresolved = Array.isArray(source.migrationAudit?.usageOwnerUnresolved) ? clone(source.migrationAudit.usageOwnerUnresolved) : [];
  const unresolvedKeys = new Set(unresolved.map((item) => `${item.source}:${item.monthKey}:${item.sourceId}:${item.original}`));
  const resolvedKeys = new Set();
  const invalidLedgerKeys = Object.keys(sourceLedgers).filter((key) => !isMonthKey(key));
  const data = {
    ...source,
    nameA,
    nameB,
    schemaVersion: SCHEMA_VERSION,
    migratedAt: source.migratedAt || new Date().toISOString(),
    migrationToday: today,
    accounts: Array.isArray(source.accounts) ? source.accounts : [],
    cards: Array.isArray(source.cards) ? source.cards.map(normalizeCard) : [],
    loans: Array.isArray(source.loans) ? source.loans : [],
    goals: Array.isArray(source.goals) ? source.goals : [],
    months,
    ledgers: {},
    migrationAudit: {
      ...(source.migrationAudit || {}),
      usageOwnerUnresolved: unresolved,
      unmappedLedgers: {
        ...(source.migrationAudit?.unmappedLedgers || {}),
        ...Object.fromEntries(invalidLedgerKeys.map((key) => [key, sourceLedgers[key]]))
      }
    }
  };

  for (const monthKey of data.months) {
    const flatLedger = !hasMonthlyLedgers && monthKey === fallbackMonth
      ? Object.fromEntries(ledgerFields.map((key) => [key, Array.isArray(source[key]) ? source[key] : []]))
      : {};
    const ledger = normalizeLedger(sourceLedgers[monthKey] || flatLedger);
    for (const tx of ledger.cardTxns) {
      const rawOwner = tx.usageOwnerOriginal || tx.usageOwner || tx.owner;
      const ownerResult = normalizeLegacyOwner(rawOwner, { nameA, nameB });
      tx.usageOwner = ownerResult.owner;
      if (tx.usageOwnerOriginal && !ownerResult.needsReview) {
        resolvedKeys.add(`cardTxn:${monthKey}:${tx.id || `${monthKey}:card:${ledger.cardTxns.indexOf(tx)}`}:${tx.usageOwnerOriginal}`);
      }
      if (ownerResult.needsReview) {
        const sourceId = tx.id || `${monthKey}:card:${ledger.cardTxns.indexOf(tx)}`;
        const key = `cardTxn:${monthKey}:${sourceId}:${ownerResult.original}`;
        if (!unresolvedKeys.has(key)) {
          unresolved.push({ monthKey, source: "cardTxn", sourceId, original: ownerResult.original });
          unresolvedKeys.add(key);
        }
        tx.usageOwnerOriginal = ownerResult.original;
      }
      if (!tx.payment) tx.payment = { type: "card", id: tx.cardId || "" };
      tx.amount = amount(tx.amount ?? tx.amt);
      tx.monthKey = tx.monthKey || monthKeyFromDate(tx.date, monthKey);
    }
    for (const expense of ledger.expenses) {
      const rawOwner = expense.usageOwnerOriginal || expense.usageOwner || expense.owner;
      const ownerResult = normalizeLegacyOwner(rawOwner, { nameA, nameB });
      expense.usageOwner = ownerResult.owner;
      if (expense.usageOwnerOriginal && !ownerResult.needsReview) {
        resolvedKeys.add(`expense:${monthKey}:${expense.id || `${monthKey}:expense:${ledger.expenses.indexOf(expense)}`}:${expense.usageOwnerOriginal}`);
      }
      if (ownerResult.needsReview) {
        const sourceId = expense.id || `${monthKey}:expense:${ledger.expenses.indexOf(expense)}`;
        const key = `expense:${monthKey}:${sourceId}:${ownerResult.original}`;
        if (!unresolvedKeys.has(key)) {
          unresolved.push({ monthKey, source: "expense", sourceId, original: ownerResult.original });
          unresolvedKeys.add(key);
        }
        expense.usageOwnerOriginal = ownerResult.original;
      }
      if (expense.method === "card" && !expense.payment) expense.payment = { type: "card", id: expense.ref || "" };
      expense.amount = amount(expense.amount ?? expense.amt);
      expense.monthKey = expense.monthKey || monthKey;
    }
    if (ledger.closed && !ledger.closeSnapshot) {
      ledger.closeSnapshot = { version: 1, source: "legacy", capturedAt: source.updatedAt || new Date().toISOString(), monthKey };
    }
    data.ledgers[monthKey] = ledger;
  }
  const schemaVersion = Number(source.schemaVersion) || 0;
  if (schemaVersion < SCHEMA_VERSION && !data.migrationAudit.importSummary) {
    const count = (field) => data.months.reduce((total, monthKey) => total + data.ledgers[monthKey][field].length, 0);
    data.migrationAudit.importSummary = {
      sourceFormat: hasMonthlyLedgers ? "monthly-ledger" : hasFlatLedgerData ? "flat-ledger" : "legacy-empty",
      monthCount: data.months.length,
      accountCount: data.accounts.length,
      cardCount: data.cards.length,
      loanCount: data.loans.length,
      goalCount: data.goals.length,
      incomeCount: count("incomes") + count("extraIncomes"),
      expenseCount: count("expenses") + count("extraExpenses"),
      cardTransactionCount: count("cardTxns"),
      transferCount: count("transfers"),
      unmappedLedgerCount: Object.keys(data.migrationAudit.unmappedLedgers).length
    };
  }
  data.migrationAudit.usageOwnerUnresolved = unresolved.filter((item) => !resolvedKeys.has(`${item.source}:${item.monthKey}:${item.sourceId}:${item.original}`));
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
      usageOwnerOriginal: tx.usageOwnerOriginal || "",
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
      usageOwnerOriginal: expense.usageOwnerOriginal || "",
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
