# Data.gov Dataset Database – ERD & Relational Model

> **ERD file:** Open `erd_chen.drawio` in [draw.io](https://app.diagrams.net/) to view/edit the Chen Notation ERD.

---

## Entity Justification

| Concept | Modelled as | Why |
|---|---|---|
| **ORGANIZATION** | Entity | Has its own identity (unique slug name), multiple independent attributes (title, description, type, …), and exists independently of any single dataset. One organization publishes many datasets → 1:N relationship. |
| **DATASET** | Entity | The central piece of the domain — every dataset has a unique slug name, a rich set of descriptive attributes, and participates in three relationships. |
| **RESOURCE** | Entity | Each downloadable file/API endpoint is identified globally by its URL, allowing reuse by multiple datasets. |
| **APP_USER** | Entity | Represents registered application users with their own natural key (email). Creates projects that use datasets. |
| **PROJECT** | Weak Entity | A user's project that uses one or more datasets. Has no independent key — identified through its owning APP_USER via the `creates` identifying relationship. Partial key: `name`. |
| **tag** | Multivalued attribute of DATASET | Tags in CKAN have synthetic internal fields (tag_id, display_name) that are not meaningful in our context. What matters is the tag string itself — a single value repeated per dataset. A multivalued attribute is the correct model; it maps to a table `dataset_tag(dataset_name, tag_name)` in the relational schema, and can still be queried with standard SQL. |
| **TOPIC** | Entity | Themes from the CKAN extras "theme" JSON array.  Promoted to a full entity with its own `name` (PK) and `description` attributes, and connected to DATASET via the M:N `categorized_by` relationship, allowing independent querying and future enrichment. |
| **CONTACT** | Entity | A contact person has two attributes (name and email) and participates in two relationships: assigned_to (Organization) and maintains (Dataset). Modelling it as an entity avoids redundancy and correctly captures that the same person can maintain multiple datasets while belonging to one organization. |
| **dataset_resource** | M:N relationship | A dataset can reference many resource URLs, and the same URL can be referenced by many datasets. |
| **creates** | Identifying Relationship | A user creates projects. Each project is identified through its owning user → 1:N identifying relationship. |
| **uses** | M:N Relationship | A project can use many datasets, and a dataset can be used by many projects. |
| **assigned_to** | Relationship | A contact person is assigned to exactly one organization; an organization can have many contacts. Maps to FK in CONTACT. |
| **maintains** | Relationship | A contact person may maintain many datasets; each dataset has at most one maintainer. Maps to FK in DATASET. |

---

## Entities and Attributes (Chen ERD)

### ORGANIZATION
- **<u>name</u>** (PK – unique slug, e.g. "epa-gov"), title, description, org_type, image_url, created

### CONTACT
- **<u>email</u>** (PK), name

### DATASET
- **<u>name</u>** (PK – unique slug, e.g. "electric-vehicle-population-data"), title, description, access_level, license_id, license_title, metadata_created, metadata_modified, identifier, publisher_name, landing_page, modified, issued, accrual_periodicity, temporal, bureau_code, program_code
- *tag* (multivalued)

### TOPIC
- **<u>name</u>** (PK – topic label, e.g. "Transportation"), description

### RESOURCE
- **<u>url</u>** (PK), name, description, format, mimetype, created

### APP_USER
- **<u>email</u>** (PK), username, gender, *age* (derived from birthdate), birthdate, country

---

## Relationships (Chen Notation)

| Relationship | Entity 1 | Cardinality | Entity 2 | Description |
|---|---|---|---|---|
| publishes | ORGANIZATION | 1 : N | DATASET | An organization publishes many datasets |
| assigned_to | CONTACT | N : 1 | ORGANIZATION | A contact is assigned to one organization |
| maintains | CONTACT | 1 : N | DATASET | A contact maintains many datasets; each dataset has at most one maintainer |
| has | DATASET | M : N | RESOURCE | A dataset has many resources; a resource can belong to many datasets |
| creates | APP_USER | 1 : N | PROJECT | A user creates many projects (identifying relationship for weak entity PROJECT) |
| categorized_by | DATASET | M : N | TOPIC | A dataset belongs to many topics; a topic applies to many datasets |
| uses | PROJECT | M : N | DATASET | A project uses many datasets |

---

## Relational Model (mapped from Chen ERD)

All primary keys are natural — no synthetic auto-increment IDs.

Collision handling convention for RESOURCE metadata (same URL with different metadata in source):
- Keep one `RESOURCE` row per `url`.
- For `name`, `description`, `format`, `mimetype`: first non-null value wins.
- For `created`: keep the earliest non-null datetime.

1. **ORGANIZATION**(<u>name</u>, title, description, org_type, image_url, created)

2. **CONTACT**(<u>email</u>, name, *org_name*)
   - org_name → ORGANIZATION.name

3. **DATASET**(<u>name</u>, title, description, access_level, license_id, license_title, metadata_created, metadata_modified, identifier, publisher_name, landing_page, modified, issued, accrual_periodicity, temporal, bureau_code, program_code, *org_name*, *maintainer_email*)
   - org_name → ORGANIZATION.name
   - maintainer_email → CONTACT.email

4. **RESOURCE**(<u>url</u>, name, description, format, mimetype, created)

5. **DATASET_RESOURCE**(<u>*dataset_name*</u>, <u>*url*</u>)  — M:N bridge table
   - dataset_name → DATASET.name
   - url → RESOURCE.url

6. **DATASET_TAG**(<u>*dataset_name*</u>, <u>tag_name</u>)  — multivalued attribute of DATASET
   - dataset_name → DATASET.name

7. **TOPIC**(<u>name</u>, description)

8. **DATASET_TOPIC**(<u>*dataset_name*</u>, <u>*topic_name*</u>)  — M:N bridge (categorized_by)
   - dataset_name → DATASET.name
   - topic_name → TOPIC.name

9. **APP_USER**(<u>email</u>, username, gender, birthdate, country)  — age is derived from birthdate

10. **PROJECT**(<u>*email*</u>, <u>name</u>, type)  — weak entity
   - email → APP_USER.email

11. **PROJECT_DATASET**(<u>*email*</u>, <u>*project_name*</u>, <u>*dataset_name*</u>)  — M:N "uses" relationship
   - (email, project_name) → PROJECT.(email, name)
   - dataset_name → DATASET.name
