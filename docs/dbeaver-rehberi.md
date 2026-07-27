# DBeaver Rehberi ve Sunum Senaryosu

> Bu belge iki işe yarar:
> 1. **DBeaver'ı hiç kullanmadıysanız** sıfırdan öğretir (kurulum → bağlantı → arayüz).
> 2. **Staj sunumu için** adım adım, ne söyleyeceğiniz dahil bir senaryo verir.
>
> Senaryodaki her adım gerçekten çalıştırılıp doğrulandı; beklenen çıktılar gerçek çıktılardır.

---

## 0. DBeaver nedir, neden kullanıyoruz?

**Tek cümlede:** DBeaver, veritabanına bağlanıp içindeki verileri **görsel olarak** görmenizi
ve SQL çalıştırmanızı sağlayan ücretsiz bir masaüstü programıdır.

**Benzetme:** Veritabanı, dosya sistemi gibidir; DBeaver ise "Dosya Gezgini"dir. Terminalden
`psql` ile de aynı işi yaparsınız — tıpkı `ls`/`cd` ile dosya gezebildiğiniz gibi. Ama
klasörleri gözle görmek, sürükleyip bırakmak farklı bir kolaylıktır.

**Benzetme nerede bozuluyor:** Dosya gezgini dosyaları *taşır*; DBeaver veriyi taşımaz,
**sorgu gönderir**. Ekranda gördüğünüz her tablo, DBeaver'ın arka planda çalıştırdığı bir
`SELECT`'in sonucudur. Sihir yok — bu belgenin 16. bölümdeki sorguları tam olarak bunu
kanıtlıyor: DBeaver'ın ağaçta gösterdiği her şeyi siz de SQL ile sorgulayabilirsiniz.

**Sunumda neden değerli:** Uygulamada bir işlem yaparsınız, DBeaver'da <kbd>F5</kbd>'e
basarsınız, satırın belirdiğini gösterirsiniz. "Çalışıyor" demek yerine **gösterirsiniz**.

---

## 1. Kurulum

1. <https://dbeaver.io/download/> → **Community Edition** (ücretsiz).
   Windows/macOS/Linux hepsi var.
2. Kurup açın. İlk açılışta "sample database" sorarsa **hayır** deyin, gerek yok.
3. PostgreSQL sürücüsü **hazır gelir**; ilk bağlantıda DBeaver "Download driver files"
   diye sorarsa **Download** deyin (bir kez, internet gerekir).

---

## 2. Bağlantı kurma

**Önce veritabanının çalıştığından emin olun:**

```bash
npm run db:up        # Docker kullanıyorsanız
# ya da yerel PostgreSQL servisiniz açıksa bir şey yapmanıza gerek yok
```

**DBeaver'da:** `Database > New Database Connection` → **PostgreSQL** → Next.

| Alan | Değer |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `mufettis` |
| Username | `mufettis` |
| Password | `mufettis-dev` |

> Bu değerler `.env.example` ve `docker-compose.yml` ile aynıdır. Kendi `.env` dosyanızda
> değiştirdiyseniz oradaki değerleri kullanın.

**Test Connection** düğmesine basın → yeşil tik görmelisiniz. Sonra **Finish**.

Sol paneldeki **Database Navigator**'da `mufettis` beliriyor. Açın:

```
mufettis
└── Schemas
    ├── demo      <- SUNUMDA BURAYA BAKACAKSINIZ (temiz, küçük)
    └── public    <- gerçek/büyük veri (425 bin rezervasyon)
```

> `demo` şemasını göremiyorsanız henüz oluşturmamışsınızdır: `npm run demo:reset`.
> Sonra Navigator'da veritabanına sağ tık → **Refresh** (<kbd>F5</kbd>).

---

## 3. Arayüzü tanıyın

| Bölüm | Ne işe yarar |
|---|---|
| **Database Navigator** (sol) | Şemalar → tablolar ağacı |
| **Properties** sekmesi | Tablonun kolonları, kısıtları, indeksleri |
| **Data** sekmesi | Tablodaki **satırlar** (en çok kullanacağınız) |
| **ER Diagram** sekmesi | Tabloların ilişki şeması (otomatik çizilir) |
| **SQL Editor** | SQL yazıp çalıştırdığınız yer |

**Bilmeniz gereken 4 kısayol:**

| Kısayol | Ne yapar |
|---|---|
| <kbd>F5</kbd> | **YENİLE** — demonun kalbi. Veri değişti mi görmek için |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | İmlecin olduğu SQL ifadesini çalıştır |
| <kbd>Alt</kbd>+<kbd>X</kbd> | Editördeki **tüm** SQL'i çalıştır |
| <kbd>Ctrl</kbd>+<kbd>]</kbd> | Yeni SQL Editor sekmesi |

**SQL Editor açmak:** `mufettis` bağlantısına tıklayın → `SQL Editor > New SQL Editor`.

**Her SQL Editor sekmesinin başına şunu yazın** (o sekme boyunca geçerli olur):

```sql
SET search_path = demo, public;
```

> **Neden gerekli?** PostgreSQL'de aynı veritabanı içinde birden çok "şema" olabilir —
> klasör gibi düşünün. `reservations` yazdığınızda hangi klasördeki tabloyu kastettiğinizi
> `search_path` belirler. `public` sonda duruyor çünkü PostGIS fonksiyonları (`ST_Contains`
> gibi) orada yaşıyor.

---

## 4. ER diyagramı üretme (sunum slaytı için)

1. Navigator'da `demo` şemasına çift tıklayın.
2. Açılan sekmede **ER Diagram** sekmesine geçin.
3. DBeaver bütün tabloları ve aralarındaki **yabancı anahtar oklarını** otomatik çizer.
4. Sağ tık → `Export Diagram` → PNG olarak kaydedin, sunuma koyun.

**Okların anlamı:** ok, "bu tablo şuna bağlı" demektir. `reservations → facilities` oku,
her rezervasyonun bir tesise ait olduğunu ve **olmayan bir tesise rezervasyon
yapılamayacağını** söyler. Bu oklar süs değil; veritabanı bunları zorluyor
(`queries.sql` 13.5 bunu kırmayı deniyor ve hata alıyor).

Aynı bilgiyi SQL ile de alabilirsiniz (`queries.sql` 16.6) — diyagram o sorgunun resmidir.

---

## 5. PostGIS geometrisini DBeaver'da GÖRMEK

Bu, "Web GIS projesi" iddiasını DBeaver içinde kanıtlamanın en hızlı yolu.

```sql
SET search_path = demo, public;
SELECT kod, ad, geom FROM facilities;
```

Sonuç grid'inde **`geom` kolonundaki bir hücreye tıklayın**. DBeaver sağ panelde
(ya da alt panelde) **harita** gösterir — noktanız İstanbul'da belirir.

İlçe poligonları için:

```sql
SELECT name, population, geom FROM districts WHERE geom IS NOT NULL LIMIT 5;
```

Bir hücreye tıklayın: ilçe sınırı poligon olarak çizilir.

> **Panel açılmıyorsa:** sonuç grid'inde sağ tık → `View/Format > Spatial/GIS viewer`.
> Ya da grid'in sağındaki küçük dünya simgesine tıklayın.

**Anlatım:** *"Geometri veritabanının içinde bir veri tipi. Uygulamaya hiç gitmeden burada
görebiliyorum, çünkü PostGIS bunu `geometry` tipiyle saklıyor — metin ya da JSON olarak
değil. Bu yüzden üstünde `ST_Contains` gibi mekansal sorgular çalıştırabiliyorum."*

---

## 6. EXPLAIN — sorgunun nasıl çalıştığını görmek

DBeaver'da bir sorgu yazıp <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> yaparsanız
**görsel yürütme planı** çıkar (ya da SQL'i `EXPLAIN (ANALYZE)` ile başlatın).

**Yan yana koyun** — `public` şemasında (425 bin satır):

```sql
SET search_path = public;

-- A) İndeksli kolon üzerinden
EXPLAIN (ANALYZE) SELECT SUM(guests) FROM reservations
WHERE facility_id = 1 AND reserve_date = '2026-06-01' AND reserve_time = '19:00';

-- B) İndekssiz kolon üzerinden
EXPLAIN (ANALYZE) SELECT COUNT(*) FROM reservations WHERE crypto_signature = 'generated';
```

A'da **`Index Scan using idx_reservations_slot`** ve ~0,01 ms göreceksiniz.
B'de **`Seq Scan`** (tüm tabloyu tarama) ve çok daha uzun süre.

**Anlatım:** *"İndeks, kitabın arkasındaki dizin gibi. Dizin varsa doğrudan sayfaya
gidiyorum; yoksa kitabı baştan sona okuyorum. Fark 425 bin satırda ölçülebilir hale geliyor."*

---

## 7. ⭐ SUNUM SENARYOSU (adım adım)

### Hazırlık (sunumdan 5 dakika önce)

```bash
npm run db:up          # veritabanı ayakta mı
npm run demo:reset     # TEMİZ demo şeması: 5 tesis, 3 kullanıcı, 0 rezervasyon
npm run demo:start     # backend'i demo şemasına bağla  (bu terminali açık bırakın)
```

> `demo:start`, `data/seed-demo.json` dosyasını kullanır (5 tesis). Bu önemli: seed **her**
> sunucu açılışında çalışıyor, dolayısıyla küçük veri kümesi seed'in kendisinde olmak
> zorunda. "Kur sonra sil" yaklaşımı işe yaramıyordu — silinen tesisler sunucu yeniden
> başlayınca geri geliyordu.

Ayrı bir terminalde arayüz:
```bash
cd docs && python3 -m http.server 8092
```

**DBeaver'da 3 sekme açın** ve hepsinin başına `SET search_path = demo, public;` yazın:

| Sekme | İçerik |
|---|---|
| **1 — Canlı sayaçlar** | `queries.sql` 12.8 (tüm tabloların satır sayısı) |
| **2 — Detay** | O anda incelediğiniz tablo |
| **3 — Audit** | `SELECT * FROM audit_log ORDER BY id DESC;` |

**Tarayıcıda:** `http://localhost:8092/index.html`
Sol altta **● Canlı veritabanı** rozetini görmelisiniz. Görmüyorsanız backend kapalıdır.

> **Bu rozet çok önemli.** Yeşilse yaptığınız her işlem PostgreSQL'e yazılıyor demektir.
> Gri "○ Çevrimdışı replika" ise sayfa tarayıcı içi taklit modda çalışıyordur ve
> **DBeaver'da hiçbir şey belirmez**.

---

### Adım 1 — Başlangıç: her şey sıfır

**DBeaver Sekme 1**'de <kbd>F5</kbd>:

```
tablo          satir
audit_log          0
orders             0
reservations       0
users              3
facilities         5
```

> *"Tertemiz bir veritabanıyla başlıyorum. Şimdi uygulamada işlem yapacağım ve buraya
> dönüp ne değiştiğine bakacağız."*

---

### Adım 2 — Kayıt ol → `users`

Tarayıcıda kayıt olun (örn. `sunum_konugu` / `SunumParola26`).

**DBeaver Sekme 2:**
```sql
SELECT id, username, role,
       split_part(password,'$',1) AS algoritma,
       split_part(password,'$',2) AS iterasyon,
       left(split_part(password,'$',3),12)||'…' AS salt_onek
FROM users ORDER BY id DESC LIMIT 5;
```

Gerçek çıktı:
```
id  username        algoritma      iterasyon  salt_onek
8   sunum_konugu    pbkdf2_sha256  600000     jIdbjq9SA96r…
```

> *"Parola düz metin olarak hiçbir yerde yok. Saklanan şey PBKDF2 ile 600 bin kez
> döndürülmüş bir özet. Salt sütununa bakın — her kullanıcıda farklı. Yani iki kişi aynı
> parolayı seçse bile özetleri farklı olur; tek bir hazır tabloyla ikisi birden kırılamaz."*

**Beklenen soru — "600 bin niye?"**
> *"OWASP'ın 2023 önerisi. Amaç doğrulamayı bilerek yavaşlatmak: benim için 100 milisaniye,
> saldırgan için milyarlarca deneme demek."*

---

### Adım 3 — Rezervasyon yap → `reservations`

Tarayıcıda giriş yapıp (`ayse` / `AyseParola26`) bir tesise rezervasyon yapın.

**DBeaver:**
```sql
SELECT r.id, u.username, f.ad AS tesis, r.reserve_date, r.reserve_time,
       r.guests, r.status, left(r.crypto_signature,20)||'…' AS imza
FROM reservations r
JOIN users u ON u.id=r.user_id JOIN facilities f ON f.id=r.facility_id
ORDER BY r.id DESC;
```

```
id  username  tesis                       reserve_date  guests  status     imza
1   ayse      Altınboynuz Sosyal Tesisi   2027-04-15    4       confirmed  40b35ccfb818a0eb…
```

> *"`id = 1` — bu tablonun ilk satırı. Az önce ben oluşturdum. `crypto_signature` alanı
> rezervasyonun HMAC imzası: kullanıcı, tesis, tarih ve kişi sayısından üretiliyor. Biri
> veritabanından kişi sayısını değiştirirse imza tutmaz."*

---

### Adım 4 — Sipariş ver → **üç tablo birden**

`order.html` sayfasından (ya da uygulama içinden) sipariş verin.

```sql
SELECT o.id AS siparis, o.status, ROUND(o.total_minor/100.0,2) AS toplam_tl,
       m.name AS urun, oi.quantity AS adet,
       ROUND(oi.unit_price_minor/100.0,2) AS birim_snapshot,
       ROUND(r.amount_minor/100.0,2) AS rez_toplami
FROM orders o
JOIN order_items oi ON oi.order_id=o.id
JOIN menu_items m ON m.id=oi.menu_item_id
JOIN reservations r ON r.id=o.reservation_id
ORDER BY o.id DESC;
```

```
siparis  status     toplam_tl  urun          adet  birim_snapshot  rez_toplami
1        submitted  360.00     Izgara Tavuk  2     180.00          360.00
```

> *"Tek bir 'sipariş ver' tıklaması **üç tabloyu** birden değiştirdi: `orders`,
> `order_items` ve rezervasyonun toplam tutarı. Üçü de aynı transaction içinde — ya hepsi
> olur ya hiçbiri. Yarısı yazılıp yarısı yazılmamış bir durum oluşamaz."*

**Ayrıca:** *"Para `total_minor` olarak, yani **kuruş cinsinden tam sayı** tutuluyor.
360 TL burada 36000. Float kullansaydım 0.1 + 0.2'nin 0.3 etmediği o klasik yuvarlama
hataları paraya bulaşırdı."*

---

### Adım 5 — ⭐ Fiyat snapshot: en etkileyici an

**DBeaver'dan** menü fiyatını değiştirin:

```sql
UPDATE menu_items SET price_minor = price_minor + 10000
WHERE id = (SELECT menu_item_id FROM order_items ORDER BY id DESC LIMIT 1);
```

Sonra karşılaştırın:

```sql
SELECT m.name,
       ROUND(m.price_minor/100.0,2)       AS guncel_menu_fiyati,
       ROUND(oi.unit_price_minor/100.0,2) AS siparis_anindaki_fiyat
FROM order_items oi JOIN menu_items m ON m.id=oi.menu_item_id
ORDER BY oi.id DESC LIMIT 1;
```

```
name          guncel_menu_fiyati  siparis_anindaki_fiyat
Izgara Tavuk  280.00              180.00
```

> *"Menü fiyatını 100 lira artırdım ama geçmiş siparişin tutarı **değişmedi**. Çünkü sipariş
> menüye referans vermiyor, fiyatı o an **kopyalamış**. Buna captured (yakalanmış) veri
> deniyor. Eğer referans verseydi, bugün yaptığım bir zam geçen ayın raporlarını da
> değiştirirdi — muhasebe açısından felaket olurdu."*

---

### Adım 6 — İptal: para geri alınıyor + denetim izi

Rezervasyonu iptal edin (uygulamadan ya da `DELETE /api/reservations/1`).

```sql
SELECT r.id, r.status, ROUND(r.amount_minor/100.0,2) AS kalan_tutar FROM reservations WHERE id=1;
SELECT action, detail FROM audit_log ORDER BY id DESC LIMIT 1;
```

```
id  status     kalan_tutar
1   cancelled  0.00

action              detail
reservation.cancel  {"reverted_minor": 36000, "cancelled_orders": 1}
```

> *"İki şeye dikkat: birincisi satır **silinmedi**, durumu 'cancelled' oldu — gerçekleşmiş
> bir olayı silmiyoruz, tarihçe duruyor. İkincisi tutar otomatik geri alındı. Bu bir hataydı
> ve düzelttim: eskiden iptal edilen sipariş sonsuza dek ciroda kalıyordu."*

**`audit_log`'u gösterin:** *"Her yönetimsel işlem buraya yazılıyor ve bu tablo yalnızca
INSERT alıyor — güncellenmiyor, silinmiyor. `detail` kolonu JSONB, yani içindeki alanlara
göre sorgulayabiliyorum."*

---

### Adım 7 — Kısıtları kırmayı deneyin (hata almak = başarı)

```sql
INSERT INTO facilities (kod, ad, lat, lng, capacity) VALUES ('KIR-1','Negatif',41,29,-5);
```

DBeaver kırmızı kutuda:
```
ERROR: new row for relation "facilities" violates check constraint "facilities_capacity_check"
```

Sonra imkansız tarihi deneyin:
```sql
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
VALUES ((SELECT MIN(id) FROM users),(SELECT MIN(id) FROM facilities),'2027-13-45','19:00',2,'x');
```
```
ERROR: date/time field value out of range: "2027-13-45"
```

> *"Bu kuralları uygulama kodunda da yazabilirdim. Ama uygulama atlanabilir — biri doğrudan
> SQL yazabilir, bir script hata yapabilir. Veritabanına yazılan kural atlanamaz. 13. bölümde
> bunun 10 örneği var."*

**Bonus (çok etkili):** aynı slota ikinci aktif rezervasyon → hata. Sonra ilkini iptal edin →
aynı slot **tekrar rezerve edilebiliyor**. *"Kısıt sıradan bir UNIQUE değil, kısmi indeks:
kural yalnız iptal edilmemiş satırlara uygulanıyor."*

---

### Adım 8 — Eşzamanlılık: sunumun en güçlü anı

Terminalde:

```bash
node backend/test-concurrency.js
```

```
[demo] READ COMMITTED: booked=18 (kapasite 10), başarılı=18
[demo] SERIALIZABLE : booked=10 (kapasite 10), başarılı=10
[demo] NAİF (txn yok): booked=24 (kapasite 10), başarılı=24
```

> *"40 kişi aynı anda son 10 yeri kapmaya çalışıyor. Aynı uygulama kodu: yanlış izolasyon
> seviyesinde 18 rezervasyon geçiyor — kapasite 10 olmasına rağmen. Doğru seviyede tam 10'da
> duruyor. Buna write skew deniyor ve tek başına transaction kullanmak yetmiyor; izolasyon
> seviyesini bilerek seçmek gerekiyor."*

İsterseniz kilidi DBeaver'da **gözle** de gösterin (`docs/sorgu-defteri.md` bölüm 14):
iki sekme, birinde `BEGIN` + `UPDATE`, diğerinde aynı satır → bekler.

---

### Adım 9 — PostGIS ve büyük veri

```sql
SET search_path = demo, public;

-- Hangi ilçede kaç tesis var? (mekansal join)
SELECT d.name AS ilce, COUNT(f.id) AS tesis
FROM districts d LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
WHERE d.geom IS NOT NULL GROUP BY d.id, d.name
HAVING COUNT(f.id) > 0;
```

Gerçek çıktı (demo şemasındaki 5 tesis için):
```
ilce        tesis
Beşiktaş        1
Beykoz          2
Eyüpsultan      1
Üsküdar         1
```

> *"Hiçbir tesiste 'ilçe' diye bir kolon yok. İlçeyi **geometriden** buluyorum: tesisin
> noktası hangi ilçe poligonunun içindeyse o ilçeye ait. Bunu veritabanı hesaplıyor —
> `ST_Contains`, GiST indeksi üzerinden."*

Sonra büyük veriye geçin:

```sql
SET search_path = public;
SELECT COUNT(*) FROM reservations;     -- ~425.000
EXPLAIN (ANALYZE) SELECT SUM(guests) FROM reservations
WHERE facility_id=1 AND reserve_date='2026-06-01' AND reserve_time='19:00';
```

> *"425 bin satır var ama sorgu 0,01 milisaniyede dönüyor, çünkü indeks kullanıyor.
> Planda 'Index Scan' yazdığını görüyorsunuz."*

---

## 8. Sorun giderme

| Sorun | Sebep / çözüm |
|---|---|
| **Bağlanamıyorum** | Veritabanı çalışmıyor olabilir: `npm run db:up`. Docker'sız kurulumda servisi başlatın. |
| **`demo` şeması yok** | `npm run demo:reset` çalıştırın, sonra Navigator'da <kbd>F5</kbd>. |
| **`relation "reservations" does not exist`** | Sekmenin başına `SET search_path = demo, public;` yazmayı unuttunuz. |
| **`ST_Contains` bulunamadı** | `search_path`'te `public` yok. `demo, public` yazın — PostGIS fonksiyonları `public`'te. |
| **Uygulamada işlem yaptım, DBeaver'da yok** | (a) Sayfadaki rozet gri mi? Backend kapalı → `npm run demo:start`. (b) <kbd>F5</kbd>'e bastınız mı? (c) `demo` şemasına mı bakıyorsunuz, `public`'e mi? |
| **Giriş yapamıyorum** | Parolalar **moda göre değişiyor.** Backend açılırken konsola `[giriş]` satırlarını yazar — geçerli hesaplar orada. `demo` şemasında: `demo_admin / DemoAdmin2026`, `ayse / AyseParola26`, `mehmet / MehmetParola26`. `public` şemasında parolalar rastgele: `data/dev-credentials.json`. Backend kapalıyken (çevrimdışı replika) taklit hesaplar geçerli: `admin / admin1234`. |
| **Giriş `429` dönüyor** | Parola yanlış değil — 15 dakikada 5 başarısız denemeden sonra hız sınırı devreye girdi. Bekleyin ya da backend'i yeniden başlatın (sayaç bellekte tutuluyor). |
| **Türkçe karakterler bozuk** | Bağlantı ayarlarında encoding `UTF-8` olmalı (varsayılan). |
| **Sorgu takılı kaldı, dönmüyor** | Başka bir sekmede açık transaction satırı kilitliyor olabilir. `ROLLBACK;` yazın ya da `pg_stat_activity`'ye bakın (sorgu defteri 14.3). |
| **Hava durumu "demo" diyor** | `.env` dosyasında `OPENWEATHER_API_KEY` var mı? Backend açılırken `[weather] GERÇEK ... aktif` yazmalı. |

---

## 9. Sunum öncesi son kontrol listesi

- [ ] `npm run db:up` — veritabanı ayakta
- [ ] `npm run demo:reset` — tertemiz demo şeması (rezervasyon 0 olmalı, script yazdırır)
- [ ] `npm run demo:start` — backend açık, `[weather] GERÇEK` yazıyor
- [ ] `cd docs && python3 -m http.server 8092` — arayüz açık
- [ ] Tarayıcıda sol altta **● Canlı veritabanı** rozeti yeşil
- [ ] DBeaver'da 3 sekme hazır, hepsinde `SET search_path = demo, public;` çalıştırılmış
- [ ] `node backend/test-concurrency.js` bir kez denenmiş (ilk çalıştırma yavaş olabilir)
- [ ] ER diyagramı PNG olarak dışa aktarılmış (yedek slayt)

**Panik anı için yedek:** internet ya da bir servis çökerse
`node backend/test-concurrency.js` ve `queries.sql` tamamen yereldir; sunumun en güçlü
kısımları internetsiz çalışır.
