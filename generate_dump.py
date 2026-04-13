"""
Generate clean SQL dump matching schema.sql style
"""
import mysql.connector
import csv
import os

DB_CONFIG = {
    "host": "localhost",
    "user": "your_username",  # <-- Replace with your MySQL username
    "password": "your_password",  # <-- Replace with your MySQL password
    "database": "datagov_db",
    "charset": "utf8mb4"
}

OUTPUT_FILE = "datagov_db_dump.sql"

# Connect to database
conn = mysql.connector.connect(**DB_CONFIG)
cursor = conn.cursor()

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    # Header
    f.write("-- =============================================================\n")
    f.write("-- Data.gov Dataset Database - Full Dump\n")
    f.write("-- Database: datagov_db\n")
    f.write("-- Generated from populated database\n")
    f.write("-- Course: CSCE 2501 - Fundamentals of Database Systems\n")
    f.write("-- =============================================================\n\n")
    
    f.write("DROP DATABASE IF EXISTS datagov_db;\n")
    f.write("CREATE DATABASE datagov_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n")
    f.write("USE datagov_db;\n\n")
    
    # Get all tables
    cursor.execute("SHOW TABLES")
    tables = [t[0] for t in cursor.fetchall()]
    
    # Skip these old/incorrect tables
    skip_tables = {'dataset_usage', 'org_contact'}
    
    for table in tables:
        if table in skip_tables:
            continue
        # Get CREATE TABLE statement
        cursor.execute(f"SHOW CREATE TABLE {table}")
        create_stmt = cursor.fetchone()[1]
        
        # Clean up the CREATE statement - remove ENGINE and other MySQL-specific stuff
        # Split into lines and filter
        lines = create_stmt.split('\n')
        cleaned_lines = []
        for line in lines:
            line = line.rstrip()
            if not line:
                continue
            # Skip ENGINE, CHARSET, COLLATE lines but KEEP the closing )
            if 'ENGINE=' in line:
                # This line has ENGINE, but might also have closing )
                if line.strip().startswith(')'):
                    cleaned_lines.append(')')
                continue
            if 'DEFAULT CHARSET' in line or 'COLLATE=' in line:
                continue
            # Remove character set from column definitions
            if 'CHARACTER SET' in line:
                line = line.split('CHARACTER SET')[0].strip()
                if line.endswith(','):
                    line = line[:-1]
            # Remove COLLATE from column definitions
            if 'COLLATE ' in line and 'CONSTRAINT' not in line and 'PRIMARY KEY' not in line and 'UNIQUE' not in line and 'FOREIGN KEY' not in line:
                # Remove COLLATE clause
                import re
                line = re.sub(r'COLLATE\s+\w+', '', line).strip()
                # Fix double spaces
                line = re.sub(r'\s+', ' ', line)
            cleaned_lines.append(line)
        
        # Make sure we have a closing paren
        if cleaned_lines and not cleaned_lines[-1].strip() == ')':
            # Check if last line ends with )
            last_line = cleaned_lines[-1].strip()
            if not last_line.endswith(')'):
                # Need to add closing paren - check if there's one somewhere
                has_close_paren = any(l.strip() == ')' for l in cleaned_lines)
                if not has_close_paren:
                    cleaned_lines.append(')')
        
        # Rebuild CREATE TABLE
        create_clean = '\n'.join(cleaned_lines)
        # Remove any trailing commas before closing paren
        create_clean = create_clean.replace(',\n)', '\n)')
        
        f.write(f"-- Table: {table}\n")
        f.write(create_clean + ";\n\n")
        
        # Get data
        cursor.execute(f"SELECT * FROM {table}")
        rows = cursor.fetchall()
        
        if rows:
            # Get column names
            cursor.execute(f"SHOW COLUMNS FROM {table}")
            columns = [c[0] for c in cursor.fetchall()]
            col_str = ', '.join(f'`{c}`' for c in columns)
            
            f.write(f"-- Data for {table}\n")
            
            # Write INSERT statements (batch in groups of 100)
            batch_size = 100
            for i in range(0, len(rows), batch_size):
                batch = rows[i:i+batch_size]
                values_list = []
                for row in batch:
                    vals = []
                    for val in row:
                        if val is None:
                            vals.append('NULL')
                        elif isinstance(val, str):
                            # Escape single quotes
                            val_escaped = val.replace("'", "''")
                            vals.append(f"'{val_escaped}'")
                        elif hasattr(val, 'isoformat'):  # Date/Datetime objects
                            vals.append(f"'{val.isoformat()}'")
                        else:
                            vals.append(str(val))
                    values_list.append(f"({', '.join(vals)})")
                
                f.write(f"INSERT INTO `{table}` ({col_str}) VALUES\n")
                f.write(',\n'.join(values_list) + ";\n")
            
            f.write(f"\n-- {len(rows)} rows in {table}\n\n")
    
    f.write("-- =============================================================\n")
    f.write("-- End of dump\n")
    f.write("-- =============================================================\n")

cursor.close()
conn.close()

print(f"Clean SQL dump created: {OUTPUT_FILE}")
print("Style matches schema.sql - no ENGINE=InnoDB, no weird comments")
