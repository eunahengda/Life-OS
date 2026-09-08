# Asset Information Architecture

Status: architecture note, not application code. Written during Task 005B.
Nothing in this document has been implemented beyond what Task 005A already
built, except where marked otherwise.

## 1. Asset as the central entity

An **Asset** (`public.assets`) is the hub that everything else in LifeOS's
"things you own" domain hangs off of. An asset record itself stays small —
core identity and a handful of optional descriptive fields. Everything else
(documents, warranty, maintenance history, reminders) is modeled as its own
entity that _points at_ an asset, not as more columns bolted onto `assets`.

```
Asset
├── Information       (category, description, model, serial — on assets)
├── Purchase          (date, price, currency, merchant — on assets)
├── Notes             (on assets)
│
├── Documents         (separate table, NOT IMPLEMENTED yet)
├── Warranty          (separate table, NOT IMPLEMENTED yet)
├── Maintenance       (separate table, NOT IMPLEMENTED yet)
└── Reminders         (separate table, NOT IMPLEMENTED yet)
```

## 2. Current Asset fields (`public.assets`, frozen since Task 002)

| Column                      | Type        | Notes                                    |
| --------------------------- | ----------- | ---------------------------------------- |
| `id`                        | uuid        | primary key                              |
| `household_id`              | uuid        | ownership boundary; FK → `households.id` |
| `name`                      | text        | **only required field**                  |
| `category`                  | text        | free-form, not an enum/taxonomy (see §8) |
| `description`               | text        |                                          |
| `model_number`              | text        |                                          |
| `serial_number`             | text        |                                          |
| `purchase_date`             | date        |                                          |
| `purchase_price`            | numeric     |                                          |
| `currency`                  | text        | free-form code, e.g. "MYR"               |
| `merchant`                  | text        | shown to the user as "Seller"            |
| `notes`                     | text        |                                          |
| `created_at` / `updated_at` | timestamptz |                                          |

That's the complete list. There is no `brand`, `location`, `receipt_url`,
`warranty_expiry`, `photo_url`, or similar column, and none should be added —
see §5.

## 3. Related entities that already exist in the database

These tables exist today (created in Task 002) but have **no UI** yet. Their
actual relationship to `assets`, read directly from the schema/generated
types — not assumed:

| Table                 | Relationship to assets                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `warranties`          | `warranties.asset_id` → `assets.id` (direct FK, many-to-one)                                                                                                                                                                           | one asset can have multiple warranty rows                                                                                                                                                                                                                                                                                                                                                        |
| `maintenance_records` | `maintenance_records.asset_id` → `assets.id` (direct FK, many-to-one)                                                                                                                                                                  |                                                                                                                                                                                                                                                                                                                                                                                                  |
| `documents`           | **no direct FK to assets.** `documents.household_id` → `households.id` only                                                                                                                                                            | linkage to an asset goes through `document_links`                                                                                                                                                                                                                                                                                                                                                |
| `document_links`      | `document_links.document_id` → `documents.id`, plus a polymorphic `entity_type` + `entity_id` pair (`entity_type` constrained to `asset`, `vehicle`, `warranty`, `maintenance_record`, `recurring_expense`)                            | a document can attach to more than one entity type by design; there is no FK on `entity_id` itself, since it's polymorphic                                                                                                                                                                                                                                                                       |
| `reminders`           | **no direct link to assets today.** `reminders.household_id` → `households.id`, plus a polymorphic `source_type` + `source_id` pair, with `source_type` constrained to `warranty`, `maintenance_record`, `recurring_expense`, `manual` | note: `asset` is **not** currently a valid `source_type` — a reminder today can only be sourced from a warranty, a maintenance record, a recurring expense, or be manual. Linking a reminder directly to an asset is not possible under the current schema/constraint without a future migration. This is worth flagging as a product/schema question for whoever designs the Reminders feature. |

This task changes none of the above — every row in this table was read from
the existing schema, not proposed.

## 4. What belongs on the Asset record vs. elsewhere

**Belongs on `assets`** (small, descriptive, about the item itself):
category, description, model/serial identifiers, purchase info, free-form
notes.

**Must NOT be added to `assets`** — these belong to their own entity because
they have their own lifecycle, can repeat, or need their own fields:

- `receipt_url` / any document reference → belongs to `documents` +
  `document_links`
- `warranty_expiry` → belongs to `warranties` (which already models
  provider, warranty number, start/expiry date)
- `last_service_date` / `next_service_date` → belongs to
  `maintenance_records` (which already models performed/next-due
  date+mileage, cost, provider)
- `insurance_provider` → no table exists for this yet; do not improvise one
  by adding columns to `assets`
- `photo_url` → not modeled yet; when it is, it almost certainly wants the
  same shape as `documents` (a file reference table), not a column
- `reminder_date` → belongs to `reminders`

The reasoning is the same in every case: these things can each occur zero,
one, or many times per asset, change independently of the asset's identity,
and (for documents/warranty/maintenance) already have real tables designed
for them. Cramming them into `assets` as columns would both violate 1NF in
spirit (repeating future need → repeating nullable columns) and make the
"only Name is required" empty-state promise harder to keep as the table
grows wider.

## 5. Future relationship direction (once each feature is built)

```
assets.id ← warranties.asset_id            (direct FK, already exists)
assets.id ← maintenance_records.asset_id   (direct FK, already exists)
assets.id ← document_links.entity_id       (polymorphic, entity_type='asset', already exists)
assets.id ← ??? for reminders              (NOT YET POSSIBLE — see §3; reminders
                                             would need source_type to accept
                                             'asset', or a different mechanism —
                                             a decision for the Reminders task,
                                             not this one)
```

When Documents/Warranty/Maintenance are eventually built, their screens
should query _by asset_id_ (or by `document_links.entity_id` for documents)
rather than the Asset Detail screen growing more fields — i.e. new tabs/
sections on the same screen, backed by their own queries, not new columns.

## 6. Empty-state philosophy

An asset created with only a name is a **complete, valid, un-degraded**
record — not a partially-filled form. The Asset Detail screen reflects that:

- A section (Information / Purchase / Notes) renders only if at least one of
  its fields is non-empty. No section ever renders with all-dash placeholder
  rows.
- An asset with zero optional fields shows just its name and "No additional
  details yet." — never a wall of empty labels.
- Filling in more fields later is "enriching," not "finishing" — there is no
  concept of an asset being incomplete.

This was already the behavior established in Task 005A; this task confirms
it as the permanent rule going forward, including for future sections
(Documents/Warranty/Maintenance should follow the same only-show-if-present
convention once built, rather than showing "No warranty added" chrome by
default — though that specific call belongs to whoever implements them).

## 7. "Create first, enrich later"

The Add Thing flow (Task 004) — name → save → "Want to add more details?" →
Add details → Asset Detail — is the permanent mental model, not a temporary
MVP shortcut. Nothing in this task changes it. Future features (Documents,
Warranty, Maintenance, Reminders) are things a user _optionally_ attaches to
an already-complete asset, never things required to finish creating one.

## 8. Category remains intentionally unresolved

`assets.category` is a free-form text column today. This task deliberately
does **not**:

- introduce a category table, enum, or fixed list
- build category management UI
- add filtering/sorting by category

Reason: LifeOS's broader domain (Assets, Vehicles, Home, Electronics, Pets,
Family) hasn't been mapped out yet, and a taxonomy decided in isolation for
"things in the Life tab" risks not fitting once those other domains exist.
**This is a real open product decision**, not an engineering gap — see the
final report's Product Decisions section.
