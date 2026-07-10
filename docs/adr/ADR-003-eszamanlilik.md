# ADR-003: Veri Bütünlüğü, Eşzamanlılık & Büyük Veri

- **Durum:** Kabul edildi
- **Faz / Dal:** `v2-03-data-integrity`
- **Tarih:** 2026-07
- **Referans:** DDIA Böl. 7 (Transactions), Böl. 8 (Distributed/Fault problems)
- **İlgili:** `backend/test-concurrency.js` (kanıt), `ADR-001`

## Bağlam

Mentörün en çok vurguladığı beceri: **veriyi her koşulda yönetmek**. Cevap 7'deki kenar
durumlar: çifte rezervasyon, İSPARK son-yer yarışı, kapasite aşımı, hatalı girdi, saat
çakışması + çok büyük veri. Amaç yalnız doğru inşa etmek değil, **eşzamanlılık altında
doğruluğu KANITLAMAK**. Ölçek ~6000 kapasite (küçük) — mesele hacim değil **doğruluk**.

## Karar 1 — Ayrık zaman slotları + per-slot kapasite (saat çakışması + kapasite aşımı)

**Karar:** Sabit 90 dk slotlar (10:00…20:30). Kapasite kararı = aynı (tesis, tarih, slot)
için onaylı rezervasyonların `SUM(guests)` + yeni misafir ≤ tesis kapasitesi. `reserve_time`
izinli slot kümesinden olmalı (uygulama doğrulaması).

**Neden:** "Saat çakışması"nı ve "kapasite aşımı"nı tek modelle çözer: her slot bağımsız bir
kova, kova taşarsa 409. Bu, DDIA Böl. 7'nin **write-skew** dersinin somut hâlidir (klasik
"toplantı odası/aşırı rezervasyon" örneği): iki işlem "yer var mı?" diye okur, ikisi de "evet"
görür, ikisi de yazar → overbook. Çözüm: oku+kontrol+yaz'ı **tek atomik transaction**
(`BEGIN IMMEDIATE`) içine almak.

**Sonuç — occupancy% artık türetilmiş:** `facilities.occupancy` bir görüntüleme metriği
(harita ısı rengi) olarak kaldı; **booking'in gerçek kaynağı per-slot toplamdır**. Eski kaba
yüzde muhasebesi (round(capacity*%)) emekli edildi (ADR-001'deki hassasiyet kaybı kapandı).
Bu, DDIA Böl. 11'in derived-vs-source ayrımıdır.

## Karar 2 — Atomik transaction (BEGIN IMMEDIATE) + kanıt

**Karar:** `createReservation` okuma+kontrol+yazmayı `transaction()` (BEGIN IMMEDIATE)
içinde yapar. Yazma kilidi transaction BAŞINDA alınır → eşzamanlı rezervasyonlar serileşir.

**Kanıt (`backend/test-concurrency.js`):** 40 gerçek OS thread'i (worker_threads), her biri
DB'ye ayrı bağlantı. Kapasite 10 iken 40 eşzamanlı rezervasyon:
- **Atomik yol:** tam 10 başarılı, `booked = 10` — overbook YOK.
- **Naif yol** (txn dışı oku, araya gecikme, sonra yaz): `booked = 15` — **overbook** (write-skew
  gözle görülür). Aynı mantık; tek fark oku+yaz'ın atomik olması.

Bu karşılaştırma fazın öğrenme artefaktıdır: "transaction neden gerekli"yi teoride değil,
**ölçülen sonuçla** gösterir.

## Karar 3 — İSPARK: compare-and-set (koşullu UPDATE) ile son-yer yarışı

**Karar:** `ispark_status(facility_id, capacity, occupied)`. Yer kapma tek statement:
```sql
UPDATE ispark_status SET occupied = occupied + 1
WHERE facility_id = ? AND occupied < capacity;   -- changes==1 ? kapıldı : dolu
```
**Neden:** Koşul (`occupied < capacity`) UPDATE'in WHERE'ine gömülüdür → **compare-and-set**.
Tek statement atomiktir; "önce oku sonra yaz" arasındaki yarış penceresi hiç oluşmaz
(lost-update imkansız). N eşzamanlı çağrıdan tam `capacity` tanesi kazanır. Testte kanıtlı
(40 istek → tam 10 yer). Ayrıca `CHECK (occupied <= capacity)` **son savunma**: uygulama
hatası olsa bile DB aşırı doluluğu reddeder.

## Karar 4 — Katmanlı doğrulama: uygulama (dostça) + DB CHECK (son savunma)

**Karar:** `backend/validate.js` girdiyi transaction'a girmeden doğrular (slot geçerli mi,
tarih geçmiş mi, guests>0, highchair ≤ guests, payment_type kümede mi) → 400 + net mesaj.
DB CHECK kısıtları ikinci ve **kesin** savunmadır.

**Neden:** İki katman iki amaca hizmet eder: uygulama katmanı kullanıcıya anlamlı hata verir
ve gereksiz transaction'ı önler; DB katmanı, uygulama unutsa/bypass edilse bile invariant'ı
korur ("geçersiz durumu imkansız kıl"). Parametreli sorgular SQL-injection'ı zaten kapatır.

## Karar 5 — Büyük veri: batch insert + ölçeklenebilir üreteç

**Karar:** `scripts/generate-data.js` gerçekçi, GEÇERLİ (per-slot kapasiteye uyan) veri üretir;
`--scale=N` ile geçmiş N katına çıkar (milyonlar). Yazma **CHUNK'lar hâlinde tek transaction**
(batch), sipariş toplamı INSERT'ten önce hesaplanır (post-UPDATE yok).

**Neden:** Satır-satır autocommit büyük veride felakettir (her commit fsync). Tek transaction
içinde toplu yazma, DDIA Böl. 3'ün sıralı-yazma avantajını kullanır. Ölçülen: ~214k rezervasyon
+ ~118k sipariş + ~295k kalem **7.4 saniyede** (taban). Aylık ciro sorgusu 60ms; `EXPLAIN QUERY
PLAN` `idx_reservations_slot` indeksini kullandığını gösterir (tam tarama değil, SEARCH).

## Bilinen borç / sonraki adımlar
- **Rate-limiting / brute-force koruması** yok (ayrı güvenlik fazı).
- **İSPARK rezervasyona bağlı değil** (bağımsız kaynak) — ürün kararı; ileride bağlanabilir.
- **Yeni tesis (createFacility) İSPARK kaydı üretmiyor** — şimdilik yalnız seed üretir; admin
  fazında (v2-07) tesis eklerken İSPARK kapasitesi de girilebilir.
- **occupancy% görüntüleme metriği** artık canlı booking'i yansıtmaz; harita rengi için genel
  bir gösterge. İstenirse günlük türetilmiş değere bağlanabilir (v2-04 analytics).
