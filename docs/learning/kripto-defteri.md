# Kriptografi Öğrenme Defteri (Mentör Anlatımı)

> Bu defter, projedeki kripto kararlarının **arkasındaki matematiği** anlatmak için. Amaç:
> "kütüphane çağırdım" değil, **ne olduğunu bilerek** açıklayabilmek. Her başlıkta önce sezgi,
> sonra matematik, sonra projedeki kod karşılığı var. Referans: `backend/security.js`,
> `backend/database.js`, `advanced-gis/security/crypto_signer.py`.

---

## 0. Büyük resim: neyi neden yapıyoruz?

Üç ayrı problem, üç ayrı araç:

| Problem | Araç | Bizde |
|---|---|---|
| Parolayı saklamak (ama okuyamamak) | **Hash + salt + key stretching** (PBKDF2) | `users.password` |
| "Bu token'ı gerçekten ben mi verdim?" | **HMAC imza** (JWT) | `signJwt`/`verifyJwt` |
| "Bu rezervasyonu kimse değiştirmedi mi?" | **HMAC imza** | `signReservation` |

Ortak fikir: **tek yönlü fonksiyonlar** — hesaplaması kolay, tersi pratikte imkânsız.

---

## 1. Hash fonksiyonu ve tek yönlülük

**Sezgi:** Hash, her girdiyi sabit uzunlukta bir "parmak izine" çeviren fonksiyondur
(SHA-256 → 256 bit). İyi bir kriptografik hash:
- **Deterministik**: aynı girdi → aynı çıktı.
- **Tek yönlü (preimage direnci)**: çıktıdan girdiyi bulmak pratikte imkânsız.
- **Çakışma direnci**: iki farklı girdinin aynı çıktıyı vermesi pratikte imkânsız.

**Matematik — neden "pratikte imkânsız"?** 256 bitlik çıktı uzayı $2^{256}$ elemanlıdır. Kaba
kuvvetle preimage aramak ortalama $2^{255}$ deneme ister — evrenin yaşı kadar zaman. Bu
**hesaplamalı zorluk** (computational hardness); matematiksel imkânsızlık değil, ekonomik
imkânsızlık.

**Çakışmalar ve güvercin yuvası (pigeonhole):** Girdi uzayı sonsuz, çıktı uzayı $2^{256}$
sonlu → çakışmalar **matematiksel olarak vardır**. Ama onları *bulmak* zordur. **Doğum günü
paradoksu**: $2^{256}$ çıktıda çakışma bulmak için kabaca $2^{128}$ deneme yeter (karekök) —
yine de astronomik. (Bu yüzden 256 bit seçilir: 128-bit güvenlik marjı.)

---

## 2. Salt: neden aynı parola aynı hash olmamalı

**Problem:** Sadece `hash(parola)` saklarsak:
1. Aynı parolayı kullanan iki kullanıcı **aynı hash**'i alır → "bu ikisi aynı parolayı
   kullanıyor" sızar.
2. Saldırgan önceden `hash(yaygın_parola)` tablosu (**rainbow table**) hazırlar, DB'yi çalınca
   anında eşleştirir.

**Çözüm — salt:** Her kullanıcıya rastgele bir `salt` üretir, `hash(salt + parola)` saklarız.
Salt gizli değil (hash'le birlikte durur), ama **her kullanıcıda farklı** olduğu için:
- Aynı parola → farklı salt → **farklı hash** (problem 1 çözülür).
- Rainbow table işe yaramaz: saldırganın her salt için tabloyu **yeniden** hesaplaması gerekir
  (problem 2 çözülür).

**Projede kanıt:** `test-db.js` → "aynı parola farklı hash (salt çalışıyor)". İki kullanıcıya
`AyniParola123` verdik, `users.password` değerleri **farklı** çıktı.

---

## 3. Key stretching: PBKDF2 = iterasyonlu HMAC

**Problem:** SHA-256 çok hızlıdır — saldırgan saniyede milyarlarca parola deneyebilir.

**Çözüm — kasıtlı yavaşlatma:** Hash'i **çok kez** (600.000 kez) tekrarla. Meşru kullanıcı
girişte bunu bir kez öder (~yüz milisaniye); saldırgan **her deneme** için öder → kaba kuvvet
600.000 kat pahalılaşır. Buna **key stretching** denir.

**PBKDF2 formülü (sezgi):** PBKDF2, HMAC'i $c$ kez zincirleme uygular:
$$U_1 = \text{HMAC}(\text{parola}, \text{salt}), \quad U_i = \text{HMAC}(\text{parola}, U_{i-1})$$
$$\text{DK} = U_1 \oplus U_2 \oplus \dots \oplus U_c$$
($\oplus$ = XOR, $c$ = iterasyon sayısı = 600.000.) Çıktı `DK` (derived key) saklanır.

**Projede kod:** `hashPassword` (Node) / `hash_password` (Python):
```
pbkdf2_sha256$600000$<salt_b64>$<hash_b64>
```
Bu **PHC string** formatı: algoritma + iterasyon + salt + hash tek yerde. Django da bunu
kullanır. Avantajı: iterasyonu ileride 600k→1M yapsak bile eski hash'ler kendi iterasyonunu
taşıdığı için hâlâ doğrulanır (kademeli geçiş).

**Sonraki adım (defter notu):** scrypt/Argon2id **bellek-sert**tir — sadece CPU değil çok
**bellek** de ister. GPU/ASIC saldırılarına PBKDF2'den daha dirençlidir. Biz anlatılabilirlik
+ sıfır bağımlılık için PBKDF2 seçtik; format `algo$...` olduğu için `argon2$...`'ye geçiş kolay.

---

## 4. HMAC: "bu mesajı sırrı bilen biri üretti"

**Amaç:** Bir mesajın (JWT payload'ı, rezervasyon) **bütünlüğünü ve kaynağını** doğrulamak.

**Sezgi:** Sadece `hash(mesaj)` işe yaramaz — saldırgan mesajı da hash'i de değiştirir.
Çözüm: hash'e **gizli anahtar** karıştır. Anahtarı bilmeyen geçerli imza üretemez.

**HMAC neden basit `hash(anahtar + mesaj)` değil?** Bazı hash'lerde "length extension attack"
açığı var. HMAC bunu **iç içe iki hash** ile kapatır:
$$\text{HMAC}(K, m) = H\big((K \oplus opad)\ \|\ H((K \oplus ipad)\ \|\ m)\big)$$
($ipad$, $opad$ sabit dolgular; $\|$ birleştirme.) İç hash mesajı anahtarla karıştırır, dış
hash sonucu tekrar anahtarla sarar.

**Projede kod:** `signReservation` = `HMAC(JWT_SECRET, "userId:facId:date:time:guests")`.
Rezervasyonun tek bir alanı değişse imza tutmaz.

---

## 5. JWT: HMAC'in kimlik biletine uygulanışı

Bir JWT üç parçadır, noktayla ayrılmış:
```
base64url(header) . base64url(payload) . base64url(HMAC(secret, header.payload))
```
- **header**: `{"alg":"HS256","typ":"JWT"}`
- **payload**: `{"id":1,"username":"admin","role":"admin","iat":..., "exp":...}`  ← **açık**, herkes okur
- **signature**: ilk iki parçanın HMAC imzası ← **sadece secret sahibi üretebilir**

**Kritik kavram:** JWT payload'ı **şifreli değil, imzalı**. Yani içeriği gizli değil (base64
herkes çözer), ama **değiştirilemez**: rolünü `user`→`admin` yapmaya kalkarsan imza tutmaz.

**`exp` neden önemli:** Token'a son kullanma koyduk (+8 saat). `verifyJwt` süresi geçmişi
reddeder → çalınan token sonsuza dek geçerli olmaz. **Projede kanıt:** `test-db.js` →
"süresi geçmiş token reddedildi", "kurcalanmış imza reddedildi".

**HS256 vs RS256 (ölçek-uygun tasarım):** HS256 **simetrik** — imzalayan ve doğrulayan aynı
sırrı paylaşır. Tek servisimiz olduğu için doğru tercih. RS256 **asimetrik** olurdu (aşağıda);
onu, çok sayıda bağımsız doğrulayıcı olsaydı seçerdik. İhtiyaç yokken karmaşıklık eklemiyoruz.

---

## 6. Sabit-zamanlı karşılaştırma (timing attack)

**İncelik:** İmzayı `a === b` ile karşılaştırırsan, çoğu dil **ilk farklı byte'ta** durur.
Saldırgan yanıt süresini ölçerek imzayı **byte byte** tahmin edebilir (timing side-channel).

**Çözüm:** `crypto.timingSafeEqual` (Node) / `hmac.compare_digest` (Python) — uzunluk aynıysa
**tüm** byte'ları karşılaştırır, süre içeriğe bağlı değişmez. Projede hem parola doğrulama hem
JWT imza kontrolü bunu kullanır.

---

## 7. İleri okuma sidebar'ı — asimetrik kripto (RSA) ve üniversite matematiği

Biz simetrik (HMAC) kullandık, ama mentör "asimetrik nasıl çalışıyor?" derse:

**Fikir:** İki anahtar — **açık (public)** ve **özel (private)**. Açıkla şifrele/doğrula,
özelle çöz/imzala. Kimse özeli açıktan türetemez. Bu, **sayılar teorisi**ne dayanır:

- **Modüler aritmetik:** $a \equiv b \pmod{n}$ ("saat aritmetiği").
- **RSA kurulumu:** İki büyük asal $p, q$; $n = pq$. Euler totient $\varphi(n) = (p-1)(q-1)$.
  Açık üs $e$, özel üs $d$ öyle ki $ed \equiv 1 \pmod{\varphi(n)}$.
- **Şifreleme/imza:** $c = m^e \bmod n$, geri: $m = c^d \bmod n$.
- **Neden çalışır — Euler teoremi:** $\gcd(m,n)=1$ için $m^{\varphi(n)} \equiv 1 \pmod n$.
  Buradan $m^{ed} = m^{1 + k\varphi(n)} \equiv m \pmod n$. (Fermat'ın küçük teoreminin
  genellemesi.)
- **Güvenlik:** $n$'i çarpanlarına ayırmak ($p, q$'yu bulmak) büyük sayılar için pratikte
  imkânsız → **tamsayı çarpanlarına ayırma problemi**. Özel anahtar bu zorluğa yaslanır.

**Neden bizde yok:** Tek servis kendi token'ını hem imzalar hem doğrular → paylaşılan tek sır
(HMAC) yeterli ve daha hızlı. RS256'yı, "merkez imzalar, onlarca bağımsız servis doğrular"
senaryosunda seçerdik. **Ölçek-uygun tasarım:** ihtiyaç doğmadan asimetrik karmaşıklık ekleme.

---

## 8. Mentöre 3 dakikalık anlatım planı

1. **(30 sn)** "Parolaları düz metin değil, PBKDF2 ile per-user salt'lı hash'liyorum" — Bölüm 2+3.
2. **(45 sn)** Salt'ı canlı göster: aynı parola iki kullanıcıda farklı hash (`test-db.js`).
3. **(45 sn)** JWT'yi aç: payload imzalı ama açık; rolü değiştirmeye çalış → imza tutmaz.
4. **(30 sn)** `exp` + sabit-zamanlı karşılaştırma neden var.
5. **(30 sn)** "Neden HS256 yeterli, RS256'yı ne zaman seçerdim" — ölçek-uygun tasarım kapanışı.

Bonus soru gelirse: PBKDF2 → Argon2 yükseltme yolu (format `algo$...` kademeli geçişe uygun).
