# ADR-010 — Canlı güncelleme: Server-Sent Events

- **Durum:** Kabul edildi
- **Tarih:** 2026-07-27
- **Bağlam:** Faz 9 — analiz panelinin canlı güncellenmesi

---

## Sorun

Analiz paneli veriyi yalnız **üç durumda** çekiyordu: sayfa açılışında, granülerlik
butonuna basınca, tema değişince. Kullanıcı sipariş verdiğinde grafikler olduğu gibi
kalıyor, değişikliği görmek için sayfayı **elle yenilemek** gerekiyordu.

Üstelik ekrandaki banner *"🟢 Canlı backend verisi (gerçek zamanlı sorgu)"* yazıyordu.
Bu **yanıltıcıydı**: sorgu gerçekten canlı backend'e gidiyordu, ama yalnız **bir kez**.
"Gerçek zamanlı" kelimesi karşılıksızdı.

Sunum açısından da kritik bir boşluk: DBeaver senaryosunun (ADR-007 sonrası eklenen
`docs/dbeaver-rehberi.md`) kalbi *"uygulamada işlem yap, veritabanında belirdiğini
göster"* anıdır. Aynı anın arayüz tarafı — *"sipariş ver, grafiğin büyüdüğünü göster"* —
mümkün değildi.

---

## Karar

**Server-Sent Events (SSE)** ile sunucudan tarayıcıya tek yönlü bir bildirim kanalı
açıldı. Sunucu bir mutasyondan sonra *"şu tür bir şey değişti"* işareti yayınlıyor;
tarayıcı işareti alınca **normal API ucundan taze veriyi çekip** grafikleri güncelliyor.

---

## Alternatifler

### (a) Yoklama (polling) — reddedildi

`setInterval` ile her N saniyede bir veriyi yeniden çekmek. En basit çözüm ve sunucuda
hiçbir değişiklik gerektirmiyor.

Reddedilme sebebi **aralık seçiminin iki ucunun da kötü olması**:

- **Kısa aralık (2-3 sn):** boşuna sorgu yağmuru. `/api/analytics/dashboard` **altı ayrı
  agregasyon** koşturuyor; hiçbir şey değişmese bile bunları saniyede bir tekrarlamak
  veritabanını gereksiz yorar.
- **Uzun aralık (30 sn):** sunumda ölü bekleme. "Sipariş verdim… şimdi bekleyelim…"

Ayrıca yoklama **ne zaman güncellendiğini bilmiyor** — kullanıcı ekrandaki sayının taze
mi bayat mı olduğunu anlayamıyor.

### (b) WebSocket — reddedildi

Çift yönlü, düşük gecikmeli, güçlü. Ama:

- **Burada tarayıcının sunucuya söyleyeceği bir şey yok.** Akış tamamen tek yönlü.
  WebSocket'in asıl değeri olan çift yönlülük kullanılmayacaktı.
- **Yeni bağımlılık gerektiriyor** (`ws`). Proje üç pakette duruyor (`express`, `cors`,
  `pg`) ve bunu bir *bildirim kanalı* için bozmak orantısız.
- Yeniden bağlanma, kalp atışı, durum yönetimi **elle** yazılmalı; SSE'de bunlar
  tarayıcıda yerleşik.

### (c) SSE — seçildi

- **Düz HTTP.** Sunucu tarafında ek paket yok: açık bir yanıt nesnesine yazmak yeterli.
- **`EventSource` tarayıcıda yerleşik** ve bağlantı koparsa **kendiliğinden yeniden
  bağlanıyor** (sunucu `retry:` alanıyla süreyi söylüyor).
- İhtiyacın şekliyle birebir örtüşüyor: tek yönlü, metin tabanlı, seyrek olay.

---

## Sözleşme: olay veri TAŞIMAZ

Yayınlanan kare yalnız bir **işaret**tir:

```
event: change
data: {"type":"order","at":"2026-07-27T13:42:43.013Z","action":"create"}
```

Verinin kendisi **yok**. İstemci işareti alınca normal API ucundan taze veriyi çekiyor.
İki sebep:

**1. Yetkilendirme tek yerde kalıyor.** Olayın içine veri koysaydık, o veriyi görmeye
kimin hakkı olduğunu **bir de burada** kontrol etmek gerekirdi — admin gözetim uçları
sahiplik filtresiz çalışıyor (ADR-007). İki ayrı yetki yolu, er ya da geç ayrışan iki
yetki yolu demektir.

**2. İstemci her zaman en güncel BÜTÜNÜ okuyor.** Yayın anı ile okuma anı arasında başka
yazmalar olabilir; parça parça birleştirme yapılmadığı için tutarsız bir ara duruma
düşmek mümkün değil.

Bu, bilinen **cache invalidation** desenidir: *"şu değişti" de, "yenisi şu" deme.*

---

## Uygulama notları

**Kimlik doğrulaması yok — bilinçli.** `EventSource` özel başlık göndermeyi desteklemiyor;
token'ı sorgu dizesine koymak onu tarayıcı geçmişine ve sunucu erişim loglarına yazar.
Olay hiçbir veri taşımadığı için buradaki maruziyet *"bir şey değişti"* bilgisinden
ibaret. Asıl veriyi çekerken yetki kontrolü ilgili uçta zaten yapılıyor.

**Kalp atışı (25 sn).** Ara katmanlar (nginx, Cloudflare) hareketsiz bağlantıyı kapatır.
Düzenli bir yorum satırı (`: ping`) baytların akmasını sağlıyor; yorum satırı olduğu için
istemcide olay tetiklemiyor. `X-Accel-Buffering: no` ve `Cache-Control: no-transform`
başlıkları da tamponlamayı engelliyor — **SSE'yi bozan en sık sebep budur.**

**Biriktirme (debounce, 400 ms).** Kullanıcı arka arkaya işlem yapabilir. Her olayda ayrı
ayrı 6 agregasyon koşturmak yerine 400 ms sessizlik bekleyip **tek** yenileme yapılıyor.
İnsan gözü için zaten anlık.

**`publish()` asla fırlatmaz.** Bildirim bir yan etkidir; asıl işlem (rezervasyon,
sipariş) çoktan commit edilmiştir. Buradaki bir hata kullanıcının isteğini başarısız
**göstermemelidir** — en kötü ihtimalle grafik geç güncellenir.

**Chart'lar yeniden yaratılmıyor, YERİNDE güncelleniyor.** `destroy()` + `new Chart()`
grafiği sıfırdan çizer: ekran bir an boşalır, yeni değer animasyonsuz belirir. Oysa canlı
güncellemede asıl istenen şey **çubuğun büyüdüğünü görmek**. `chart.update()` eski
veriden yeniye animasyon yapıyor. (Tek istisna tema değişimi: renkler `options` içine
gömülü olduğu için orada sıfırdan yaratmak zorunlu.)

---

## Sonuç

Gerçek bir tarayıcıyla ölçüldü (`order.html` yerine doğrudan API çağrısı, dashboard açık):

```
Sipariş: 3× Izgara Tavuk (180₺) + 3× Köfte Ekmek (150₺) = 990₺

2029 ciro çubuğu     :      0 ₺  →     990 ₺
Toplam Ciro KPI      : ₺106.439.975  →  ₺106.440.965   (fark tam 990 ₺)
Chart instance id    :      0  →  0    (AYNI → yerinde animasyonlu güncelleme)
Rozet                : "Sipariş değişti — grafikler güncellendi"
```

Rezervasyon için de aynı şekilde: `Rezervasyon 391.431 → 391.432`,
`Misafir 1.081.596 → 1.081.602` (+6, siparişteki `guests` ile birebir).

**Ekranda görünen kanıt.** Panelde artık bir canlı akış çubuğu var: bağlıyken yeşil nabız
atıyor, bir değişiklik geldiğinde *"Sipariş değişti — grafikler güncellendi"* yazıyor ve
**son güncelleme saatini** gösteriyor. Mentör *"bu gerçekten canlı mı?"* derse cevap
ekranda.

**Çevrimdışı/Pages modunda** sunucu olmadığı için itilecek olay da yok. Sessiz kalmak
yerine sebebi yazılıyor: *"Canlı akış yok — bu modda sunucu çalışmıyor (snapshot
okunuyor)."* Elle **↻ Yenile** butonu her iki modda da çalışıyor.

---

## Takas — dürüst kısım

- **Her tarayıcı sekmesi bir açık bağlantı tutuyor.** Node tek süreç olduğu için bu
  bellekte küçük ama sıfır değil. Yüzlerce eşzamanlı izleyicide bağlantı başına maliyet
  düşünülmeli; bu ölçekte sorun değil.
- **Olaylar süreç içinde tutuluyor.** Birden çok backend örneği çalıştırılırsa, bir
  örnekteki mutasyon diğerine bağlı istemcilere ulaşmaz. Çözümü bilinen (Redis pub/sub
  gibi bir dış kanal) ama tek düğümlü bu proje için gereksiz karmaşıklık.
- **Olay kaybı telafi edilmiyor.** Bağlantı koptuğu sırada yayınlanan olay kaçar.
  Tarayıcı yeniden bağlanınca **tam yenileme** yaptığı için sonuç yine doğru olur —
  yani kayıp, gecikmeye dönüşüyor, hataya değil. (SSE'nin `Last-Event-ID` mekanizması
  bunu çözebilirdi ama olaylar veri taşımadığı için gerek yok.)

---

## İlgili

- ADR-004 (analitik: canlı sorgu + rollup)
- ADR-007 (admin gözetim uçları, sahiplik filtresiz — yetki neden tek yerde kalmalı)
- `backend/events.js`, `backend/test-events.js`, `docs/dashboard.js`
- Öğrenme kitabı: [12 — Canlı güncelleme](../ogrenme/12-canli-guncelleme.md),
  [teknoloji/sse.md](../ogrenme/teknoloji/sse.md)
