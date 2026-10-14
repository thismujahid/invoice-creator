const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");
const unitPricingPromise = import("./shared/unitPricing.mjs");
const inventoryCorePromise = import("./shared/inventoryCore.mjs");

const MAX_UNITS = 40;
const MAX_PURCHASE_ITEMS = 100;

function invalid(message) {
  throw new HttpsError("invalid-argument", message);
}

function unavailable(message) {
  throw new HttpsError("failed-precondition", message);
}

function text(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finite(value, min = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= min;
}

function hasKnownCost(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function operationKey(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value);
}

function productLabel(product) {
  const family = text(product.family_name, 120);
  const variant = text(product.variant_name || product.name, 120);
  const packSize = text(product.pack_size_name, 120);
  if (product.inventory_mode === "independent") {
    if (product.uses_variants === false) return [family, packSize].filter(Boolean).join(" — ") || product.name;
    return [family, variant, packSize].filter(Boolean).join(" — ") || product.name;
  }
  if (product.uses_variants === false) return family || product.name;
  return family && variant ? `${family} — ${variant}` : variant || family;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1e6;
  return null;
}

function movementFingerprint(transactions) {
  return JSON.stringify(transactions.map((transaction) => ({
    id: transaction.id ?? "",
    product_id: transaction.product_id ?? null,
    type: transaction.type ?? null,
    direction: transaction.direction ?? null,
    quantity: transaction.quantity ?? null,
    unit_id: transaction.unit_id ?? null,
    unit_name: transaction.unit_name ?? null,
    unit_factor: transaction.unit_factor ?? null,
    base_quantity: transaction.base_quantity ?? null,
    unit_cost: transaction.unit_cost ?? null,
    invoice_id: transaction.invoice_id ?? null,
    return_id: transaction.return_id ?? null,
    purchase_invoice_id: transaction.purchase_invoice_id ?? null,
    operation_id: transaction.operation_id ?? null,
    reason: transaction.reason ?? null,
    component_deltas: transaction.component_deltas ?? null,
    opened_packages: transaction.opened_packages ?? null,
    seq: transaction.seq ?? null,
    created_at: timestampMillis(transaction.created_at),
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

function replayAverage(transactions, core) {
  const ordered = transactions.map((transaction) => ({
    ...transaction,
    timestamp: timestampMillis(transaction.created_at),
    quantity: Number(transaction.base_quantity ?? transaction.quantity),
  })).sort((left, right) => left.timestamp - right.timestamp
    || (Number(left.seq ?? Number.MAX_SAFE_INTEGER) - Number(right.seq ?? Number.MAX_SAFE_INTEGER))
    || left.id.localeCompare(right.id));
  if (ordered.some((transaction) => transaction.timestamp === null || !Number.isFinite(transaction.quantity) || transaction.quantity <= 0)) unavailable("سجل الحركة غير مكتمل ولا يمكن إعادة حساب متوسط التكلفة.");
  const groups = new Map();
  for (const transaction of ordered) {
    let key = transaction.operation_id ? `operation:${transaction.operation_id}` : null;
    if (!key && transaction.type === "purchase" && transaction.purchase_invoice_id) key = `purchase:${transaction.purchase_invoice_id}`;
    if (!key && transaction.return_id) key = `return:${transaction.type}:${transaction.return_id}`;
    if (!key && transaction.type === "sale" && transaction.invoice_id) key = `sale:${transaction.invoice_id}`;
    if (!key) key = `movement:${transaction.id}`;
    if (!groups.has(key)) groups.set(key, { timestamp: transaction.timestamp, items: [] });
    const group = groups.get(key);
    if (group.timestamp !== transaction.timestamp) unavailable("توقيت حركات العملية الذرية غير متطابق؛ راجع سجل الحركة.");
    group.items.push(transaction);
  }
  const groupsByTimestamp = new Map();
  for (const [key, group] of groups) {
    const keys = groupsByTimestamp.get(group.timestamp) || [];
    keys.push(key);
    groupsByTimestamp.set(group.timestamp, keys);
  }
  for (const keys of groupsByTimestamp.values()) if (keys.length > 1) unavailable("ترتيب عمليتين متزامنتين غير واضح؛ لم يُخمَّن ترتيب التكلفة.");
  let stock = 0;
  let average;
  let untrusted = false;
  for (const group of [...groups.values()].sort((left, right) => left.timestamp - right.timestamp)) {
    const transactionsInGroup = group.items;
    const seqs = transactionsInGroup.map((transaction) => transaction.seq).filter(Number.isInteger);
    if (transactionsInGroup.length > 1 && (seqs.length !== transactionsInGroup.length || new Set(seqs).size !== seqs.length)) unavailable("ترتيب الحركات داخل العملية الذرية غير صالح.");
    const steps = transactionsInGroup.map((transaction) => {
      if (["opening_stock", "purchase"].includes(transaction.type)) {
        if (transaction.direction !== "in" || !hasKnownCost(transaction.unit_cost)) unavailable("سجل شراء أو رصيد افتتاحي بلا تكلفة صالحة.");
        return { direction: "in", base_quantity: transaction.quantity, unit_cost: Number(transaction.unit_cost) };
      }
      if (transaction.type === "sale") {
        if (transaction.direction === "out") return { direction: "out", base_quantity: transaction.quantity, unit_cost: transaction.unit_cost ?? null };
        if (transaction.direction === "in" && hasKnownCost(transaction.unit_cost)) return { direction: "in", base_quantity: transaction.quantity, unit_cost: Number(transaction.unit_cost) };
        unavailable("سجل مرتجع أو عكس بيع بلا تكلفة صالحة.");
      }
      if (transaction.type === "refund") {
        if (transaction.direction === "out") return { direction: "out", base_quantity: transaction.quantity, unit_cost: transaction.unit_cost ?? null };
        if (transaction.direction === "in" && hasKnownCost(transaction.unit_cost)) return { direction: "in", base_quantity: transaction.quantity, unit_cost: Number(transaction.unit_cost) };
        unavailable("سجل مرتجع بلا تكلفة صالحة.");
      }
      if (transaction.type === "supplier_return") {
        if (transaction.direction === "out") return { direction: "out", base_quantity: transaction.quantity, unit_cost: transaction.unit_cost ?? null };
        unavailable("اتجاه مرتجع المورد غير صالح.");
      }
      if (transaction.type === "manual_adjustment") {
        if (transaction.direction === "out") return { direction: "out", base_quantity: transaction.quantity, unit_cost: transaction.unit_cost ?? null };
        if (transaction.direction === "in") {
          if (hasKnownCost(transaction.unit_cost)) return { direction: "in", base_quantity: transaction.quantity, unit_cost: Number(transaction.unit_cost) };
          return { direction: "in", base_quantity: transaction.quantity, unit_cost: null };
        }
      }
      unavailable("نوع حركة غير مدعوم لإعادة حساب التكلفة.");
    });
    try {
      const replayed = core.replayMovementGroup(stock, average ?? null, steps);
      stock = replayed.stock;
      average = replayed.average ?? undefined;
      untrusted ||= replayed.untrusted;
    } catch { unavailable("سجل الحركات لا ينتج قيمة مخزون صالحة؛ لم يُطبق الإصلاح."); }
  }
  return { stock: core.round4(stock), average: average == null ? null : average, untrusted };
}

function validateUnitList(rawUnits, baseUnitId, { round4, roundMoney }) {
  if (!Array.isArray(rawUnits) || rawUnits.length < 1 || rawUnits.length > MAX_UNITS) invalid("أضف وحدة أساسية ووحدات صالحة.");
  const ids = new Set();
  const units = rawUnits.map((raw) => {
    const id = text(raw?.id, 64);
    const name = text(raw?.name, 80);
    const factor = Number(raw?.factor);
    const stockKind = raw?.stock_kind;
    if (!id || !name || ids.has(id)) invalid("معرّف الوحدة أو اسمها غير صالح.");
    ids.add(id);
    if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - round4(factor)) > 1e-9) invalid("عدد الوحدة الأساسية في الوحدة يجب أن يكون موجبًا وبحد أقصى أربع منازل عشرية.");
    if (stockKind !== "loose" && stockKind !== "package") invalid("حدد هل الوحدة كمية مفردة أم عبوة مغلقة.");
    if (raw?.profit_margin != null && !finite(raw.profit_margin, -1)) invalid("هامش الربح غير صالح.");
    if (raw?.selling_price != null && !finite(raw.selling_price)) invalid("سعر البيع غير صالح.");
    if (raw?.purchase_price != null && !finite(raw.purchase_price)) invalid("سعر الشراء غير صالح.");
    if (stockKind === "package" && raw?.allows_fractional === true) invalid("عدد العبوات المغلقة يجب أن يكون صحيحًا.");
    return {
      id,
      name,
      factor: round4(factor),
      stock_kind: stockKind,
      profit_margin: raw?.profit_margin ?? null,
      selling_price: raw?.selling_price == null ? null : roundMoney(raw.selling_price),
      purchase_price: raw?.purchase_price == null ? null : round4(raw.purchase_price),
      purchase_price_history: typeof raw?.purchase_price_history === "string" ? raw.purchase_price_history.slice(0, 1200) : null,
      allows_fractional: raw?.allows_fractional === true,
      is_base: id === baseUnitId,
      can_purchase: raw?.can_purchase !== false,
      can_sell: raw?.can_sell !== false,
      archived: raw?.archived === true,
    };
  });
  const base = units.filter((unit) => unit.id === baseUnitId);
  if (base.length !== 1 || base[0].factor !== 1 || base[0].stock_kind !== "loose") invalid("الوحدة الأساسية يجب أن تكون كمية مفردة وقيمتها 1.");
  return units;
}

function validateAlerts(raw, units) {
  const loose = raw?.loose || {};
  const reorder = loose.reorder_point == null ? 0 : Number(loose.reorder_point);
  const target = loose.target_level == null ? null : Number(loose.target_level);
  if (!finite(reorder) || (target != null && !finite(target))) invalid("مؤشر أو مستوى مخزون الكمية المفردة غير صالح.");
  const packages = {};
  for (const unit of units.filter((entry) => entry.stock_kind === "package")) {
    const rule = raw?.packages?.[unit.id] || {};
    const packageReorder = rule.reorder_point == null ? 0 : Number(rule.reorder_point);
    const packageTarget = rule.target_level == null ? null : Number(rule.target_level);
    if (!finite(packageReorder) || !Number.isInteger(packageReorder)
      || (packageTarget != null && (!finite(packageTarget) || !Number.isInteger(packageTarget)))) invalid(`مؤشر المخزون يجب أن يكون عددًا صحيحًا لوحدة ${unit.name}.`);
    packages[unit.id] = { reorder_point: packageReorder, target_level: packageTarget };
  }
  return { loose: { reorder_point: reorder, target_level: target }, packages };
}

function familyIdFor(name) {
  return `family_${createHash("sha256").update(name.toLocaleLowerCase()).digest("hex").slice(0, 32)}`;
}

function makeOperations({ db, authorize, operationRef }) {
  const applyInventoryCostRepair = async (request) => {
    const core = await inventoryCorePromise;
    const productId = text(request.data?.product_id, 128);
    const transactionIds = request.data?.transaction_ids;
    const requestId = request.data?.requestId;
    if (!productId || !operationKey(requestId) || !Array.isArray(transactionIds) || transactionIds.length > 450
      || transactionIds.some((id) => typeof id !== "string" || !id) || new Set(transactionIds).size !== transactionIds.length) invalid("بيانات مراجعة التكلفة غير صالحة.");
    const operation = operationRef(request, "inventory_cost_repair");
    const proposedCost = request.data?.recomputed_cost;
    const proposedStock = request.data?.current_stock;
    if (!finite(proposedCost) || !finite(proposedStock)) invalid("متوسط التكلفة المقترح أو الرصيد غير صالح.");
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const productRef = db.doc(`products/${productId}`);
      const [previous, productSnap, movementsSnap] = await Promise.all([
        tx.get(operation), tx.get(productRef), tx.get(db.collection("inventory_transactions").where("product_id", "==", productId)),
      ]);
      if (previous.exists) return previous.data().result;
      if (!productSnap.exists || movementsSnap.size > 450) unavailable("تغيّر المنتج أو سجل الحركات؛ أعد التحليل.");
      const product = productSnap.data();
      const transactions = movementsSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
      if (JSON.stringify(transactions.map((transaction) => transaction.id).sort()) !== JSON.stringify([...transactionIds].sort())) unavailable("تغيّر سجل الحركات أثناء المراجعة؛ أعد التحليل.");
      if (transactions.some((transaction) => transaction.product_id !== productId)
        || movementFingerprint(transactions) !== request.data?.transaction_fingerprint) unavailable("تغيّر سجل الحركات أثناء المراجعة؛ أعد التحليل.");
      const currentStock = core.inventoryTotal(product.inventory, product.units || []);
      if (Math.abs(currentStock - proposedStock) > 0.0001
        || Math.abs(currentStock - Number(request.data?.replayed_stock ?? currentStock)) > 0.0001
        || (product.cost_price == null) !== (request.data?.current_cost == null)
        || (product.cost_price != null && Math.abs(Number(product.cost_price) - Number(request.data.current_cost)) > 0.00005)
        || (product.last_inventory_transaction_id ?? null) !== (request.data?.last_movement_id ?? null)
        || JSON.stringify([...(product.last_inventory_transaction_ids || [])].sort()) !== JSON.stringify([...(request.data?.last_movement_ids || [])].sort())) unavailable("تغيّر المنتج أثناء المراجعة؛ أعد التحليل.");
      const replay = replayAverage(transactions, core);
      if (replay.untrusted || Math.abs(replay.stock - currentStock) > 0.0001 || replay.average == null
        || Math.abs(replay.average - proposedCost) > 0.00005) unavailable("لم تتطابق إعادة حساب التكلفة مع المعاينة؛ لم يُطبق الإصلاح.");
      const result = { ok: true, cost: replay.average };
      const adjustmentRef = db.collection("inventory_cost_adjustments").doc();
      tx.update(productRef, { cost_price: replay.average, last_cost_adjustment_id: adjustmentRef.id, updated_at: FieldValue.serverTimestamp() });
      tx.create(adjustmentRef, {
        product_id: productId, unit_id: null, old_cost: product.cost_price ?? null,
        new_cost: replay.average, reason: text(request.data?.reason, 500) || "مراجعة التكلفة", created_by: request.auth.uid,
        created_at: FieldValue.serverTimestamp()
      });
      tx.create(operation, { result, created_at: FieldValue.serverTimestamp() });
      return result;
    });
  };

  const saveInventoryProduct = async (request) => {
    const core = await inventoryCorePromise;
    const { unitReferenceCost } = await unitPricingPromise;
    const input = request.data || {};
    if (!operationKey(input.requestId)) invalid("مفتاح حفظ المنتج غير صالح.");
    const familyName = text(input.family_name, 120);
    const familyIdInput = text(input.family_id, 128);
    const completeFamily = Array.isArray(input.variants);
    if (!familyName || (familyIdInput && familyIdInput.includes("/"))) invalid("اسم المنتج أو معرّفه غير صالح.");
    if (completeFamily && typeof input.uses_variants !== "boolean") invalid("حدّد استخدام الأنواع.");
    const inventoryMode = completeFamily ? text(input.inventory_mode, 32) || "convertible" : null;
    if (completeFamily && inventoryMode !== "convertible" && inventoryMode !== "independent") invalid("حدّد طريقة المخزون.");
    const rawVariants = completeFamily ? input.variants : [input];
    if (!rawVariants.length || rawVariants.length > 40) invalid("أضف من نوع واحد إلى 40 نوعًا.");
    const names = new Set();
    const ids = new Set();
    const variants = rawVariants.map((raw, index) => {
      const variantName = completeFamily && !input.uses_variants ? "أساسي" : text(raw?.variant_name, 120);
      const packSizeName = inventoryMode === "independent" ? text(raw?.pack_size_name, 120) : "";
      const variantKey = inventoryMode === "independent"
        ? input.uses_variants
          ? text(raw?.variant_key, 128) || `variant_${createHash("sha256").update(variantName.toLocaleLowerCase()).digest("hex").slice(0, 24)}`
          : "default"
        : "";
      const baseUnitId = text(raw?.base_unit_id, 64);
      const productId = text(raw?.product_id, 128);
      const uniqueName = inventoryMode === "independent" ? `${variantKey}:${packSizeName.toLocaleLowerCase()}` : variantName.toLocaleLowerCase();
      if (!variantName || !baseUnitId || (inventoryMode === "independent" && (!packSizeName || !variantKey || variantKey.includes("/"))) || productId.includes("/") || (productId && ids.has(productId)) || names.has(uniqueName)) invalid("أسماء الأنواع وأحجام العبوات ومعرّفاتها يجب أن تكون صالحة وغير مكررة.");
      names.add(uniqueName);
      if (productId) ids.add(productId);
      const units = validateUnitList(raw?.units, baseUnitId, core);
      if (inventoryMode === "independent") {
        const base = units.find((unit) => unit.id === baseUnitId);
        if (!base || base.factor !== 1 || base.stock_kind !== "loose" || base.allows_fractional === true) invalid("الوحدة الأساسية لحجم العبوة يجب أن تكون عبوة كاملة واحدة ولا تقبل الكسور.");
        if (units.some((unit) => unit.id !== baseUnitId && (unit.stock_kind !== "package" || !Number.isInteger(unit.factor) || unit.allows_fractional === true))) invalid("وحدات الحجم المعبأ يجب أن تكون كراتين مغلقة بعدد صحيح من العبوات.");
      }
      return {
        variantName, variantKey: variantKey || null, packSizeName: packSizeName || null,
        variantOrder: Number.isInteger(raw?.variant_order) ? raw.variant_order : index,
        packSizeOrder: Number.isInteger(raw?.pack_size_order) ? raw.pack_size_order : 0,
        baseUnitId, productId, units, expectedUpdatedAt: raw?.expected_updated_at ?? null,
        inventoryAlerts: validateAlerts(raw?.inventory_alerts, units),
      };
    });
    if (completeFamily && inventoryMode === "convertible" && !input.uses_variants && variants.length !== 1) invalid("المنتج القابل للتحويل بدون أنواع يحتاج نوعًا أساسيًا واحدًا.");
    const operation = operationRef(request, "save_product");
    const fingerprint = JSON.stringify({ familyName, familyIdInput, variants, usesVariants: input.uses_variants ?? null, inventoryMode, completeFamily });
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const previous = await tx.get(operation);
      if (previous.exists) {
        if (previous.data().fingerprint !== fingerprint) unavailable("مفتاح الحفظ مستخدم لبيانات مختلفة.");
        return previous.data().result;
      }
      const normalizedFamilyName = familyName.toLocaleLowerCase();
      const familyRef = db.doc(`product_families/${familyIdInput || familyIdFor(normalizedFamilyName)}`);
      const family = await tx.get(familyRef);
      if (familyIdInput && !family.exists) unavailable("المنتج لم يعد موجودًا؛ أعد تحميل القائمة.");
      if (family.exists && family.data().is_active === false) unavailable("هذا المنتج مؤرشف.");
      const sameName = await tx.get(db.collection("product_families").where("normalized_name", "==", normalizedFamilyName));
      if (sameName.docs.some((doc) => doc.id !== familyRef.id)) unavailable("اسم المنتج مسجل بالفعل.");
      const familyProducts = await tx.get(db.collection("products").where("family_id", "==", familyRef.id));
      if (completeFamily && !familyIdInput && familyProducts.docs.length) unavailable("اسم المنتج مسجل بالفعل. افتح المنتج الموجود من زر تعديل وأضف الأنواع من داخله.");
      if (completeFamily && familyProducts.docs.some((doc) => !ids.has(doc.id))) unavailable("تغيّرت أنواع المنتج. أعد فتح النموذج قبل الحفظ.");
      const currentProducts = await Promise.all(variants.map((variant) => variant.productId ? tx.get(db.doc(`products/${variant.productId}`)) : null));
      if (!completeFamily && family.data()?.uses_variants === false && !variants[0].productId && familyProducts.docs.length) unavailable("فعّل الأنواع من نموذج المنتج قبل إضافة نوع جديد.");
      const usesVariants = completeFamily ? input.uses_variants : family.data()?.uses_variants !== false;
      const savedInventoryMode = family.data()?.inventory_mode || "convertible";
      const resolvedInventoryMode = completeFamily ? inventoryMode : savedInventoryMode;
      if (completeFamily && family.exists && savedInventoryMode !== resolvedInventoryMode) {
        const hasStockOrHistory = familyProducts.docs.some((doc) => {
          const product = doc.data();
          let stock = Number(product.stock_quantity || 0);
          try { stock = core.inventoryTotal(product.inventory, product.units || []); } catch { }
          return Math.abs(stock) > 1e-9 || product.last_inventory_transaction_id || product.last_purchase_invoice_id
            || (product.units || []).some((unit) => typeof unit.purchase_price_history === "string" && unit.purchase_price_history.trim());
        });
        if (hasStockOrHistory) unavailable("لا يمكن تغيير طريقة المخزون بعد تسجيل رصيد أو حركة على المنتج.");
      }
      const planned = variants.map((variant, index) => {
        const { productId, variantName, variantKey, packSizeName, variantOrder, packSizeOrder, baseUnitId, units, inventoryAlerts } = variant;
        const current = currentProducts[index];
        if (productId && !current?.exists) unavailable("النوع لم يعد موجودًا.");
        const old = current?.data() || null;
        if (completeFamily && old && timestampMillis(old.updated_at) !== timestampMillis(variant.expectedUpdatedAt)) unavailable("تغيّرت بيانات أو أسعار أحد الأنواع أثناء التعديل. أعد فتح المنتج للحصول على أحدث البيانات.");
        if (old && old.family_id !== familyRef.id) unavailable("لا يمكن نقل نوع إلى منتج آخر من هذا النموذج.");
        if (!completeFamily && familyProducts.docs.some((doc) => doc.id !== productId && (doc.data().variant_name || "").toLocaleLowerCase() === variantName.toLocaleLowerCase())) unavailable("اسم النوع مسجل بالفعل داخل المنتج.");
        if (old?.base_unit_id && old.base_unit_id !== baseUnitId) unavailable("لا يمكن تغيير الوحدة الأساسية بعد إنشاء النوع.");
        const requested = new Map(units.map((unit) => [unit.id, unit]));
        for (const existing of old?.units || []) {
          const next = requested.get(existing.id);
          if (!next) {
            if (existing.id === old.base_unit_id) unavailable("لا يمكن أرشفة الوحدة الأساسية.");
            requested.set(existing.id, { ...existing, archived: true, can_sell: false, can_purchase: false });
          } else if (Number(next.factor) !== Number(existing.factor) || next.stock_kind !== existing.stock_kind) unavailable(`لا يمكن تغيير عدد الوحدة الأساسية في الوحدة ${existing.name} أو نوعها بعد إنشائها.`);
        }
        for (const unit of requested.values()) {
          const previousUnit = old?.units?.find((entry) => entry.id === unit.id);
          const basis = unitReferenceCost(old || {}, unit);
          if (previousUnit && previousUnit.selling_price === unit.selling_price && previousUnit.profit_margin != null) unit.profit_margin = previousUnit.profit_margin;
          else if ((old || unit.profit_margin == null) && basis > 0 && unit.selling_price != null) unit.profit_margin = unit.selling_price / basis - 1;
        }
        const ref = productId ? db.doc(`products/${productId}`) : db.collection("products").doc();
        const { price, stock_quantity, average_cost, low_stock_threshold, target_stock_level, preferred_purchase_unit_id, purchase_multiple, ...preserved } = old || {};
        return {
          ref, data: {
            ...preserved,
            family_id: familyRef.id, family_name: familyName, uses_variants: usesVariants, inventory_mode: resolvedInventoryMode,
            variant_order: completeFamily ? variantOrder : old?.variant_order ?? 0,
            variant_key: resolvedInventoryMode === "independent" ? variantKey || old?.variant_key || "default" : null,
            pack_size_name: resolvedInventoryMode === "independent" ? packSizeName || old?.pack_size_name : null,
            pack_size_order: resolvedInventoryMode === "independent" ? packSizeOrder ?? old?.pack_size_order ?? 0 : null,
            variant_name: usesVariants ? variantName : "أساسي",
            name: resolvedInventoryMode === "independent" ? packSizeName || old?.pack_size_name : usesVariants ? variantName : familyName,
            base_unit_id: old?.base_unit_id || baseUnitId,
            base_unit_name: units.find((unit) => unit.id === baseUnitId).name,
            units: [...requested.values()],
            inventory_alerts: { loose: inventoryAlerts.loose, packages: { ...(old?.inventory_alerts?.packages || {}), ...inventoryAlerts.packages } },
            inventory: old ? core.normalizeInventory(old.inventory) : core.emptyInventory(),
            cost_price: old?.cost_price ?? null, is_active: old?.is_active !== false,
            date: old?.date || FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
          }
        };
      });
      tx.set(familyRef, {
        name: familyName, normalized_name: normalizedFamilyName, uses_variants: usesVariants, inventory_mode: resolvedInventoryMode, is_active: true,
        ...(family.exists ? {} : { created_at: FieldValue.serverTimestamp() }), updated_at: FieldValue.serverTimestamp()
      }, { merge: true });
      for (const item of planned) tx.set(item.ref, item.data);
      const result = { id: planned[0].ref.id, ids: planned.map((item) => item.ref.id), family_id: familyRef.id, family_name: familyName };
      tx.create(operation, { fingerprint, result, created_at: FieldValue.serverTimestamp() });
      return result;
    });
  };

  const archiveInventoryProduct = async (request) => {
    const ids = Array.isArray(request.data?.ids) ? request.data.ids : [request.data?.id];
    if (!ids.length || ids.length > 40 || ids.some((id) => typeof id !== "string" || !id || id.includes("/"))) invalid("اختر المنتج المطلوب أرشفته.");
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const refs = [...new Set(ids)].map((id) => db.doc(`products/${id}`));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      if (snapshots.some((snapshot) => !snapshot.exists)) throw new HttpsError("not-found", "Product not found.");
      for (const ref of refs) tx.update(ref, { is_active: false, updated_at: FieldValue.serverTimestamp() });
      return { archived: true };
    });
  };

  const unarchiveInventoryProduct = async (request) => {
    const ids = Array.isArray(request.data?.ids) ? request.data.ids : [request.data?.id];
    if (!ids.length || ids.length > 40 || ids.some((id) => typeof id !== "string" || !id || id.includes("/"))) invalid("اختر المنتج المطلوب إلغاء أرشفته.");
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const refs = [...new Set(ids)].map((id) => db.doc(`products/${id}`));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      if (snapshots.some((snapshot) => !snapshot.exists)) throw new HttpsError("not-found", "Product not found.");
      for (const ref of refs) tx.update(ref, { is_active: true, updated_at: FieldValue.serverTimestamp() });
      return { unarchived: true };
    });
  };

  const adjustInventoryBucket = async (request) => {
    const core = await inventoryCorePromise;
    const id = text(request.data?.product_id, 128);
    const bucket = request.data?.bucket;
    const unitId = text(request.data?.unit_id, 64) || null;
    const target = request.data?.new_quantity;
    const note = text(request.data?.note, 500);
    if (!id || !note || (bucket !== "loose" && bucket !== "package") || !finite(target)) invalid("أدخل مكوّن المخزون والرصيد الجديد والسبب.");
    const operation = operationRef(request, "inventory_adjustment");
    const fingerprint = JSON.stringify({ id, bucket, unitId, target, note });
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const previous = await tx.get(operation);
      if (previous.exists) {
        if (previous.data().fingerprint !== fingerprint) unavailable("مفتاح التعديل مستخدم لبيانات مختلفة.");
        return previous.data().result;
      }
      const productRef = db.doc(`products/${id}`);
      const snapshot = await tx.get(productRef);
      if (!snapshot.exists) throw new HttpsError("not-found", "Product not found.");
      const product = snapshot.data();
      const before = core.normalizeInventory(product.inventory);
      let adjusted;
      try {
        adjusted = core.setInventoryBucket(before, product, bucket, unitId, target);
      } catch (error) {
        if (String(error.message).startsWith("INVALID_")) invalid("الكمية تقبل أربع منازل عشرية كحد أقصى.");
        if (["UNIT_MISSING", "UNIT_NOT_PACKAGE"].includes(error.message)) invalid("العبوة المحددة غير صالحة.");
        throw error;
      }
      const delta = adjusted.changes;
      const totalDelta = core.round4(delta.loose_base_quantity + Object.entries(delta.closed_packages).reduce((sum, [packageId, count]) => sum + Number(count) * Number(product.units.find((unit) => unit.id === packageId)?.factor || 0), 0));
      if (Math.abs(totalDelta) < 1e-9) {
        tx.create(operation, { fingerprint, result: { adjusted: false }, created_at: FieldValue.serverTimestamp() });
        return { adjusted: false };
      }
      if (totalDelta > 0 && (product.cost_price == null || !Number.isFinite(Number(product.cost_price)))) unavailable("متوسط التكلفة غير معروف؛ سجّل شراءً أولًا.");
      const unit = bucket === "loose" ? product.units.find((entry) => entry.id === product.base_unit_id) : product.units.find((entry) => entry.id === unitId);
      const componentQuantity = bucket === "loose"
        ? Math.abs(Number(delta.loose_base_quantity))
        : Math.abs(Number(delta.closed_packages[unitId] || 0));
      const movementRef = db.collection("inventory_transactions").doc();
      const now = FieldValue.serverTimestamp();
      tx.update(productRef, { inventory: adjusted.inventory, last_inventory_transaction_id: movementRef.id, last_inventory_transaction_ids: [movementRef.id], updated_at: now });
      tx.create(movementRef, {
        type: "manual_adjustment", product_id: id, product_name: productLabel(product), quantity: Math.abs(totalDelta),
        unit_quantity: componentQuantity, unit_id: unit?.id || null, unit_name: unit?.name || product.base_unit_name,
        unit_factor: bucket === "loose" ? 1 : Number(unit.factor), base_quantity: Math.abs(totalDelta), direction: totalDelta > 0 ? "in" : "out",
        unit_cost: totalDelta > 0 ? Number(product.cost_price) : null, operation_id: operation.id, reason: "manual_correction", note,
        component_deltas: delta, opened_packages: [], seq: 0, created_by: request.auth.uid, created_at: now,
      });
      const result = { adjusted: true };
      tx.create(operation, { fingerprint, result, created_at: now });
      return result;
    });
  };

  const executeInventoryPurchase = async (request) => {
    const core = await inventoryCorePromise;
    const input = request.data || {};
    const key = text(input.idempotencyKey, 80);
    const items = input.items;
    if (!/^[a-zA-Z0-9:_-]{16,120}$/.test(key) || !Array.isArray(items) || items.length < 1 || items.length > MAX_PURCHASE_ITEMS) invalid("بيانات فاتورة الشراء غير صالحة.");
    const paidRequested = input.paidNow;
    if (!finite(paidRequested)) invalid("قيمة المدفوع غير صالحة.");
    const supplierId = text(input.supplier_id, 128) || null;
    const supplierName = text(input.supplier_name, 160) || null;
    const supplierRefText = text(input.supplier_ref, 120) || null;
    const invoiceRef = db.doc(`purchase_invoices/${key}`);
    const fingerprint = JSON.stringify({ ...input, items });
    return db.runTransaction(async (tx) => {
      const role = await authorize(request, tx);
      if (role !== "admin") throw new HttpsError("permission-denied", "Admin access is required.");
      const existingInvoice = await tx.get(invoiceRef);
      if (existingInvoice.exists) {
        if (existingInvoice.data().request_fingerprint !== fingerprint) unavailable("مفتاح عملية الشراء مستخدم لبيانات مختلفة.");
        const data = existingInvoice.data();
        return { ok: true, duplicate: true, id: key, total: data.total_amount, paid: data.paid_amount, remaining: data.remaining_amount, fullyPaid: data.remaining_amount <= 0, advance: data.advance_amount || 0 };
      }
      const parsed = items.map((item) => {
        const productId = text(item?.product_id, 128);
        const unitId = text(item?.unit_id, 64);
        const qty = Number(item?.quantity);
        const unitCost = Number(item?.unit_cost);
        if (!productId || !unitId || !finite(qty, 0.0001) || !finite(unitCost)) invalid("أحد أسطر الشراء غير صالح.");
        if (Math.abs(qty - core.round4(qty)) > 1e-9) invalid("كمية الشراء تقبل أربع منازل عشرية كحد أقصى.");
        return { raw: item, productId, unitId, quantity: core.round4(qty), unitCost };
      });
      const ids = [...new Set(parsed.map((item) => item.productId))];
      const [cashSnap, supplierSnap, ...productSnaps] = await Promise.all([
        tx.get(db.doc("cashbox/current")),
        supplierId ? tx.get(db.doc(`suppliers/${supplierId}`)) : Promise.resolve(null),
        ...ids.map((id) => tx.get(db.doc(`products/${id}`))),
      ]);
      if (supplierSnap && !supplierSnap.exists) unavailable("المورد المحدد غير موجود.");
      const products = new Map(productSnaps.map((snapshot) => [snapshot.id, { ref: snapshot.ref, data: snapshot.data() }]));
      if (products.size !== ids.length) unavailable("أحد الأصناف لم يعد موجودًا.");
      const total = core.roundMoney(parsed.reduce((sum, item) => sum + core.roundMoney(item.quantity * item.unitCost), 0));
      if (paidRequested > total + 0.005 && !supplierId) unavailable("اختر المورد لتسجيل المبلغ الزائد كسلفة.");
      const paid = core.roundMoney(Math.min(total, paidRequested));
      const advance = core.roundMoney(Math.max(0, paidRequested - paid));
      const balance = core.roundMoney(Number(cashSnap.data()?.balance || 0));
      if (paidRequested > 0 && !cashSnap.exists) unavailable("لا يمكن الدفع قبل تهيئة الخزنة.");
      if (paidRequested - balance > 0.005) unavailable("المدفوع يتجاوز رصيد الخزنة المتاح.");
      const original = new Map(ids.map((id) => [id, products.get(id).data]));
      const prepared = parsed.map((item) => {
        const product = products.get(item.productId).data;
        if (!product || product.is_active === false) unavailable("أحد الأصناف مؤرشف أو غير موجود.");
        const unit = (product.units || []).find((candidate) => candidate.id === item.unitId);
        if (!unit || unit.archived === true || unit.can_purchase === false) unavailable("وحدة الشراء غير متاحة لهذا الصنف.");
        const factor = Number(unit.factor);
        if (!Number.isFinite(factor) || factor <= 0) invalid("عدد الوحدة الأساسية في وحدة الشراء غير صالح.");
        if (unit.allows_fractional !== true && !Number.isInteger(item.quantity)) invalid("هذه الوحدة لا تقبل كميات كسرية.");
        let baseQuantity;
        try { baseQuantity = core.baseQuantityFor(item.quantity, factor); }
        catch { invalid("الكمية بعد التحويل يجب أن تكون موجبة وقابلة للتمثيل حتى أربع منازل عشرية."); }
        const lineTotal = core.roundMoney(item.quantity * item.unitCost);
        return { ...item, product, unit, factor, baseQuantity, lineTotal, baseCost: lineTotal / baseQuantity };
      });
      for (const id of ids) {
        const entries = prepared.filter((entry) => entry.productId === id);
        const basis = entries.find((entry) => entry.raw.pricing?.averageBasis)?.raw.pricing.averageBasis;
        if (basis) {
          const product = original.get(id);
          const stock = core.inventoryTotal(product.inventory, product.units || []);
          if (Math.abs(stock - Number(basis.stock)) > 0.00005 || Math.abs(Number(product.cost_price || 0) - Number(basis.cost)) > 0.00005) unavailable("تغيّر رصيد المنتج أو متوسط تكلفته. راجع المعاينة ثم أكد مجددًا.");
          if (entries.some((entry) => entry.raw.pricing?.averageBasis && JSON.stringify(entry.raw.pricing.averageBasis) !== JSON.stringify(basis))) invalid("أسطر الصنف نفسه تعتمد على لقطات تكلفة مختلفة.");
        }
      }
      const updatedProducts = new Map();
      const movementDocs = [];
      const invoiceItems = [];
      let seq = 0;
      for (const entry of prepared) {
        const id = entry.productId;
        const current = updatedProducts.get(id) || { ...products.get(id).data, inventory: core.normalizeInventory(products.get(id).data.inventory), units: [...products.get(id).data.units] };
        const physical = core.addPurchase(current.inventory, current, entry.unitId, entry.quantity);
        current.inventory = physical.inventory;
        const unitIndex = current.units.findIndex((unit) => unit.id === entry.unitId);
        const unit = { ...current.units[unitIndex], purchase_price: entry.unitCost };
        const history = String(unit.purchase_price_history || "").split(",").filter(Boolean);
        unit.purchase_price_history = [`${entry.unitCost}-${Date.now()}`, ...history].slice(0, 20).join(",");
        const pricing = entry.raw.pricing || { mode: "auto" };
        if (!["auto", "keep", "custom", "proposed"].includes(pricing.mode)) invalid("طريقة تحديث السعر غير صالحة.");
        current.last_purchase_base_cost = entry.unitCost / entry.factor;
        current.units[unitIndex] = unit;
        updatedProducts.set(id, current);
        const label = productLabel(entry.product);
        invoiceItems.push({
          product_id: id, product_name: label,
          family_id: entry.product.family_id || null, family_name: entry.product.family_name || null,
          variant_name: entry.product.variant_name || null, variant_key: entry.product.variant_key || null,
          pack_size_name: entry.product.pack_size_name || null, inventory_mode: entry.product.inventory_mode === "independent" ? "independent" : "convertible",
          quantity: entry.quantity, unit_cost: entry.unitCost, unit_id: unit.id, unit_name: unit.name, unit_factor: entry.factor, stock_kind: unit.stock_kind, allows_fractional: unit.allows_fractional === true, base_quantity: entry.baseQuantity, base_unit_cost: entry.baseCost, line_total: entry.lineTotal
        });
        movementDocs.push({
          ref: db.collection("inventory_transactions").doc(), data: {
            type: "purchase", direction: "in", product_id: id, product_name: label, quantity: entry.baseQuantity,
            unit_quantity: entry.quantity, unit_id: unit.id, unit_name: unit.name, unit_factor: entry.factor, base_quantity: entry.baseQuantity,
            unit_cost: entry.baseCost, purchase_invoice_id: key, operation_id: key, note: text(input.note, 500) || null,
            component_deltas: physical.changes, opened_packages: [], seq: seq++,
          }
        });
      }
      for (const id of ids) {
        const entries = prepared.filter((entry) => entry.productId === id);
        const product = original.get(id);
        const oldQuantity = core.inventoryTotal(product.inventory, product.units || []);
        const addedQuantity = entries.reduce((sum, entry) => sum + entry.baseQuantity, 0);
        const addedValue = entries.reduce((sum, entry) => sum + entry.lineTotal, 0);
        let average;
        try {
          average = core.movingAverage(oldQuantity, product.cost_price, addedQuantity, addedValue);
        } catch (error) {
          if (error.message === "COST_MISSING") unavailable("متوسط التكلفة السابق غير معروف لهذا الصنف.");
          throw error;
        }
        const updated = updatedProducts.get(id);
        updated.cost_price = average;
        const decisions = Object.fromEntries(entries.map((entry) => [entry.unitId, entry.raw.pricing || { mode: "auto" }]));
        const { repriceUnits } = await unitPricingPromise;
        if (product.inventory_mode === "independent") {
          const prices = new Map();
          try {
            for (const [unitId, decision] of Object.entries(decisions)) {
              const lastEntry = entries.filter((entry) => entry.unitId === unitId).at(-1);
              if (!lastEntry) continue;
              const priced = repriceUnits(product, lastEntry.unitCost / lastEntry.factor, { [unitId]: decision });
              prices.set(unitId, priced.find((unit) => unit.id === unitId));
            }
          } catch { invalid("تعذر حساب أسعار البيع. راجع التكلفة والأسعار المدخلة."); }
          updated.units = updated.units.map((unit) => {
            const price = prices.get(unit.id);
            return price ? { ...unit, selling_price: price.selling_price, profit_margin: price.profit_margin ?? null } : unit;
          });
        } else {
          let priced;
          try { priced = repriceUnits(product, updated.last_purchase_base_cost, decisions); }
          catch { invalid("تعذر حساب أسعار البيع. راجع التكلفة والأسعار المدخلة."); }
          updated.units = updated.units.map((unit) => {
            const price = priced.find((entry) => entry.id === unit.id);
            return { ...unit, selling_price: price.selling_price, profit_margin: price.profit_margin ?? null };
          });
        }
      }
      const remaining = core.roundMoney(total - paid);
      const status = remaining <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
      const now = FieldValue.serverTimestamp();
      const productIds = ids;
      tx.create(invoiceRef, {
        request_fingerprint: fingerprint, supplier_name: supplierName, supplier_id: supplierId, supplier_ref: supplierRefText,
        invoice_number: text(input.invoice_number, 100) || null, source: input.source || "manual", pinned: false, items: invoiceItems,
        product_ids: productIds, total_amount: total, paid_amount: paid, advance_amount: advance, remaining_amount: remaining,
        status, payment_ids: [], note: text(input.note, 500) || null, created_by: request.auth.uid, created_at: now,
      });
      for (const id of ids) {
        const update = updatedProducts.get(id);
        const productRef = products.get(id).ref;
        const idsForProduct = movementDocs.filter((movement) => movement.data.product_id === id).map((movement) => movement.ref.id);
        tx.update(productRef, {
          inventory: update.inventory, cost_price: update.cost_price, last_purchase_base_cost: update.last_purchase_base_cost, units: update.units,
          last_inventory_transaction_id: idsForProduct.at(-1), last_inventory_transaction_ids: idsForProduct,
          last_purchase_invoice_id: key, updated_at: now,
        });
      }
      for (const movement of movementDocs) tx.create(movement.ref, { ...movement.data, created_by: request.auth.uid, created_at: now });
      if (advance > 0) tx.set(db.doc(`supplier_advances/${key}`), { supplier_id: supplierId, supplier_name: supplierName, purchase_invoice_id: key, amount: advance, remaining_amount: advance, created_by: request.auth.uid, created_at: now });
      if (paidRequested > 0) {
        tx.update(db.doc("cashbox/current"), { balance: core.roundMoney(balance - paidRequested), updated_at: now });
        tx.create(db.collection("cash_transactions").doc(), { type: "inventory_purchase", direction: "out", amount: core.roundMoney(paidRequested), purchase_invoice_id: key, reference_type: "supplier_invoice", reference_id: key, reference_label: `فاتورة توريد من ${supplierName || "مورد غير مسمى"}`, note: text(input.note, 500) || null, created_by: request.auth.uid, created_at: now });
      }
      if (supplierId) tx.set(db.doc(`supplier_summaries/${supplierId}`), {
        supplier_id: supplierId, supplier_name: supplierName || supplierSnap.data().name,
        invoice_count: FieldValue.increment(1), total_purchases: FieldValue.increment(total),
        outstanding_payable: FieldValue.increment(remaining), advance_receivable: FieldValue.increment(advance), updated_at: now,
      }, { merge: true });
      const result = { ok: true, id: key, total, paid, remaining, fullyPaid: remaining <= 0, advance };
      return result;
    });
  };

  return {
    applyInventoryCostRepair: onCall(applyInventoryCostRepair),
    saveInventoryProduct: onCall(saveInventoryProduct),
    archiveInventoryProduct: onCall(archiveInventoryProduct),
    unarchiveInventoryProduct: onCall(unarchiveInventoryProduct),
    adjustInventoryBucket: onCall(adjustInventoryBucket),
    executeInventoryPurchase: onCall(executeInventoryPurchase),
  };
}

module.exports = makeOperations;
