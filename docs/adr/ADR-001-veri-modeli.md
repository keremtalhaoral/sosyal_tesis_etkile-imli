# ADR-001: v_2 Veri Modeli Kararları

- **Durum:** Kabul edildi
- **Faz / Dal:** `v2-01-data-model`
- **Tarih:** 2026-07
- **Referans:** Martin Kleppmann, *Designing Data-Intensive Applications* (DDIA)
- **İlgili:** `DATABASE.md` (v1 merkezi veri mimarisi), `docs/diagrams/er-v2.md`

> ADR (Architecture Decision Record) = bir mimari kararı, **alternatiflerini** ve **neden o
> tercihi yaptığımızı** kaydeden kısa belge. Amaç: 6 ay sonra (veya mentöre anlatırken)
> "burada neyi neden seçtik?" sorusuna net cevap verebilmek.

---

## Bağlam

v1'de tüm veri merkezi bir SQLite'a (`data/app.db`) taşınmıştı. v_2'de proje büyüyor:
müşteri **sipariş** verebilmeli, **menü** olmalı, rezervasyonlar analitik **chart**'lara
(ciro, ortalama müşteri, bebe sandalyesi ihtiyacı) veri sağlamalı. Bu ADR, bu genişlemenin
**veri modeli** kararlarını kaydeder. Davranış (uç noktalar, kripto, chart UI, sipariş akışı)
sonraki fazlara aittir — burada yalnızca **şema ve ilişkiler** var.

Yol gösterici ilke: *ölçek-uygun tasarım.* Küçük bir işletmeye Instagram altyapısı kurmak
mühendislik değil gösteriştir. En basit doğru modeli kur, ama **evrilmeye açık** bırak
(DDIA Böl. 1: reliability, scalability, maintainability).

---

## Karar 1 — Sipariş rezervasyona bağlı (`orders.reservation_id`)

**Karar:** Her sipariş bir rezervasyona bağlıdır (`orders.reservation_id FK → reservations`).
Bağımsız "gel-al / paket" siparişi yoktur.

**Neden:** Sosyal tesiste sipariş ancak masaya oturmuş (rezervasyonu olan) müşteriden gelir;
gel-al/paket iş modeli yok (kullanıcı teyit etti). Sipariş bağlamı (kim, hangi tesis, ne
zaman) zaten rezervasyonda mevcut — tekrar taşımaya gerek yok (normalizasyon, DDIA Böl. 2).

**Alternatif:** Sipariş bağımsız varlık olup opsiyonel `reservation_id` taşıyabilirdi. Bu
esneklik bugün gereksiz karmaşıklık olurdu (YAGNI). İleride gel-al eklenirse kolonu nullable
yapmak tek migration'lık iş — kapı açık.

**Trade-off:** Bir rezervasyonun çok siparişi olabilir (1‑N). Rezervasyon silinince siparişler
`ON DELETE CASCADE` ile gider — yetim sipariş kalmaz (referans bütünlüğü DB'de).

---

## Karar 2 — Para birimi: tam sayı **kuruş** (`*_minor`), asla float

**Karar:** Tüm parasal değerler tam sayı kuruş olarak saklanır: `amount_minor`,
`price_minor`, `unit_price_minor`, `total_minor`. Örn. 250,00 TL → `25000`.

**Neden:** İkili (binary) float, `0.1 + 0.2 = 0.30000000000000004` örneğindeki gibi ondalık
para değerlerini tam gösteremez. Finansal veride bu yuvarlama hataları toplanır. Tam sayı en
küçük birimi (kuruş) tutmak bu hata sınıfını **kökten yok eder** (DDIA'nın "geçersiz durumu
imkansız kıl" yaklaşımı). Sunumda 100'e bölüp biçimlendiririz.

**Alternatif:** `REAL`/float basit görünür ama sinsi hatalar üretir. `DECIMAL` tipi SQLite'ta
yok. Integer-minor endüstri standardıdır (Stripe, muhasebe sistemleri).

---

## Karar 3 — Sipariş kalemi fiyatı **snapshot** (`order_items.unit_price_minor`)

**Karar:** Sipariş kalemi, ürünün **o anki** fiyatını kendi içinde saklar
(`unit_price_minor`), `menu_items.price_minor`'a JOIN ile bakmaz.

**Neden:** Menü fiyatı zamanla değişir. Dün 40 TL'ye satılan çayın bugün 50 TL olması, dünkü
siparişin tutarını değiştirmemeli. Fiyatı sipariş anında "dondururuz". Bu, DDIA Böl. 11'in
**captured vs derived data** ayrımıdır: geçmiş sipariş bir **olgu (fact)**, canlı menü ise
değişken durum. Olguyu türetilebilir kaynağa bağlarsak geçmişi bozarız.

**Trade-off:** Küçük bir veri tekrarı (fiyat iki yerde), ama tarihsel doğruluk için zorunlu.
`orders.total_minor` da kalemlerden hesaplanıp saklanır (okuma kolaylığı); tutarlılığı
sipariş transaction'ı garanti eder (Faz v2-05).

---

## Karar 4 — Bebe sandalyesi: **adet** (`highchair_count`), boolean değil

**Karar:** Rezervasyonda `highchair_count INTEGER` (kaç bebe sandalyesi lazım), boolean değil.

**Neden:** Kullanıcı bu veriyi bebek (çocuk değil — çocuk kendi oturur) için bebe sandalyesi
ihtiyacını ölçmek istiyor. Bir grupta birden fazla bebek olabilir. Adet tutmak "toplam
sandalye ihtiyacı", "bebekli rezervasyon oranı" gibi metrikleri (Faz v2-04 chart'ları)
mümkün kılar; boolean bu bilgiyi kaybederdi. `CHECK (highchair_count >= 0)`.

---

## Karar 5 — Durum (status) alanları + CHECK ile sonlu durum kümesi

**Karar:** `reservations.status` (pending/confirmed/cancelled) ve `orders.status`
(open/submitted/served/paid/cancelled), `CHECK ... IN (...)` ile sınırlanır.

**Neden:** Geçersiz durumu **veritabanı seviyesinde imkansız** kılmak (uygulama koduna
güvenmek yerine). Yaşam döngüsünü açıkça modellemek ileride "iptal edilen rezervasyonları
hariç tut" gibi analitik sorguları temizler. Enum tablosu yerine CHECK, bu ölçekte yeterli
ve okunur.

---

## Karar 6 — Şemayı **önden tasarla**, migration'ı **faza böl**

**Karar:** Tüm v_2 hedef şemasını şimdi tasarladık (ER diyagramı). Ama migration v2 yalnızca
**sipariş/menü + rezervasyon kolonlarını** oluşturur. `ispark_status` (Faz 3), `daily_stats`
rollup (Faz 4), `audit_log` (Faz 7) kendi fazlarının migration'ında eklenecek.

**Neden:** İki gerekçe. (1) **Şema evrimi** (DDIA Böl. 4): versiyonlu migration'lar
(`schema_migrations`) sayesinde şema ileri sarılabilir; her faz kendi değişikliğini ekler,
mevcut veritabanları güvenle taşınır. (2) **Anlatı temizliği:** her dal = mentöre tek karar
olarak anlatılabilen bütün. Sipariş tablolarını Faz 5'te değil şimdi eklememizin sebebi,
veri modelinin çekirdeğinin sipariş↔rezervasyon ilişkisi olması; İSPARK/rollup/audit ise
davranışa bağlı, o yüzden kendi fazlarına bırakıldı.

---

## Karar 7 — Analitik için **canlı → sonra rollup** (OLTP vs OLAP)

**Karar:** Chart verisi v1'de ham tablolardan **canlı** hesaplanır (`SUM`/`GROUP BY`).
Sonra (Faz v2-04) `daily_stats` rollup tablosu eklenip ikisi **benchmark** edilir.

**Neden:** Bu, DDIA Böl. 3'ün **OLTP** (çok sayıda küçük yazma = rezervasyon/sipariş) vs
**OLAP** (az sayıda ağır analitik okuma = dashboard) ayrımıdır. Büyük sistemler ayrı veri
ambarı kurar; **bizim ölçeğimizde gereksiz** — aynı SQLite içinde rollup tablosu doğru orta
yol. Canlıyla başlamak erken optimizasyondan kaçınır; "canlı ne zaman yetmez oluyor?"
benchmark'ı öğrenme çıktısı olur. `daily_stats` **türetilmiş veri**dir (DATABASE.md'deki
derived-data ilkesi): siparişlerden yeniden üretilebilir.

---

## Bilinen borç / riskler

- **Şema iki yerde tanımlı:** `backend/database.js` (Node migration) ve
  `advanced-gis/app/models.py` (`init_db`) şemayı elle senkron tutar. Bir tarafı değiştirip
  diğerini unutmak sinsi hata kaynağıdır. Şimdilik kabul edildi (iki farklı dil, tek DB);
  ileride tek bir `schema.sql` dosyasından iki tarafın da okuması düşünülebilir.
- **`total_minor` denormalize:** Kalemlerden hesaplanır ama saklanır; tutarlılık sipariş
  transaction'ına bağımlı (Faz v2-05'te garanti edilecek).

## "Ölçek-uygun tasarım" kutusu — ne zaman büyütmeli?

Bugün tek düğüm SQLite yeterli. Büyütme **sinyalleri** (henüz yok, ama izleyeceğiz):
- Yazma çakışmaları `busy_timeout`'u aşmaya başlarsa → PostgreSQL'e geç (gerçek eşzamanlılık).
- `daily_stats` canlı hesabı dashboard'u yavaşlatırsa → rollup'a geç (zaten planlı).
- Coğrafi sorgular ray-casting'le yavaşlarsa → PostGIS + `geometry` kolonu (DATABASE.md'de yol).

İlke: **evrilmeye dayanıklı yapı kur, ama ihtiyaç doğmadan karmaşıklık ekleme.**
