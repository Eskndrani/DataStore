# Schema Review: Crawled Data vs Current Schema

## 1. ORGANIZATION

**Current schema:** `org_id, name, title, description, org_type, image_url, created, state, approval_status`

| Field | Populated | Verdict |
|---|---|---|
| `org_id` | 87/87 (100%) | **KEEP** — PK |
| `name` | 87/87 (100%) | **KEEP** — slug like `fcc-gov` |
| `title` | 87/87 (100%) | **KEEP** — "Federal Communications Commission" |
| `description` | ~20/87 (~23%) | **KEEP** — professor guidance: retain even if mostly null to avoid schema changes |
| `org_type` (from extras) | 87/87 (100%) | **KEEP** — Federal/State/City/County/University — critical for project |
| `image_url` | ~50/87 (~57%) | **KEEP** — useful for UI display |
| `created` | 87/87 (100%) | **Keep or remove** — not required by project, minor |
| `state` | 87/87 — always "active" | **REMOVE** — zero information value |
| `approval_status` | 87/87 — always "approved" | **REMOVE** — zero information value |

**Recommended:** `org_id (PK), name, title, description, org_type, image_url, created`

---

## 2. ORG_CONTACT (multivalued attribute)

199 contact emails across 87 orgs.

**Verdict: KEEP as-is.** Good multivalued attribute. Project requires "contact information" for organizations.

---

## 3. DATASET

**Current schema (22 columns):** `dataset_id, name, title, description, access_level, license_id, license_title, metadata_created, metadata_modified, author, author_email, maintainer, maintainer_email, identifier, url, version, state, type, publisher_name, bureau_code, program_code, org_id`

| Field | Population | Verdict |
|---|---|---|
| `dataset_id` | 100% | **KEEP** — PK |
| `name` | 100% | **KEEP** — slug |
| `title` | 100% | **KEEP** — human-readable name |
| `description` (notes) | 100% | **KEEP** — required |
| `metadata_created` | 100% | **KEEP** — required |
| `metadata_modified` | 100% | **KEEP** — required |
| `maintainer` | 86.6% | **KEEP** — required |
| `maintainer_email` | 86.5% | **KEEP** — contact info |
| `license_id` | 86.6% | **KEEP** — required |
| `license_title` | 86.6% | **KEEP** — professor guidance: retain even if slightly redundant |
| `access_level` (extras) | 86.6% | **KEEP** — required |
| `identifier` (extras) | 86.6% | **KEEP** — required |
| `publisher_name` (extras) | 86.6% | **KEEP** — professor guidance: retain even if org relationship exists |
| `bureau_code` (extras) | 57.8% | **KEEP** — professor guidance: retain to avoid schema modification later |
| `program_code` (extras) | 56.5% | **KEEP** — professor guidance: retain to avoid schema modification later |
| `author` | **0%** | **REMOVE** — empty for ALL 2000 datasets |
| `author_email` | **0%** | **REMOVE** — empty for ALL 2000 datasets |
| `url` | **0%** | **REMOVE** — empty for ALL 2000 datasets |
| `version` | **0%** | **REMOVE** — empty for ALL 2000 datasets |
| `state` | 100% always "active" | **REMOVE** — zero information value |
| `type` | 100% always "dataset" | **REMOVE** — zero information value |
| `org_id` (FK) | 100% | **KEEP** — relationship to ORGANIZATION |

**Recommended:** `dataset_id (PK), name, title, description, access_level, license_id, license_title, metadata_created, metadata_modified, maintainer, maintainer_email, identifier, publisher_name, bureau_code, program_code, org_id (FK)`

### Optional columns (from extras that could become real columns):

| Extra Key | Population | Notes |
|---|---|---|
| `modified` | 86.1% | When the *data* was last modified (distinct from metadata_modified) |
| `issued` | 62.5% | When the dataset was first published |
| `landingPage` | 61.0% | The actual URL (since top-level `url` is always empty) |
| `accrualPeriodicity` | 22.1% | Update frequency (yearly, monthly, etc.) |
| `temporal` | 17.5% | Time coverage |
| `spatial` | 33.6% | GeoJSON blobs — not useful for queries |
| `language` | 19.4% | Almost always "en-US" — no info value |
| `dataQuality` | 15.2% | Always "True" when present |
| `rights` | 7.1% | Too rare |

---

## 4. RESOURCE

**Current schema (12 columns):** `resource_id, dataset_id, name, description, format, url, mimetype, size, created, last_modified, resource_type, state`

| Field | Population | Verdict |
|---|---|---|
| `resource_id` | 100% | **KEEP** — PK |
| `dataset_id` | 100% | **KEEP** — FK |
| `name` | 100% | **KEEP** |
| `description` | 70.9% | **KEEP** |
| `format` | 90.7% | **KEEP** — critical for "view datasets by format" |
| `url` | 100% | **KEEP** — download/access URL |
| `mimetype` | 84.9% | **KEEP** — useful alongside format for accurate content type detection |
| `size` | **0%** | **REMOVE** — empty for ALL 15,478 resources |
| `created` | 100% | **KEEP** |
| `last_modified` | **0%** | **REMOVE** — empty for all resources |
| `resource_type` | **0%** | **REMOVE** — empty for all resources |
| `state` | 100% always "active" | **REMOVE** — zero info value |

**Recommended:** `resource_id (PK), dataset_id (FK), name, description, format, url, mimetype, created`

---

## 5. DATASET_TAG (multivalued attribute)

**Current:** `dataset_id, tag_name` — 45,862 entries

**Verdict: KEEP as-is.** Required for "view datasets by tag" and "top 10 tags per project type".

---

## 6. TOPIC (Entity) & DATASET_TOPIC (M:N bridge)

**TOPIC** is now a standalone entity with `name` (PK) and `description`.

**DATASET_TOPIC** is an M:N bridge table between DATASET and TOPIC.

**Current:** `dataset_id, topic_name` — 1,446 entries (57% of datasets have topics), 297 unique topic names.

**Verdict: Promoted TOPIC to entity.** Required for "total datasets by topic". M:N relationship via DATASET_TOPIC.

---

## 7. DATASET_EXTRA — the problem table

**Current:** 18,098 rows of `(dataset_id, extra_key, extra_value)`

**Recommendation: DELETE this table entirely.**

Reasons:
- EAV (Entity-Attribute-Value) anti-pattern — shows you didn't analyze the data
- Important extras already captured as proper columns/tables (access_level, identifier, theme→dataset_topic)
- Remaining extras (spatial GeoJSON, geospatial harvester metadata, Census API links) not needed for any project requirement
- If you want `modified` or `issued`, add them as real columns on DATASET

---

## 8. APP_USER & DATASET_USAGE

No changes needed — these are from your own design, not crawled data.

---

## Summary Table

| Entity | Recommended Columns | Removed |
|---|---|---|
| **ORGANIZATION** | name, title, description, org_type, image_url, created | state (always active), approval_status (always approved) |
| **ORG_CONTACT** | org_id, contact_email | No change |
| **DATASET** | name, title, description, access_level, license_id, license_title, metadata_created, metadata_modified, maintainer_email, identifier, publisher_name, bureau_code, program_code, landing_page, modified, issued, accrual_periodicity, temporal, org_name | author/author_email/url/version (all empty), state/type (constant) |
| **RESOURCE** | url, name, description, format, mimetype, created | size/last_modified/resource_type (all empty), state (constant) |
| **DATASET_TAG** | dataset_name, tag_name | No change |
| **TOPIC** | name, description | NEW entity (promoted from multivalued attribute) |
| **DATASET_TOPIC** | dataset_name, topic_name | Now M:N bridge between DATASET and TOPIC |
| **~~DATASET_EXTRA~~** | — | DELETE entirely |
| **APP_USER** | email, username, gender, age, birthdate, country | No change |
| **DATASET_USAGE** | email, dataset_id, project_name, project_category, usage_date | No change |

## Open Questions

1. ~~Add `modified` and/or `issued` as real dataset columns?~~ **Done** — added.
2. ~~Add `landingPage` as a real URL column?~~ **Done** — added as `landing_page`.
3. ~~Keep `description` on ORGANIZATION even though it's mostly empty?~~ **Yes** — kept per professor guidance.
4. ~~Keep `publisher_name` on DATASET even though org relationship exists?~~ **Yes** — kept per professor guidance.
