# 12 — Canlı güncelleme: ekran veriyi nasıl "takip eder"?

> [01. bölümde](01-web-nasil-calisir.md) HTTP'nin **durumsuz** olduğunu öğrendik: istek
> gider, yanıt gelir, bağlantı biter. Peki o zaman sunucu bize kendiliğinden nasıl haber
> verebilir? Bu bölüm o sorunun cevabı.

---

## 1. Bir cümlede

Sunucu, tarayıcıya açık bıraktığı bir bağlantı üstünden *"bir şey değişti"* diye
seslenebilir; tarayıcı da bunu duyunca taze veriyi çekip ekranı günceller.

---

## 2. Benzetme: gazete aboneliği vs bayiye gitmek

**Bayiye gitmek** = *yoklama* (polling). Her sabah bayiye gidip "yeni gazete var mı?"
diye sorarsınız. Çoğu gün cevap "hayır" olsa da yolu yürümüşsünüzdür.

**Abonelik** = *itme* (push). Gazete çıktığında kapınıza gelir. Boşuna yürüme yok, ve
gecikme yok.

**Benzetme nerede bozuluyor — ve bu proje için önemli:** Gazete aboneliğinde kapınıza
gelen şey **gazetenin kendisidir**. Bu projede kapınıza gelen şey yalnız bir **not**:
*"yeni sayı çıktı."* Gazeteyi hâlâ siz alıyorsunuz.

Bu tuhaf görünebilir ama bilinçli bir karar ve sebebi birazdan (bölüm 5) — özetle:
**yetkiyi tek yerde tutmak için.**

---

## 3. Şimdi biraz daha derin: üç yol

Sunucudan tarayıcıya haber ulaştırmanın üç yaygın yolu var.

### (a) Yoklama (polling)

```js
setInterval(() => fetch('/api/analytics/dashboard').then(render), 5000);
```

Basit, sunucuda hiçbir şey değişmiyor. Ama aralık seçiminin **iki ucu da kötü**:

| Aralık | Sorun |
|---|---|
| 2-3 sn | Boşuna sorgu yağmuru. Bu projede dashboard sorgusu **altı ayrı agregasyon** koşturuyor; hiçbir şey değişmese bile. |
| 30 sn | Sunumda ölü bekleme: *"sipariş verdim… şimdi bekleyelim…"* |

Ayrıca yoklama **taze mi bayat mı** olduğunu bilmiyor.

### (b) WebSocket

Tarayıcı ile sunucu arasında **çift yönlü**, sürekli açık bir kanal. Sohbet uygulaması,
çok oyunculu oyun, işbirlikçi editör — hepsi bunu kullanır.

Güçlü. Ama bu projede tarayıcının sunucuya söyleyeceği bir şey **yok**; akış tamamen tek
yönlü. Üstelik `ws` paketi gerektiriyor ve proje üç bağımlılıkta duruyor.

### (c) Server-Sent Events (SSE) — projenin seçimi

Tarayıcı normal bir `GET` isteği atar, ama sunucu yanıtı **bitirmez**. Bağlantı açık
kalır ve sunucu istediği zaman içine metin yazar.

```
GET /api/events
Content-Type: text/event-stream       ← "bu yanıt bitmeyecek"

retry: 3000
event: hello
data: {"clientId":1,"at":"2026-07-27T13:42:40.810Z"}

event: change
data: {"type":"reservation","at":"2026-07-27T13:42:43.013Z","action":"create"}
```

Boş satır bir kareyi bitirir. Format bu kadar basit — düz metin.

Tarayıcı tarafında **hiçbir kütüphane gerekmiyor**, `EventSource` yerleşik:

```js
const es = new EventSource('/api/events');
es.addEventListener('change', () => refresh());
```

Ve bağlantı koparsa **kendiliğinden yeniden bağlanıyor** — sunucunun gönderdiği
`retry: 3000` ile "3 saniye sonra tekrar dene" der.

### Karşılaştırma

| | Yoklama | SSE | WebSocket |
|---|---|---|---|
| Yön | istemci→sunucu (tekrar tekrar) | sunucu→istemci | çift yönlü |
| Protokol | HTTP | HTTP | ws:// (yükseltme) |
| Sunucuda ek paket | yok | **yok** | `ws` gerekir |
| Tarayıcıda | `fetch` | **`EventSource` (yerleşik)** | `WebSocket` (yerleşik) |
| Otomatik yeniden bağlanma | — | **var** | elle yazılır |
| Gecikme | aralık kadar | anında | anında |
| Ne zaman doğru seçim | veri çok seyrek değişiyorsa | **bildirim, canlı gösterge** | sohbet, oyun, ortak düzenleme |

---

## 4. Projede tam olarak nerede

### Sunucu tarafı — `backend/events.js` (114 satır, sıfır bağımlılık)

```js
const clients = new Set();

const subscribe = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  clients.add({ id: nextId++, res });      // res.end() ÇAĞIRILMIYOR - bağlantı yaşıyor
  req.on('close', cleanup);
};

const publish = (type, detail = {}) => {
  const frame = `event: change\ndata: ${JSON.stringify({ type, at: …, ...detail })}\n\n`;
  for (const c of clients) c.res.write(frame);
};
```

`backend/server.js` her mutasyondan sonra haber veriyor — **10 yerde**:

```js
events.publish('reservation', { action: 'create', facilityId });
events.publish('order',       { action: 'create', reservationId });
events.publish('facility',    { action: 'delete' });
…
```

### Tarayıcı tarafı — `docs/dashboard.js`

```js
es.addEventListener('change', (e) => {
  clearTimeout(burstTimer);
  burstTimer = setTimeout(async () => {
    await refresh(false);      // ← taze veriyi ÇEK, chart'ları YERİNDE güncelle
    setLive('hit', `${TYPE_LABEL[type]} değişti — grafikler güncellendi`);
  }, 400);
});
```

### Ekrandaki kanıt

Panelin üstünde bir **canlı akış çubuğu** var:

- Bağlıyken yeşil nokta **nabız atıyor** → "Canlı akış bağlı"
- Değişiklik gelince → "**Sipariş değişti — grafikler güncellendi**"
- Yanında **son güncelleme saati**

Mentör *"bu gerçekten canlı mı?"* derse cevap ekranda duruyor.

---

## 5. İki tasarım kararı — asıl öğretici kısım

### Karar 1: Olay VERİ taşımıyor

Yayınlanan kare şu:

```json
{"type":"order","at":"2026-07-27T13:42:43.013Z","action":"create"}
```

Siparişin tutarı yok, kalemleri yok, hiçbir şey yok. Sadece *"bir sipariş oluştu."*

**Neden veriyi de göndermiyoruz?** İlk bakışta israf gibi: zaten sunucudayız, veriyi de
koyalım, tarayıcı ikinci bir istek atmasın.

İki sebep:

**(a) Yetkilendirme tek yerde kalıyor.** Olayın içine veri koysaydık, *"bu veriyi görmeye
kimin hakkı var?"* sorusunu **bir de burada** cevaplamak gerekirdi. Admin gözetim uçları
sahiplik filtresiz çalışıyor ([ADR-007](../adr/ADR-007-admin-yonetim.md)) — yani bir
siparişi kimin görebileceği basit bir kural değil. İki ayrı yetki yolu, er ya da geç
**ayrışan** iki yetki yoludur.

**(b) Tutarsız ara duruma düşmek imkânsız.** Tarayıcı her seferinde en güncel **bütünü**
okuyor; parça parça birleştirme yapmıyor. Yayın anı ile okuma anı arasında başka yazmalar
olsa bile sonuç doğru.

> Bu, bilgisayar biliminde bilinen bir desendir: **cache invalidation.**
> *"Şu değişti" de, "yenisi şu" deme.*

### Karar 2: Chart'lar yeniden yaratılmıyor

Panel eskiden her yenilemede tüm grafikleri `destroy()` edip `new Chart()` ile
yeniden kuruyordu. Canlı güncelleme için bu **yanlış**:

```js
// YANLIŞ: ekran bir an boşalır, yeni değer animasyonsuz belirir
chart.destroy(); new Chart(ctx, config);

// DOĞRU: eski değerden yeniye animasyon yapar
chart.data.datasets[0].data = yeniVeri;
chart.update();
```

Canlı güncellemede asıl istediğimiz şey **çubuğun büyüdüğünü görmek**. Sunumda
*"sipariş verdim, bakın ciro yükseldi"* anı tam olarak buradan çıkıyor.

Tek istisna **tema değişimi**: renkler `options` içine gömülü olduğu için orada sıfırdan
yaratmak zorunlu. Kod bunu `rebuild` bayrağıyla ayırıyor.

---

## 6. Kendin dene

**SSE akışını çıplak gözle görün.** Terminalde:

```bash
curl -sN localhost:8085/api/events
```

Bekleyin — bağlantı kapanmıyor. Şimdi **başka bir terminalde** bir rezervasyon yapın:

```bash
cd /home/user/sosyal_tesis_etkile-imli
TOKEN=$(curl -s -X POST localhost:8085/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"user\",\"password\":\"$(node -pe "require('./data/dev-credentials.json').users.user")\"}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

curl -s -X POST localhost:8085/api/reservations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"facilityId":1,"reserveDate":"2029-03-15","reserveTime":"19:00","guests":2,"highchairCount":0}'
```

İlk terminalde anında belirir:

```
event: change
data: {"type":"reservation","at":"…","action":"create","facilityId":1}
```

**Kaç kişi dinliyor?**

```bash
curl -s localhost:8085/api/events/status
# {"clients":1,"heartbeatMs":25000}
```

**Kalp atışını görün.** `curl -sN` ile 25 saniye bekleyin; düzenli olarak
`: ping 1785…` satırları düşer. Bunlar **yorum satırı** (`:` ile başlıyor), istemcide
olay tetiklemez — yalnız bağlantıyı canlı tutar.

**Asıl gösteriyi görün.** İki pencere açın:

```bash
npm start                                  # 1. terminal
cd docs && python3 -m http.server 8092     # 2. terminal
```

Tarayıcıda `localhost:8092/dashboard.html` (canlı akış çubuğu yeşil yanmalı) ve
`localhost:8092/order.html`. Sipariş verin, **dashboard'a hiç dokunmadan** grafiklerin
güncellendiğini görün.

**Testler:**

```bash
node backend/test-events.js
```

---

## 7. Mentör sorarsa

**"Grafikler nasıl kendiliğinden güncelleniyor?"**
> *"Server-Sent Events ile. Sunucu bir rezervasyon ya da sipariş yazıldığında açık bir
> HTTP bağlantısı üstünden 'değişti' işareti gönderiyor; tarayıcı işareti alınca taze
> veriyi normal analytics ucundan çekip grafikleri yerinde güncelliyor."*

**"Neden WebSocket kullanmadın?"**
> *"WebSocket çift yönlü ve burada tarayıcının sunucuya söyleyeceği bir şey yok — akış
> tek yönlü. Üstelik `ws` paketi gerektiriyordu, projem üç bağımlılıkta duruyor. SSE düz
> HTTP üstünde çalışıyor, sunucuda ek paket yok, tarayıcıda `EventSource` yerleşik ve
> kopan bağlantıyı kendisi yeniden kuruyor."*

**"Neden yoklama yapmadın? Daha basit değil mi?"**
> *"Basit ama aralık seçiminin iki ucu da kötü. Dashboard sorgum altı ayrı agregasyon
> koşturuyor; 3 saniyede bir tekrarlamak hiçbir şey değişmese bile veritabanını boşuna
> yorar. 30 saniye yaparsam sunumda ölü bekleme oluyor. SSE'de gecikme yok ve boşuna
> sorgu da yok."*

**"Olayın içine veriyi de koysaydın bir istek tasarruf ederdin."**
> *"Bilerek koymadım. Veriyi olaya koysaydım 'bunu görmeye kimin hakkı var' sorusunu bir
> de orada cevaplamam gerekirdi — admin gözetim uçlarım sahiplik filtresiz çalışıyor,
> yani basit bir kural değil. İki ayrı yetki yolu zamanla ayrışır. Bu yüzden olay yalnız
> 'şu değişti' diyor; asıl veriyi çekerken yetki kontrolü tek yerde kalıyor. Buna cache
> invalidation deseni deniyor."*

**"Bağlantı koparsa ne oluyor?"**
> *"`EventSource` kendiliğinden yeniden bağlanıyor; sunucu `retry: 3000` ile süreyi
> söylüyor. Kopukluk sırasında yayınlanan olay kaçar, ama tarayıcı yeniden bağlanınca tam
> yenileme yaptığı için sonuç yine doğru olur — yani kayıp hataya değil, gecikmeye
> dönüşüyor. Ayrıca ekranda 'canlı akış koptu' yazıyor, kullanıcı bayat veriye
> bakmıyor."*

**"Bu, birden çok sunucuyla çalışır mı?"**
> *"Hayır ve bunu ADR-010'da yazdım. Olaylar süreç içinde tutuluyor; iki backend örneği
> çalıştırırsam birindeki değişiklik diğerine bağlı istemcilere ulaşmaz. Çözümü belli —
> Redis pub/sub gibi bir dış kanal — ama tek düğümlü bu proje için gereksiz karmaşıklık.
> Ölçek gerekince eklenecek yer belli."*

---

## Sırada ne var

Katmanlı kitabın son teknik bölümü buydu. Terimler için: **[11 — Sözlük](11-sozluk.md)**
Derinlemesine: **[`teknoloji/sse.md`](teknoloji/sse.md)**
Karar gerekçesi: **[ADR-010](../adr/ADR-010-canli-guncelleme.md)**
