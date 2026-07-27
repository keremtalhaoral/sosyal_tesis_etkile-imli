# PBKDF2

## 1. Tek cümlede

PBKDF2 (Password-Based Key Derivation Function 2), bir parolayı **kasıtlı olarak yavaş**
hash'leyerek, veritabanı çalınsa bile parolaların kaba kuvvetle bulunmasını pratikte
imkânsızlaştıran algoritmadır.

**Bu projede:** HMAC-SHA256, **600.000 iterasyon**, kullanıcı başına 16 baytlık salt,
PHC formatında saklanır.

---

## 2. Hangi problemi çözmek için doğdu

Parolaları **düz metin** saklamanın yanlış olduğu 1970'lerden beri biliniyor. İlk çözüm:
hash'le. `SHA-256("hunter2")` sakla, girişte tekrar hash'le, karşılaştır. Veritabanı
çalınsa bile parolalar görünmez.

**Ama iki şey bunu yıktı.**

### Sorun 1: Hash'ler çok hızlı

SHA-256 **hızlı olmak için** tasarlandı — dosya bütünlüğü doğrulamak için milyonlarca
hash saniyede hesaplanmalı. Bu, parola için tam ters gereksinim.

Modern bir GPU saniyede **milyarlarca** SHA-256 hesaplar. 8 karakterlik bir parolanın
tüm olasılıkları saatler içinde denenir. Hız, saldırganın dostu.

### Sorun 2: Aynı parola aynı hash'i verir

İki kullanıcı da "123456" kullanıyorsa hash'leri **aynı** olur. Saldırgan:

- Aynı hash'i gören herkesi tek seferde çözer.
- **Rainbow table** kullanır: milyarlarca yaygın parolanın hash'i önceden hesaplanmış
  tablolar. Arama işi, hesaplama işi değil.

### PBKDF2'nin iki cevabı

**(a) Salt.** Her kullanıcı için rastgele 16 bayt üretilir, parolaya eklenir, öyle
hash'lenir. Artık aynı parola farklı hash'ler verir; hazır tablolar işe yaramaz ve her
kullanıcı **ayrı ayrı** kırılmalıdır.

**(b) İterasyon.** Hash tek kez değil, **600.000 kez** uygulanır. Bu projede ölçüldü:
tek doğrulama **~106 ms**.

Kullanıcı için 106 ms fark etmez. Saldırgan içinse:

```
saniyede 1 milyar hash (GPU, düz SHA-256)
→ 600.000 iterasyonla saniyede ~1.600 deneme
→ 600.000 kat yavaşlama
```

> **Anahtar fikir:** Güvenlik burada bir sırdan değil, **maliyetten** geliyor. Saldırıyı
> imkânsız yapamazsınız; ekonomik olarak anlamsız yaparsınız.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **bcrypt** | 1999'dan beri savaş görmüş, salt gömülü | native derleme gerektirir (`node-gyp`); parola 72 baytta kesilir |
| **scrypt** | **bellek**-zor: GPU avantajını kırar | Node'da var ama parametre ayarı (N, r, p) daha zor anlatılır |
| **Argon2id** | **bugünün en iyi seçimi** — bellek-zor + yan kanal dirençli | Node'un standart kütüphanesinde **yok**; dış paket gerektirir |
| **Düz SHA-256** | hızlı | tam da bu yüzden **yanlış** |

**Belirleyici sebep — ve dürüst olmak gerekirse bir takas:**

Argon2id bugün önerilen seçimdir. PBKDF2 seçildi çünkü **Node'un `crypto` modülünde
yerleşik** — sıfır bağımlılık. PBKDF2'nin bilinen zayıflığı **bellek-zor olmaması**:
saldırgan GPU/ASIC ile paralelleştirebilir, bcrypt ve Argon2 bunu zorlaştırır.

600.000 iterasyon bunu telafi etmek için seçildi — **OWASP'ın 2023'te SHA-256 için
önerdiği değer.** Yani "en iyi algoritma" değil, "bağımlılıksız kalarak ulaşılabilecek
en iyi güvenlik seviyesi."

> Mentöre söylenecek: *"PBKDF2 seçtim çünkü Node'da yerleşik. Argon2id daha iyi olurdu —
> bellek-zor, GPU'ya karşı daha dirençli. PBKDF2'yi OWASP'ın önerdiği 600.000 iterasyonla
> kullanarak farkı kapatmaya çalıştım. Bu bilinçli bir takas, bilgisizlik değil."*

---

## 4. Bu projede tam olarak nerede

### PHC formatı — parametreleri hash'le birlikte saklamak

```
pbkdf2_sha256$600000$<salt_base64>$<hash_base64>
└────┬─────┘ └──┬──┘ └────┬─────┘ └────┬─────┘
  algoritma  iterasyon   salt        hash
```

Neden hepsi bir arada? **Çünkü iterasyon sayısı ileride artacak.** Donanım hızlandıkça
600.000 yetmeyecek. Parametreler hash'in yanında olduğu için:

- Eski hash'ler (600.000) hâlâ **doğrulanabilir**.
- Yeni kayıtlar daha yüksek sayı kullanabilir.
- Kullanıcı giriş yaptığında hash'i sessizce yükseltebilirsiniz.

Sabit bir global iterasyon sayısı kullansaydınız, artırdığınız an **tüm eski parolalar
doğrulanamaz** olurdu.

### İki sürüm: senkron ve asenkron

```js
hashPassword,      verifyPassword       // senkron  — seed/CLI için
hashPasswordAsync, verifyPasswordAsync  // asenkron — HTTP yolu için (ZORUNLU)
```

Senkron sürüm olay döngüsünü **106 ms kilitler** (→ [nodejs.md](nodejs.md)). HTTP yolunda
kullanılsaydı, her giriş denemesi tüm sunucuyu dondururdu — ve sınırsız login denemesiyle
birleşince hizmet dışı bırakma saldırısına dönerdi.

### Zamanlama saldırısına karşı iki önlem

**(a) `timingSafeEqual`** — hash karşılaştırması ilk farklı baytta durmuyor.

**(b) `DUMMY_PHC`** — kullanıcı **bulunamasa bile** gerçek parametrelerle sahte bir
doğrulama koşuluyor:

```js
const record = username ? await db.getUserByUsername(username) : null;
const valid  = await verifyPasswordAsync(password || '', record ? record.password : DUMMY_PHC);
```

Böylece "kullanıcı yok" ile "parola yanlış" **aynı süreyi** harcar. Yoksa saldırgan yanıt
süresine bakarak hangi kullanıcı adlarının var olduğunu **numaralandırabilirdi**.

`DUMMY_PHC` iterasyon sayısını `PBKDF2_ITERATIONS`'tan türetiyor — biri sayıyı
değiştirirse sahte doğrulama da otomatik ayarlanıyor, yoksa zamanlama farkı geri gelirdi.

---

## 5. Bilinmesi gereken üç tuzak

### (a) Hash'in gücü, parolanın entropisi kadardır

600.000 iterasyon "1234" parolasını **kurtarmaz**: 4 haneli sayı = 10.000 olasılık,
saniyede 1.600 deneme = **6 saniye**.

Bu proje uzun süre **4 karakterlik** parolaya izin veriyordu. Denetimde yakalandı ve 8'e
çıkarıldı. **Sağlam kripto, zayıf politikayı telafi etmez.**

### (b) Salt gizli değildir, **benzersiz** olmalıdır

Salt hash'in yanında açıkça duruyor — sır değil. İşlevi gizlemek değil, **her kullanıcının
ayrı ayrı kırılmasını zorunlu kılmak.**

Bu projede gerçek bir tutarsızlık çıktı: `generate-data.js` hız için 200 sentetik
kullanıcının hepsine **aynı hash'i** veriyordu. DBeaver'da `users` tablosunu açan mentör
200 özdeş hash görecekti — tam da "her kullanıcıya ayrı salt" anlatısının yanında.
Düzeltildi.

> Ders: **anlatınızla veriniz çelişmemeli.** Mentör tabloya bakacak.

### (c) Hash'i "şifreleme" sanmak

Şifrelemenin anahtarı vardır ve **geri açılır**. Hash'in yoktur ve **açılmaz.** Bu yüzden
"parolamı unuttum" akışı parolayı **gönderemez** — sıfırlama bağlantısı yollar. Bir site
size parolanızı e-postayla gönderiyorsa, onu düz metin ya da şifreli saklıyordur ve bu
bir güvenlik açığıdır.

---

## 6. Kendin dene

```bash
# tek doğrulamanın maliyeti
node -e "
const c=require('crypto'), s=Buffer.alloc(16), t=Date.now();
c.pbkdf2Sync('x',s,600000,32,'sha256');
console.log('tek PBKDF2:', Date.now()-t, 'ms');
console.log('→ saldırgan saniyede ~', Math.round(1000/(Date.now()-t)), 'deneme yapabilir');
"

# aynı parola, farklı salt → farklı hash
node -e "
const {hashPassword}=require('./backend/database');
console.log(hashPassword('AyniParola123').slice(0,60));
console.log(hashPassword('AyniParola123').slice(0,60));
"

# veritabanında nasıl duruyor
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c \
  "SELECT username, left(password, 55) AS phc FROM users LIMIT 3;"

# zamanlama: var olmayan kullanıcı da aynı süreyi harcıyor mu?
time curl -s -o /dev/null -X POST localhost:8085/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"yanlis"}'
time curl -s -o /dev/null -X POST localhost:8085/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"boyle_biri_yok","password":"yanlis"}'
```

Son iki komutun süresi birbirine yakın olmalı — fark olsaydı kullanıcı adı sızardı.
*(Hız sınırı devredeyse önce 15 dakika bekleyin ya da farklı kullanıcı adları kullanın.)*

---

## 7. Daha fazlası için

- OWASP Password Storage Cheat Sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- RFC 8018 (PKCS #5 v2.1): <https://datatracker.ietf.org/doc/html/rfc8018>
- Bu kitapta: [07 — Kimlik ve şifreleme](../07-kimlik-ve-sifreleme.md)
- Projede: `docs/adr/ADR-002-*.md`, `backend/test-auth.js`
