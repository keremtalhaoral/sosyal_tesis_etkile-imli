# 04 — Neden PostgreSQL? (ve SQLite'tan neden geçtik)

> Bu proje SQLite ile başladı ve PostgreSQL'e geçti. Bu bölüm o kararı anlatıyor —
> özellikle **neyi kaybettiğimizi**, çünkü her mimari karar bir takastır.

---

## 1. Bir cümlede

SQLite veritabanını **uygulamanın içine gömer**; PostgreSQL ise **ayrı bir sunucu** olarak
çalışır ve bu ayrım her şeyi değiştirir.

---

## 2. Benzetme: cüzdan vs banka

**SQLite** cüzdanınız gibidir. Cebinizde, her zaman yanınızda, hızlı, kimseye sormadan
kullanırsınız. Ama tek kişiliktir ve içine sığdırabileceğiniz kadarını taşır.

**PostgreSQL** banka gibidir. Ayrı bir bina, açılış saatleri, hesap açmanız gerekir. Ama
aynı hesaba birden çok kişi erişebilir, işlem geçmişi tutulur, kurallar vardır.

**Benzetme nerede bozuluyor — ve bu proje için kritik:** Cüzdanınızdan iki kişi *aynı anda*
para alamaz, sırayla alır. SQLite de tam olarak böyle davranır: yazma işlemlerini
**sıraya sokar**. Banka ise aynı anda binlerce işlem yapar — **işte tehlike burada
başlıyor.** SQLite'ta "iki kişi aynı anda son yeri alamaz" garantisini bedava alıyorduk;
PostgreSQL'de o garantiyi **açıkça istemek** zorundayız.

Bu, geçişin en önemli dersi ve [06. bölümün](06-ayni-anda-iki-kisi.md) konusu.

---

## 3. Neden geçtik? İki iddia karşılıksız kalmıştı

### İddia 1: "Bu bir Web GIS projesi"

Ama mekansal işlerin **hiçbiri** veritabanında değildi:

| İş | SQLite döneminde |
|---|---|
| "Bu tesis hangi ilçede?" | JavaScript'te elle yazılmış ray-casting algoritması |
| "İki nokta arası mesafe" | JavaScript'te elle yazılmış Haversine formülü |
| "En yakın 3 tesis" | Tüm tesisleri belleğe alıp JS'te sıralama |
| İlçe sınırları (3,7 MB) | Her açılışta dosyadan belleğe okunuyordu |

SQLite bunları **yapamadığı** için başka çare yoktu. PostGIS ile hepsi indeksli SQL oldu
(bkz. [05. bölüm](05-harita-verisi-postgis.md)).

### İddia 2: "Eşzamanlılık güvenli"

Bu doğruydu — **ama korumayı bizim kodumuz sağlamıyordu.** SQLite `BEGIN IMMEDIATE` ile
tüm yazıcıları sıraya sokuyordu. Yani doğruluğu, veritabanının **eşzamanlılık
yeteneksizliğinden** alıyorduk.

> Bu, sunumda anlatabileceğiniz en iyi şeylerden biri: *"Bir garantinin çalıştığını görmek
> yetmiyor; onu neyin sağladığını bilmek gerekiyor. Benimki ödünç alınmış bir garantiydi."*

---

## 4. Aradaki farklar

| | SQLite | PostgreSQL |
|---|---|---|
| **Nerede çalışır** | uygulamanın içinde, kütüphane | ayrı süreç/sunucu |
| **Veri nerede** | tek dosya (`app.db`) | sunucunun yönettiği dizin |
| **Kurulum** | yok | sunucu gerekir (Docker) |
| **Eşzamanlı yazma** | sıraya sokar (tek yazıcı) | gerçekten paralel |
| **Tipler** | esnek — `TEXT`'e her şey girer | katı — yanlış tip reddedilir |
| **Mekansal** | yok | PostGIS |
| **Ölçek** | tek makine, orta veri | küme, replikasyon, terabaytlar |

### Tip katılığı — somut bir örnek

SQLite'ta `reserve_date` bir `TEXT` kolonuydu. Şunu kabul ediyordu:

```sql
INSERT INTO reservations (..., reserve_date, ...) VALUES (..., '2027-13-45', ...);
```

**13. ay, 45. gün.** SQLite için bu sadece bir metin. PostgreSQL'de kolon gerçek bir
`date`:

```
ERROR:  date/time field value out of range: "2027-13-45"
```

Bir sınıf hata **tamamen ortadan kalktı** — kod yazarak değil, doğru tipi seçerek.

---

## 5. Ne kaybettik? (dürüst kısım)

Geçiş bedava değildi:

**(a) "Sıfır dış bağımlılık" iddiası bitti.** SQLite Node 22'nin içinde geliyordu; artık
`pg` paketi gerekiyor.

**(b) Kurulum tek adım değil.** Önceden `npm start` yeterliydi. Şimdi önce veritabanı:
```bash
npm run db:up && npm start
```

**(c) Dosyayı kopyalayıp taşıma kolaylığı gitti.** `app.db`'yi USB'ye atıp götürebilirdiniz.
Şimdi yedek almak `pg_dump` işi.

**(d) Tüm kod async oldu.** SQLite senkron çalışıyordu; `pg` async. Bu, altı test dosyası
ve 24 API ucunu etkileyen mekanik ama geniş bir değişiklikti.

> Bu takas `docs/adr/ADR-009-postgresql-postgis.md`'de kayıt altında. **Her mimari karar
> bir takastır** — kazandığınızı söyleyip kaybettiğinizi söylememek, kararı anlamamak
> demektir.

---

## 6. Geçişte yakalanan iki gerçek hata

Bunlar sunumda anlatmaya değer, çünkü "geçiş yaptım" demekle "geçişin ne öğrettiğini
biliyorum" demek arasındaki farkı gösterirler.

### Hata 1: commit edilmemiş veriyi okumak

`createFacility` fonksiyonu tesisi ekliyor, sonra eklediği satırı okuyup döndürüyordu.
SQLite'ta **tek bağlantı** olduğu için çalışıyordu. PostgreSQL'de **bağlantı havuzu** var:
okuma başka bir bağlantıdan gitti ve o bağlantı henüz commit edilmemiş satırı **göremedi**.
Fonksiyon `null` döndü.

**Ders:** Havuzlu bir sistemde "yazdım, hemen okuyayım" masum değildir. Okuma commit'ten
sonra yapılmalı.

### Hata 2: para toplamının taşması

Para kuruş cinsinden tam sayı tutuluyor (float yuvarlama hatası olmasın diye — doğru
karar). Ama toplamlar `::int` cast ediliyordu ve **`int4` üst sınırı 2.147.483.647
kuruş = yalnızca ~21,5 milyon TL.**

Bir yıllık üretilmiş veri bunu aştı ve PostgreSQL sessizce yanlış sonuç vermek yerine
hata fırlattı:

```
ERROR: integer out of range   (SQLSTATE 22003)
```

Analitik paneli tamamen çöktü. Gerçek ciro: **106 milyon TL** — sınırın 5 katı.

**Ders:** Doğru tipi seçmek yetmiyor, **toplamın** tipini de düşünmek gerekiyor. Ve
PostgreSQL'in sessizce yanlış cevap vermek yerine patlaması bir özelliktir, kusur değil.

---

## 7. Kendin dene

Sürümleri görün:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c \
  "SELECT version(), postgis_version();"
```

**Tip katılığını kendiniz deneyin:**

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
INSERT INTO reservations (user_id, facility_id, reserve_date, reserve_time, guests, crypto_signature)
VALUES ((SELECT MIN(id) FROM users), (SELECT MIN(id) FROM facilities), '2027-13-45', '19:00', 2, 'x');"
```

```
ERROR:  date/time field value out of range: "2027-13-45"
```

**Taşma sınırını görün:**

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
SELECT 2147483647 AS int4_ust_siniri,
       ROUND(2147483647/100.0/1000000, 1) AS bu_kac_milyon_TL,
       ROUND(SUM(amount_minor)/100.0/1000000, 1) AS gercek_ciro_milyon_TL
FROM reservations WHERE status <> 'cancelled';"
```

Gerçek cironun sınırı kaç kat aştığını göreceksiniz.

---

## 8. Mentör sorarsa

**"Neden SQLite ile başlayıp sonra değiştirdin? Baştan PostgreSQL seçseydin?"**
> *"SQLite doğru başlangıçtı: sıfır kurulum, hızlı iterasyon, tek düğüm. Proje büyüyünce
> iki iddia karşılıksız kaldı — mekansal sorgu yapamıyordum ve eşzamanlılık garantisini
> aslında SQLite'ın tek-yazıcı davranışından ödünç alıyordum. O noktada geçtim. Erken
> optimizasyon yapmamak da bir karar."*

**"Geçişte ne kaybettin?"**
> *"Sıfır bağımlılık iddiası, tek komutla kurulum ve veritabanını dosya olarak taşıma
> kolaylığı. Ayrıca tüm kodu async'e çevirmek gerekti. Kazanç PostGIS ve gerçek
> eşzamanlılık kontrolüydü; bedeli ADR-009'da yazılı."*

**"Geçişte bir sorun yaşadın mı?"**
> *"İki tane, ikisi de öğreticiydi. Birincisi: bağlantı havuzunda commit edilmemiş veriyi
> okumaya çalışıyordum, SQLite'ta tek bağlantı olduğu için fark edilmiyordu. İkincisi:
> para toplamları int4'ü taşırıyordu — kuruş cinsinden sınır sadece 21,5 milyon TL ve
> verim 106 milyon TL'ydi. Dashboard tamamen çöküyordu."*

---

## Sırada ne var

PostgreSQL'e geçmemizin birinci sebebi mekansal sorgulardı. Sırada tam olarak o:
**[05 — Harita verisi ve PostGIS](05-harita-verisi-postgis.md)**
