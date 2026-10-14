/**
 * Deterministic execution ordering for sale lines sharing one product.
 *
 * Display order and execution order are independent: closed-package demand is
 * reserved BEFORE loose demand may auto-open packages. Otherwise a loose line
 * processed first can open the very carton a later line wants to sell sealed,
 * failing the invoice even though stock is sufficient.
 *
 * Pure — no Firestore access. Shared by create/update paths and unit tests.
 */

/**
 * Return execution positions for `count` lines: package lines first (stable),
 * then loose lines (stable). `stockKindAt(index)` reports "package"/"loose".
 */
function planSaleExecutionOrder(count, stockKindAt) {
  const order = [];
  for (let index = 0; index < count; index += 1) {
    if (stockKindAt(index) === "package") order.push(index);
  }
  for (let index = 0; index < count; index += 1) {
    if (stockKindAt(index) !== "package") order.push(index);
  }
  return order;
}

function normalizeLineId(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 128);
}

function isLineIdWellFormed(value) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** True when the requested payload reuses a line id twice. */
function findDuplicateLineIds(ids) {
  const seen = new Set();
  const duplicates = new Set();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/**
 * Mint a collision-free line id. `taken` holds every id already used in the
 * invoice (old + already minted). Never reuses an index that was used before
 * within the same invoice, even across repeated edits.
 */
function mintUniqueLineId(invoiceId, fallbackIndex, taken) {
  const base = `${invoiceId}-edit-${fallbackIndex}`;
  let candidate = base;
  let suffix = 0;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Resolve the persisted line id for one requested line.
 * - A well-formed client id that is still free is honored (stable across
 *   repeated edits, no index reuse).
 * - Otherwise a collision-free `invoiceId-edit-index[-n]` id is minted.
 */
function resolvePersistedLineId({ invoiceId, requestedId, matchedOldId, fallbackIndex, taken }) {
  const wanted = normalizeLineId(requestedId);
  if (matchedOldId) return matchedOldId;
  if (wanted && isLineIdWellFormed(wanted) && !taken.has(wanted)) {
    taken.add(wanted);
    return wanted;
  }
  return mintUniqueLineId(invoiceId, fallbackIndex, taken);
}

export {
  findDuplicateLineIds,
  isLineIdWellFormed,
  mintUniqueLineId,
  normalizeLineId,
  planSaleExecutionOrder,
  resolvePersistedLineId,
};
