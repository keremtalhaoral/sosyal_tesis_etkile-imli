# Server-Sent Events (SSE)

## 1. Tek cümlede

SSE, sunucunun bir HTTP yanıtını **bitirmeyip** açık tutarak, istediği zaman tarayıcıya
metin mesajı göndermesini sağlayan W3C standardıdır.

**Bu projede:** `backend/events.js` (114 satır, sıfır bağımlılık) + `docs/dashboard.js`.
Grafiklerin canlı güncellenmesi bunun üstünde çalışıyor (ADR-010).

---

## 2. Hangi problemi çözmek için doğdu

HTTP tek bir varsayım üstüne kurulu: **istemci sorar, sunucu cevaplar.** Sunucunun
kendiliğinden konuşmasının yolu yok. 2000'lerde bunu aşmak için kullanılan hileler
dönemin acısını iyi anlatır:

- **Yoklama (polling):** her N saniyede bir "değişti mi?" diye sormak. Çoğu istek boşa.
- **Uzun yoklama (long polling):** sunucu isteği **bekletiyor**, bir şey olunca cevap
  veriyor, istemci hemen yeni istek açıyor. İşe yarıyordu ama her mesaj yeni bir HTTP
  el sıkışması demekti.
- **Gizli `<iframe>`, `<script>` hileleri** ("Comet" desenleri) — kırılgan ve tarayıcıya
  göre değişken.

2006'da Opera'nın önerdiği, sonra HTML5'e giren fikir çok basitti: *"Yanıtı bitirmesek?"*

```
Content-Type: text/event-stream
```

Bu başlığı gören tarayıcı, yanıtın **akış** olduğunu anlar ve gelen her kareyi olay
olarak tetikler. WebSocket'ten (2011) beş yıl önce, ve çok daha küçük bir fikirle.

**SSE'nin WebSocket karşısında hâlâ yaşamasının sebebi:** HTTP'den ayrılmaması. Proxy'ler,
güvenlik duvarları, HTTP/2 çoğullama, `Authorization` başlığı, sıkıştırma — hepsi olduğu
gibi çalışır. WebSocket protokol yükseltmesi (`Upgrade: websocket`) yaptığı için bu
altyapının bir kısmını kaybeder.

---

## 3. Format — şaşırtıcı derecede basit

Düz metin. Boş satır bir kareyi bitirir.

```
retry: 3000
event: hello
data: {"clientId":1,"at":"2026-07-27T13:42:40.810Z"}

event: change
data: {"type":"order","action":"create"}

: ping 1785157423000
```

| Alan | Anlamı |
|---|---|
| `data:` | mesaj gövdesi (birden çok satır olabilir, `\n` ile birleşir) |
| `event:` | olay adı → `addEventListener('change', …)` ile dinlenir. Yoksa `onmessage` |
| `id:` | olay kimliği. Tarayıcı yeniden bağlanırken `Last-Event-ID` başlığıyla geri gönderir |
| `retry:` | kopunca kaç ms sonra yeniden denensin |
| `:` ile başlayan satır | **yorum** — olay tetiklemez, yalnız bağlantıyı canlı tutar |

Tarayıcı tarafı tek satır:

```js
const es = new EventSource('/api/events');
es.addEventListener('change', (e) => console.log(JSON.parse(e.data)));
```

**Yeniden bağlanma yerleşik.** Bağlantı koparsa `EventSource` kendisi tekrar dener.
WebSocket'te bunu elle yazmanız gerekir.

---

## 4. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Yoklama** | en basit, sunucuda değişiklik yok | aralık kısaysa 6 agregasyonluk sorgu yağmuru, uzunsa sunumda ölü bekleme |
| **WebSocket** | çift yönlü, ikili veri, en düşük gecikme | akış tek yönlü — çift yönlülük kullanılmayacak; `ws` paketi gerekir (proje 3 bağımlılıkta) |
| **Uzun yoklama** | çok eski tarayıcılarda çalışır | her mesaj yeni HTTP el sıkışması; SSE zaten her yerde destekli |
| **WebRTC data channel** | eşler arası, çok düşük gecikme | tamamen farklı problem (P2P); burada sunucu→istemci yayın var |

**Ne zaman SSE değil WebSocket seçilmeli?** İstemcinin de sürekli konuşması gerekiyorsa:
sohbet, çok oyunculu oyun, işbirlikçi editör, canlı imleç konumu. Kural basit —
**akış tek yönlüyse SSE, çift yönlüyse WebSocket.**

---

## 5. Bu projede tam olarak nerede

```
backend/events.js       abone listesi + publish + kalp atışı
backend/server.js:349   GET /api/events        → SSE akışı
backend/server.js:354   GET /api/events/status → kaç dinleyici var (tanı)
backend/server.js       10 mutasyon noktasında events.publish(...)
docs/dashboard.js       EventSource + biriktirme + yerinde chart güncelleme
backend/test-events.js  15 test (gerçek HTTP sunucusu, gerçek akış)
```

Yayınlanan olay türleri: `reservation`, `order`, `facility`, `ispark`, `user`.

**Sözleşme: olay veri taşımaz.** Kare yalnız *"şu tür bir şey değişti"* der; istemci taze
veriyi normal API ucundan çeker. Gerekçesi [ADR-010](../../adr/ADR-010-canli-guncelleme.md)
ve [12. bölümde](../12-canli-guncelleme.md) — özetle yetkilendirmenin tek yerde kalması.

---

## 6. Bilinmesi gereken üç tuzak

### (a) Tamponlama — SSE'yi bozan **bir numaralı** sebep

Ara katmanlar (nginx, Cloudflare, bazı kurumsal proxy'ler) yanıtı **tamponlar**: yeterince
bayt birikene kadar istemciye hiçbir şey göndermez. SSE için bu ölümcül — mesajlarınız
sunucudan çıkar ama tarayıcıya ulaşmaz ve **hiçbir hata görmezsiniz.**

Projedeki üç önlem:

```js
'Cache-Control': 'no-cache, no-transform',   // proxy sıkıştırıp dönüştürmesin
'X-Accel-Buffering': 'no',                   // nginx'e özel: tamponlama
'Connection': 'keep-alive',
```

`test-events.js` bu başlıkları **test ediyor** — birinin sessizce kaybolması geri gelmesi
zor bir hata olurdu.

### (b) Bağlantı zaman aşımı → kalp atışı şart

Hareketsiz bir bağlantıyı ara katmanlar bir süre sonra kapatır (tipik olarak 30-60 sn).
Kullanıcı hiçbir şey yapmazsa akış sessizce ölür.

Çözüm: düzenli aralıklarla **yorum satırı** göndermek.

```js
setInterval(() => { for (const c of clients) c.res.write(`: ping ${Date.now()}\n\n`); }, 25000);
```

`:` ile başladığı için istemcide olay tetiklemez — yalnız baytlar akar ve bağlantı canlı
kalır. 25 sn, yaygın 30 sn eşiğinin altında kalacak şekilde seçildi.

### (c) `EventSource` özel başlık gönderemez

```js
new EventSource('/api/events', { headers: { Authorization: '…' } });   // ÇALIŞMAZ
```

Spesifikasyon bunu desteklemiyor. Üç seçenek kalıyor:

1. **Çerez** ile kimlik — ama bu proje oturumu `Authorization` başlığıyla taşıyor
   (bilinçli: klasik CSRF yüzeyi yok).
2. **Token'ı sorgu dizesine** koymak — tarayıcı geçmişine ve sunucu erişim loglarına
   yazılır. Kötü.
3. **Ucu kimliksiz bırakmak** — ancak olay hiçbir veri taşımıyorsa güvenli.

Proje üçüncüsünü seçti; bunu mümkün kılan şey tam olarak *"olay veri taşımaz"*
sözleşmesi. İki karar birbirine bağlı.

> **Not:** `EventSource` polyfill'leri (ör. `event-source-polyfill`) başlık desteği
> ekler. Bu projede gerek yok — ve bir paket daha eklemek istemedik.

---

## 7. Kendin dene

```bash
# akışı çıplak gözle izleyin (kapanmaz, Ctrl+C ile çıkın)
curl -sN localhost:8085/api/events

# başka bir terminalde tetikleyin
cd /home/user/sosyal_tesis_etkile-imli
TOKEN=$(curl -s -X POST localhost:8085/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"user\",\"password\":\"$(node -pe "require('./data/dev-credentials.json').users.user")\"}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
curl -s -X POST localhost:8085/api/reservations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"facilityId":1,"reserveDate":"2029-03-15","reserveTime":"19:00","guests":2,"highchairCount":0}'

# kaç dinleyici var?
curl -s localhost:8085/api/events/status

# testler
node backend/test-events.js
```

**Başlıkları görün** (tamponlama önlemleri):

```bash
timeout 5 curl -sN -D - localhost:8085/api/events -o /dev/null | head -9
```

`curl -I` (HEAD) burada **işe yaramaz ve asılı kalır**: uç yanıtı hiç bitirmiyor, bu
yüzden `curl` gövde sonunu sonsuza dek bekler. `-D -` başlıkları yazdırır, `timeout` da
akışı keser. (Bu, SSE'yi elle denerken herkesin bir kez düştüğü tuzak.)

Beklenen:
```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

**Kalp atışını görün:** `curl -sN` ile 30 saniye bekleyin — düzenli `: ping …` satırları.

---

## 8. Daha fazlası için

- Spesifikasyon (WHATWG HTML, Server-sent events):
  <https://html.spec.whatwg.org/multipage/server-sent-events.html>
- MDN `EventSource`: <https://developer.mozilla.org/docs/Web/API/EventSource>
- Bu kitapta: [12 — Canlı güncelleme](../12-canli-guncelleme.md)
- Karar gerekçesi: [ADR-010](../../adr/ADR-010-canli-guncelleme.md)
- İlgili: [express.md](express.md), [chartjs.md](chartjs.md), [nodejs.md](nodejs.md)
