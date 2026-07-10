# ADR-005: Müşteri Sipariş Akışı

- **Durum:** Kabul edildi
- **Faz / Dal:** `v2-05-ordering`
- **Tarih:** 2026-07
- **Referans:** DDIA Böl. 7 (Transactions), Böl. 11 (captured vs derived data)
- **İlgili:** `backend/db.js` (createOrder), `docs/order.html`/`order.js`, `ADR-001` (sipariş↔rezervasyon)

## Bağlam

Mentör 4.c: "Müşteri sipariş verebilmeli." Veri modeli v2-01'de kuruldu (orders/order_items/
menu_items; sipariş rezervasyona bağlı — Cevap 1). Bu faz **kullanıcı-facing akışı** ekler.
Kararlar: **iki giriş yolu** (yeni sipariş + mevcut rezervasyona sipariş); **basit yaşam
döngüsü** (müşteri oluşturur → simüle ödeme → `paid`; personel adımı v2-07'ye).

## Karar 1 — Sipariş = tek atomik transaction, sunucu-tarafı tutar

**Karar:** `createOrder` tek `transaction()` (BEGIN IMMEDIATE) içinde: sahiplik doğrula →
kalemleri tesis menüsüyle doğrula → fiyatı snapshot'la → orders + order_items INSERT → total
hesapla → rezervasyon tutarını artır. Toplam **sunucuda** hesaplanır; istemcinin gönderdiği
fiyata/tutara güvenilmez.

**Neden:** Sipariş çok adımlı bir yazma; yarıda kalırsa (geçersiz kalem) tamamı geri alınmalı
(atomiklik, Böl. 7). Tutarı istemciye bırakmak güvenlik açığıdır (fiyat manipülasyonu) —
sunucu menüden okur.

## Karar 2 — Fiyat snapshot'ı pekiştirildi (captured vs derived)

**Karar:** `order_items.unit_price_minor` sipariş anındaki menü fiyatını dondurur; `orders.
total_minor` bundan hesaplanır. Menü fiyatı sonradan değişse bile geçmiş sipariş değişmez.

**Neden (Böl. 11):** Geçmiş sipariş bir **olgu**; canlı menü değişken durum. Test ediyor:
sipariş sonrası menü fiyatını değiştirdik, sipariş kalemi ve toplamı sabit kaldı.

## Karar 3 — Sahiplik zorlaması

**Karar:** Sipariş yalnız **kendi rezervasyonuna** verilebilir; sorgular da sahiplik kontrollü
(`getOrdersByReservation` sahibi değilse `null` → API 403). Rezervasyon→user_id üzerinden.

**Neden:** Yetkilendirme sınırı. Başka kullanıcının rezervasyonuna sipariş = 403 (testli).

## Karar 4 — İki giriş yolu, basit yaşam döngüsü

**Karar:** (A) "Yeni Sipariş": tesis+tarih+slot+kişi ile rezervasyon oluştur, aynı akışta sipariş
ver (frontend `POST /reservations` → `POST /orders` orkestrasyonu; backend ortogonal kalır).
(B) "Siparişlerim": mevcut rezervasyonları listele, siparişlerini gör. Yaşam döngüsü basit:
`paid` (simüle ödeme); `served`/personel durumları admin fazına (v2-07).

**Neden:** Kullanıcı "ikisi de" dedi. Backend'i birleşik uca zorlamak yerine frontend'in iki
uç çağırması, backend'i temiz/ortogonal tutar (tek sorumluluk).

## Karar 5 — Frontend: ayrı sipariş sayfası (legacy app.js cerrahisi yerine)

**Karar:** Sipariş UI'ı, 1900 satırlık legacy `docs/app.js`'e riskli müdahale yerine **ayrı,
kendi içinde bütün `docs/order.html` + `order.js`** olarak kuruldu (dashboard deseni). Çift mod:
canlı backend varsa gerçek API; yoksa (Pages) `localStorage` + `seed.json` mock. Görsel kalite
dashboard ile tutarlı (kart/rozet, açık/koyu tema).

**Neden:** Legacy dosyanın kendi API sözleşmesi (snake_case, 'reserve'/'menu' mock uçları) var;
oraya sepet mantığı örmek kırılgan ve test edilmesi zor olurdu. Ayrı sayfa = düşük risk, temiz
test, tutarlı UX. Legacy haritadan "🛒 Sipariş Ver" linkiyle erişiliyor; menü fiyatı da
`price_minor`'a hizalandı.

**Trade-off:** Sipariş, haritadaki tesis-detay panelinin *içinde* değil ayrı sayfada. Aynı
localStorage anahtarlarını paylaştıkları için veri tutarlı; istenirse ileride panele gömülebilir.

## Bilinen borç / sonraki adımlar
- **Personel servis/ödeme** durum akışı (open→submitted→served→paid tam yaşam döngüsü) — v2-07 admin.
- **Gerçek ödeme** entegrasyonu yok (simüle); `payment_type` kaydediliyor.
- Sipariş, tesis-detay paneline gömülü değil (ayrı sayfa) — bilinçli kapsam kararı.
