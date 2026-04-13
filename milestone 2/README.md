# Milestone 2 - Data Crawling and Population

This directory contains all deliverables for Milestone 2 of the Database Project.

## Files Overview

### 1. scraping.py
**Purpose:** Crawls data.gov using the CKAN API to fetch datasets and organizations.

**Key Functions:**
- `ckan_api_call(action, params, retries)` - Makes API calls to CKAN with retry logic
- `trunc(val, max_len)` - Truncates strings to fit database column limits
- `parse_date_only(val)` - Extracts date portion from ISO datetime strings
- `get_extra(extras, *keys)` - Retrieves values from the extras dictionary
- `crawl_datasets()` - Fetches 2000 datasets (20 per page × 100 pages)
- `fetch_organizations(datasets)` - Gets unique org IDs from datasets, fetches their details
- `extract_extras_dict(extras_list)` - Converts CKAN extras list to flat dictionary
- `parse_organizations(orgs)` - Extracts org rows and contact rows from raw org data
- `parse_datasets(datasets)` - Parses datasets into rows for: dataset table, resource table, dataset_tag, dataset_topic

**Outputs:**
- `raw_datasets.json` - Raw API response for 2000 datasets
- `raw_organizations.json` - Org details for 87 unique organizations
- `parsed_data.json` - Cleaned data ready for database import

---

### 2. populate_db.py
**Purpose:** Loads parsed JSON data into MySQL and exports to CSV.

**Key Functions:**
- `get_db_connection()` - Creates MySQL connection using hardcoded credentials
- `init_schema(cursor)` - Drops and recreates all 11 database tables
- `insert_organizations(cursor, org_rows)` - Inserts 87 organizations with error handling
- `insert_contacts(cursor, contact_rows)` - Inserts 742 contacts
- `insert_datasets(cursor, ds_rows)` - Inserts 2000 datasets with FKs to org and maintainer
- `insert_resources(cursor, res_rows)` - Inserts 17437 resources
- `insert_tags(cursor, ds_tag_rows)` - Inserts 46019 dataset-tag relationships
- `insert_topic_entities(cursor, topic_rows)` - Inserts 4 official data.gov topics
- `insert_topics(cursor, ds_topic_rows)` - Inserts 557 dataset-topic relationships
- `import_users(cursor)` - Imports 100 users from users.csv
- `generate_random_usage(cursor, user_emails, dataset_ids, count)` - Creates 500 random project-dataset usage entries
- `export_tables_to_csv(cursor)` - Exports all 11 tables to CSV files

**Outputs:**
- Populated MySQL database (datagov_db)
- 11 CSV files in csv_exports/ folder

---

### 3. schema.sql
**Purpose:** Database DDL defining all 11 tables.

**Tables Created:**
1. **organization** - Stores 87 organizations (name, title, description, org_type, image_url, created)
2. **contact** - Stores 742 contacts (email PK, name, org_name FK)
3. **dataset** - Stores 2000 datasets with FKs to organization and maintainer
4. **resource** - Stores 17437 downloadable resources identified by URL
5. **dataset_resource** - M:N bridge table linking datasets to resources
6. **dataset_tag** - Multivalued attribute table for dataset tags (46K entries)
7. **topic** - 4 official data.gov topics (local, climate5434, energy9485, older-adults-health-data)
8. **dataset_topic** - M:N bridge for dataset-topic relationships (557 entries)
9. **app_user** - 100 users from users.csv (email PK, username, gender, birthdate, country)
10. **project** - Weak entity (email, project_name, project_type) ~233 projects
11. **project_dataset** - M:N "uses" relationship (500 entries)

---

### 4. users.csv
**Purpose:** Source data for 100 app users provided by the instructor.

**Columns:** email, username, gender, age, birthdate, country
- Age is derived from birthdate in the database
- Gender is Male/Female enum

---

### 5. parsed_data.json
**Purpose:** Intermediate JSON file with cleaned data ready for database import.

**Sections:**
- `org_rows` - 87 cleaned organization records
- `contact_rows` - 742 contacts from org email lists
- `ds_rows` - 2000 datasets with all attributes
- `res_rows` - 17437 resources linked to datasets
- `ds_tag_rows` - 46019 dataset-tag pairs
- `ds_topic_rows` - 557 dataset-topic pairs
- `topic_rows` - 4 official topics with descriptions

---

### 6. raw_datasets.json
**Purpose:** Raw API response from CKAN `package_search` endpoint.

Contains 2000 complete dataset records as returned by data.gov API, including all metadata, extras, groups, tags, and resources.

---

### 7. raw_organizations.json
**Purpose:** Raw API response from CKAN `organization_show` endpoint.

Contains 87 organization records with full details including extras (email_list, organization_type).

---

### 8. datagov_db_dump.sql
**Purpose:** Complete MySQL dump of the populated database.

Generated using mysqldump. Contains all INSERT statements for all 11 tables.

---

### 9. csv_exports/ Directory
**Purpose:** Contains CSV exports of all 11 database tables.

**Files:**
- `organization.csv` - 87 rows
- `contact.csv` - 742 rows (723 unique after deduplication)
- `dataset.csv` - 2000 rows
- `resource.csv` - 16202 rows (unique URLs)
- `dataset_resource.csv` - 16756 rows (M:N links)
- `dataset_tag.csv` - 46019 rows (multivalued attribute)
- `topic.csv` - 4 official topics with descriptions
- `dataset_topic.csv` - 557 rows (M:N links)
- `app_user.csv` - 100 users (doctor's data)
- `project.csv` - ~233 projects for users
- `project_dataset.csv` - 500 usage entries

---

## How to Run

1. **Crawl data:**
   ```bash
   python scraping.py
   ```
   This creates raw_datasets.json, raw_organizations.json, parsed_data.json

2. **Load into database:**
   ```bash
   python populate_db.py
   ```
   This creates tables, loads data, imports users, generates usage, exports CSVs

3. **Create database dump:**
   ```bash
   mysqldump -u root -p datagov_db > datagov_db_dump.sql
   ```

## Key Relationships

- Organization 1:N Dataset (publishes)
- Organization 1:N Contact (assigned_to)
- Contact 1:N Dataset (maintains via maintainer_email FK)
- Dataset M:N Resource (dataset_resource bridge)
- Dataset M:N Topic (dataset_topic bridge)
- Dataset multivalued Tag (dataset_tag table)
- App_User 1:N Project (creates - weak entity)
- Project M:N Dataset (project_dataset bridge)

## Notes

- Topics are extracted from `dataset["groups"]` (4 official data.gov topics), NOT from `extras["theme"]`
- Contacts are extracted from organization `email_list` extras plus dataset `maintainer_email`
- Resources are deduplicated by URL (first non-null metadata wins)
- 500 random usage entries generated for project-dataset relationships
