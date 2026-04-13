"""
Script to load parsed JSON data into MySQL database.
Also creates sample users/projects and exports everything to CSV.

Usage:
    python populate_db.py

Prerequisites:
    - MySQL running on localhost
    - Database 'datagov_db' created (run schema.sql first)
    - parsed_data.json from scraping.py
    - users.csv with sample users
"""

import json
import mysql.connector
from mysql.connector import Error
import csv
import os
import sys
import random
from datetime import date, timedelta

# Database connection settings
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "2143658709Mm",
    "database": "datagov_db",
    "charset": "utf8mb4",
    "collation": "utf8mb4_unicode_ci",
}

PARSED_DATA_FILE = os.path.join(BASE_DIR, "parsed_data.json")
USERS_CSV = os.path.join(BASE_DIR, "users.csv")
CSV_OUTPUT_DIR = os.path.join(BASE_DIR, "csv_exports")


# =============================================================
# Insert helpers
# =============================================================
def get_db_connection():
    """Connect to MySQL using settings above."""
    return mysql.connector.connect(**DB_CONFIG)


def init_schema(cursor):
    """Create database tables from schema.sql. Drops existing tables first."""
    schema_path = os.path.join(BASE_DIR, "schema.sql")
    if not os.path.exists(schema_path):
        print(f"  (warning) schema.sql not found at {schema_path}")
        return
    
    print("  Setting up database tables...")
    
    # Drop tables in reverse dependency order (child tables first)
    drop_order = [
        'project_dataset', 'dataset_topic', 'dataset_tag', 'dataset_resource',
        'project', 'app_user', 'topic', 'resource', 'dataset', 'contact', 'organization'
    ]
    
    for table in drop_order:
        try:
            cursor.execute(f"DROP TABLE IF EXISTS {table}")
        except Error:
            pass
    
    # Read and execute schema
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    
    # Extract CREATE TABLE statements with their contents
    import re
    pattern = r'CREATE TABLE\s+\w+\s*\([^;]+\);'
    create_statements = re.findall(pattern, schema_sql, re.IGNORECASE | re.DOTALL)
    
    for stmt in create_statements:
        try:
            cursor.execute(stmt)
        except Error as e:
            print(f"  (warning) Could not create table: {e}")
    
    print(f"  Created {len(create_statements)} tables.")


def insert_organizations(cursor, org_rows):
    print(f"\nInserting {len(org_rows)} organizations...")
    sql = """INSERT IGNORE INTO organization
             (name, title, description, org_type, image_url, created)
             VALUES (%(name)s, %(title)s, %(description)s, %(org_type)s,
                     %(image_url)s, %(created)s)"""
    for row in org_rows:
        try:
            cursor.execute(sql, row)
        except Error as e:
            print(f"  (warning) couldn't insert org {row.get('name')}: {e}")


def insert_contacts(cursor, contact_rows):
    print(f"\nInserting {len(contact_rows)} contacts...")
    # If same email appears twice, keep first non-null name/org
    sql = """INSERT INTO contact (email, name, org_name)
             VALUES (%(email)s, %(name)s, %(org_name)s)
             ON DUPLICATE KEY UPDATE
               name = COALESCE(contact.name, VALUES(name)),
               org_name = COALESCE(contact.org_name, VALUES(org_name))"""
    for row in contact_rows:
        if not row.get("email"):
            continue
        try:
            cursor.execute(sql, row)
        except Error as e:
            print(f"  (warning) couldn't insert contact {row.get('email')}: {e}")


def insert_datasets(cursor, ds_rows):
    print(f"\nInserting {len(ds_rows)} datasets...")
    sql = """INSERT IGNORE INTO dataset
             (name, title, description, access_level, license_id, license_title,
              metadata_created, metadata_modified, maintainer_email,
              identifier, publisher_name, landing_page, modified, issued,
              accrual_periodicity, temporal, bureau_code, program_code, org_name)
             VALUES (%(name)s, %(title)s, %(description)s, %(access_level)s,
                     %(license_id)s, %(license_title)s, %(metadata_created)s,
                     %(metadata_modified)s, %(maintainer_email)s,
                     %(identifier)s, %(publisher_name)s, %(landing_page)s, %(modified)s,
                     %(issued)s, %(accrual_periodicity)s, %(temporal)s,
                     %(bureau_code)s, %(program_code)s, %(org_name)s)"""
    for row in ds_rows:
        # Add missing keys with None value
        for key in ['bureau_code', 'program_code', 'landing_page', 'modified', 'issued', 
                    'accrual_periodicity', 'temporal', 'maintainer_email', 'identifier']:
            if key not in row:
                row[key] = None
        try:
            cursor.execute(sql, row)
        except Error as e:
            print(f"  (warning) couldn't insert dataset {row.get('name')}: {e}")


def insert_resources(cursor, res_rows):
    print(f"\nInserting {len(res_rows)} resources...")
    # Same URL might appear multiple times with different metadata
    # Keep first non-null for text fields, earliest date for created
    upsert_sql = """INSERT INTO resource
                    (url, name, description, format, mimetype, created)
                    VALUES (%(url)s, %(name)s, %(description)s, %(format)s, %(mimetype)s, %(created)s)
                    ON DUPLICATE KEY UPDATE
                      name = COALESCE(resource.name, VALUES(name)),
                      description = COALESCE(resource.description, VALUES(description)),
                      format = COALESCE(resource.format, VALUES(format)),
                      mimetype = COALESCE(resource.mimetype, VALUES(mimetype)),
                      created = CASE
                                  WHEN resource.created IS NULL THEN VALUES(created)
                                  WHEN VALUES(created) IS NULL THEN resource.created
                                  WHEN VALUES(created) < resource.created THEN VALUES(created)
                                  ELSE resource.created
                                END"""

    link_sql = """INSERT IGNORE INTO dataset_resource (dataset_name, url)
                  VALUES (%(dataset_name)s, %(url)s)"""

    for row in res_rows:
        try:
            if not row.get("url") or not row.get("dataset_name"):
                continue
            cursor.execute(upsert_sql, row)
            cursor.execute(link_sql, row)
        except Error as e:
            print(f"  (warning) couldn't insert resource {row.get('url')}: {e}")


def insert_tags(cursor, ds_tag_rows):
    print(f"\nInserting {len(ds_tag_rows)} dataset-tag entries...")
    sql = """INSERT IGNORE INTO dataset_tag (dataset_name, tag_name)
             VALUES (%(dataset_name)s, %(tag_name)s)"""
    for row in ds_tag_rows:
        try:
            cursor.execute(sql, row)
        except Error as e:
            print(f"  (warning) dataset-tag insert issue: {e}")


def insert_topic_entities(cursor, topic_rows):
    print(f"\nInserting {len(topic_rows)} topic entities...")
    sql = """INSERT IGNORE INTO topic (name, description)
             VALUES (%(name)s, %(description)s)"""
    for row in topic_rows:
        try:
            cursor.execute(sql, row)
        except Error as e:
            print(f"  (warning) Topic insert failed for {row.get('name')}: {e}")


def insert_topics(cursor, ds_topic_rows):
    print(f"\nInserting {len(ds_topic_rows)} dataset-topic entries...")
    sql = """INSERT IGNORE INTO dataset_topic (dataset_name, topic_name)
              VALUES (%(dataset_name)s, %(topic_name)s)"""
    for row in ds_topic_rows:
        try:
            cursor.execute(sql, row)
        except Error as e:
            print(f"  (warning) dataset-topic insert issue: {e}")


# =============================================================
# Import users from CSV
# =============================================================
def import_users(cursor):
    """Read users.csv and insert into app_user table."""
    print(f"\nImporting users from {USERS_CSV}...")
    if not os.path.exists(USERS_CSV):
        print(f"  [ERROR] Users file not found: {USERS_CSV}")
        return []

    user_emails = []
    sql = """INSERT IGNORE INTO app_user (email, username, gender, birthdate, country)
             VALUES (%s, %s, %s, %s, %s)"""

    with open(USERS_CSV, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                # Handle quoted column names
                email_key = next((k for k in row.keys() if 'email' in k.lower()), 'email')
                cursor.execute(sql, (
                    row[email_key].strip('"'),
                    row["username"].strip('"'),
                    row["gender"].strip('"'),
                    row["birthdate"].strip('"'),
                    row["country"].strip('"')
                ))
                user_emails.append(row[email_key].strip('"'))
            except Error as e:
                print(f"  (warning) User insert failed for {row.get('email', 'unknown')}: {e}")

    print(f"  Imported {len(user_emails)} users.")
    return user_emails


# =============================================================
# Generate random usage entries
# =============================================================
PROJECT_CATEGORIES = ["analytics", "machine_learning", "field_research"]
PROJECT_PREFIXES = [
    "Analysis of", "Modeling", "Research on", "Study of", "Exploration of",
    "Investigation into", "Survey using", "Dashboard for", "ML Pipeline for",
    "Prediction Model for", "Classification of", "Clustering", "Visualization of",
    "Report on", "Assessment of", "Audit of", "Mapping", "Tracking",
    "Forecasting", "Benchmarking"
]
PROJECT_SUFFIXES = [
    "Public Data", "Government Records", "Open Datasets", "Field Data",
    "National Trends", "Regional Statistics", "Federal Sources", "Census Info",
    "Environmental Data", "Health Records", "Economic Indicators", "Education Stats",
    "Transportation Data", "Energy Metrics", "Climate Records"
]


def generate_random_usage(cursor, user_emails, dataset_ids, count=500):
    """Create random PROJECT rows and link them to datasets via project_dataset."""
    print(f"\nGenerating random projects and dataset usage entries...")
    if not user_emails or not dataset_ids:
        print("  [ERROR] No users or datasets available for usage generation.")
        return

    project_sql = """INSERT IGNORE INTO project (email, project_name, project_type)
                     VALUES (%s, %s, %s)"""
    link_sql = """INSERT IGNORE INTO project_dataset (email, project_name, dataset_name)
                  VALUES (%s, %s, %s)"""

    # Build a pool of projects (each user gets 1-5 projects)
    projects = []
    for email in user_emails:
        n = random.randint(1, 5)
        for _ in range(n):
            prefix = random.choice(PROJECT_PREFIXES)
            suffix = random.choice(PROJECT_SUFFIXES)
            project_name = f"{prefix} {suffix}"
            category = random.choice(PROJECT_CATEGORIES)
            projects.append((email, project_name, category))

    # Insert projects
    inserted_projects = 0
    for p in projects:
        try:
            cursor.execute(project_sql, p)
            if cursor.rowcount > 0:
                inserted_projects += 1
        except Error:
            pass
    print(f"  Inserted {inserted_projects} projects.")

    # Link projects to datasets
    inserted_links = 0
    attempts = 0
    while inserted_links < count and attempts < count * 3:
        email, pname, _ = random.choice(projects)
        did = random.choice(dataset_ids)
        attempts += 1
        try:
            cursor.execute(link_sql, (email, pname, did))
            if cursor.rowcount > 0:
                inserted_links += 1
        except Error:
            pass

    print(f"  Inserted {inserted_links} project-dataset links (after {attempts} attempts).")


# =============================================================
# Export tables to CSV
# =============================================================
def export_tables_to_csv(cursor):
    """Export all tables to CSV files in csv_exports/ folder."""
    os.makedirs(CSV_OUTPUT_DIR, exist_ok=True)

    tables = [
        "organization", "contact", "dataset", "resource",
        "dataset_resource", "dataset_tag", "topic", "dataset_topic",
        "app_user", "project", "project_dataset"
    ]

    for table in tables:
        print(f"  Exporting {table}...")
        try:
            cursor.execute(f"SELECT * FROM {table}")
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            csv_path = os.path.join(CSV_OUTPUT_DIR, f"{table}.csv")
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(columns)
                for row in rows:
                    writer.writerow(row)
            print(f"    -> {csv_path} ({len(rows)} rows)")
        except PermissionError:
            print(f"    (skipped - file locked, probably open in IDE)")
        except Error as e:
            print(f"    (error: {e})")


# =============================================================
# Main
# =============================================================
def main():
    print("=" * 50)
    print("  Database Loader")
    print("=" * 50)

    # Load parsed data
    if not os.path.exists(PARSED_DATA_FILE):
        print(f"[ERROR] Can't find {PARSED_DATA_FILE}")
        print("        Run scraping.py first.")
        sys.exit(1)

    print(f"\nLoading data from {PARSED_DATA_FILE}...")
    with open(PARSED_DATA_FILE, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    org_rows = parsed["org_rows"]
    raw_contact_rows = parsed["contact_rows"]
    ds_rows = parsed["ds_rows"]
    res_rows = parsed["res_rows"]
    ds_tag_rows = parsed["ds_tag_rows"]
    ds_topic_rows = parsed["ds_topic_rows"]
    topic_rows = parsed.get("topic_rows", [])

    # Build contact list: org email_list contacts + dataset maintainers
    contacts_by_email = {}
    for c in raw_contact_rows:
        email = c.get("contact_email") or c.get("email")
        if not email:
            continue
        if email not in contacts_by_email:
            contacts_by_email[email] = {"email": email, "name": c.get("name"), "org_name": c.get("org_name")}
        else:
            existing = contacts_by_email[email]
            existing["name"] = existing["name"] or c.get("name")
            existing["org_name"] = existing["org_name"] or c.get("org_name")

    for ds in ds_rows:
        me = ds.get("maintainer_email")
        if me:
            if me not in contacts_by_email:
                contacts_by_email[me] = {"email": me, "name": ds.get("maintainer"), "org_name": ds.get("org_name")}
            else:
                existing = contacts_by_email[me]
                existing["name"] = existing["name"] or ds.get("maintainer")
                existing["org_name"] = existing["org_name"] or ds.get("org_name")

    contact_rows = list(contacts_by_email.values())

    print(f"  Organizations:  {len(org_rows)}")
    print(f"  Contacts:       {len(contact_rows)}")
    print(f"  Datasets:       {len(ds_rows)}")
    print(f"  Resources:      {len(res_rows)}")
    print(f"  Tags:           {len(ds_tag_rows)}")
    print(f"  Topics:         {len(topic_rows)} entities, {len(ds_topic_rows)} links")

    # Insert into MySQL
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
        
        # Create tables if they don't exist
        init_schema(cursor)

        insert_organizations(cursor, org_rows)
        insert_contacts(cursor, contact_rows)
        insert_datasets(cursor, ds_rows)
        insert_resources(cursor, res_rows)
        insert_tags(cursor, ds_tag_rows)
        insert_topic_entities(cursor, topic_rows)
        insert_topics(cursor, ds_topic_rows)

        cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
        conn.commit()
        print("\n  Data loaded into MySQL successfully.")

        # Import users
        user_emails = import_users(cursor)
        conn.commit()

        # Generate random usage
        dataset_ids = [row["name"] for row in ds_rows]
        generate_random_usage(cursor, user_emails, dataset_ids, count=500)
        conn.commit()

        # Export to CSV
        print("\nExporting tables to CSV...")
        export_tables_to_csv(cursor)

        cursor.close()
        conn.close()

    except Error as e:
        print(f"\n[ERROR] MySQL connection failed: {e}")
        print("        Make sure MySQL is running and credentials are correct.")
        sys.exit(1)

    print("\n" + "=" * 50)
    print("  All done! Check csv_exports/ folder.")
    print("=" * 50)


if __name__ == "__main__":
    main()
