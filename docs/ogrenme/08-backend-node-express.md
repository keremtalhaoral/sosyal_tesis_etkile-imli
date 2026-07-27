# 08 — Backend: Node.js ve Express

> Şu ana kadar veritabanını, haritayı, eşzamanlılığı ve güvenliği gördük. Peki bunların
> hepsini kim çağırıyor? Cevap: `backend/server.js`. Bu bölüm o dosyanın altındaki
> makineyi anlatıyor.

---

## 1. Bir cümlede

Node.js, JavaScript'i tarayıcının dışında — sunucuda — çalıştıran bir çalışma ortamıdır;
Express ise "hangi URL gelirse hangi fonksiyon çalışsın" eşleştirmesini yapan ince bir
katmandır.

---

## 2. Benzetme: tek garsonlu restoran

Çoğu sunucu (Java, PHP, Apache) **her müşteriye bir garson** ayırır: 100 müşteri = 100
garson. Garsonlar çoğu zaman mutfağı beklerken boş boş durur, ama yine de maaş alır
(bellek tüketir).

Node.js **tek garsonla** çalışır. Ama bu garson asla beklemez: siparişi mutfağa verir,
*hemen* diğer masaya gider, mutfak "hazır!" diye seslendiğinde geri döner. Tek kişiyle
yüzlerce masaya bakabilir, çünkü bekleme süresini başkasının işiyle doldurur.

**Benzetme nerede bozuluyor — ve bu proje için tam olarak kritik:**
Garson mutfağı beklemiyor, doğru. Ama garsonun **kendi elleriyle** yapması gereken bir iş
çıkarsa (diyelim salatayı kendisi doğruyor), o iş bitene kadar **restoranın tamamı durur.**
Kimse sipariş veremez, kimse hesap isteyemez.

Bu projede o "salata doğrama" işi gerçekten var: **parola hash'leme.** Ve gerçekten
ölçtük — birazdan sayılarla.

---

## 3. Şimdi biraz daha derin: olay döngüsü (event loop)

Node'un kalbi **tek bir iş parçacığıdır** (single thread) ve sürekli aynı döngüyü döner:

```
sırada iş var mı? → varsa çalıştır → bitince tekrar sor → …
```

Bu döngüye **olay döngüsü** denir. İki tür iş vardır:

**(a) Beklemeli işler — döngüyü meşgul etmez.**
Veritabanı sorgusu, dosya okuma, ağ isteği. Node bunları işletim sistemine devreder,
"bitince haber ver" der ve döngü boşa çıkar. `await db.query(...)` yazdığınızda olan budur:
fonksiyonunuz **duraklar**, ama sunucu durmaz.

**(b) Hesap işleri — döngüyü kilitler.**
Devredilecek kimse yok; CPU'yu Node'un kendi iş parçacığı yakar. Bu sürede gelen hiçbir
istek işlenemez, sadece kuyrukta bekler.

### Bunu kendi projemizde ölçtük

Parolayı PBKDF2 ile 600.000 tur hash'lemek saf hesap işidir. Node bunun iki sürümünü sunar:
`crypto.pbkdf2Sync` (döngüde) ve `crypto.pbkdf2` (havuzda). Aradaki fark şu:

```
SYNC çalışırken:  10 ms'ye kurulmuş bir zamanlayıcı → gerçekte 106 ms sonra çalıştı
ASYNC çalışırken: 10 ms'ye kurulmuş bir zamanlayıcı → gerçekte  11 ms sonra çalıştı
```

Senkron sürümde zamanlayıcı **10 kat gecikti** — çünkü olay döngüsü 106 ms boyunca
kilitliydi. O 106 ms'de gelen her istek de aynı şekilde beklerdi.

**libuv thread pool.** Peki asenkron sürüm hesabı nasıl yapıyor? Node'un altındaki
`libuv` kütüphanesinin **4 iş parçacıklı** bir yardımcı havuzu var. `crypto.pbkdf2`
işi oraya atar. Dört parola aynı anda gelirse:

```
4 adet SIRAYLA (sync):                 428 ms
4 adet PARALEL (async, libuv havuzu):  107 ms
```

Dört kat hızlı — çünkü dört havuz iş parçacığı gerçekten paralel çalıştı.

> **Projede tam olarak burada:** `backend/database.js` her iki sürümü de dışa açıyor
> (satır 613-614). Seed/CLI yolları senkron olanı kullanıyor (orada beklemenin zararı yok),
> ama HTTP yolu — `server.js`'teki login ve register — **her zaman async olanı** kullanıyor.
> Bu bir tercih değil, zorunluluk: senkron olsaydı her giriş denemesi tüm sunucuyu
> 106 ms dondururdu ve bu, sınırsız login denemesiyle birleşince (D5 bulgusu)
> **hizmet dışı bırakma saldırısına** dönüşürdü.

---

## 4. Express: URL → fonksiyon

Express'in yaptığı şey şaşırtıcı derecede basit. Bir istek geldiğinde, kayıtlı kuralları
**yukarıdan aşağıya** dener; eşleşen ilk kuralın fonksiyonunu çalıştırır.

```js
app.get('/api/facilities', handler);          // GET /api/facilities → handler
app.post('/api/reservations', requireAuth, handler);
```

### Middleware: zincirdeki halkalar

Bir isteğin geçtiği yol bir **boru hattıdır**. Her halka ya isteği değiştirir ya da
`next()` diyerek bir sonrakine devreder:

```
istek
  ↓
cors()                     ← başka kaynaktan gelen tarayıcı isteğine izin ver
  ↓
güvenlik başlıkları        ← nosniff / DENY / no-referrer
  ↓
express.json({limit})      ← gövdedeki JSON'u req.body'ye çevir (en fazla 100 kb)
  ↓
log middleware             ← konsola "[zaman] POST /api/orders" yaz
  ↓
loginLimiter               ← 15 dk'da 5'ten fazlaysa 429 dön, next() ÇAĞIRMA
  ↓
requireAuth                ← token yoksa 401 dön, varsa req.user'ı doldur
  ↓
asıl handler               ← işi yap, res.json(...)
```

**Sıra önemlidir ve bu projede bir yerde hayati:** `express.json()` **hız
sınırlayıcıdan önce** gelmek zorunda. Çünkü sınırlayıcının anahtarı
`${req.ip}|${req.body.username}` — gövde henüz ayrıştırılmamışsa `req.body` `undefined`'dır
ve sınırlayıcı herkesi tek anahtara toplar. (`server.js:45` ve `:75`.)

### `asyncHandler` — Express 4'ün en sinsi tuzağı

```js
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
```

Express 4, `async` bir handler içinde fırlatılan hatayı **görmez**. Reddedilen Promise
kimse tarafından yakalanmaz; istemci hiçbir yanıt alamaz ve bağlantı **asılı kalır** —
hata mesajı bile yok, sadece sonsuz bekleme. Bu sarmalayıcı reddi `next()`'e bağlar,
böylece en alttaki hata middleware'i devreye girer.

> Projedeki **24 ucun tamamı** `asyncHandler` ile sarılı. Tek bir tanesini unutmak,
> o uçtaki her hatayı sessiz bir asılmaya çevirirdi.

---

## 5. Bağlantı havuzu (connection pool)

PostgreSQL'e her bağlanmak pahalıdır (TCP el sıkışması + kimlik doğrulama + sunucu
tarafında yeni bir süreç). Her istek için yeni bağlantı açmak, her sipariş için restoranı
yeniden inşa etmek gibidir.

`pg` havuzu, açık bağlantıları saklar ve ödünç verir:

```js
pool = new Pool({
  max: Number(process.env.PG_POOL_MAX || 10),   // en fazla 10 eşzamanlı bağlantı
  idleTimeoutMillis: 30000,                     // 30 sn kullanılmayan bağlantı kapanır
});
```

**Havuzun ilk günden ısırdığı yer.** [04. bölümde](04-neden-postgresql.md) anlattığımız
"commit edilmemiş veriyi okumak" hatası tam olarak buradan çıktı: `createFacility` satırı
ekliyor, sonra okumak için havuzdan **başka bir bağlantı** alıyordu. O bağlantı, henüz
commit edilmemiş satırı göremez — [06. bölümdeki](06-ayni-anda-iki-kisi.md) izolasyon
kuralının doğrudan sonucu. SQLite'ta tek bağlantı olduğu için hata hiç görünmemişti.

**Ders:** Havuzlu bir sistemde "aynı bağlantı" varsayımı yapamazsınız. Bir işlemin
tamamı tek bağlantıda kalmalıysa, `transaction()` sarmalayıcısını kullanmalısınız —
projede tam olarak bunun için var (`database.js`).

---

## 6. Projede tam olarak nerede

| Dosya | Satır | Sorumluluk |
|---|---|---|
| `backend/server.js` | 411 | 24 HTTP ucu, middleware zinciri, hata yakalayıcı |
| `backend/db.js` | 595 | SQL sorguları (repository katmanı) |
| `backend/database.js` | 616 | havuz, migration, seed, `transaction()`, parola |
| `backend/analytics.js` | 215 | analitik agregasyonlar |
| `backend/security.js` | 75 | JWT imzalama/doğrulama, rezervasyon imzası |
| `backend/ratelimit.js` | 74 | kayan pencere hız sınırlayıcı (bağımlılıksız) |
| `backend/env.js` | 59 | `.env` okuyucu (bağımlılıksız) |
| `backend/validate.js` | 82 | girdi doğrulama |
| `backend/weather.js` | 177 | OpenWeather çağrısı + önbellek + mock'a düşme |
| `backend/geo.js` | 45 | ilçe geometrisi yükleyici |

**Bağımlılık listesi üç paketten ibaret:** `express`, `cors`, `pg`. Hız sınırlayıcı,
`.env` okuyucu ve güvenlik başlıkları için paket eklemek yerine (`express-rate-limit`,
`dotenv`, `helmet`) her biri 60-80 satırda yazıldı. Sebep: her paket bir bakım ve tedarik
zinciri riskidir; bu boyuttaki işler için kendi kodunuzu okumak, başkasınınkine güvenmekten
kolaydır.

---

## 7. Kendin dene

**Olay döngüsünün kilitlendiğini kendi gözünüzle görün:**

```bash
node -e "
const crypto=require('crypto'); const salt=Buffer.alloc(16);
let t=Date.now();
setTimeout(()=>console.log('10 ms timer GERÇEKTE:', Date.now()-t,'ms sonra'),10);
crypto.pbkdf2Sync('x',salt,600000,32,'sha256');   // OLAY DÖNGÜSÜNÜ KİLİTLER
"
```

Beklenen: `10 ms timer GERÇEKTE: ~106 ms sonra`. Şimdi son satırdaki `pbkdf2Sync(...)`
yerine asenkron sürümü koyun:

```bash
node -e "
const crypto=require('crypto'); const salt=Buffer.alloc(16);
let t=Date.now();
setTimeout(()=>console.log('10 ms timer GERÇEKTE:', Date.now()-t,'ms sonra'),10);
crypto.pbkdf2('x',salt,600000,32,'sha256',()=>{});   // libuv havuzuna gider
"
```

Beklenen: `~11 ms sonra`. Aradaki fark, projenin login ucunun neden async olduğunun cevabı.

**Thread pool'un paralelliğini görün:**

```bash
node -e "
const crypto=require('crypto'); const salt=Buffer.alloc(16); let t=Date.now();
for(let i=0;i<4;i++) crypto.pbkdf2Sync('x',salt,600000,32,'sha256');
console.log('4 adet SIRAYLA:', Date.now()-t,'ms');
t=Date.now();
Promise.all([...Array(4)].map(()=>new Promise(r=>crypto.pbkdf2('x',salt,600000,32,'sha256',r))))
  .then(()=>console.log('4 adet PARALEL:', Date.now()-t,'ms'));
"
```

Beklenen: sırayla ~428 ms, paralel ~107 ms.

**Middleware zincirini logdan izleyin.** Sunucu açıkken bir istek atın:

```bash
curl -s "localhost:8085/api/facilities" -o /dev/null
```

Sunucu konsolunda `[2026-07-27T…] GET /api/facilities` satırını göreceksiniz — bu,
`server.js:78`'deki log middleware'inin çıktısı.

**Hız sınırlayıcının `next()` çağırmadığını görün:**

```bash
for i in $(seq 1 7); do
  printf "%s. deneme -> " "$i"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8085/api/auth/login \
    -H 'Content-Type: application/json' -d '{"username":"user","password":"yanlisparola"}'
done
```

Beklenen: `401 401 401 401 401 429 429`. Altıncıdan itibaren istek **handler'a hiç
ulaşmıyor** — sınırlayıcı zinciri kesiyor, dolayısıyla PBKDF2 de hiç çalışmıyor.
CPU tüketme vektörü tam olarak burada kapanıyor.

---

## 8. Mentör sorarsa

**"Node tek iş parçacıklı ise nasıl bu kadar isteğe yetişiyor?"**
> *"Çünkü isteklerin çoğu bekleme işidir — veritabanı, disk, ağ. Node bunları işletim
> sistemine devredip döngüyü boşa çıkarıyor. Tehlike hesap işlerinde: onları devredemez.
> Projemde o iş parola hash'lemesi ve ölçtüm — senkron sürüm olay döngüsünü 106 ms
> kilitliyor, asenkron sürüm 11 ms'ye düşürüyor. O yüzden HTTP yolunda her zaman asenkron
> sürümü kullanıyorum."*

**"Middleware sırası neden önemli?"**
> *"Zincir yukarıdan aşağı çalışıyor, bir halka `next()` çağırmazsa istek orada bitiyor.
> Projemde somut bir bağımlılık var: hız sınırlayıcı anahtarı kullanıcı adını içeriyor,
> yani `express.json()` ondan önce gelmek zorunda — yoksa `req.body` boş olur ve
> sınırlayıcı herkesi tek anahtara toplar."*

**"Bağlantı havuzu ne işe yarıyor, bir sorun çıkardı mı?"**
> *"Bağlantı kurmak pahalı, havuz onları yeniden kullanıyor; en fazla 10 eşzamanlı.
> Geçişte bir hata çıkardı: bir satırı yazıp hemen okuyordum, okuma havuzdan başka bir
> bağlantı aldı ve commit edilmemiş satırı göremedi. SQLite'ta tek bağlantı olduğu için
> hiç görünmemişti. Havuzlu sistemde 'aynı bağlantı' varsayımı yapılamaz."*

**"Neden `express-rate-limit`, `dotenv`, `helmet` kullanmadın?"**
> *"Üçünün projemde ihtiyacım olan kısmı toplam 200 satır. Paket eklemek bakım ve tedarik
> zinciri riski demek. Bu boyutta kendi kodumu okumak, başkasınınkine güvenmekten kolay.
> Bağımlılık listem üç pakette kaldı: express, cors, pg."*

**"Async handler'ı neden sarmaladın?"**
> *"Express 4, async handler'daki hatayı görmüyor — reddedilen Promise yakalanmıyor ve
> istek yanıt almadan asılı kalıyor. Sarmalayıcı reddi `next()`'e bağlıyor. 24 ucun
> hepsinde var; birini unutmak o uçtaki her hatayı sessiz bir asılmaya çevirirdi."*

---

## Sırada ne var

Sunucu tarafını bitirdik. Sırada kullanıcının gerçekten gördüğü kısım:
**[09 — Frontend ve harita](09-frontend-harita.md)**
