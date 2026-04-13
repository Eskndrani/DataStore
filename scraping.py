"""
Scraper for data.gov datasets using CKAN API.
Gets dataset info and saves it as JSON for loading into MySQL.

Usage:
    python scraping.py

Outputs:
    raw_datasets.json - all the raw data from API
    raw_organizations.json - org details
    parsed_data.json - cleaned up data ready for the database
"""

import requests
import json
import time
import os
import sys

# API settings
API_BASE = "https://catalog.data.gov/api/3/action/"
ROWS_PER_PAGE = 20          # CKAN gives 20 per page
TOTAL_PAGES = 100           # 100 pages = 2000 datasets

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DATASETS_FILE = os.path.join(OUTPUT_DIR, "raw_datasets.json")
RAW_ORGS_FILE = os.path.join(OUTPUT_DIR, "raw_organizations.json")
PARSED_DATA_FILE = os.path.join(OUTPUT_DIR, "parsed_data.json")

# Wait between API calls so we don't get blocked
API_DELAY = 0.3


# =============================================================
# Helper: CKAN API call
# =============================================================
def ckan_api_call(action, params=None, retries=3):
    """Make a call to CKAN API with some retries if it fails."""
    url = API_BASE + action
    for attempt in range(retries):
        try:
            resp = requests.post(url, json=params or {}, timeout=30)
            data = resp.json()
            if data.get("success"):
                return data["result"]
            else:
                print(f"  (warning) API call failed: {action} => {data.get('error')}")
                return None
        except Exception as e:
            print(f"  (warning) Attempt {attempt+1}/{retries} failed for {action}: {e}")
            time.sleep(2)
    print(f"  (error) Couldn't get {action} after {retries} tries")
    return None


# =============================================================
# Helper: safe truncate strings for DB columns
# =============================================================
def trunc(val, max_len):
    """Cut string if too long for database column."""
    if val is None:
        return None
    s = str(val)
    return s[:max_len] if len(s) > max_len else s


def parse_date_only(val):
    """Get just the date part from ISO datetime string."""
    if not val:
        return None
    s = str(val).strip()
    return s[:10] if len(s) >= 10 else None


def get_extra(extras, *keys):
    """Try multiple keys in extras dict, return first one that has a value."""
    for k in keys:
        v = extras.get(k)
        if v is not None and str(v).strip() != "":
            return v
    return None


# =============================================================
# Step 1: Crawl all datasets
# =============================================================
def crawl_datasets():
    """Get 2000 datasets from data.gov, 20 at a time."""
    all_datasets = []
    for page in range(TOTAL_PAGES):
        start = page * ROWS_PER_PAGE
        print(f"> page {page+1}/{TOTAL_PAGES} - getting datasets {start+1}..{start+ROWS_PER_PAGE}...")
        result = ckan_api_call("package_search", {
            "rows": ROWS_PER_PAGE,
            "start": start
        })
        if result and "results" in result:
            all_datasets.extend(result["results"])
            print(f"    got {len(result['results'])} rows (total {len(all_datasets)})")
        else:
            print(f"    (warning) nothing on page {page+1}, continuing...")
        time.sleep(API_DELAY)

    print(f"\n==> Got {len(all_datasets)} total datasets")
    return all_datasets


# =============================================================
# Step 2: Extract unique organizations & fetch full details
# =============================================================
def fetch_organizations(datasets):
    """Get unique org IDs from datasets, then fetch their details."""
    org_ids = set()
    for ds in datasets:
        org = ds.get("organization")
        if org and org.get("id"):
            org_ids.add(org["id"])

    print(f"\n==> Found {len(org_ids)} orgs. Fetching details...")
    orgs = {}
    for i, oid in enumerate(org_ids):
        print(f"  [{i+1}/{len(org_ids)}] Fetching org: {oid}")
        result = ckan_api_call("organization_show", {
            "id": oid,
            "include_extras": True,
            "include_datasets": False,
            "include_users": False,
            "include_tags": False,
            "include_groups": False,
            "include_followers": False
        })
        if result:
            orgs[oid] = result
        time.sleep(API_DELAY)

    print(f"  Fetched {len(orgs)} org details.")
    return orgs


# =============================================================
# Step 3: Parse & extract structured data
# =============================================================
def extract_extras_dict(extras_list):
    """Turn list of {key, value} into a flat dict."""
    d = {}
    for item in (extras_list or []):
        d[item["key"]] = item["value"]
    return d


def parse_organizations(orgs):
    """Extract org and contact rows from raw org data."""
    org_rows = []
    contact_rows = []

    for oid, org in orgs.items():
        extras = extract_extras_dict(org.get("extras", []))
        org_type = extras.get("organization_type", None)
        email_list_raw = extras.get("email_list", "")

        org_rows.append({
            "name": trunc(org.get("name", ""), 255),
            "title": trunc(org.get("title", ""), 500),
            "description": org.get("description", ""),
            "org_type": trunc(org_type, 100),
            "image_url": trunc(org.get("image_url", ""), 500),
            "created": org.get("created"),
        })

        # Parse contact emails from org extras
        if email_list_raw:
            emails = [e.strip() for e in email_list_raw.replace("\r\n", "\n").split("\n") if e.strip()]
            for email in emails:
                contact_rows.append({
                    "email": trunc(email, 255),
                    "name": None,
                    "org_name": trunc(org.get("name", ""), 255),
                })

    return org_rows, contact_rows


def parse_datasets(datasets):
    """
    Parse datasets into rows for:
    - dataset table
    - resource table
    - dataset_tag (multivalued attribute)
    - dataset_topic (M:N relationship)
    """
    ds_rows = []
    res_rows = []
    ds_tag_rows = []
    ds_topic_rows = []
    topic_set = {}  # unique topics we found

    for ds in datasets:
        extras = extract_extras_dict(ds.get("extras", []))

        publisher_name = extras.get("publisher", "")
        if isinstance(publisher_name, dict):
            publisher_name = publisher_name.get("name", str(publisher_name))

        landing_page = get_extra(extras, "landingPage", "landing_page")
        modified = parse_date_only(get_extra(extras, "modified"))
        issued = parse_date_only(get_extra(extras, "issued"))
        accrual_periodicity = get_extra(extras, "accrualPeriodicity", "accrual_periodicity")

        temporal_val = get_extra(extras, "temporal")
        if isinstance(temporal_val, (list, dict)):
            temporal_val = json.dumps(temporal_val)

        bureau_code = get_extra(extras, "bureauCode", "bureau_code")
        program_code = get_extra(extras, "programCode", "program_code")

        org_name = None
        org_data = ds.get("organization")
        if org_data and org_data.get("name"):
            org_name = org_data["name"]

        ds_rows.append({
            "name": trunc(ds.get("name", ""), 255),
            "title": trunc(ds.get("title", ""), 500),
            "description": ds.get("notes", ""),
            "access_level": trunc(extras.get("accessLevel", ""), 50),
            "license_id": trunc(ds.get("license_id", ""), 100),
            "license_title": trunc(ds.get("license_title", ""), 255),
            "metadata_created": ds.get("metadata_created"),
            "metadata_modified": ds.get("metadata_modified"),
            "maintainer": trunc(ds.get("maintainer", ""), 255),
            "maintainer_email": trunc(ds.get("maintainer_email", ""), 255),
            "identifier": trunc(extras.get("identifier", ""), 500),
            "publisher_name": trunc(str(publisher_name), 500),
            "landing_page": trunc(landing_page, 1000),
            "modified": modified,
            "issued": issued,
            "accrual_periodicity": trunc(accrual_periodicity, 50),
            "temporal": trunc(temporal_val, 255),
            "bureau_code": trunc(bureau_code, 50),
            "program_code": trunc(program_code, 50),
            "org_name": trunc(org_name, 255),
        })

        # Resources for this dataset
        for res in ds.get("resources", []):
            res_rows.append({
                "dataset_name": trunc(ds.get("name", ""), 255),
                "name": trunc(res.get("name", ""), 500),
                "description": res.get("description", ""),
                "format": trunc(res.get("format", ""), 100),
                "url": trunc(res.get("url", ""), 500),
                "mimetype": trunc(res.get("mimetype", ""), 100),
                "created": res.get("created"),
            })

        # Tags
        for tag in ds.get("tags", []):
            tag_name = trunc(tag.get("name", tag.get("display_name", "")), 255)
            if tag_name:
                ds_tag_rows.append({
                    "dataset_name": trunc(ds.get("name", ""), 255),
                    "tag_name": tag_name,
                })

        # Topics - official data.gov topics from groups field
        for group in ds.get("groups", []):
            topic_name = group.get("name", "").strip()
            topic_title = group.get("title", "").strip()
            topic_desc = group.get("description", "").strip()
            if topic_name:
                ds_topic_rows.append({
                    "dataset_name": trunc(ds.get("name", ""), 255),
                    "topic_name": trunc(topic_name, 255),
                })
                # Store topic with description from API
                if topic_name not in topic_set:
                    # Use description if available, otherwise use title
                    desc = topic_desc if topic_desc else (f"Datasets related to {topic_title}" if topic_title else None)
                    topic_set[topic_name] = desc

    topic_rows = [{"name": trunc(n, 255), "description": d} for n, d in topic_set.items()]
    return ds_rows, res_rows, ds_tag_rows, ds_topic_rows, topic_rows


# =============================================================
# Main execution
# =============================================================
def main():
    print("=" * 50)
    print("  Data.gov Dataset Scraper")
    print("=" * 50)

    # Step 1: Crawl datasets
    print("\n[Step 1] Getting datasets from catalog.data.gov...")
    datasets = crawl_datasets()

    if not datasets:
        print("[ERROR] No datasets found. Check your internet or try again.")
        sys.exit(1)

    # Save raw datasets
    with open(RAW_DATASETS_FILE, "w", encoding="utf-8") as f:
        json.dump(datasets, f, ensure_ascii=False, default=str)
    print(f"  Saved to {RAW_DATASETS_FILE}")

    # Step 2: Get org details
    print("\n[Step 2] Fetching organization info...")
    orgs = fetch_organizations(datasets)

    with open(RAW_ORGS_FILE, "w", encoding="utf-8") as f:
        json.dump(orgs, f, ensure_ascii=False, default=str)
    print(f"  Saved to {RAW_ORGS_FILE}")

    # Step 3: Parse everything
    print("\n[Step 3] Cleaning up the data...")
    org_rows, contact_rows = parse_organizations(orgs)
    ds_rows, res_rows, ds_tag_rows, ds_topic_rows, topic_rows = parse_datasets(datasets)

    parsed = {
        "org_rows": org_rows,
        "contact_rows": contact_rows,
        "ds_rows": ds_rows,
        "res_rows": res_rows,
        "ds_tag_rows": ds_tag_rows,
        "ds_topic_rows": ds_topic_rows,
        "topic_rows": topic_rows,
        "extra_rows": [],
    }

    with open(PARSED_DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False, default=str)
    print(f"  Saved to {PARSED_DATA_FILE}")

    print(f"\n  Summary:")
    print(f"    Organizations:  {len(org_rows)}")
    print(f"    Contacts:       {len(contact_rows)}")
    print(f"    Datasets:       {len(ds_rows)}")
    print(f"    Resources:      {len(res_rows)}")
    print(f"    Dataset tags:   {len(ds_tag_rows)}")
    print(f"    Topics:         {len(topic_rows)}")
    print(f"    Dataset-Topics: {len(ds_topic_rows)}")

    print("\n" + "=" * 50)


if __name__ == "__main__":
    main()
