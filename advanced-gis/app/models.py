import sqlite3
import os
from app.config import DB_PATH

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    # Make sure data folder exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
    )
    """)

    # 2. Reservations Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        facility_id INTEGER NOT NULL,
        reserve_date TEXT NOT NULL,
        reserve_time TEXT NOT NULL,
        guests INTEGER NOT NULL,
        crypto_signature TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    """)

    # 3. Facilities Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS facilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kod TEXT UNIQUE NOT NULL,
        ad TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        capacity INTEGER NOT NULL,
        occupancy INTEGER NOT NULL,
        iett_info TEXT NOT NULL,
        transit_transfer TEXT NOT NULL,
        route_description TEXT NOT NULL
    )
    """)
    
    # Auto-seed default users if table is empty
    cursor.execute("SELECT COUNT(*) as count FROM users")
    if cursor.fetchone()["count"] == 0:
        from security.crypto_signer import hash_password
        cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ("user", hash_password("user"), "user"))
        cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ("admin", hash_password("admin"), "admin"))
    
    conn.commit()
    conn.close()

def get_facilities():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM facilities")
    rows = cursor.fetchall()
    conn.close()
    return rows

def get_facility_by_id(facility_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM facilities WHERE id = ?", (facility_id,))
    row = cursor.fetchone()
    conn.close()
    return row

def add_facility(code, name, lat, lng, capacity, occupancy, iett, transit, route):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO facilities (kod, ad, lat, lng, capacity, occupancy, iett_info, transit_transfer, route_description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (code, name, lat, lng, capacity, occupancy, iett, transit, route))
    conn.commit()
    conn.close()

def get_user_by_username(username):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    return row

def create_user(username, password_hash, role='user'):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", (username, password_hash, role))
    conn.commit()
    conn.close()

def create_reservation(user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check capacity constraints
        cursor.execute("SELECT capacity, occupancy FROM facilities WHERE id = ?", (facility_id,))
        row = cursor.fetchone()
        if not row:
            raise Exception("Tesis bulunamadı.")
        
        capacity = row["capacity"]
        occupancy = row["occupancy"]
        current_occupied = int(capacity * (occupancy / 100.0))
        
        if current_occupied + guests > capacity:
            raise Exception("Tesis kapasitesi yetersiz. Yer kalmadı.")
            
        new_occupied = current_occupied + guests
        new_occupancy = min(100, int((new_occupied / capacity) * 100))
        
        # Update facility occupancy
        cursor.execute("UPDATE facilities SET occupancy = ? WHERE id = ?", (new_occupancy, facility_id))
        
        # Insert reservation
        cursor.execute("""
            INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature))
        
        conn.commit()
        return True, new_occupancy
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def delete_facility(facility_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM facilities WHERE id = ?", (facility_id,))
    cursor.execute("DELETE FROM reservations WHERE facility_id = ?", (facility_id,))
    conn.commit()
    conn.close()

def get_reservations_by_user_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.*, f.ad as facility_name 
        FROM reservations r
        JOIN facilities f ON r.facility_id = f.id
        WHERE r.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return rows

