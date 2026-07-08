import hashlib
import hmac
import base64
import json
import os
import time
from app.config import JWT_SECRET

# Parola hash'i - PHC string formati (Node database.js ile CAPRAZ-UYUMLU):
#   pbkdf2_sha256$<iterasyon>$<salt_b64>$<hash_b64>
# Her kullaniciya AYRI rastgele salt (ADR-002 Karar 1). Django ile ayni bicim.
PBKDF2_ITERATIONS = 600000
PBKDF2_KEYLEN = 32

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode('utf-8'),
        base64.b64encode(dk).decode('utf-8'),
    )

def verify_password(password: str, stored: str) -> bool:
    """Sabit-zamanli parola dogrulama. Node'un urettigi PHC stringini de dogrular."""
    try:
        algo, iterations, salt_b64, hash_b64 = stored.split('$')
        if algo != 'pbkdf2_sha256':
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, int(iterations), len(expected))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False

def base64url_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).replace(b'=', b'').decode('utf-8')

def base64url_decode(s: str) -> bytes:
    padding = '=' * (4 - (len(s) % 4))
    return base64.urlsafe_b64decode(s + padding)

TOKEN_TTL_SECONDS = 60 * 60 * 8  # 8 saat

def sign_jwt(user_data: dict) -> str:
    now = int(time.time())
    # iat/exp eklenir: calinan token sonsuza dek gecerli olmasin (ADR-002 Karar 3).
    claims = dict(user_data)
    claims["iat"] = now
    claims["exp"] = now + TOKEN_TTL_SECONDS
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64url_encode(json.dumps(header).encode('utf-8'))
    payload_b64 = base64url_encode(json.dumps(claims).encode('utf-8'))

    msg = f"{header_b64}.{payload_b64}".encode('utf-8')
    sig = hmac.new(JWT_SECRET, msg, hashlib.sha256).digest()
    sig_b64 = base64url_encode(sig)

    return f"{header_b64}.{payload_b64}.{sig_b64}"

def verify_jwt(token: str) -> dict:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        msg = f"{header_b64}.{payload_b64}".encode('utf-8')
        expected_sig = hmac.new(JWT_SECRET, msg, hashlib.sha256).digest()
        expected_sig_b64 = base64url_encode(expected_sig)

        if not hmac.compare_digest(sig_b64, expected_sig_b64):
            return None

        claims = json.loads(base64url_decode(payload_b64).decode('utf-8'))
        if claims.get("exp") and int(time.time()) >= claims["exp"]:
            return None  # suresi gecmis
        return claims
    except Exception:
        return None

def sign_reservation(user_id, fac_id, r_date, r_time, guests) -> str:
    reserve_payload = f"{user_id}:{fac_id}:{r_date}:{r_time}:{guests}"
    return hmac.new(JWT_SECRET, reserve_payload.encode('utf-8'), hashlib.sha256).hexdigest()
