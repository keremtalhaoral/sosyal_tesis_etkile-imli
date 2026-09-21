# Express

## 1. Tek cümlede

Express, Node'un ham HTTP sunucusunun üstüne "hangi URL hangi fonksiyona gitsin" ve
"istek şu halkalardan geçsin" düzenini ekleyen **ince** bir kütüphanedir.

**Bu projede:** v4.19.2, `backend/server.js`, 24 uç.

---

## 2. Hangi problemi çözmek için doğdu

Node'un yerleşik `http` modülüyle bir sunucu yazmak mümkündür, ama şöyle görünür:

```js
http.createServer((req, res) => {
  if (req.url === '/api/facilities' && req.method === 'GET') { … }
  else if (req.url.startsWith('/api/facilities/') && req.method === 'DELETE') {
    const id = req.url.split('/')[3];   // elle ayrıştırma
    …
  }
  // gövdeyi okumak: 'data' olaylarını biriktir, sonra JSON.parse, sonra try/catch
});
```

Üç uçta katlanılır, yirmi dörtte çekilmez. Express 2010'da üç şeyi standartlaştırdı:

1. **Yönlendirme** — `app.get('/api/facilities/:id', …)`, parametre otomatik ayrıştırılır.
2. **Middleware zinciri** — ortak işleri (log, CORS, gövde ayrıştırma, kimlik doğrulama)
   handler'lardan ayırmak.
3. **Yanıt yardımcıları** — `res.json(…)`, `res.status(404)`.

**Kritik nokta: Express bir çatı (framework) değil, bir kütüphanedir.** Size ORM,
şablon motoru, klasör yapısı ya da yaşam döngüsü dayatmaz. Ne koyarsanız o olur. Bu hem
gücü hem zayıflığı.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Ham `http` modülü** | sıfır bağımlılık | 24 uçta yönlendirme kodu asıl işi gölgeler |
| **Fastify** | ~2× hızlı, şema tabanlı doğrulama | performans darboğazı burada değil (veritabanı ve PBKDF2); Express'in dokümantasyonu ve örnek havuzu öğrenme için daha geniş |
| **NestJS** | yapı dayatır, büyük ekipte iyi | dekoratör + DI + modül sistemi bu boyutta gereksiz kavramsal yük |
| **Koa** | daha modern async modeli | ekosistemi küçük; Express 4'ün async tuzağı 3 satırla çözülüyor |

**Belirleyici sebep:** Öğrenme odaklı bir projede, en çok belgelenmiş ve en çok örneği olan
araç değerlidir. Ayrıca Express'in ince olması bir **avantaj**: middleware zincirinin nasıl
çalıştığını gerçekten görebiliyorsunuz, çünkü arada sihir yok.

---

## 4. Bu projede tam olarak nerede

Middleware zinciri (`backend/server.js`, sırayla):

```
app.use(cors(...))                    :63   başka kaynaktan erişim
app.use(güvenlik başlıkları)          :67   nosniff / DENY / no-referrer
app.use(express.json({limit:'100kb'})) :75  gövdeyi req.body'ye çevir
app.use(log middleware)               :78   konsola metod + URL
```

Sonra uç bazlı middleware:

```js
app.post('/api/auth/login',   loginLimiter, asyncHandler(…));   // hız sınırı
app.post('/api/reservations', requireAuth,  asyncHandler(…));   // giriş şart
app.get('/api/admin/…',       requireAdmin, asyncHandler(…));   // admin şart
```

En sonda dört argümanlı **hata middleware'i** (`:380`) — Express bir middleware'in
4 parametresi varsa onu hata yakalayıcı sayar.

---

## 5. Bilinmesi gereken üç tuzak

### (a) Middleware sırası bir bağımlılıktır — bu projede somut

Hız sınırlayıcının anahtarı `${req.ip}|${req.body.username}`. Eğer `express.json()`
sınırlayıcıdan **sonra** gelseydi, `req.body` `undefined` olurdu ve sınırlayıcı **tüm
kullanıcıları tek anahtara** toplardı. Yani bir kişinin 5 hatalı denemesi, aynı IP'deki
herkesi kilitlerdi.

Genel kural: bir middleware'in okuduğu şeyi **üreten** middleware ondan önce olmalı.

### (b) `async` handler'ın hatası Express 4'e ulaşmaz

Express 5 bunu düzeltti ama proje 4 kullanıyor. Çözüm `asyncHandler` sarmalayıcısı
(→ [nodejs.md](nodejs.md), tuzak c). Belirti sinsi: hata **mesajı yok**, istek sadece
asılı kalıyor.

### (c) `next()` çağırmayan middleware zinciri sessizce keser

```js
const requireAuth = (req, res, next) => {
  if (!user) return res.status(401).json({…});   // next() YOK → zincir burada biter
  req.user = user;
  next();                                        // ← bunu unutursanız istek asılır
};
```

Bu **bazen istenen** davranıştır (yetkisiz isteği durdurmak), bazen hatadır (`next()`
unutmak). İkisi arasındaki fark sadece niyettir; kod aynı görünür.

> Projede bunun yararlı yüzü: hız sınırı aşıldığında `429` dönülüp `next()`
> çağrılmadığı için, PBKDF2 **hiç çalışmıyor**. CPU tüketme vektörü tam olarak burada
> kapanıyor — sınırlayıcı zincirin başında olduğu için.

---

## 6. Kendin dene

```bash
# middleware log'unu görün (sunucu konsolunda belirir)
curl -s localhost:8085/api/facilities -o /dev/null

# zincirin kesildiğini görün: 6. denemede handler'a hiç ulaşılmıyor
for i in $(seq 1 7); do
  printf "%s -> " "$i"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8085/api/auth/login \
    -H 'Content-Type: application/json' -d '{"username":"user","password":"yanlis"}'
done
# beklenen: 401 401 401 401 401 429 429

# gövde limitini görün (100kb üstü reddedilir)
node -e "console.log(JSON.stringify({x:'a'.repeat(200000)}))" > /tmp/buyuk.json
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8085/api/auth/login \
  -H 'Content-Type: application/json' --data-binary @/tmp/buyuk.json
# beklenen: 413 (Payload Too Large)
```

---

## 7. Daha fazlası için

- Resmî doküman: <https://expressjs.com/en/4x/api.html>
- Middleware rehberi: <https://expressjs.com/en/guide/using-middleware.html>
- Bu kitapta: [08 — Backend: Node ve Express](../08-backend-node-express.md)
