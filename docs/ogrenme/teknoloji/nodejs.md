# Node.js

## 1. Tek cümlede

Node.js, tarayıcı için tasarlanmış JavaScript motorunu (Google'ın V8'i) alıp sunucuda
çalıştıran, üstüne dosya/ağ/süreç yetenekleri ekleyen bir çalışma ortamıdır.

**Bu projede:** v22 (LTS). `backend/` altındaki her şey bunun üstünde koşuyor.

---

## 2. Hangi problemi çözmek için doğdu

2009'da Ryan Dahl'ın derdi somuttu: **bir dosya yüklenirken sunucunun beklemesi.**

O zamanki yaygın model (Apache + PHP) her isteğe bir iş parçacığı ayırıyordu. Her iş
parçacığı ~2 MB bellek. 10.000 eşzamanlı bağlantı = 20 GB bellek — çoğu **hiçbir şey
yapmadan**, sadece veritabanı ya da diskten yanıt beklerken. Bu, dönemin ünlü
"**C10K problemi**"ydi: on bin eşzamanlı bağlantıya nasıl yetişilir?

Dahl'ın cevabı: **beklemeyi kaldır.** Tek iş parçacığı, her işi devret, bitince geri dön.
Bekleme sırasında iş parçacığı boşta değil, başka isteklerle meşgul.

JavaScript'i seçmesinin sebebi de bu: JavaScript zaten olay tabanlıydı (tarayıcıda tıklama,
zamanlayıcı, ağ isteği hep geri çağırmayla çalışır) ve **hiç bloke edici standart
kütüphanesi yoktu.** Python ya da Ruby seçseydi, ekosistemdeki her bloke edici fonksiyon
modeli bozardı.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Python + FastAPI** | veri bilimi ekosistemi, okunabilirlik | frontend zaten JS; iki dil = iki zihinsel model |
| **Java + Spring** | olgun, kurumsal, güçlü tip sistemi | bu ölçek için ağır; kurulum ve derleme döngüsü uzun |
| **Go** | gerçek paralellik, tek binary | ekip/öğrenme maliyeti; JS deneyimi kullanılamaz |
| **PHP** | kurulumu en kolay, paylaşımlı hosting | istek başına süreç modeli; modern API için sürtünmeli |

**Belirleyici sebep:** Frontend zaten JavaScript. Tek dil demek, `docs/app.js` ile
`backend/db.js` arasında **bağlam değiştirmemek** demek. Öğrenme odaklı bir projede bu
gerçek bir kazanç: iki dilin tuzaklarını değil, bir dilin derinliğini öğreniyorsunuz.

**Node'un zayıf olduğu yer:** CPU yoğun iş. Video kodlama, büyük matris hesabı ya da makine
öğrenmesi yapıyorsanız Node yanlış araçtır. Bu projede tek CPU yoğun iş parola hash'lemesi
ve o da libuv havuzuna atılıyor (aşağıda).

---

## 4. Bu projede tam olarak nerede

```
backend/server.js      411 satır   24 HTTP ucu, middleware zinciri
backend/db.js          595 satır   SQL sorguları
backend/database.js    616 satır   havuz, migration, seed, transaction, parola
backend/analytics.js   215 satır   analitik agregasyonlar
backend/security.js     75 satır   JWT, HMAC imza
backend/weather.js     177 satır   OpenWeather + önbellek
backend/ratelimit.js    74 satır   kayan pencere sınırlayıcı
backend/env.js          59 satır   .env okuyucu
backend/validate.js     82 satır   girdi doğrulama
backend/geo.js          45 satır   ilçe geometrisi yükleyici
scripts/*.js                       veri üretimi, dışa aktarma, GTFS işleme
```

**Dış bağımlılık: yalnız 3 paket** — `express`, `cors`, `pg`. Hız sınırlayıcı, `.env`
okuyucu ve güvenlik başlıkları için paket eklemek yerine (`express-rate-limit`, `dotenv`,
`helmet`) her biri Node'un standart kütüphanesiyle yazıldı. Toplam 200 satır.

Kullanılan yerleşik modüller: `crypto` (PBKDF2, HMAC, rastgele sayı), `https` (OpenWeather,
İBB), `fs`/`path` (dosya), `zlib` (GTFS ZIP), `assert` (testler — test çatısı da yok).

---

## 5. Bilinmesi gereken üç tuzak

### (a) Olay döngüsünü bloke etmek — bu projede ölçüldü

```
crypto.pbkdf2Sync çalışırken  → 10 ms'lik zamanlayıcı gerçekte 106 ms sonra çalıştı
crypto.pbkdf2   çalışırken    → 10 ms'lik zamanlayıcı gerçekte  11 ms sonra çalıştı
```

Senkron sürümde **tüm sunucu** 106 ms donuyor. Bu yüzden HTTP yolundaki her parola işlemi
asenkron sürümü kullanıyor (`database.js:613-614` — iki sürüm ayrı ayrı dışa açık).

### (b) `libuv` havuzu 4 iş parçacıklıdır (varsayılan)

Asenkron `crypto`, `fs` ve `dns` çağrıları bu havuzu paylaşır. Beş eşzamanlı parola
doğrulaması gelirse beşincisi sıra bekler.

```
4 hash sırayla (sync):   428 ms
4 hash paralel (async):  107 ms      ← 4 havuz iş parçacığı
```

`UV_THREADPOOL_SIZE` ile artırılabilir ama çekirdek sayısından fazlası anlamsız.

### (c) `async` fonksiyondaki hata sessizce kaybolabilir

Express 4, `async` handler'da fırlatılan hatayı görmez: reddedilen Promise yakalanmaz,
istemci **yanıt almadan asılı kalır**. Hata mesajı bile yok. Projedeki çözüm:

```js
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
```

**24 ucun 24'ü** bununla sarılı. Bir tanesini unutmak o uçtaki her hatayı sessiz bir
asılmaya çevirirdi.

---

## 6. Kendin dene

```bash
node -v                                    # v22.x bekleniyor
node -e "console.log(require('os').cpus().length, 'çekirdek')"

# olay döngüsü kilidi
node -e "
const c=require('crypto'), s=Buffer.alloc(16); let t=Date.now();
setTimeout(()=>console.log('10ms timer →', Date.now()-t,'ms'),10);
c.pbkdf2Sync('x',s,600000,32,'sha256');"
```

---

## 7. Daha fazlası için

- Resmî doküman: <https://nodejs.org/docs/latest-v22.x/api/>
- Olay döngüsü rehberi: <https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick>
- Bu kitapta: [08 — Backend: Node ve Express](../08-backend-node-express.md)
