import os

PORT = 8085
JWT_SECRET = b"netcad_gis_crypto_key_2026_secure"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, 'data', 'database.db')
DISTRICTS_GEOJSON_PATH = os.path.join(BASE_DIR, 'data', 'raw', 'istanbul-districts.geojson')
