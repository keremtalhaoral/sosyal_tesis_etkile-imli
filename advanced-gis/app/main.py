#!/usr/bin/env python3
import http.server
import socketserver
import json
import urllib.parse
import sys
import os

# Setup sys.path to find packages correctly
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from app.config import PORT
from app.models import init_db, get_facilities, get_facility_by_id, add_facility, get_user_by_username, create_user, create_reservation, get_reservations_by_user_id
from security.crypto_signer import hash_password, sign_jwt, verify_jwt, sign_reservation
from services.scraper import scrape_menu
from services.weather import get_live_weather
from observability.tracer import log_request

class GISRequestHandler(http.server.BaseHTTPRequestHandler):
    
    def end_headers(self):
        # Enable CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def get_auth_user(self):
        auth_header = self.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
        token = auth_header.split(' ')[1]
        return verify_jwt(token)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        # 1. API: List Facilities
        if path == '/api/facilities':
            log_request("GET", path, 200, self.client_address[0])
            rows = get_facilities()
            facilities = []
            for r in rows:
                facilities.append({
                    "id": r["id"],
                    "kod": r["kod"],
                    "ad": r["ad"],
                    "koordinatlar": [r["lat"], r["lng"]],
                    "kapasite": r["capacity"],
                    "dolulukOrani": r["occupancy"],
                    "transit": {
                        "otobus": r["iett_info"],
                        "vapur": "Deniz Hattı" if "sahil" in r["ad"].lower() else None,
                        "aktarma": r["transit_transfer"],
                        "arabayla": r["route_description"]
                    }
                })
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(facilities).encode('utf-8'))
            return

        # 2. API: Fetch Menu Scraper
        elif path == '/api/menu':
            log_request("GET", path, 200, self.client_address[0])
            fac_id = query_params.get('facilityId', ['0'])[0]
            menu = scrape_menu(int(fac_id))
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(menu).encode('utf-8'))
            return

        # 3. API: Fetch weather (Proxy with Simulated climate fallbacks)
        elif path == '/api/weather':
            lat = query_params.get('lat', [''])[0]
            lng = query_params.get('lng', [''])[0]
            if not lat or not lng:
                log_request("GET", path, 400, self.client_address[0])
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing coordinates: lat and lng."}).encode('utf-8'))
                return
            
            log_request("GET", path, 200, self.client_address[0])
            weather = get_live_weather(lat, lng)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(weather).encode('utf-8'))
            return

        # 4. API: Get reservations (JWT Authenticated)
        elif path == '/api/reservations':
            user = self.get_auth_user()
            if not user:
                log_request("GET", path, 401, self.client_address[0])
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Kimlik doğrulama başarısız."}).encode('utf-8'))
                return

            log_request("GET", path, 200, self.client_address[0])
            rows = get_reservations_by_user_id(user["id"])
            res_list = []
            for r in rows:
                res_list.append({
                    "id": r["id"],
                    "facility_name": r["facility_name"],
                    "reserve_date": r["reserve_date"],
                    "reserve_time": r["reserve_time"],
                    "guests": r["guests"],
                    "crypto_signature": r["crypto_signature"]
                })

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(res_list).encode('utf-8'))
            return

        log_request("GET", path, 404, self.client_address[0])
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        body = {}
        if post_data:
            try:
                body = json.loads(post_data.decode('utf-8'))
            except Exception:
                pass

        # 1. API: Register
        if path == '/api/register':
            username = body.get('username')
            password = body.get('password')

            if not username or not password:
                log_request("POST", path, 400, self.client_address[0])
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Kullanıcı adı ve şifre gereklidir."}).encode('utf-8'))
                return

            hashed = hash_password(password)
            try:
                create_user(username, hashed, 'user')
                log_request("POST", path, 200, self.client_address[0])
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"message": "Kayıt başarıyla oluşturuldu."}).encode('utf-8'))
            except Exception:
                log_request("POST", path, 409, self.client_address[0])
                self.send_response(409)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Kullanıcı adı zaten mevcut."}).encode('utf-8'))
            return

        # 2. API: Login
        elif path == '/api/login':
            username = body.get('username')
            password = body.get('password')

            user = get_user_by_username(username)
            if user and user["password"] == hash_password(password):
                user_payload = {"id": user["id"], "username": user["username"], "role": user["role"]}
                token = sign_jwt(user_payload)
                
                log_request("POST", path, 200, self.client_address[0])
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"token": token, "user": user_payload}).encode('utf-8'))
            else:
                log_request("POST", path, 401, self.client_address[0])
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Kullanıcı adı veya şifre hatalı."}).encode('utf-8'))
            return

        # 3. API: Masa Rezervasyonu (JWT Authenticated & Signed Reservations)
        elif path == '/api/reserve':
            user = self.get_auth_user()
            if not user:
                log_request("POST", path, 401, self.client_address[0])
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Kimlik doğrulama başarısız."}).encode('utf-8'))
                return

            fac_id = body.get('facilityId')
            r_date = body.get('reserveDate')
            r_time = body.get('reserveTime')
            guests = body.get('guests')

            if not fac_id or not r_date or not r_time or not guests:
                log_request("POST", path, 400, self.client_address[0])
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Parametreler eksik."}).encode('utf-8'))
                return

            crypto_signature = sign_reservation(user['id'], fac_id, r_date, r_time, guests)
            create_reservation(user['id'], fac_id, r_date, r_time, guests, crypto_signature)

            log_request("POST", path, 200, self.client_address[0])
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "message": "Rezervasyon başarıyla oluşturuldu.",
                "signature": crypto_signature
            }).encode('utf-8'))
            return

        # 4. API: Admin Add Facility (JWT Authenticated, Admin role check)
        elif path == '/api/facilities':
            user = self.get_auth_user()
            if not user or user.get('role') != 'admin':
                log_request("POST", path, 403, self.client_address[0])
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Erişim engellendi: Yönetici yetkisi gereklidir."}).encode('utf-8'))
                return

            name = body.get('ad')
            lat = body.get('lat')
            lng = body.get('lng')
            capacity = body.get('capacity')
            occupancy = body.get('occupancy')
            iett = body.get('iett_info')
            transit = body.get('transit_transfer')
            route = body.get('route_description')

            if not name or lat is None or lng is None:
                log_request("POST", path, 400, self.client_address[0])
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Eksik parametreler."}).encode('utf-8'))
                return

            try:
                # Retrieve all facilities to find next sequential code (ALTY-XX)
                all_facs = get_facilities()
                next_id = max([f['id'] for f in all_facs]) + 1 if all_facs else 1
                code = f"ALTY-{str(next_id).padStart(2, '0')}" if hasattr(str, 'padStart') else f"ALTY-{str(next_id).zfill(2)}"
                
                add_facility(code, name, float(lat), float(lng), int(capacity), int(occupancy), iett, transit, route)
                
                log_request("POST", path, 200, self.client_address[0])
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"message": "Tesis başarıyla eklendi.", "kod": code}).encode('utf-8'))
            except Exception as e:
                log_request("POST", path, 409, self.client_address[0])
                self.send_response(409)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Veritabanı hatası: {str(e)}"}).encode('utf-8'))
            return

        log_request("POST", path, 404, self.client_address[0])
        self.send_response(404)
        self.end_headers()

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    pass

if __name__ == '__main__':
    # Auto-initialize SQLite database on startup
    init_db()
    
    print(f"Starting Python 9-Layer GIS Server on port {PORT}...")
    with ThreadingHTTPServer(('0.0.0.0', PORT), GISRequestHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down GIS server.")
            sys.exit(0)
