import json

with open('parsed_data.json', encoding='utf-8') as f:
    d = json.load(f)

# Check datasets for nulls
print("=== DATASET FIELDS ===")
null_counts = {}
for ds in d['ds_rows']:
    for k, v in ds.items():
        if v is None or v == '':
            null_counts[k] = null_counts.get(k, 0) + 1

for k, count in sorted(null_counts.items(), key=lambda x: -x[1]):
    pct = count / len(d['ds_rows']) * 100
    print(f"  {k}: {count}/{len(d['ds_rows'])} ({pct:.0f}% null)")

print(f"\n=== ORG FIELDS ===")
null_counts = {}
for org in d['org_rows']:
    for k, v in org.items():
        if v is None or v == '':
            null_counts[k] = null_counts.get(k, 0) + 1

for k, count in sorted(null_counts.items(), key=lambda x: -x[1]):
    pct = count / len(d['org_rows']) * 100
    print(f"  {k}: {count}/{len(d['org_rows'])} ({pct:.0f}% null)")

print(f"\n=== TOPICS ===")
print(f"  Total topics: {len(d['topic_rows'])}")
if d['topic_rows']:
    desc_null = sum(1 for t in d['topic_rows'] if not t.get('description'))
    print(f"  Topics with null description: {desc_null}/{len(d['topic_rows'])}")
    print("\n  Sample topics (first 10):")
    for t in d['topic_rows'][:10]:
        print(f"    - {t['name']}: {repr(t.get('description'))}")
