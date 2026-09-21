import os
import sys
import json

# Setup sys.path to find app and security modules
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from app.config import SEED_PATH
from app.models import init_db, get_db_connection
from security.crypto_signer import hash_password

def run_seed():
    """Merkezi veritabanini (data/app.db) kanonik seed'den (data/seed.json) tohumlar.

    INSERT OR IGNORE ile idempotenttir: tekrar calistirmak mevcut veriyi bozmaz.
    Ayni seed dosyasini Node backend'i de kullanir - tek gercek kaynak.
    """
    print("Initializing central SQLite database schema...")
    init_db()

    if not os.path.exists(SEED_PATH):
        print(f"Error: Canonical seed not found at {SEED_PATH}")
        return

    with open(SEED_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    conn = get_db_connection()
    cursor = conn.cursor()

    print("Seeding baseline users...")
    for u in data.get("users", []):
        cursor.execute("""
            INSERT OR IGNORE INTO users (username, password, role)
            VALUES (?, ?, ?)
        """, (u["username"], hash_password(u["password_raw"]), u["role"]))

    print("Seeding districts (TUIK demographics)...")
    for d in data.get("districts", []):
        cursor.execute("""
            INSERT OR IGNORE INTO districts (name, population)
            VALUES (?, ?)
        """, (d["name"], d["population"]))

    print("Seeding baseline facilities...")
    for fac in data.get("facilities", []):
        cursor.execute("""
            INSERT OR IGNORE INTO facilities
                (id, kod, ad, adres, lat, lng, capacity, occupancy, iett_info, vapur_info, transit_transfer, route_description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            fac.get("id"), fac["kod"], fac["ad"], fac.get("adres"),
            fac["lat"], fac["lng"], fac["capacity"], fac["occupancy"],
            fac.get("iett_info", "Mevcut Değil"), fac.get("vapur_info", "Mevcut Değil"),
            fac.get("transit_transfer", "Mevcut Değil"), fac.get("route_description", "Mevcut Değil")
        ))

    conn.commit()
    conn.close()
    print("Central database seeding completed successfully.")

if __name__ == '__main__':
    run_seed()
