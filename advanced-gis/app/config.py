import os

PORT = 8085
JWT_SECRET = b"netcad_gis_crypto_key_2026_secure"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BASE_DIR)
# Merkezi veritabanı: Node backend'i ile paylaşılan tek gerçek kaynak (bkz. DATABASE.md).
DB_PATH = os.environ.get('DB_PATH', os.path.join(REPO_ROOT, 'data', 'app.db'))
SEED_PATH = os.path.join(REPO_ROOT, 'data', 'seed.json')
DISTRICTS_GEOJSON_PATH = os.path.join(BASE_DIR, 'data', 'raw', 'istanbul-districts.geojson')
