import hashlib
import hmac
import base64
import json
from app.config import JWT_SECRET

# Deterministic salt for simplicity, or project standard
SALT = b"mufettis_salt_value_2026"

def hash_password(password: str) -> str:
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), SALT, 100000)
    return pwd_hash.hex()

def base64url_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).replace(b'=', b'').decode('utf-8')

def base64url_decode(s: str) -> bytes:
    padding = '=' * (4 - (len(s) % 4))
    return base64.urlsafe_b64decode(s + padding)

def sign_jwt(user_data: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64url_encode(json.dumps(header).encode('utf-8'))
    payload_b64 = base64url_encode(json.dumps(user_data).encode('utf-8'))
    
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
            
        return json.loads(base64url_decode(payload_b64).decode('utf-8'))
    except Exception:
        return None

def sign_reservation(user_id, fac_id, r_date, r_time, guests) -> str:
    reserve_payload = f"{user_id}:{fac_id}:{r_date}:{r_time}:{guests}"
    return hmac.new(JWT_SECRET, reserve_payload.encode('utf-8'), hashlib.sha256).hexdigest()
