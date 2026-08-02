# Beta financial lifecycle

Financial facts are recorded by staff and remain append-only. A donation moves
through an explicit revision lifecycle:

1. Staff receive and inspect the package, record actual devices, processing
   disposition, wipe verification, sales, and eligible cost candidates.
2. Finalization freezes an immutable reconciliation snapshot, resolves the
   approved proceeds-policy version, records calculation evidence for every
   cost application, and creates one allocation for that revision.
3. If the allocation has not been externally disbursed, staff may reopen it
   only with a non-empty correction reason. Reopen writes a compensating
   reversal allocation, clears the finalization lock, and increments the next
   revision. Historical snapshots, allocations, sales, and costs are never
   edited or deleted.
4. Staff correct the open facts and finalize again. The effective-allocation
   view excludes reversal rows and exposes exactly one current calculated or
   policy-held allocation.

Reopen is denied after a completed external payout. A later adjustment workflow
must be designed and approved separately.

## Proceeds and costs

Policy versions are scoped and effective-dated; no universal percentage is a
database invariant. Resolution is campaign, partnership/charity, then general
donation, with a policy hold when no approved assignment applies. Cost rules
are evaluated by their configured method:

- `direct` applies the eligible amount once;
- `pro_rata` records the shared amount once against the frozen eligible-device
  denominator and preserves base/remainder evidence for deterministic cents;
- `capped` uses an explicit cap in basis points of the frozen gross proceeds;
- `fixed` requires an explicit `metadata.fixed_cents` value and otherwise fails
  closed to a policy hold/error rather than guessing.

Non-deductible costs are excluded. Applied costs never exceed gross proceeds.

## Device and zero-proceeds rules

Only a received, inspected device with a completed, staff-attributed data wipe
may have a resale sale recorded. `not_started`, `pending`, and `blocked` wipe
states are not sale-eligible; an agent cannot assert a wipe.

Resale devices require an effective sale at finalization. Recycle, reuse, parts,
returned, and other non-resalable dispositions may close without a sale. A
donation containing only non-resalable devices receives an explicit zero-gross,
zero-allocation result. Mixed donations include only sold eligible devices in
gross proceeds; missing devices are excluded rather than represented by fake
sales.

The staff dashboard disables new financial/device controls after finalization,
shows the revision and effective allocation, and provides reason-required
reverse/reopen controls only while a payout is not completed.

An allocation with a calculated zero amount is explicitly marked
`settlement_status = no_proceeds`. Staff sees that no disbursement is required,
and payment preparation is not offered. This is distinct from a `policy_hold`
(no approved policy) or a pending positive payout. Financial finalization
freezes financial evidence, while a later `processing -> completed`
donor-visible transition remains valid because it does not change that evidence.
