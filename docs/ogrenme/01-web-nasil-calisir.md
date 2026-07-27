# 01 — Web nasıl çalışır?

> Önceki bölümde "tarayıcı ↔ sunucu ↔ veritabanı" resmini gördük. Şimdi ilk oku açıyoruz:
> tarayıcı ile sunucu birbiriyle nasıl konuşuyor?

---

## 1. Bir cümlede

Tarayıcınız sunucuya **soru sorar** ("bana tesis listesini ver"), sunucu **cevap verir**;
her soru-cevap bağımsızdır ve arada kalıcı bir bağlantı yoktur.

---

## 2. Benzetme: restoran

- **Siz** = tarayıcı (müşteri)
- **Garson** = HTTP protokolü (mesajı taşıyan kurallar)
- **Mutfak** = sunucu (işi yapan)
- **Kiler** = veritabanı

Sipariş verirsiniz, garson mutfağa götürür, mutfak hazırlar, garson getirir. Siz mutfağa
girmezsiniz; mutfak da masanıza oturmaz. Herkesin işi belli.

**Benzetme nerede bozuluyor — iki önemli yerde:**

**(a) Garson sizi hatırlamaz.** Her siparişte kim olduğunuzu baştan söylemeniz gerekir.
HTTP **durumsuzdur** (stateless): sunucu, iki isteğin aynı kişiden geldiğini kendiliğinden
bilmez. Bu yüzden her istekte kimlik kartı gösterirsiniz — projede bu **JWT token**
(bkz. [07](07-kimlik-ve-sifreleme.md)).

**(b) Mutfak müşteriye güvenmez.** Gerçek restoranda "hesabım 50 lira" derseniz garson
inanmaz, kasaya bakar. Aynı şekilde sunucu, tarayıcının gönderdiği "bu siparişin tutarı
360 TL" bilgisine **asla güvenmez** — tutarı kendisi hesaplar. Çünkü tarayıcıdaki kod
kullanıcının bilgisayarında çalışır ve değiştirilebilir.

---

## 3. Biraz daha derin

### İstek (request) ve yanıt (response)

Her konuşma iki parçadan oluşur:

```
İSTEK                                    YANIT
GET /api/facilities HTTP/1.1             HTTP/1.1 200 OK
Host: localhost:8085                     Content-Type: application/json
Authorization: Bearer eyJhbGc...
                                         [{"id":1,"ad":"Altınboynuz..."}]
```

**Metod** ne yapmak istediğinizi söyler:

| Metod | Anlamı | Projede örnek |
|---|---|---|
| `GET` | Veri iste (hiçbir şeyi değiştirme) | tesis listesi |
| `POST` | Yeni bir şey oluştur | rezervasyon yap |
| `PATCH` | Var olanı kısmen değiştir | sipariş durumunu ilerlet |
| `DELETE` | Sil / iptal et | rezervasyon iptali |

**Durum kodu** ne olduğunu söyler:

| Kod | Anlamı | Projede ne zaman |
|---|---|---|
| `200` | Tamam | başarılı okuma |
| `201` | Oluşturuldu | rezervasyon yapıldı |
| `400` | Senin isteğin bozuk | eksik alan, geçersiz tarih |
| `401` | Kim olduğunu bilmiyorum | giriş yapılmamış |
| `403` | Kim olduğunu biliyorum ama yetkin yok | başkasının rezervasyonu |
| `404` | Öyle bir şey yok | olmayan tesis |
| `409` | Çakışma | slot dolu, çifte rezervasyon |
| `429` | Çok hızlısın | hız sınırı |
| `500` | Bende bir şey patladı | beklenmedik hata |

> **`401` ile `403` farkı önemli.** 401 "kimsin?", 403 "kim olduğunu biliyorum ama bu
> senin değil". Projede başkasının rezervasyonuna sipariş vermeye çalışırsanız `403`
> alırsınız — çünkü kimliğiniz belli, sadece yetkiniz yok.

### Port nedir?

Bir bilgisayarın tek IP adresi vardır ama üstünde birçok program çalışabilir. **Port**,
hangi programa gittiğinizi söyleyen kapı numarasıdır.

- `8085` → bu projenin sunucusu (Node/Express)
- `5432` → PostgreSQL veritabanı
- `8092` → arayüzü yerelde servis eden basit sunucu

Bir apartmanın tek sokak adresi (IP) ama birçok daire numarası (port) olması gibi.

### API nedir?

**API** = bir programın diğerine sunduğu "menü". Projedeki API, tarayıcının sunucudan
isteyebileceği şeylerin listesi:

```
GET    /api/facilities              tesisleri ver
POST   /api/reservations            rezervasyon oluştur
DELETE /api/reservations/:id        rezervasyonu iptal et
GET    /api/analytics/dashboard     analitik verileri ver
```

Restoranda menüde olmayan bir şey isteyemezsiniz; API'de tanımlı olmayan bir uç da yoktur
(`404` alırsınız).

---

## 4. Projede tam olarak nerede

Bütün uçlar tek dosyada: **`backend/server.js`**.

```bash
grep -n "^app\.\(get\|post\|patch\|delete\)" backend/server.js
```

24 uç göreceksiniz. Hepsinin listesi ve ne yaptığı `DATABASE.md`'nin sonundaki tabloda —
ve o tablo `npm run check` ile **koda karşı doğrulanıyor**, yani belge kayamaz.

Bir ucun anatomisi (`server.js`, rezervasyon oluşturma):

```js
app.post('/api/reservations', requireAuth, asyncHandler(async (req, res) => {
//  │      │                   │           │
//  │      │                   │           └─ hata yakalayıcı sarmalayıcı
//  │      │                   └───────────── ÖNCE kimlik kontrolü (middleware)
//  │      └───────────────────────────────── hangi adres
//  └──────────────────────────────────────── hangi metod
  const v = validateReservationInput(req.body);        // girdi doğru mu?
  if (!v.ok) return res.status(400).json({ error: v.error });
  ...
}));
```

**Middleware** = istek asıl işe ulaşmadan önce geçtiği ara katman. `requireAuth`
havaalanındaki pasaport kontrolü gibi: geçemezseniz uçağa (asıl handler'a) hiç varamazsınız.

---

## 5. Kendin dene

Sunucuyu başlatın:

```bash
npm start
```

Başka bir terminalde — **kimliksiz** istek:

```bash
curl -s http://localhost:8085/api/facilities | head -c 200
```

Tesis listesi gelir (bu uç herkese açık).

Şimdi **kimlik gerektiren** bir uç:

```bash
curl -s -i http://localhost:8085/api/reservations | head -3
```

`HTTP/1.1 401 Unauthorized` göreceksiniz. Sunucu sizi tanımıyor.

**Durum kodlarını görün** (`-w` ile sadece kodu yazdırıyoruz):

```bash
curl -s -o /dev/null -w "tesisler         : %{http_code}\n" localhost:8085/api/facilities
curl -s -o /dev/null -w "olmayan uç       : %{http_code}\n" localhost:8085/api/boyle-bir-sey-yok
curl -s -o /dev/null -w "kimliksiz istek  : %{http_code}\n" localhost:8085/api/reservations
curl -s -o /dev/null -w "eksik parametre  : %{http_code}\n" localhost:8085/api/menu
```

Beklenen: `200`, `404`, `401`, `400`.

**İsteği tam olarak görmek isterseniz** `-v` ekleyin:

```bash
curl -v -s -o /dev/null localhost:8085/api/facilities 2>&1 | grep -E "^[><]" | head -12
```

`>` ile başlayanlar sizin gönderdikleriniz, `<` ile başlayanlar sunucunun döndürdükleri.
İşte HTTP tam olarak bu — okunabilir metin satırları.

---

## 6. Mentör sorarsa

**"HTTP durumsuz derken ne kastediyorsun?"**
> *"Sunucu iki isteğin aynı kişiden geldiğini kendiliğinden bilmez. Her istek sıfırdan
> başlar. Bu yüzden kimliği her seferinde göndermek gerekiyor — ben JWT token kullanıyorum,
> `Authorization` başlığında gidiyor."*

**"Neden tarayıcıdan gelen tutara güvenmiyorsun?"**
> *"Çünkü tarayıcıdaki kod kullanıcının makinesinde çalışıyor; geliştirici araçlarını açıp
> isteği değiştirebilir. Sipariş toplamını sunucuda menü fiyatlarından hesaplıyorum, gelen
> tutarı hiç okumuyorum bile."*

**"401 ve 403 arasındaki fark?"**
> *"401 'kim olduğunu bilmiyorum' — giriş yapmamışsınız. 403 'kim olduğunuzu biliyorum ama
> bu kaynak sizin değil'. Başkasının rezervasyonuna sipariş vermeye çalışınca 403 dönüyor."*

---

## Sırada ne var

Sunucu bir şeyleri hatırlamak zorunda. Nereye yazıyor ve neden düz dosyaya değil?
**[02 — Veritabanı nedir?](02-veritabani-nedir.md)**
