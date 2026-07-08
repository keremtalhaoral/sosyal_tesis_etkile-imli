import os
import sys
import json
import base64
import secrets
from datetime import datetime, timezone

# Setup sys.path to find app and security modules
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from app.config import SEED_PATH, DB_PATH
from app.models import init_db, get_db_connection
from security.crypto_signer import hash_password

# Dev parolalari DB dosyasinin yaninda yasar (gitignored). Node database.js ile AYNI dosya:
# hangi servis once tohumlarsa parolayi uretir, digeri ayni acik metni okur.
CREDENTIALS_PATH = os.path.join(os.path.dirname(DB_PATH), "dev-credentials.json")

def _generate_password():
    return base64.urlsafe_b64encode(secrets.token_bytes(12)).decode("utf-8").rstrip("=")

def load_or_create_credentials(users):
    store = {"_comment": "YEREL dev parolalari - git'e girmez. Silerseniz app.db'yi de silip yeniden tohumlayin.", "users": {}}
    if os.path.exists(CREDENTIALS_PATH):
        try:
            with open(CREDENTIALS_PATH, "r", encoding="utf-8") as f:
                store = json.load(f)
                store["users"] = store.get("users", {})
        except Exception:
            pass
    changed = False
    for u in users:
        if not store["users"].get(u["username"]):
            store["users"][u["username"]] = _generate_password()
            changed = True
    if changed:
        store["generated_at"] = datetime.now(timezone.utc).isoformat()
        with open(CREDENTIALS_PATH, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False, indent=2)
        print(f"[seed] Dev parolalari uretildi/guncellendi: {CREDENTIALS_PATH}")
    return store["users"]

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
    seed_users = data.get("users", [])
    credentials = load_or_create_credentials(seed_users)  # ham parola seed'de yok (ADR-002 Karar 4)
    for u in seed_users:
        cursor.execute("""
            INSERT OR IGNORE INTO users (username, password, role)
            VALUES (?, ?, ?)
        """, (u["username"], hash_password(credentials[u["username"]]), u["role"]))

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

    # Menu: tek sablon her tesise uygulanir (DRY). UNIQUE(facility_id, name) + IGNORE = idempotent.
    menu_template = data.get("menu_template", [])
    if menu_template:
        print("Seeding menu items (template applied per facility)...")
        facility_ids = [row["id"] for row in cursor.execute("SELECT id FROM facilities")]
        for fid in facility_ids:
            for m in menu_template:
                cursor.execute("""
                    INSERT OR IGNORE INTO menu_items (facility_id, name, category, price_minor)
                    VALUES (?, ?, ?, ?)
                """, (fid, m["name"], m.get("category", "Genel"), m["price_minor"]))

    # İSPARK kapasitesi: tesis kapasitesine orantili (Node database.js ile ayni mantik).
    ispark_cfg = data.get("ispark", {"capacity_divisor": 5, "min_capacity": 10})
    print("Seeding İSPARK capacities...")
    for row in cursor.execute("SELECT id, capacity FROM facilities").fetchall():
        park_cap = max(ispark_cfg["min_capacity"], round(row["capacity"] / ispark_cfg["capacity_divisor"]))
        cursor.execute(
            "INSERT OR IGNORE INTO ispark_status (facility_id, capacity, occupied) VALUES (?, ?, 0)",
            (row["id"], park_cap),
        )

    conn.commit()
    conn.close()
    print("Central database seeding completed successfully.")

if __name__ == '__main__':
    run_seed()
