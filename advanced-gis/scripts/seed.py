import os
import sys
import json

# Setup sys.path to find app and security modules
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from app.models import init_db, get_db_connection
from security.crypto_signer import hash_password

def run_seed():
    print("Initializing SQLite Database schemas...")
    init_db()
    
    dataset_path = os.path.join(BASE_DIR, 'evaluation', 'golden_dataset.json')
    if not os.path.exists(dataset_path):
        print(f"Error: Golden dataset not found at {dataset_path}")
        return

    with open(dataset_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Seed users
    print("Seeding baseline users...")
    for u in data.get("users", []):
        hashed_pass = hash_password(u["password_raw"])
        cursor.execute("""
            INSERT OR IGNORE INTO users (username, password, role)
            VALUES (?, ?, ?)
        """, (u["username"], hashed_pass, u["role"]))

    # Seed facilities
    print("Seeding baseline facilities...")
    for f in data.get("facilities", []):
        cursor.execute("""
            INSERT OR IGNORE INTO facilities (kod, ad, lat, lng, capacity, occupancy, iett_info, transit_transfer, route_description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (f["kod"], f["ad"], f["lat"], f["lng"], f["capacity"], f["occupancy"], f["iett_info"], f["transit_transfer"], f["route_description"]))

    conn.commit()
    conn.close()
    print("Database seeding completed successfully.")

if __name__ == '__main__':
    run_seed()
