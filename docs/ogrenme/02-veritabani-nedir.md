# 02 — Veritabanı nedir ve neden gerekli?

> Sunucu bir şeyleri hatırlamak zorunda: kim kayıt oldu, kim nereye rezervasyon yaptı.
> Peki bunu neden bir dosyaya yazıp geçmiyoruz?

---

## 1. Bir cümlede

Veritabanı, **çok kişinin aynı anda güvenle** okuyup yazabildiği, **kurallar koyabildiğiniz**
ve **hızlı arayabildiğiniz** bir depolama sistemidir.

---

## 2. Benzetme: not defteri vs. kütüphane

**Dosyaya yazmak** bir not defteri gibidir: açarsınız, yazarsınız, kapatırsınız. Tek başınıza
çalışırken mükemmel.

**Veritabanı** ise kayıtlı bir kütüphane gibidir: görevli vardır, kim ne aldı kayıtta durur,
aynı kitabı iki kişiye birden vermez, ve "1990'dan sonra basılan tarih kitapları" gibi
soruları saniyede yanıtlar.

**Benzetme nerede bozuluyor:** Kütüphanede kitap *fiziksel olarak* tektir, o yüzden iki
kişiye veremezsiniz. Veritabanında veri kopyalanabilir — sorun kopyalamak değil, **iki
kişinin aynı anda değiştirmeye çalışması**. Bu, benzetmenin gösteremediği asıl zorluk ve
[06. bölümün](06-ayni-anda-iki-kisi.md) tamamı buna ayrılmış.

---

## 3. Neden düz dosya yetmiyor?

Diyelim rezervasyonları `rezervasyonlar.json` dosyasında tutuyoruz. Dört sorun çıkar:

### (a) Aynı anda iki kişi
İki kişi aynı anda rezervasyon yapıyor. İkisi de dosyayı okuyor, ikisi de kendi kaydını
ekliyor, ikisi de yazıyor. **İkincisi birincisinin kaydını siler.** Kimse fark etmez.

### (b) Yarım kalan işlem
Rezervasyon yazıldı, sipariş yazılırken elektrik kesildi. Şimdi ödemesi olmayan bir
rezervasyon var. Dosyada "ya hepsi ya hiçbiri" garantisi yoktur.

### (c) Kural yok
Dosyaya `{"guests": -5}` yazabilirsiniz. Ya da olmayan bir tesise rezervasyon. Dosya
umursamaz. Kuralları uygulama koduna yazarsınız — ama biri doğrudan dosyayı düzenlerse?

### (d) Arama yavaş
"Şu tesiste 1 Haziran 19:00'da kaç kişi var?" sorusu için **tüm dosyayı** okumak gerekir.
425 bin kayıtta bu her seferinde yüz megabaytlarca okuma demek.

**Veritabanı dördünü de çözer.** Sırasıyla: kilitler, transaction'lar, kısıtlar, indeksler.

---

## 4. Temel kavramlar

### Tablo, satır, kolon

Veritabanı **tablolardan** oluşur; tablo bir Excel sayfası gibidir.

```
facilities tablosu
┌────┬──────────┬─────────────────────────┬──────────┬─────────┐
│ id │ kod      │ ad                      │ capacity │ lat     │  ← KOLONLAR
├────┼──────────┼─────────────────────────┼──────────┼─────────┤
│ 1  │ ALTY-01  │ Altınboynuz Sosyal Tes. │ 120      │ 41.0578 │  ← SATIR
│ 2  │ ARNV-01  │ Arnavutköy Sosyal Tes.  │ 80       │ 41.1854 │  ← SATIR
└────┴──────────┴─────────────────────────┴──────────┴─────────┘
```

- **Kolon** = bir özellik. Bir **tipi** vardır: `capacity` tam sayı, `ad` metin.
- **Satır** = bir kayıt (bir tesis).
- **Tablo** = aynı türden kayıtların topluluğu.

> Excel'den en büyük farkı: bir kolona yanlış tipte veri **yazamazsınız**. `capacity`
> kolonuna "çok" yazamazsınız. Excel izin verir, veritabanı reddeder.

### Birincil anahtar (primary key)

Her satırın benzersiz bir kimliği olmalı — genelde `id`. İki tesisin adı aynı olabilir ama
`id`'si asla.

Projede `id` kolonları `GENERATED ALWAYS AS IDENTITY`: **numarayı veritabanı üretir.**
Elle yazamazsınız. Neden? İki farklı yerin aynı numarayı üretmesi imkânsız hale gelsin diye.

### Yabancı anahtar (foreign key) — tabloları bağlamak

Rezervasyonun bir tesise ait olduğunu nasıl söylersiniz? Tesisin tüm bilgisini rezervasyon
satırına kopyalamazsınız (tesis adı değişse yüz binlerce satırı güncellemek gerekirdi).
Bunun yerine **id'sini** yazarsınız:

```
reservations
┌────┬─────────┬─────────────┬──────────────┬────────┐
│ id │ user_id │ facility_id │ reserve_date │ guests │
├────┼─────────┼─────────────┼──────────────┼────────┤
│ 1  │ 4       │ 1  ─────────┼─ 2027-04-15  │ 4      │
└────┴─────────┴──┼──────────┴──────────────┴────────┘
                  │
                  └──→ facilities.id = 1 (Altınboynuz)
```

`facility_id` bir **yabancı anahtardır**: "bu değer `facilities` tablosunda var olmak
zorunda". Olmayan bir tesise rezervasyon yazmayı denerseniz veritabanı reddeder.

**`ON DELETE CASCADE`** ise şunu der: tesis silinirse, ona bağlı rezervasyonlar da silinsin.
Yoksa "yetim" kayıtlar kalırdı — var olmayan bir tesise ait rezervasyonlar.

### Kısıt (constraint) — kuralı veriye gömmek

Bu projenin en önemli fikirlerinden biri: **kuralları uygulama koduna değil, veritabanına
yaz.**

```sql
capacity INTEGER NOT NULL CHECK (capacity > 0)
--                        └──────────────────┘ bu kural DB'de yaşıyor
```

Uygulama kodu atlanabilir: biri doğrudan SQL yazabilir, bir script hata yapabilir, yeni bir
geliştirici kontrolü unutabilir. Veritabanı kısıtı **atlanamaz**.

Projedeki kısıt türleri:

| Tür | Ne der | Örnek |
|---|---|---|
| `NOT NULL` | Bu alan boş olamaz | tesis adı |
| `CHECK` | Bu koşul doğru olmalı | `capacity > 0` |
| `UNIQUE` | Bu değer tekrarlanamaz | tesis kodu |
| `PRIMARY KEY` | Benzersiz kimlik | `id` |
| `FOREIGN KEY` | Bu değer şu tabloda olmalı | `facility_id` |

### İndeks — neden aramalar hızlı?

**Kitabın arkasındaki dizin gibi.** "Fotosentez" kelimesini ararken kitabı baştan sona
okumazsınız, dizinden bakıp sayfaya gidersiniz.

İndeks olmadan veritabanı **tüm tabloyu** tarar (sequential scan). İndeksle doğrudan
ilgili satırlara gider.

**Bedeli var:** indeks yer kaplar ve **her yazmada güncellenir**. Bu yüzden "her kolona
indeks atalım" yanlıştır — sorgu desenine göre seçilir.

---

## 5. Projede tam olarak nerede

Şema tek yerde tanımlı: **`backend/database.js`** içindeki `MIGRATIONS` dizisi.

```bash
grep -n "version:" backend/database.js
```

9 migration göreceksiniz. Her biri şemanın bir evrim adımı — ve **sırayla** uygulanıyor.

Okunabilir hâli:

```bash
head -60 schema.sql
```

> `schema.sql` **elle yazılmaz**, veritabanından üretilir (`npm run export:schema`).
> Kanonik kaynak her zaman `database.js`.

Projedeki 12 tablo:

| Tablo | Ne tutar |
|---|---|
| `users` | kullanıcılar ve parola özetleri |
| `facilities` | sosyal tesisler + konumları |
| `districts` | ilçeler, nüfus, sınır geometrisi |
| `reservations` | rezervasyonlar |
| `menu_items` | tesis menüleri |
| `orders` / `order_items` | siparişler ve kalemleri |
| `ispark_status` / `ispark_holds` | otopark doluluğu ve kim kapmış |
| `daily_stats` | analitik özet (türetilmiş) |
| `audit_log` | kim ne yaptı kaydı |
| `schema_migrations` | hangi migration uygulandı |

---

## 6. Kendin dene

```bash
npm run db:up      # veritabanı ayakta değilse
npm start          # bir kez çalıştırıp Ctrl+C ile durdurun (şemayı kurar)
```

Tabloları listeleyin:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "\dt"
```

Bir tablonun yapısına bakın — kolonlar, tipler, kısıtlar, indeksler bir arada:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "\d reservations"
```

**Kısıtı kırmayı deneyin** — hata almak burada başarıdır:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis \
  -c "INSERT INTO facilities (kod, ad, lat, lng, capacity) VALUES ('TEST','Deneme',41,29,-5);"
```

```
ERROR:  new row for relation "facilities" violates check constraint "facilities_capacity_check"
```

> Veritabanı sizi durdurdu. Uygulama kodunda bir kontrol unutulsa bile bu satır asla
> oluşamaz. `queries.sql` bölüm 13'te bunun 10 farklı örneği var.

**İndeksin farkını ölçün:**

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
EXPLAIN ANALYZE SELECT SUM(guests) FROM reservations
WHERE facility_id=1 AND reserve_date='2026-06-01' AND reserve_time='19:00';"
```

Planda `Index Scan` ya da `Bitmap Heap Scan` göreceksiniz ve süre milisaniyenin altında.
Aynı tabloda indekssiz bir kolonla deneyin:

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis -c "
EXPLAIN ANALYZE SELECT COUNT(*) FROM reservations WHERE crypto_signature='generated';"
```

`Seq Scan` ve çok daha uzun süre. **Fark budur.**

---

## 7. Mentör sorarsa

**"Neden dosya yerine veritabanı?"**
> *"Dört sebep: eşzamanlı erişim (iki kişi aynı anda yazarsa biri diğerini ezmesin),
> atomiklik (yarım kalan işlem olmasın), kısıtlar (geçersiz veri hiç giremesin) ve indeksler
> (425 bin satırda tüm dosyayı okumadan arama). Dosyada bunların hiçbiri yok."*

**"Kuralları neden veritabanına koyuyorsun, kodda olsa olmaz mı?"**
> *"Uygulama atlanabilir — biri doğrudan SQL yazabilir, bir migration script'i hata
> yapabilir. Veritabanı kısıtı atlanamaz. Kodda da doğrulama yapıyorum ama o kullanıcıya
> dostça hata vermek için; son savunma hattı veritabanında."*

**"İndeks her zaman iyi midir?"**
> *"Hayır. Yer kaplar ve her INSERT/UPDATE'te güncellenir, yani yazmayı yavaşlatır. Sorgu
> desenine göre seçilir. `pg_stat_user_indexes` ile hangi indeksin kaç kez kullanıldığını
> görebiliyorum — hiç kullanılmayan bir indeks sadece maliyettir."*

---

## Sırada ne var

Veritabanının nasıl bir şey olduğunu gördük. Şimdi onunla **konuşmayı** öğrenelim:
**[03 — SQL ile konuşmak](03-sql-ile-konusmak.md)**
