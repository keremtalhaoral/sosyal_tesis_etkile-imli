import os
import sys

PORT = 8085

# JWT secret ortam degiskeninden gelir. Uretimde (ENV=production) yoksa gurultulu hata;
# gelistirmede acikca 'DEV-ONLY' etiketli sabit (ADR-002 Karar 2). Node security.js ile ayni deger.
_DEV_SECRET = "DEV-ONLY-INSECURE-SECRET-do-not-use-in-production"
if os.environ.get("JWT_SECRET"):
    JWT_SECRET = os.environ["JWT_SECRET"].encode("utf-8")
elif os.environ.get("ENV") == "production":
    raise RuntimeError("JWT_SECRET ortam degiskeni uretimde zorunludur (guvenlik).")
else:
    print("[config] JWT_SECRET set edilmemis - DEV-ONLY sabit kullaniliyor. Uretimde ASLA.", file=sys.stderr)
    JWT_SECRET = _DEV_SECRET.encode("utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BASE_DIR)
# Merkezi veritabanı: Node backend'i ile paylaşılan tek gerçek kaynak (bkz. DATABASE.md).
DB_PATH = os.environ.get('DB_PATH', os.path.join(REPO_ROOT, 'data', 'app.db'))
SEED_PATH = os.path.join(REPO_ROOT, 'data', 'seed.json')
