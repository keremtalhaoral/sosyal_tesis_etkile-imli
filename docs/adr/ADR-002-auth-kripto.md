# ADR-002: Kimlik Doğrulama & Kriptografi

- **Durum:** Kabul edildi
- **Faz / Dal:** `v2-02-auth-crypto`
- **Tarih:** 2026-07
- **Referans:** DDIA (güvenilirlik/maintainability), OWASP Password Storage Cheat Sheet
- **İlgili:** `docs/learning/kripto-defteri.md` (matematik anlatımı), `ADR-001`

## Bağlam

v1'de kimlik katmanı çalışıyordu ama üç ciddi kriptografik zayıflık vardı:
1. **Global sabit salt** → aynı parola herkeste aynı hash (rainbow-table + parola eşitliği sızıntısı).
2. **Hardcoded JWT secret** git'te → token sahteciliği (admin taklidi).
3. **Ham parolalar `seed.json`'da** → repoyu gören giriş yapar.
Ek olarak JWT'de **son kullanma yok**, Pages'te **gerçek kripto yok**.

Bu faz bunları kapatır. İki hedef: (a) üretim sertleştirmesi, (b) mentöre anlatılabilir
matematik (`kripto-defteri.md`).

---

## Karar 1 — Parola hash'i: PBKDF2 + **per-user rastgele salt**, PHC formatı

**Karar:** Her kullanıcıya 16 baytlık rastgele salt. Parola şu tek stringde saklanır:
```
pbkdf2_sha256$600000$<salt_b64>$<hash_b64>
```
(Django'nun da kullandığı PHC formatı.) Node (`backend/database.js`) ve Python
(`crypto_signer.py`) **aynı formatı üretip doğrular** — çapraz-dil uyumu testlerle kanıtlı.

**Neden:** Per-user salt, "aynı parola → aynı hash" problemini yok eder; önceden hesaplanmış
rainbow-table saldırısını işe yaramaz kılar. Salt'ı ayrı kolon yerine hash string'ine gömmek
(PHC) şema değişikliği gerektirmez ve algoritma/iterasyon bilgisini de taşır → ileride
parametreler değişse bile eski hash'ler doğrulanabilir (kademeli geçiş).

**Alternatif:** scrypt/Argon2id GPU saldırısına daha dirençli (bellek-sert). PBKDF2'yi seçtik
çünkü (1) en kolay **anlatılabilir** ("iterasyonlu HMAC" — kullanıcı mentöre bunu açıklayacak),
(2) Node+Python'da sıfır bağımlılıkla yerleşik, (3) OWASP hâlâ 600k iterasyonla kabul ediyor.
`kripto-defteri.md` scrypt/Argon2'yi "sonraki adım" olarak anlatır.

**İterasyon = 600.000:** OWASP 2023 önerisi (SHA-256). Key stretching: her deneme
600k HMAC turu gerektirir → çevrimdışı kaba-kuvvet saldırısı ekonomik olmaktan çıkar.

## Karar 2 — JWT secret ortam değişkeninden, üretimde fail-safe

**Karar:** `JWT_SECRET` env'den okunur. `NODE_ENV=production`/`ENV=production` iken yoksa
servis **gürültülü hata** ile açılmaz. Geliştirmede açıkça `DEV-ONLY-...` etiketli sabit +
uyarı. `.env.example` değişkenleri belgeler; `.env` gitignored.

**Neden:** Secret'ın kaynak kodda (ve git geçmişinde) durması, gören herkese token sahteciliği
imkânı verir (açık #2). Env'e taşımak endüstri standardıdır. Fail-safe, "prod'a sırsız
çıkma" hatasını imkânsız kılar (yine "geçersiz durumu imkansız kıl").

**Trade-off:** Dev fallback sabiti hâlâ kodda; ama (1) override edilebilir, (2) prod'da ölür,
(3) açıkça "insecure" etiketli. Zero-dependency hedefi için dotenv eklemedik; değişkenler
elle export edilir ya da `.env` bir başlatıcıyla yüklenir.

## Karar 3 — JWT'ye `iat` + `exp`, doğrulamada süre kontrolü

**Karar:** Token'a veriliş (`iat`) ve son kullanma (`exp` = +8 saat) eklenir; `verify_jwt`
süresi geçmiş token'ı reddeder.

**Neden:** Süresiz token çalınırsa sonsuza dek geçerlidir ve iptal edilemez. `exp` ile hasar
penceresi sınırlanır. HS256 (simetrik) korunur — tek servis için doğru; **RS256 (asimetrik)
bu ölçekte gereksiz** (bkz. kripto-defteri, "ölçek-uygun tasarım": çok taraflı doğrulama
ihtiyacı yokken açık/özel anahtar karmaşıklığı eklemeyiz).

## Karar 4 — Ham parola yok; **gerçekçi rastgele** üretim + gitignored dosya

**Karar:** `seed.json` artık `password_raw` tutmaz (sadece `username`+`role`). Seeder ilk
tohumlamada güçlü rastgele parola üretir, açık metni **gitignored** `data/dev-credentials.json`'a
yazar, DB'ye yalnızca hash'i koyar. Node ve Python **aynı** credentials dosyasını paylaşır.

**Neden:** Kullanıcı tercihi (gerçekçi rastgele + belgeli). Sonuç: git'te ham parola yok,
ama geliştirici yerel dosyadan giriş yapabilir. Parolalar restart'lar arası kalıcı
(dosyada), silinirse yeniden üretilir (app.db de silinmeli).

## Karar 5 — Pages (demo) ayrı, açıkça etiketli demo hesaplar

**Karar:** GitHub Pages replikası `seed.demo_users`'tan beslenir (`demo`/`demo-admin`,
parola `demo1234`). Gerçek backend kullanıcıları/parolaları public yüzeye **hiç** çıkmaz.

**Neden:** Pages sunucusuz bir demo; orada gerçek kripto çalıştırmak (Web Crypto) mümkün ama
gereksiz iş. Asıl güvenlik dersi: **demo/public yüzey, üretim sırlarını taşımaz.** Demo
parolası açıkça throwaway. (Web Crypto ile gerçek in-browser PBKDF2 ileride opsiyonel.)

---

## Bilinen borç / sonraki adımlar

- **Brute-force/rate-limiting yok:** login denemeleri sınırsız. Ayrı faz konusu (throttling,
  hesap kilitleme).
- **Salt başına parola değil, sabit dev secret:** dev'de secret sabit; prod'da env zorunlu.
- **Argon2id'ye geçiş:** daha güçlü; bağımlılık kabul edilirse yükseltilebilir (format zaten
  `algo$...` olduğu için `argon2$...` eklemek kademeli geçişe uygun).
- **Token iptali (revocation):** `exp` var ama erken iptal (blocklist) yok; kısa TTL bunu
  telafi ediyor.
