# 07 — Kimlik ve şifreleme

> Sunucu bir isteğin kimden geldiğini nasıl bilir? Ve parolalar nasıl saklanır?

---

## 1. Bir cümlede

Parolaları **saklamıyoruz** — geri döndürülemez bir özetini saklıyoruz; kimliği ise her
istekte gösterilen, imzalı bir **bilet** taşıyor.

---

## 2. Benzetme: kütüphane kartı

Kütüphaneye her girişte kimliğinizi baştan anlatmazsınız; bir **kart** gösterirsiniz.
Kartın üstünde adınız yazar ve kütüphanenin **mührü** vardır. Görevli mührün gerçek
olduğunu anlar, defterlere bakmasına gerek kalmaz.

**Benzetme nerede bozuluyor — iki önemli yerde:**

**(a) Kartın içi herkese açık.** JWT'nin içindekiler **şifreli değildir**, sadece
kodlanmıştır. Herkes okuyabilir. Sağladığı şey gizlilik değil, **değiştirilemezlik**:
içeriği kurcalarsanız mühür tutmaz. Bu yüzden JWT'ye **asla parola veya sır koyulmaz**.

**(b) Kart iptal edilemez.** Kütüphane kartınızı kaybederseniz görevli listeye bakıp
iptal eder. JWT'de böyle bir liste yok — sunucu her isteği bağımsız doğrular. Bu yüzden
**süre sınırı** konur (projede 8 saat). Çalınan bir token, süresi dolana kadar geçerlidir.

---

## 3. Hash ile şifreleme farkı

Bu ikisi sık karıştırılır ve fark kritiktir:

| | Şifreleme | Hash (özet) |
|---|---|---|
| Geri dönüş | **var** (anahtarla) | **yok** |
| Ne için | mesajı gizlemek | doğrulamak |
| Örnek | HTTPS trafiği | parola saklama |

**Parolalar şifrelenmez, hash'lenir.** Sebep: şifreleme geri döndürülebilir, yani anahtarı
ele geçiren tüm parolaları okur. Hash tek yönlüdür — veritabanı çalınsa bile parolalar
geri çıkmaz.

Peki nasıl doğruluyoruz? Girilen parolayı **aynı işlemden geçirip** sonuçları
karşılaştırıyoruz. Aynı girdi hep aynı çıktıyı verir.

---

## 4. Salt — neden aynı parola farklı görünmeli?

Düz hash yetmez. İki kullanıcı da "123456" seçerse hash'leri aynı olur:

```
ayse    → a8f5f167f44f4964e6c998dee827110c
mehmet  → a8f5f167f44f4964e6c998dee827110c    ← aynı!
```

İki sorun: (a) kimlerin aynı parolayı kullandığı görünür, (b) saldırgan milyonlarca yaygın
parolanın hash'ini **önceden hesaplayıp** (rainbow table) tabloyla eşleştirir.

**Salt** = her kullanıcı için üretilen rastgele bir değer, parolaya eklenip öyle hash'lenir:

```
ayse    → salt: 7f3a...  →  hash: 9c2e1a...
mehmet  → salt: b104...  →  hash: 4d8f77...    ← aynı parola, FARKLI hash
```

Artık önceden hesaplanmış tablo işe yaramaz — saldırganın **her kullanıcı için ayrı**
hesap yapması gerekir.

> **Salt gizli değildir**, hash'in yanında açıkça durur. Amacı gizlemek değil,
> **toplu saldırıyı imkânsız kılmak**.

---

## 5. PBKDF2 — neden bilerek yavaş?

Normal hash fonksiyonları (SHA-256) **hızlıdır** — saniyede milyarlarca hesaplanabilir.
Parola için bu **kötü** bir özelliktir: saldırgan da saniyede milyarlarca deneyebilir.

**PBKDF2** hash'i **600.000 kez** üst üste uygular. Sonuç:

- Sizin girişiniz: ~100 milisaniye. Fark etmezsiniz.
- Saldırganın 1 milyar denemesi: yıllar sürer.

Projede saklanan format (PHC string):

```
pbkdf2_sha256$600000$jIdbjq9SA96roMO+Z...$4vN8xK2mQ...
└─ algoritma ─┘└iter.┘└──── salt ─────┘└─── hash ───┘
```

İterasyon sayısı **hash'in içinde** yazılı. Neden? İleride 600.000 yetersiz kalırsa
1.200.000'e çıkarabilirsiniz ve **eski hash'ler çalışmaya devam eder** — her hash kendi
iterasyonunu taşıyor.

---

## 6. Zamanlama saldırısı — projede bulunan gerçek bir hata

Bu, sunumda anlatılacak en iyi hikâyelerden biri.

**Sorun:** Kullanıcı adı yanlışsa sunucu hemen "hatalı" der. Doğruysa ama parola yanlışsa
PBKDF2 çalışır ve ~100 ms sürer. Saldırgan **süreye bakarak** hangi kullanıcı adlarının
kayıtlı olduğunu anlayabilir — parolayı bilmeden.

**Kodda çözüm denenmişti:** kullanıcı yoksa da sahte bir hash doğrula, süreler eşitlensin.
Doğru fikir. Ama sahte hash şuydu:

```js
'pbkdf2_sha256$1$AA==$AA=='
//              ↑ BİR iterasyon
```

Gerçek hash'ler **600.000** iterasyonlu. Ölçüm:

```
kullanıcı VAR   : 103.96 ms
kullanıcı YOK   :   0.26 ms     → 402× fark
```

**Kod, engellemeye çalıştığı sızıntıyı bizzat üretiyordu.**

Düzeltme — sahte hash iterasyon sayısını gerçek ayardan alıyor:

```js
const DUMMY_PHC = `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${...}`;
```

```
kullanıcı VAR   : 104.0 ms
kullanıcı YOK   : 110.5 ms     → 1.06× fark
```

> **Ders:** Bir güvenlik önlemini yazmak yetmiyor; **ölçmek** gerekiyor. Yorum satırında
> "timing sızıntısını azaltırız" yazıyordu ve kod tam tersini yapıyordu. `test-auth.js`
> artık bu oranı her testte ölçüyor.

### Bonus: aynı yerde ikinci hata

600.000 iterasyonlu PBKDF2 **senkron** çalışıyordu. Node.js tek thread'li olduğu için
her giriş denemesi **tüm sunucuyu** ~100 ms donduruyordu.

```
6 eşzamanlı login sırasında basit bir GET isteği:
  önce  : ~600 ms
  sonra :   14 ms
```

Çözüm: `crypto.pbkdf2` (async) — iş libuv thread havuzuna gidiyor, olay döngüsü boş kalıyor.
Bu aynı zamanda bir **erişilebilirlik** sorunuydu: parolayı bilmeyen biri bile sadece istek
göndererek sunucuyu meşgul edebilirdi. Artık hız sınırı da var (15 dakikada 5 deneme).

---

## 7. JWT — biletin anatomisi

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9  .  eyJpZCI6NCwidXNlcm5hbWUiOiJheXNlIn0  .  4f7d2a...
└──────────── başlık ───────────────┘     └──────────── içerik ─────────────┘     └─ imza ─┘
```

- **Başlık**: hangi algoritma (`HS256`)
- **İçerik**: kim olduğunuz (`id`, `username`, `role`), ne zaman verildi (`iat`),
  ne zaman biter (`exp`)
- **İmza**: sunucunun sırrıyla üretilmiş HMAC

İlk iki parça **base64** — şifreleme değil, sadece kodlama. Herkes okuyabilir.

**Peki neden güvenli?** İçeriği değiştirirseniz (örneğin `"role":"user"` → `"role":"admin"`)
imza tutmaz. İmzayı yeniden üretmek için **sunucunun sırrı** gerekir.

> **`exp` neden şart?** JWT iptal edilemez. Süre sınırı olmasaydı çalınan bir token
> sonsuza dek geçerli olurdu. Projede 8 saat.

### Sabit zamanlı karşılaştırma

İmza doğrulanırken:

```js
crypto.timingSafeEqual(a, b)     // === değil!
```

Normal `===` ilk farklı karakterde durur. Saldırgan süreye bakarak imzayı
**karakter karakter** tahmin edebilir. `timingSafeEqual` her zaman aynı sürede çalışır.

---

## 8. Projede tam olarak nerede

| Dosya | Ne yapar |
|---|---|
| `backend/database.js` | `hashPassword`, `verifyPassword`, `DUMMY_PHC` |
| `backend/security.js` | `signJwt`, `verifyJwt`, `signReservation`, `signOrder` |
| `backend/server.js` | `requireAuth`, `requireAdmin` middleware'leri |
| `backend/ratelimit.js` | kaba kuvvet ve CPU tüketmeye karşı sınır |
| `backend/test-auth.js` | zamanlama oranını **ölçen** test |

**Sır nereden geliyor?** `JWT_SECRET` ortam değişkeninden (`.env`, gitignored). Üretimde
tanımlı değilse sunucu **açılmayı reddediyor** — sessizce zayıf bir varsayılana düşmek
en tehlikeli davranış olurdu.

---

## 9. Kendin dene

**Parola nasıl saklanıyor, bakın:**

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT username,
       split_part(password,'\$',1) AS algoritma,
       split_part(password,'\$',2) AS iterasyon,
       left(split_part(password,'\$',3),16)||'…' AS salt
FROM users LIMIT 5;"
```

Salt sütunundaki değerlerin **hepsi farklı** olmalı.

**Zamanlama testini çalıştırın:**

```bash
node backend/test-auth.js
```

```
...kullanıcı var: 104.0ms | kullanıcı yok: 110.5ms | oran: 1.06×
PASS  zamanlama: var olan ve olmayan kullanıcı aynı süreyi harcıyor (oran < 2×)
```

**JWT'nin içini okuyun** (sır olmadan, çünkü şifreli değil):

```bash
npm start &
sleep 5
TOKEN=$(curl -s -X POST localhost:8085/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$(node -e "console.log(require('./data/dev-credentials.json').users.admin)")\"}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null; echo
```

`{"id":6,"username":"admin","role":"admin","iat":...,"exp":...}` göreceksiniz —
**parola yok**, sadece kimlik.

**Kurcalanmış token reddediliyor mu?**

```bash
curl -s -o /dev/null -w "gerçek token   : %{http_code}\n" \
  localhost:8085/api/admin/audit-log -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "kurcalanmış    : %{http_code}\n" \
  localhost:8085/api/admin/audit-log -H "Authorization: Bearer ${TOKEN}XX"
```

`200` ve `403` — imza tutmayınca token geçersiz.

**Hız sınırını görün:**

```bash
for i in $(seq 1 7); do
  printf "%s " $(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:8085/api/auth/login \
    -H 'Content-Type: application/json' -d '{"username":"admin","password":"yanlis"}')
done; echo
```

`401 401 401 401 401 429 429` — beşinciden sonra kapı kapanıyor.

---

## 10. Mentör sorarsa

**"Parolaları nasıl saklıyorsun?"**
> *"Düz metin asla. PBKDF2-HMAC-SHA256, 600.000 iterasyon, kullanıcı başına rastgele salt,
> PHC formatında. Tek yönlü — veritabanı sızsa bile parolalar geri çıkmaz."*

**"Neden 600.000 iterasyon?"**
> *"OWASP'ın 2023 önerisi. Amaç doğrulamayı bilerek yavaşlatmak. Benim için 100 ms,
> saldırgan için milyarlarca deneme demek. İterasyon sayısını hash'in içinde tutuyorum,
> böylece ileride artırsam eski hash'ler çalışmaya devam eder."*

**"Salt ne işe yarıyor?"**
> *"Aynı parolayı seçen iki kullanıcının hash'i farklı olsun diye. Böylece önceden
> hesaplanmış rainbow table'lar işe yaramıyor; saldırganın her kullanıcı için ayrı hesap
> yapması gerekiyor. Salt gizli değil, hash'in yanında duruyor — amacı gizlemek değil,
> toplu saldırıyı imkânsız kılmak."*

**"JWT'nin içinde ne var, güvenli mi?"**
> *"Kimlik bilgisi ve süre — parola yok. İçerik şifreli değil, herkes okuyabilir; sağladığı
> şey değiştirilemezlik. Kurcalanırsa HMAC imzası tutmuyor. Süre sınırı koydum çünkü JWT
> iptal edilemiyor."*

**"Zamanlama saldırısı nedir, önlem aldın mı?"**
> *"Yanıt süresinden bilgi sızması. Bende gerçek bir örneği vardı: kullanıcı yokken sahte
> hash doğruluyordum ama sahte hash 1 iterasyonluydu, gerçekler 600.000. Ölçtüm — 402 kat
> fark vardı, yani kod engellemeye çalıştığı sızıntıyı üretiyordu. Sahte hash artık gerçek
> iterasyonu kullanıyor, oran 1.06'ya düştü ve test bunu her koşuda ölçüyor."*

---

## Sırada ne var

Sunucunun kendisine bakalım: Node.js tek thread'li nasıl bu kadar isteği karşılıyor?
**[08 — Backend: Node ve Express](08-backend-node-express.md)**
