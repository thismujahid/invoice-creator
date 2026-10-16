# Landed Costs Implementation Tracker

## Repository findings

- Purchase invoices are created atomically by the admin-only `executeInventoryPurchase` callable in `functions/inventoryOperations.cjs`.
- The transaction snapshots supplier unit prices, adds stock through `inventoryCore.mjs`, and updates product AVCO and selling prices.
- Supplier payment and cashbox outflow are recorded separately in `composables/usePurchasing.ts`; no purchase-invoice edit or cancellation workflow exists.
- Supplier returns are atomic in `functions/staffInvoiceActions.cjs`. They reduce physical stock at the current product average cost and reduce supplier payable using the original invoice unit price.
- Supplier invoice data is shown and printed by `pages/supplier-invoices.vue`; no Excel export for purchase invoices was found.
- Purchase invoice inputs have no discount or tax fields; allocation uses the current persisted line totals, so no separate discount/tax basis exists to exclude or apply.
- No product/unit weight metadata was found; allocation is limited to value, comparable base quantity, equal line, and manual methods.
- Firestore writes for invoices and inventory movements are server-only. Third-party expense payment therefore belongs in an admin callable transaction.

## Implementation plan and status

- [x] Add pure deterministic allocation engine and types: value, comparable-base-quantity, equal-line, manual; exact cents and deterministic remainder.
- [x] Extend the purchase callable to validate and persist expense records, allocation snapshots, effective unit costs, expense liabilities, and paid expense cash movements atomically, including payment audit references.
- [x] Feed capitalized allocations into the existing AVCO and selling-price path exactly once; preserve original supplier prices and stock quantities.
- [x] Add an idempotent callable to pay a previously unpaid third-party expense without changing supplier payable.
- [x] Add supplier invoice UI for multiple expenses, live allocation preview, manual allocation, payment state, reconciliation, and totals.
- [x] Show persisted expense allocations in invoice details, cashbox transactions, and print output.
- [x] Add allocation and transaction tests, including the required 600 + 10 example, AVCO, idempotency, third-party payments, and non-capitalized expense handling.
- [x] Run the complete unit test suite, typecheck, and diff whitespace check; do not run build or write to Firebase/live data.

## Scope and known lifecycle limit

The repository has no purchase-invoice edit or cancellation workflow. This implementation will make expense posting immutable and idempotent at initial purchase, and support later settlement of recorded unpaid expenses. It will not introduce purchase cancellation or retroactive cost editing because the existing inventory history has no general purchase reversal/COGS adjustment path; adding one would require a separate accounting workflow. Existing supplier returns remain unchanged and continue using current AVCO for inventory removal and original supplier price for payable reduction.

## Validation evidence

- `npm test`: 124 tests passed across 12 files.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- No build was run. No browser acceptance session, Firebase emulator, or live Firestore transaction was run.
- No purchase-invoice Excel export exists in the inspected UI; printed supplier invoices now include persisted landed-cost facts.
