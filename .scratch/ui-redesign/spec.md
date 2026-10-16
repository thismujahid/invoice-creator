# Invoice Creator UI redesign — implementation handoff

Last updated: 2026-10-16. Status: **in progress**. This file is the source of truth for the phased implementation and its verification. Update the checkboxes and the evidence log after each completed change. A checked item means the code exists and the stated proof has run; browser-only or code-only observations are labeled explicitly.

## Context and boundaries

- Starting revision: `1b1ef85` on `main`. The implementation is currently **uncommitted**. Inspect `git status` and the full diff before editing; preserve all existing changes.
- Use the installed Nuxt 4.6.1, Vue 3.5.43, Nuxt UI 4.11.3, Tailwind 4.3.3, Firebase 13.0.0. Do not add another UI library or new dependencies.
- Preserve accounting and inventory rules, Firebase schemas and stored data, weighted-average costing, invoice totals/discount/payment/balance, realtime subscriptions, exports, permissions, existing workflows, and A4 print content. Keep financial logic in its present controllers/composables. Presentation components receive calculated values and emit events.
- Do not run any build command without an explicit request. Do not run Bulk Repair, migrations, or live financial writes as a way to verify UI. The user explicitly chose **non-writing checks only** because no safe test environment is available. The authenticated browser session examined so far is admin only; the user is preparing a cashier test session.
- App-level source of truth: `app.config.ts` for Nuxt UI semantics; `assets/css/main.css` for CSS tokens, surfaces, and print font protection. Keep local Tailwind classes for layout, not repeated control skins.
- Avoid unrelated refactoring and speculative abstractions. Do not add code comments unless requested. Keep print roots and components separate from screen UI.

## Outcome

A consistent Arabic RTL, mobile-first enterprise UI built on Nuxt UI v4: navigable shell; clear page headers, search, tables, states, and financial displays; keyboard-friendly invoice editing; stable subscription/error states; protected printing; no business-rule regression. The target is a productivity interface, with 75/25 invoice workspace only where width allows and one main mobile scroll area.

## Current findings that drive the work

| Finding | Source | Required response |
| --- | --- | --- |
| Arabic direction without Nuxt UI Arabic locale; duplicate toaster | `app.vue` | Pass `ar` locale; retain one toast owner. |
| Invoice group header clickable but not a semantic button; delete guards not rendered | `components/invoice/InvoiceProductGroupHeader.vue` | Keyboard button, `aria-expanded`, actual `canDelete`/`hideActions`. |
| Nested invoice-item scrolling and customer below items on mobile | `pages/index.vue` | One scroll, customer first, accessible summary. |
| Financial reads can be mistaken for successful empty data | `composables/firebase.ts`, consumers | Reject errors; show error/stale/retry. |
| Cashbox “live” marker does not establish connection health | `composables/useCashbox.ts`, `pages/cashbox.vue` | Explicit sync state. |
| Invoice filter requests can complete out of order | `pages/invoices.vue` | Generation guard for the full result. |
| Repeated product searches and per-change array copies | `pages/index.vue`, `stores/products.ts` | Computed indexes and batched snapshot update. |
| Price formatter allocated on every call; RTL signs can appear on wrong side | `composables/helpers.ts`, financial views | Reuse formatter and isolate money in LTR. |
| Large pages and repeated table/card/toolbar markup | `pages/index.vue`, `pages/cashbox.vue`, `pages/products.vue`, `components/Forms/ProductVariant.vue`, financial pages | Extract presentation only where there is real reuse; no formula rewrite. |
| Supplier form duplicated between page and `FormsSupplier` | `pages/suppliers.vue`, `components/Forms/Supplier.vue` | Reuse the existing form, preserve payload. |
| Supplier invoice printing generated a blank A4 PDF because `#app-shell` is hidden in print media while `.print-sheet` lived inside it | `app.vue`, `pages/supplier-invoices.vue` | Clone the existing sheet into the protected `#printableArea` for printing; verify rendered A4 after the fix. |

## Design decisions

- Primary mode: light. Application background `slate-50`, primary surface white, secondary surface `slate-100`, text `slate-900`/`slate-600`, restrained emerald primary, semantic success/error/warning/info colors. Do not encode financial meaning with color alone.
- Noto Sans Arabic is the screen font. Baloo Bhaijaan 2 stays pinned to invoice, supplier invoice, debt statement, and preview/print roots. Do not alter print structure, Arabic copy, grouping, calculations, or A4 sizing.
- Spacing scale 4/8/12/16/24/32px; 1px borders; radii 6px controls, 8px cards, 12px dialogs; minimal shadows. Desktop dense controls about 36px, key mobile touch targets 44px. Typical body text 16px; dense desktop tables 14px.
- Use Lucide already installed, usually 16px inline and 20px controls/nav. Visible focus, 4.5:1 text contrast, 3:1 meaningful controls, reduced-motion respect.
- Preserve calculation precision and rounding. For money display, hide a trailing `.00` but retain two decimals when fractional (for example, `26` and `26.50`); show no currency abbreviation or name. The user explicitly requested this change for all views, including printed views. Show signs/numbers with `bdi dir="ltr"` and tabular numerals. `AppMoneyDisplay` and any future quantity display must never calculate totals or convert units. The single formatting implementation is `composables/usePriceFormat.ts`; the existing `useHelpers().formatePrice` name delegates to it for current callers.
- Arabic semantic labels; explicit loading, empty, no-results, error, stale, success states; no unknown value silently shown as zero.
- Sidebar groups: sales (new invoice, invoices, debts, customers), stock/purchases (products, suppliers, supplier invoices), finance (cashbox by role). Keep existing RBAC filters. Desktop collapses 240px→64px from 1024px; mobile retains three quick destinations and an accessible “more” drawer. No new persisted preference.
- Data page width up to 1440px; invoice workspace up to 1600px; login form up to 440px. One `main`, skip link, one page `h1`, contextual breadcrumbs only for details.
- Prefer `UFormField`, `UEmpty`, `UBadge` directly over redundant wrappers. `AppPageHeader`, `AppMoneyDisplay`, and `AppPagination` now exist. Consider `AppActionToolbar`, `AppDataTable`, `AppStatCard`, `AppConfirmDialog`, and `AppQuantityDisplay` only when two actual call sites justify each API.

## Component inventory and ownership

| Existing/proposed component | Direction | Ownership rule |
| --- | --- | --- |
| `InvoiceDesktopLayout`, `InvoiceProductGroup`, `InvoiceProductGroupHeader`, `InvoiceSubLineEditor`, `InvoiceVariantSummary` | Reuse and refine | Presentation and emitted edit events; leave grouping, stock validation, save and totals in their current owners. |
| `InvoiceSummarySidebar` | Reuse for desktop/mobile read-only summary | Accept already calculated text/values; never duplicate payment fields or calculate balances. |
| `AppDialog`, `AppDateField`, existing skeletons | Modify | Keep current public props and accessibility; date remains native. |
| `FormsCustomer`, `FormsSupplier`, `FormsProduct`, `FormsProductVariant` | Reuse; split display sections only if necessary | Preserve validation, payloads, unit factors, stock rules and transaction path. |
| `CustomerDebtTimeline`, `CustomerCreditSettlement`, `CustomerCreditPayout`, `ReturnHistory` | Reuse | Preserve debt-versus-credit and cash-versus-settlement semantics. |
| `AppPageHeader` | Implemented | One page `h1`, description and contextual action slot. |
| `AppMoneyDisplay`, proposed `AppQuantityDisplay` | Money implemented; quantity pending | Formatting/presentation only, no accounting sign inference or conversion. |
| `AppPagination` | Implemented where reused | Arabic accessible pagination controls; page owns cursor and fetch. |
| Proposed `AppActionToolbar`, `AppDataTable<T>`, `AppStatCard`, `AppConfirmDialog` | Pending justification and implementation | Toolbar exposes slots; table takes rows/columns/id/loading/error/retry and slots while page owns data; stats receive ready values; confirm emits event without API calls. Do not add wrappers when a direct Nuxt UI primitive is sufficient. |
| Print components and `printableArea` | Protected | No conversion to `UTable`, no copy/content/grouping/size changes within this effort. |

Expected implementation order and rough effort: phase 0 ~1 day; phase 1 ~2–3; phase 2 ~2–3; phase 3 ~3–5; phase 4 ~2–4; phase 5 ~3–4 in independently testable deliveries (invoices, debts/customers, cashbox, suppliers/purchases); phase 6 ~2–3. These are planning estimates, not time logged. Phase 6 read-error fixes were pulled forward because they affect whether UI states are truthful.

## Risk register

| Regression risk | Mitigation and proof still required |
| --- | --- |
| Noto screen font or global CSS changes A4 output | Keep Baloo pinned to print roots; compare reference and result for all print samples, including page count, rows and borders. |
| Moving/hiding invoice controls removes a save path or form state | Keep `Invoice.vue` save/print engine mounted; one payment form; test `saveAndNew`/`saveAndPrint`, drawer open/close and resize while partially entered. |
| Extracting UI changes a formula or historical invoice price | Pass ready values into presentation, preserve current controllers, compare payloads/totals and historic snapshots. |
| Product snapshot optimization changes order, identity, or unsub/session behavior | Check added/modified/removed events, metadata-only snapshots, stable unchanged objects and sign-out/sign-in. |
| Cursor table sorting implies global order or export includes fewer rows | Page retains cursor ownership; only local sort on a complete set; label exact export scope. |
| Cashier presentation exposes cost or wider financial scope | Only pass permitted data; inspect both roles and retain server authorization; UI hiding is insufficient security. |
| Read failure looks like empty dataset or zero balance | Distinct error/stale state, retry, preserve last good values, no successful empty export on failed read. |
| Dialog/mobile keyboard focus is trapped or form remounts | Test Escape, focus return, nested overlays, viewport resize and a partially filled form. |
| Virtualized choices break keyboard navigation | Do not virtualize invoice lines or print; only trial Nuxt UI's existing option virtualizer on long pickers with keyboard proof. |
| Broad refactor overwhelms review | Make small page/phase diffs; do not add dependencies, data migrations, auth/accounting rewrites or backend changes. |

## Progress by phase

### Phase 0 — baseline and protection (small; prerequisite)

- [x] Inspect routes, existing shared components, relevant data/callback paths, framework versions, and repo state. Initial repo was clean at `1b1ef85`.
- [x] Run initial `npm test` (92 tests in 8 files) and `npm run typecheck` (passed) before edits.
- [x] Inspect logged-in admin screens for login, invoice, products, quantities, cashbox, invoices; invoice and supplier mobile widths were also inspected during implementation. No writes were made.
- [ ] Capture and compare A4 baseline and result for short/long/multiunit sales invoices, supplier invoice, and debt statement. This was **not** done before the screen-font change. A read-only supplier invoice PDF check later produced one blank A4 page; the cause was the print root outside the hidden app shell. The bridge has been fixed in code, but a new rendered A4 proof is still required.
- [ ] Record business fixtures and before/after payloads for sales, purchase, returns, and debt settlement in a safe test environment. The user has no safe test environment and requested non-writing checks only; do not execute these flows in the current browser session.
- [ ] Record baseline and result on the same browser/device for 100/1000/5000 products and 10/50/100 invoice lines. Do not claim production performance from dev measurements.

### Phase 1 — visual foundation (medium; depends on 0)

Affected: `app.vue`, `app.config.ts`, `assets/css/main.css`, `components/ui/AppDialog.vue`, `components/ui/AppDateField.vue`, print roots.

- [x] Add Nuxt UI Arabic locale and remove the duplicate `UToaster`. Browser AX showed Arabic built-in Close and one Notifications region.
- [x] Establish semantic palette and Noto Sans Arabic screen typography; pin Baloo Bhaijaan 2 to known print/preview roots.
- [x] Replace assembled dialog z-index classes with a fixed mapping; set mobile slideover side to bottom; retain modal/slideover mode while open so resize does not remount the form.
- [x] Link native date input and label via `UFormField`.
- [x] Remove responsive `display:none` classes from mounted mobile slideover roots. Independent browser judge reproduced a persistent `aria-hidden`/`inert` leak after mobile drawer close then desktop resize; after the fix, dialog count returns to 0, header/sidebar/editor regain accessibility, and AX returns. This covers the invoice summary resize sequence only.
- [ ] Verify actual nested overlays, Escape/focus return, resize with partially entered forms, 200% zoom, color contrast, and A4 print output. Typecheck alone does not establish these.

Acceptance: one announcement per toast, Arabic accessible names, no generated z-index utility, intact dialog values/focus, visually matching print reference. **Partial** until the unchecked checks pass.

### Phase 2 — shell, navigation, login (medium; depends on 1)

Affected: `layouts/default.vue`, `pages/login.vue`, `components/Forms/AuthScreen.vue`, `components/ui/AppPageHeader.vue`, route pages using it.

- [x] Add grouped, collapsible desktop sidebar and accessible bottom “more” drawer; retain the existing role-based destinations, auth owner, and subscription lifecycle.
- [x] Add skip link, main landmark, page headers and a wider page container.
- [x] Render login form inline, with explicit role buttons, 44px PIN/buttons on mobile; keep the original auth calls and PIN rules.
- [x] Browser-inspect admin shell and login behavior; typecheck passed after these changes.
- [ ] Inspect every route with admin and cashier, direct refresh/auth loading/sign-out, complete keyboard navigation, and hydration console. Cashier session has not been inspected.

Acceptance: same routes/permissions, one page heading, no hydration errors, safe focus and no content hidden by mobile bars. **Partial**.

### Phase 3 — invoice editor and render cost (high; depends on 1–2)

Affected: `pages/index.vue`, `components/invoice/InvoiceDesktopLayout.vue`, `InvoiceProductGroupHeader.vue`, `InvoiceSubLineEditor.vue`, `InvoiceSummarySidebar.vue`, `stores/products.ts`, `composables/helpers.ts`, `tests/unit/invoice-display.test.ts`.

- [x] Expand desktop invoice workspace and use a 3fr/min-300px summary at XL; fall back to one column below XL.
- [x] Place customer before item editor on mobile in both DOM/keyboard and visual order, followed by payment; remove item-list nested scrolling. Browser AX verified the order at 375px and the 75/25 grid at 1440px.
- [x] Add mobile bottom summary slideover with read-only calculated totals and a jump to the single payment section; keep payment inputs mounted once.
- [x] Keep both save actions labeled on narrow screens and place preview/reset in secondary menu.
- [x] Use a semantic group toggle with `aria-expanded` and apply existing action guards; clarify item-edit completion label and attach quantity error to field.
- [x] Batch product `docChanges` per snapshot, preserve stable objects/order, reuse `productsById` and computed family/variant indexes, and hoist the money formatter. Added a number-format regression test, later updated for the user-requested integer/fraction display rule.
- [x] Browser-inspect mobile customer-first order, summary opening/closing, 375px action labels, absence of page horizontal overflow, and group toggle in the admin session.
- [x] Show gross, discount, net, paid, credit used when relevant, and remaining in a read-only mobile summary with a direct jump to the single mounted payment form. Browser verified the drawer and its edit action at 375px; no duplicate payment inputs are mounted.
- [x] Move keyboard focus to the first discount/payment field after the mobile summary finishes closing through Nuxt UI's `after:leave` event. Browser at 375px verified the active control changes from the summary trigger to the labeled discount spinbutton; the overlay and `inert` are gone.
- [x] Prevent leaving a changed draft without confirmation, without new autosave/storage. Browser verified unsaved navigation is blocked, cancel retains the draft, and a reset draft navigates normally. Browser reload/close prompt is implemented but not visually verified.
- [x] Open the group containing the first validation error. Browser verified an over-stock quantity in a manually collapsed group reopens and receives focus after a blocked save attempt; no invoice was saved.
- [ ] Verify the full Tab/Enter flow for product/type/unit/quantity/price, including long option lists.
- [ ] Compare before/after transaction payloads, totals, discount, paid amount, balance, conversion/independent units, repeated lines, and every save path in a safe test environment.

Acceptance: no calculation/payload drift; immediate stock feedback; no lost entry while opening summary; keyboard and mobile flows work. **Partial**.

### Phase 4 — products and inventory forms (medium/high; depends on 1–3)

Affected: `pages/products.vue`, `components/Forms/Product.vue`, `components/Forms/ProductVariant.vue`, `components/products/`.

- [x] Add page header, accessible search name, restrained secondary action menu, cache/stale indication, and defer import/history UI until opened.
- [x] Add an expandable desktop family→type→package→unit table row with stock, selling price and admin-only average cost; add unit-level shortage/out-of-stock count badges without summing unlike units. Browser admin verified row toggling and data hierarchy; product/inventory targeted suites passed 31/31 and typecheck passed.
- [x] Give mobile product card actions a 44px target, label each family selection checkbox, state that bulk selection covers matching SKUs on all pages, and separate out-of-stock from low-stock unit counts. Browser AX and screenshot checked at 375px.
- [x] Add local family sorting by recent/name/stock over the fully loaded product set, with Arabic select naming and page reset. Browser checked name order. No cursor page is sorted as though it were the full result set.
- [x] Inspect add-product, purchase and manual-adjustment forms at 375px without saving; the hierarchy and component-specific adjustment explanation are present. Link the purchase paid amount and error through `UFormField`. The stock calculations and submission handlers were not changed.
- [x] Close the create/edit product dialog after a successful save and refresh by clearing the saving guard first; keep it open with its error on failure. Source path and typecheck verified; no product write was performed in the browser.
- [x] Simplify the product draft: choose inventory mode with two cards, show base unit and prices directly for creation, group advanced unit options separately, and collapse optional stock alerts. Shorten repeated hints and use a responsive two-column field layout. Product tests and typecheck passed; rendered form and persistence remain unverified.
- [ ] Complete any remaining purchase/adjustment form section refinements and toolbar consistency where justified by full role/data testing.
- [ ] Verify simple/convertible/independent products, archived and historical units, sealed packages versus loose base quantity, low/out-of-stock, cost visibility by role, imports, and nested dialogs.

Acceptance: no sum across unlike units, no factor or purchase-price rule change, no hidden action or cashier cost leak. **Partial**.

### Phase 5 — financial and people screens (high; depends on 1–2 and relevant shared presentation)

Affected: `pages/invoices.vue`, `pages/debts.vue`, `pages/cashbox.vue`, `pages/cashier-cashbox.vue`, `pages/customers.vue`, `pages/suppliers.vue`, `pages/supplier-invoices.vue`, `components/CashierInvoices.vue`, `components/CashierDebtDesk.vue`, related debt/return display components.

- [x] Use real `UTabs` for invoice tabs; guard invoice list/return/cursor/loading writes with one request generation; clean the search timer on unmount. Apply same generation protection to cashier invoices.
- [x] Add shared page headers and Arabic pagination labels where used; introduce `AppMoneyDisplay` and use it in several cash/supplier views.
- [x] Reuse `FormsSupplier`; add supplier delete confirmation and desktop table/mobile cards; preserve supplier deletion checks.
- [x] Show debtor/customer read failures and retry instead of confirmed zeros/empty history.
- [x] Show cashbox subscription status as live/snapshot/cache/error and retry, while retaining the last good data.
- [x] On admin invoice history, make “عرض” the explicit primary row/card action and move copy/edit/payment/return/cancel to a labeled secondary menu. Remove nonsemantic card click; isolate row totals/debt/profit with `AppMoneyDisplay`. Browser verified the table, mobile card, and available menu entries without triggering a financial action.
- [x] Isolate signed cashbox period and ledger amounts in LTR display, and distinguish current balances from period metrics in the existing two sections. Browser admin inspected the mobile cashbox hierarchy and transaction list.
- [x] Keep supplier invoice “عرض” and “تسديد” visible and move return, pin and repeat to a secondary menu; state that local search covers loaded invoices. Guard overlapping supplier list/filter responses, label the purchase draft paid field, and surface pin failures. Browser inspected mobile list, menu and nested create-supplier dialog without saving.
- [x] Route supplier invoice printing through the existing `#printableArea` bridge so the hidden app shell cannot blank it; content, grouping and calculations remain unchanged. This is a code fix awaiting a new A4 render check.
- [x] Group the supplier purchase draft into supplier/reference, item cost, and payment sections with a read-only total in the dialog footer. Browser at 375px showed the sections and footer; no purchase was saved.
- [x] Refine the new supplier invoice draft: use one dialog scroll and single-column mobile fields, disclose selling-price controls when needed, show field errors on attempted save, preserve manually edited proposed prices, reset unit-specific pricing when changing product/unit, and derive a new unit's suggested cost from that unit rather than the previously selected one. Guard the 100-line limit and closing while save is pending. Typecheck and 98 unit tests passed; rendered form and transaction persistence remain unverified.
- [x] Clarify debt labels as gross amounts owed, customer credit, and after-settlement amount; remove nonsemantic mobile debt-card click. Make mobile customer/supplier actions touch-sized, isolate phone/money direction, and search suppliers by name or phone. Browser checked admin debt empty state, customers and suppliers at 375px.
- [x] Restore the missing “إضافة عميل جديد” triggers in the customers page and cashier debt form. `FormsCustomer` does not render default slot content; explicit buttons now open its existing controlled dialog. Browser verified the customer add trigger, then edit→cancel→add opens an empty form without saving.
- [x] Isolate amounts in supplier list, debt summaries/table/mobile cards and debt-payment preview with the presentational `AppMoneyDisplay`. The earlier browser inspection showed the former currency suffix; it was removed afterward per user request. Mixed-sign debt fixtures remain untested.
- [x] Browser admin searched an invoice, opened its detail, then closed it; the search remained applied. Supplier edit→cancel→add reopened an empty form, and closing the dialog returned focus to “إضافة مورد”. No update, deletion or payment was submitted.
- [ ] Complete debt/customer settlement hierarchy, cashbox current-versus-period KPI hierarchy, cashier-specific wording, supplier purchase editor and returns, consistent toolbars/stats/status/empty states across all financial pages.
- [ ] Verify filters→details→back, cursor paging, export scope, payment/credit/return flows, both roles, positive/negative/zero formatting, and no loss of filters.

Acceptance: unchanged financial values, operation effects, RBAC and export scope; unknown values never shown as zero; action labels describe the effect. **Partial**.

### Phase 6 — read reliability and final verification (medium; may be pulled forward)

Affected: `composables/firebase.ts`, `composables/useCashbox.ts`, consumers in `stores/`, `pages/`, `composables/useDebts.ts`, `composables/useInventoryCostRepair.ts`, relevant tests.

- [x] Make `readFrom` reject on read failure and update actual products/customers/suppliers/invoices/debts/export consumers to distinguish error from empty; preserve last successful lists where appropriate.
- [x] Make cashbox connection status explicit and avoid opening initial-balance onboarding because a read failed.
- [x] Guard overlapping invoice filter responses, including returns and cursor.
- [x] Add a targeted Vitest regression check proving a valid empty Firestore collection remains `[]` while a failed `readFrom` rejects.
- [x] Surface cash-transaction subscription/page read errors with retry and a stale-data description; invalidate late transaction responses on filter/page changes. Browser checked normal live transactions and a stock-purchase type filter, but no injected read failure.
- [x] Index product families by ID during product presentation and avoid rebuilding unchanged product objects when family metadata arrives. Typecheck and product/inventory suites passed; representative 5000-product performance remains unmeasured.
- [x] Reject admin product read results after inventory is cleared, and reject older overlapping cashier catalog responses. Targeted Vitest tests cover both out-of-order cases; they do not exercise a live subscription or Firestore network.
- [x] Ignore old cash-transaction page reads after clearing cashbox or starting a newer read; clear pagination/filter state with the previous session. Targeted Vitest tests cover both late-session and reversed-response cases.
- [ ] Add targeted checks for product snapshot batching and subscription recovery if suitable under the existing Vitest setup.
- [ ] Exercise unavailable/permission-denied/offline/retry, reversed responses, sign-out/sign-in, and repeated mount/unmount to detect listeners or unhandled rejections.
- [ ] Complete RTL, responsive, accessibility, visual, performance, print, business, export, and role matrices below.

Acceptance: no failed read exported as an empty success, no stale response replacing a new one, no false “live” marker, no accumulated listeners. **Partial**.

## Page-by-page remaining acceptance checklist

- [ ] Invoice: validate customer balance immediately and distinguish unavailable from zero; mobile summary/payment UX; every save/print path. Draft-exit confirmation and focus into collapsed invalid group are implemented and browser-verified. An admin customer with loaded zero balance showed a specific zero state; read failure was not injected.
- [ ] Products: product→type→unit hierarchy, dense search/filter/sort, stock and cost visibility by permission, purchase/adjustment forms. Admin browser verified local sort and read-only open/close of forms; role and write checks remain.
- [ ] Invoices: history details/preview/actions, cursor behavior, returns/profit and export scope. Admin browser verified search→detail→close preserved the filter.
- [ ] Debts: “عليه/له/بعد التسوية” meanings, debt versus customer credit, noncash settlement, linked history.
- [ ] Cashbox: current balance before period figures, actual connection state and transaction history.
- [ ] Cashier cashbox: make “your operations today” scope obvious; no store-wide claim.
- [ ] Customers: desktop/mobile views, debt versus credit, history, names/phones and empty/error states. Admin mobile add/edit reset and leading-zero phone display were checked; credit is available in history, not the customer list summary.
- [ ] Suppliers: recheck form reset/edit/delete/card/table at both widths after current changes. Admin browser verified search/card/table and edit→cancel→add reset; deletion was not executed.
- [ ] Supplier invoices: purchase form grouping, sticky summary, returns/settlement, weighted average unchanged. Draft sections/footer were browser-checked at 375px without saving.
- [ ] Login: role and PIN flow with screen reader/keyboard and actual authentication behavior. Current browser AX still reports `pin input 1 of 6` through `pin input 6 of 6` in English despite the Arabic group label; the installed Reka `PinInputInput` supplies those English names internally. Address and verify this without replacing the existing authentication flow.

## Verification matrix

- [x] `npm run typecheck` after the latest edits: passed on 2026-10-16.
- [x] `npm test` after the latest verified edits: 98 tests in 11 files passed on 2026-10-16.
- [x] `git diff --check` after the latest edits: passed on 2026-10-16.
- [ ] Inspect the full `git diff`/`git status` for unrelated changes, dead paths, or temp files before delivery.
- [ ] Desktop/mobile visual checks at 375, 390, 768, 1024, 1440px and 200% zoom, long Arabic names, large/negative/zero amounts, leading-zero phones, no page horizontal overflow or obscured actions.
- [ ] Keyboard and accessibility: Tab/Shift+Tab/Enter/Escape; focus return; Arabic icon labels; field errors; one toast announcement; no focus jump on live update; contrast and reduced motion.
- [ ] Performance on the same device/data for 100/1000/5000 products and 10/50/100 lines; ordinary local input response target <100ms and no >10% regression, while preserving Firestore read/listener counts.
- [ ] Business fixtures: invoice totals/discount/payment/balance; weighted-average and historical cost; independent/convertible/sealed/open stock; repeated-line aggregate stock; debt/settlement/returns; exports.
- [ ] A4 output: short/long/multiunit sale, supplier invoice, debt statement, pagination, Arabic typography and all numeric/grouped content.
- [ ] Verify `XLSX` remains lazy-loaded until import/export in the production bundle. Do not alter return-journal pagination/read semantics within this UI effort.
- [ ] Do not run build unless user explicitly requests it; build compatibility remains unverified without that run.

## Immediate continuation steps

1. Read `git status`, the full diff, and this file before editing. Re-run `npm run typecheck`, `npm test`, and `git diff --check` after any new edits. The working tree is uncommitted and contains the whole UI effort.
2. The user is preparing a cashier test session; inspect it read-only once ready. The user has no safe test environment and explicitly limited this effort to non-writing checks, so leave save/payment/return/stock transaction acceptance unverified.
3. Verify actual post-fix supplier A4 output through the UI print path, plus short/long/multiunit sale and debt print references. The previous read-only Chrome `Page.printToPDF` call was unexpectedly very slow; avoid repeating it without a bounded strategy. Do not mark print complete from code inspection alone.
4. Complete remaining role, responsive/zoom, keyboard, error-injection, export and performance matrices. Make small page-specific UI edits where a concrete defect is reproduced; do not move accounting code.
5. Update this file with exact results and leave any unverified item unchecked. Build is still opt-in only.

## Evidence log

| Date | Evidence | Scope/limit |
| --- | --- | --- |
| 2026-10-16 | Initial `npm test`: 92 passed in 8 files; `npm run typecheck`: passed | Before edits. |
| 2026-10-16 | Repeated `npm run typecheck` and `npm test` checkpoints passed during implementation; targeted invoice-display suite passed 18 tests after formatter test | Rerun full commands after latest changes. |
| 2026-10-16 | Authenticated admin browser at `http://localhost:3000`: Arabic Nuxt UI names, one toast region, shell, invoice mobile order/summary, supplier mobile cards and desktop table inspected | No cashier session, write flow, print/PDF, or production performance verification. |
| 2026-10-16 | Latest `npm run typecheck` passed; `npm test` passed 93/93 across 8 files; `git diff --check` passed | Static/unit checks of current working tree. Build intentionally not run. |
| 2026-10-16 | After the draft guard and group-focus change, `npm run typecheck` passed, invoice grouping/display suites passed 35/35, and `git diff --check` passed | Browser admin: unsaved product selection blocked route leave; cancel retained draft; reset allowed navigation. Over-stock quantity in collapsed group reopened and focused on save attempt; no write occurred. |
| 2026-10-16 | After product hierarchy change, `npm run typecheck` passed and product-variants/inventory suites passed 31/31 | Browser admin `/products`: expanding a family shows type, package, each unit's stock and prices, with a single expanded family at a time. No data writes. |
| 2026-10-16 | Independent browser judge reproduced mobile invoice slideover accessibility leak on viewport resize; after removing responsive hiding from the mounted slideover, the exact sequence cleared `aria-hidden`/`inert` and restored the full AX tree | Verify the shell “more” drawer separately and continue remaining keyboard/viewport checks. |
| 2026-10-16 | Admin invoice history action hierarchy changed; browser checked primary view and secondary menu in desktop/mobile; `npm run typecheck` and `git diff --check` passed | No financial actions triggered. |
| 2026-10-16 | Browser at 375/1440px verified invoice DOM order customer→products→payment, one mounted payment section, summary drawer with one heading, and the 75/25 desktop workspace | No invoice save/print or actual A4 output. |
| 2026-10-16 | Browser at 375/1024px verified shell “more” drawer closes and releases `inert`/pointer lock after viewport change; products checkboxes and numbered pagination have Arabic accessible names | Admin role only; no cashier session. |
| 2026-10-16 | `npm run typecheck`, `npm test` (94/94 in 9 files), and `git diff --check` passed after the latest UI/test edits | Build not run; no emulator or financial transaction validation. |
| 2026-10-16 | Browser admin at 375px inspected supplier invoice list/menu, purchase draft, labeled paid amount, and nested `FormsSupplier` dialog. Closing child restored the parent; closing parent removed all dialogs/inert/pointer lock | No supplier invoice was saved, paid, returned, pinned, or printed via UI. |
| 2026-10-16 | Read-only Chrome A4 PDF of an existing supplier invoice produced one 595×842-point page with only about 1 KiB of PDF data; source inspection traced the blank output to `#app-shell { display:none }` and `.print-sheet` nested inside it | Fixed by cloning the existing sheet to `#printableArea`; post-fix PDF appearance/page count remain unverified. |
| 2026-10-16 | Browser admin at 375px checked add-product, purchase and adjustment dialogs without saving; paid input has an Arabic accessible name after `UFormField` change | No purchase/adjustment, unit cost, inventory or Firebase write was exercised. |
| 2026-10-16 | Browser admin at 375px found missing add-customer button. After the controlled-trigger fix, AX showed it; edit→cancel→add reopened a blank name/phone form. Supplier card/search and debt empty state inspected | Cashier trigger fixed from source but still requires cashier-session browser verification. |
| 2026-10-16 | Browser admin cashbox showed live status and ledger. Selecting the stock-purchase filter showed only matching movement. `npm test` passed 94/94 in 9 files; `npm run typecheck` and `git diff --check` passed | Read failures/reversed responses were not injected; no cash transaction was created. |
| 2026-10-16 | Browser admin at 375px showed grouped supplier purchase draft with read-only total footer, invoice search→detail→close retained search, supplier edit→cancel→add yielded an empty form and returned focus after closing, and selected invoice customer with loaded zero balance showed a zero-specific state | No financial write, supplier deletion, or cashier role action. |
| 2026-10-16 | Corrected supplier print selector so cloned `.print-sheet` headings match scoped print CSS; isolated supplier/debt amounts and corrected the visible admin role label. `npm run typecheck`, `npm test` (94/94 in 9 files), and `git diff --check` passed at 11:40 | Rendered A4 after the print bridge fix remains unverified. Admin debt empty state was browser-checked; no signed debt fixture was available. |
| 2026-10-16 | Browser at 375px reproduced focus returning to the summary trigger after “تعديل الخصم والدفع”; after binding Nuxt UI `after:leave`, the closed drawer left focus on the labeled discount spinbutton and `inert` cleared. Viewport reset to 1536px. `npm run typecheck`, `npm test` (94/94 in 9 files), and `git diff --check` passed at 11:43 | No invoice was saved. Remaining keyboard sequence for product/type/unit is unverified. |
| 2026-10-16 | Targeted `npx vitest run tests/unit/products-fetch.test.ts` passed 2/2, and `npm run typecheck` passed after guarding stale admin/cashier product reads | No live Firebase outage, sign-out, or cashier browser session was exercised. The user requested non-writing verification only. |
| 2026-10-16 | Full `npm test` passed 96/96 in 10 files and `git diff --check` passed after the product fetch race fix | No build or financial write was run. |
| 2026-10-16 | Cashbox transaction read guards passed targeted 2/2 tests; full `npm test` passed 98/98 in 11 files, `npm run typecheck` and `git diff --check` passed | No network failure or cashier UI was injected; no financial write was run. |
| 2026-10-16 | A fresh read-only browser tab at `http://localhost:3000/` still showed the admin role; it was closed. Final `npm test` passed 98/98 in 11 files and `git diff --check` passed after the session-guard adjustment | Cashier review awaits the user's test login. No production build, A4 output check or financial write was run. |
| 2026-10-16 | Product create/edit dialog remained open because its computed setter ignored `open = false` while `saving` was true. The save path now closes only after `finally` clears that guard. Targeted product tests passed 14/14; full `npm test` passed 98/98 in 11 files; `npm run typecheck` and `git diff --check` passed | The actual save-to-Firebase UI flow was not exercised because the user requested non-writing checks only. |
| 2026-10-16 | Read-only browser AX of `/login` showed Arabic role controls but six English PIN field names; source inspection found those names hard-coded in the installed Reka input | Cashier is selected but has not signed in in the browser available to this task. No credentials were entered. |
| 2026-10-16 | Added `composables/usePriceFormat.ts` as the single money formatter; changed whole amounts to omit `.00`, retained two decimals for fractional amounts, and removed standalone currency suffixes from the frontend views, notifications and print templates. Targeted invoice-display suite passed 18/18; full `npm test` passed 98/98 in 11 files; `npm run typecheck` and `git diff --check` passed. A source search found no remaining standalone currency abbreviation or name in frontend files | No authenticated monetary screen or A4 output was re-rendered after this change. Build was not run. |
| 2026-10-16 | Reflowed `FormsProduct` and `FormsProductVariant` for a shorter creation path: inventory mode cards, direct base unit/price fields, advanced unit dialog, and optional collapsed stock alerts. Targeted product tests passed 14/14; full `npm test` passed 98/98 in 11 files; `npm run typecheck` and `git diff --check` passed | Browser remained at `/login`, so the authenticated product form was not visually retested. No product was saved or edited in Firebase; build was not run. |
| 2026-10-16 | Reworked the new supplier invoice form in `pages/supplier-invoices.vue`: responsive field flow, native modal scrolling, conditional pricing, inline validation, corrected unit cost prefill and selection resets, and clear cashbox read state. Targeted inventory/product tests passed 44/44; full `npm test` passed 98/98 in 11 files. After the final money-display markup, `npm run typecheck` and `git diff --check` passed | Browser remained at `/login`. No supplier invoice, payment, stock movement, or Firebase write was performed; build was not run. |

## Deliberate exclusions / separate issues

- `functions/staffMath.cjs` currently includes `units[].purchase_price` in `safeProduct`; hiding it in the UI is not a server-side authorization fix. Track as a separate backend security change.
- The `ReturnJournal` limit/reread pattern may need cursor work, but changing it affects data semantics; it is separate from this UI refactor.
- Keep current `no-print` content and all printed invoice structures unless separately requested.
