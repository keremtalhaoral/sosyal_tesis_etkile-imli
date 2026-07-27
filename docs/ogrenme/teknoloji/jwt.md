# JWT (JSON Web Token)

## 1. Tek cümlede

JWT, içinde kullanıcı bilgisi taşıyan, **imzalı ama şifreli olmayan** bir oturum
biletidir: herkes okuyabilir, ama gizli anahtar olmadan **değiştiremez**.

**Bu projede:** HS256, 8 saatlik `exp`. `backend/security.js`.

---

## 2. Hangi problemi çözmek için doğdu

HTTP **durumsuzdur**: sunucu iki isteği kendiliğinden ilişkilendirmez. Giriş yaptınız,
bir sonraki istekte sunucu sizi tanımaz. Bu bir eksiklik değil, tasarım — ama bir çözüm
gerektiriyor.

**Klasik çözüm: sunucu tarafı oturum.** Sunucu rastgele bir `session_id` üretir, kullanıcı
bilgisini bellekte/veritabanında saklar, id'yi çereze koyar. Her istekte id ile kaydı
bulur.

Sorun ölçekte çıkıyor: **sunucu artık durum taşıyor.** İki sunucunuz varsa, kullanıcı
birine giriş yapıp diğerine düşerse tanınmaz. Çözümler var (yapışkan oturum, Redis) ama
hepsi altyapı ekliyor.

**JWT'nin fikri: durumu bilete koy.** Sunucu hiçbir şey saklamaz; token'ın kendisi
"ben admin rolündeki 1 numaralı kullanıcıyım" der ve **imza** bunun sahte olmadığını
kanıtlar.

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9  .  eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiI…  .  1sJqK…
└──────────── header ────────────┘     └──────────── payload ──────────┘      └ imza ┘
     {"alg":"HS256","typ":"JWT"}          {"id":1,"username":"admin",
                                            "role":"admin","iat":…,"exp":…}
```

İlk iki parça sadece **base64** — yani **şifre değil, kodlama.** Herkes okuyabilir.
Üçüncü parça `HMAC-SHA256(header.payload, gizli_anahtar)`.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Sunucu tarafı oturum** | anında iptal edilebilir, token büyümez | durum saklamak gerekir; tek düğümlü bir öğrenme projesinde fayda yok |
| **Basic Auth** | en basit | parola **her istekte** gider; her istekte PBKDF2 = 106 ms |
| **OAuth2 / OIDC** | üçüncü taraf giriş, endüstri standardı | kendi kullanıcılarımız var; harici sağlayıcı gereksiz karmaşıklık |
| **API key** | basit, makine-makine için iyi | kullanıcı kimliği ve rol taşımıyor |

**Belirleyici sebep:** Bu projede JWT bir **öğrenme aracı** olarak da seçildi. HMAC imzası,
`exp`, timing attack, "base64 şifreleme değildir" — hepsi tek bir küçük dosyada (75 satır)
elle yazılmış ve **anlaşılabilir** durumda. `jsonwebtoken` paketi kullanılsaydı bunların
hiçbiri görünmezdi.

---

## 4. Bu projede tam olarak nerede

`backend/security.js`:

```js
const TOKEN_TTL_SECONDS = 60 * 60 * 8;   // 8 saat

const signJwt = (userData) => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...userData, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const header  = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64urlEncode(JSON.stringify(claims));
  const sig = base64urlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
};
```

Doğrulama üç şeyi kontrol eder:

```js
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;  // imza
if (claims.exp && Math.floor(Date.now()/1000) >= claims.exp) return null; // süre
```

**`timingSafeEqual` neden?** Normal `===` karşılaştırması ilk farklı baytta durur.
Saldırgan yanıt süresini ölçerek imzayı **bayt bayt** tahmin edebilir.
`timingSafeEqual` her koşulda aynı süreyi harcar.

**Aynı anahtar üç yerde kullanılıyor:** JWT imzası, rezervasyon imzası (`signReservation`)
ve sipariş imzası (`signOrder`). Son ikisi, veritabanındaki kaydın sunucu tarafından
üretildiğini kanıtlıyor — biri DBeaver'dan elle satır eklerse imza tutmaz.

**Sır yönetimi:** `JWT_SECRET` ortam değişkeninden gelir. Yoksa geliştirme sabiti
kullanılır **ve konsola uyarı basılır**; `NODE_ENV=production` ise doğrudan hata fırlatır.

---

## 5. Bilinmesi gereken üç tuzak

### (a) JWT **şifreli değildir** — en sık yanlış anlaşılan şey

```bash
echo $TOKEN | cut -d. -f2 | base64 -d
# {"id":1,"username":"admin","role":"admin","iat":1785156651,"exp":1785185451}
```

Anahtar gerekmedi. **Token'a asla hassas bilgi koymayın** — parola, TC kimlik, kart
numarası. İmza gizliliği değil, **bütünlüğü** sağlar.

### (b) Token iptal edilemez

Sunucu durum tutmadığı için "bu token'ı geçersiz kıl" diyecek bir yer yok. Kullanıcının
rolünü admin'den user'a düşürseniz bile, elindeki token `exp`'e kadar admin olmaya devam
eder.

Bu, JWT'nin **temel takasıdır**: durumsuzluk kazandınız, anında iptali kaybettiniz.
Azaltma: kısa `exp` (projede 8 saat). Gerçek çözüm (kara liste) durumu geri getirir ve
JWT'nin faydasını azaltır.

### (c) `alg: none` saldırısı

Bazı JWT kütüphaneleri header'daki `alg` alanına **güvenir**. Saldırgan `alg: "none"`
yazıp imzayı siler, kütüphane "imzasız algoritma seçilmiş" deyip kabul eder. 2015'te
birçok kütüphaneyi vuran gerçek bir açıktı.

Projedeki doğrulama header'daki `alg`'ı **hiç okumuyor**: her zaman HMAC-SHA256 ile
kendi imzasını hesaplayıp karşılaştırıyor. Yani bu saldırı yapısal olarak imkânsız.

> **Genel ders:** Girdinin kendi doğrulama yöntemini seçmesine izin vermeyin.

---

## 6. Kendin dene

```bash
TOKEN=$(curl -s -X POST localhost:8085/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$(node -e "console.log(require('./data/dev-credentials.json').users.admin)")\"}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

# payload'ı okuyun — anahtar GEREKMİYOR
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null; echo

# geçerli token
curl -s -o /dev/null -w "geçerli: %{http_code}\n" \
  "localhost:8085/api/admin/reservations?limit=1" -H "Authorization: Bearer $TOKEN"

# imzası kurcalanmış token
BAD="$(echo $TOKEN | cut -d. -f1,2).AAAAAAAAAAAAAAAAAAAAAAAAAAA"
curl -s -o /dev/null -w "kurcalanmış: %{http_code}\n" \
  "localhost:8085/api/admin/reservations?limit=1" -H "Authorization: Bearer $BAD"
```

Beklenen:
```
{"id":1,"username":"admin","role":"admin","iat":…,"exp":…}
geçerli: 200
kurcalanmış: 403
```

Payload'ı `"role":"admin"` yapıp yeniden kodlamayı deneyin — imza tutmayacağı için yine
`403` alırsınız. **Değiştirebilirsiniz ama işe yaramaz.**

---

## 7. Daha fazlası için

- Spesifikasyon: RFC 7519 — <https://datatracker.ietf.org/doc/html/rfc7519>
- Token ayrıştırıcı: <https://jwt.io/> *(gerçek token'ınızı buraya yapıştırmayın)*
- Bu kitapta: [07 — Kimlik ve şifreleme](../07-kimlik-ve-sifreleme.md)
- Projede: `docs/adr/ADR-002-*.md`
