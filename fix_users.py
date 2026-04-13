"""
Fix users: Convert doctor's users.csv to match schema format,
replace app_user.csv, and regenerate projects.
"""
import csv
import random
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Read doctor's users.csv (has age column, we skip it)
with open(os.path.join(BASE_DIR, 'users.csv'), 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    users = []
    for row in reader:
        users.append({
            'email': row['email'],
            'username': row['username'],
            'gender': row['gender'],
            'birthdate': row['birthdate'],
            'country': row['country']
        })

print(f"Loaded {len(users)} users from doctor's users.csv")

# Write to app_user.csv (schema format: no age)
with open(os.path.join(BASE_DIR, 'csv_exports', 'app_user.csv'), 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['email', 'username', 'gender', 'birthdate', 'country'])
    writer.writeheader()
    writer.writerows(users)

print(f"Replaced csv_exports/app_user.csv with {len(users)} users")

# Generate projects for new users (2-4 projects per user)
project_types = ['analytics', 'machine_learning', 'field_research']
projects = []
for user in users:
    num_projects = random.randint(2, 4)
    for i in range(1, num_projects + 1):
        projects.append({
            'email': user['email'],
            'project_name': f"Project_{i}",
            'project_type': random.choice(project_types)
        })

# Write to project.csv
with open(os.path.join(BASE_DIR, 'csv_exports', 'project.csv'), 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['email', 'project_name', 'project_type'])
    writer.writeheader()
    writer.writerows(projects)

print(f"Regenerated csv_exports/project.csv with {len(projects)} projects")
print("Done! Now run populate_db.py to update the database.")
