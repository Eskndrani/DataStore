import json

with open('raw_datasets.json', encoding='utf-8') as f:
    data = json.load(f)

# Find all unique groups (official data.gov topics)
groups = {}
for ds in data:
    for g in ds.get('groups', []):
        name = g.get('name', '')
        title = g.get('title', '')
        desc = g.get('description', '')
        if name:
            if name not in groups:
                groups[name] = {'title': title, 'description': desc, 'count': 0}
            groups[name]['count'] += 1

print(f'Total unique groups: {len(groups)}')
print('\nData.gov official topics (groups):')
for name, info in sorted(groups.items(), key=lambda x: -x[1]['count']):
    print(f'\n  {name}')
    print(f'    Title: {info["title"]}')
    print(f'    Description: {info["description"][:100] if info["description"] else "None"}...')
    print(f'    Datasets: {info["count"]}')
