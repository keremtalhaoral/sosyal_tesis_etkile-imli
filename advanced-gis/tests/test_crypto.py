import unittest
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from security.crypto_signer import hash_password, verify_password, sign_jwt, verify_jwt, sign_reservation

class TestCryptographicSignatures(unittest.TestCase):

    def test_password_hashing(self):
        # Faz v2-02: per-user salt sonrasi ayni parola FARKLI hash uretir (rainbow-table savunmasi).
        p1 = "mypassword123"
        h1 = hash_password(p1)
        h2 = hash_password(p1)
        self.assertNotEqual(h1, h2)              # Farkli salt -> farkli hash
        self.assertNotEqual(p1, h1)              # Ham parola degil
        self.assertTrue(h1.startswith("pbkdf2_sha256$"))  # PHC formati
        # Ikisi de dogru parolayla dogrulanir, yanlisla reddedilir
        self.assertTrue(verify_password(p1, h1))
        self.assertTrue(verify_password(p1, h2))
        self.assertFalse(verify_password("yanlis", h1))

    def test_jwt_session_auth(self):
        user_payload = {"id": 42, "username": "testuser", "role": "user"}
        token = sign_jwt(user_payload)
        
        # Verify correct token resolves payload
        resolved = verify_jwt(token)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["username"], "testuser")
        self.assertEqual(resolved["role"], "user")

        # Verify tampered token fails
        tampered_token = token[:-5] + "ABCDE"
        failed_resolve = verify_jwt(tampered_token)
        self.assertIsNone(failed_resolve)

    def test_reservation_integrity_signature(self):
        user_id = 5
        fac_id = 3
        r_date = "2026-06-27"
        r_time = "19:00"
        guests = 4
        
        sig1 = sign_reservation(user_id, fac_id, r_date, r_time, guests)
        sig2 = sign_reservation(user_id, fac_id, r_date, r_time, guests)
        self.assertEqual(sig1, sig2)

        # Tampered parameter changes signature
        sig_tampered = sign_reservation(user_id, fac_id, r_date, r_time, 5) # Changed guest count to 5
        self.assertNotEqual(sig1, sig_tampered)

if __name__ == '__main__':
    unittest.main()
