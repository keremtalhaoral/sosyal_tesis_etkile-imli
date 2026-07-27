# 06 — Aynı anda iki kişi

> Projenin en savunulabilir parçası bu bölümde. Ve PostgreSQL'e geçişin en tehlikeli
> sürprizi de burada saklıydı.

---

## 1. Bir cümlede

İki kişi aynı anda son boş yeri almaya çalışırsa, **kod doğru görünse bile** ikisi de
alabilir — ve bunu engellemek için doğru izolasyon seviyesini **bilerek seçmek** gerekir.

---

## 2. Benzetme: sinema bileti

Sinemada son bir koltuk kaldı. İki kişi aynı anda gişeye geliyor.

- Görevli birinciye bakıyor: "bir koltuk var" → satıyor.
- **Aynı anda** ikinci görevli ikinciye bakıyor: "bir koltuk var" (henüz güncellenmedi) →
  o da satıyor.

İki kişi aynı koltuğu satın aldı. Kimse yalan söylemedi, kimse hata yapmadı — **ikisi de
aynı eski bilgiye baktı.**

**Benzetme nerede bozuluyor:** Sinemada koltuk fiziksel olarak tektir, gerçek dünyada
sorun kapıda anlaşılır. Veritabanında ise **hiçbir alarm çalmaz.** Her iki işlem de
"başarılı" döner, veriler tutarlı görünür ve sorunu ancak aylar sonra bir raporda fark
edersiniz. Sessiz bozulma, gürültülü hatadan çok daha tehlikelidir.

---

## 3. Transaction — "ya hep ya hiç"

**Transaction**, birden çok işlemi tek bir bölünmez adım hâline getirir.

```sql
BEGIN;                                    -- başla
  UPDATE hesaplar SET bakiye = bakiye - 100 WHERE id = 1;
  UPDATE hesaplar SET bakiye = bakiye + 100 WHERE id = 2;
COMMIT;                                   -- ikisi birden geçerli olsun
```

Arada elektrik kesilirse **hiçbiri** olmaz. Para havada kalmaz.

`ROLLBACK` ise "boş ver, hiçbiri olmasın" der.

### ACID

Transaction'ın dört garantisi:

| Harf | Anlamı | Örnek |
|---|---|---|
| **A**tomicity | Ya hepsi ya hiçbiri | sipariş + kalemler + tutar birlikte |
| **C**onsistency | Kurallar hep geçerli | kapasite aşılamaz |
| **I**solation | İşlemler birbirini bozmaz | **bu bölümün konusu** |
| **D**urability | Commit edilen kaybolmaz | elektrik kesilse de durur |

Projede sipariş verme tam bir örnek: `orders`'a satır, `order_items`'a kalemler,
`reservations.amount_minor`'a tutar — **üçü tek transaction'da**. Yarısı yazılıp yarısı
yazılmamış bir durum oluşamaz.

---

## 4. Write skew — asıl tehlike

Rezervasyon kodu şöyle:

```js
// 1. Şu an kaç kişi var?
const booked = await tx.one(`SELECT SUM(guests) ... WHERE facility_id=... AND date=...`);
// 2. Yer var mı?
if (booked + guests > capacity) throw 409;
// 3. Ekle
await tx.one(`INSERT INTO reservations ...`);
```

Bu kod **tek transaction içinde** ve mantığı doğru. Ama iki işlem aynı anda çalışırsa:

```
      A                                    B
  ────┼────────────────────────────────────┼────
      │ SUM = 8 okur (kapasite 10)         │
      │                                    │ SUM = 8 okur  ← aynı eski değer
      │ 8 + 2 <= 10 ✓                      │
      │                                    │ 8 + 2 <= 10 ✓
      │ INSERT (2 kişi)                    │
      │                                    │ INSERT (2 kişi)
      │ COMMIT                             │ COMMIT
  ────┴────────────────────────────────────┴────
                  Toplam: 12 kişi. Kapasite: 10.
```

Buna **write skew** denir (DDIA Bölüm 7.2.3). Dikkat edin:

- **Kayıp güncelleme yok** — kimse kimsenin satırını ezmedi.
- **Kirli okuma yok** — ikisi de commit edilmiş veriyi okudu.
- Her işlem **kendi içinde tutarlı**.
- Ama **birlikte** bir kuralı kırdılar.

### Neden satır kilidi çözmez?

"O zaman satırı kilitleyelim" düşünürsünüz. Ama **hangi satırı?** Çakışma
**henüz var olmayan** satırlar üzerinde — ikisi de *yeni* satır ekliyor. Olmayan bir şeyi
kilitleyemezsiniz. Buna **phantom** (hayalet) denir.

---

## 5. İzolasyon seviyeleri

SQL standardı dört seviye tanımlar; PostgreSQL üçünü uygular:

| Seviye | Ne engeller | Bu projede |
|---|---|---|
| READ UNCOMMITTED | — | PostgreSQL'de yok |
| **READ COMMITTED** | kirli okuma | **varsayılan** — write skew'e AÇIK |
| REPEATABLE READ | tekrarlanamayan okuma | rollup yeniden inşasında |
| **SERIALIZABLE** | **her şey** | rezervasyonda |

**SERIALIZABLE**'ın anlamı: sonuç, işlemler **sırayla** çalışmış gibi olacak. PostgreSQL
bunu kilitle değil, **SSI** (Serializable Snapshot Isolation) ile yapar: işlemleri paralel
koşturur, çakışma tespit ederse birini **geri çevirir**:

```
ERROR: could not serialize access due to read/write dependencies   (SQLSTATE 40001)
```

Bu bir başarısızlık değil, **bir davettir**: "tekrar dene". Projede `transaction()`
fonksiyonu bunu otomatik yapıyor (jitter'lı geri çekilmeyle 5 deneme).

> **Neden jitter (rastgele gecikme)?** İki çakışan işlem aynı anda tekrar denerse yine
> çakışırlar. Rastgele bir bekleme ekleyince ayrışırlar.

---

## 6. SQLite'ta neden bu sorun yoktu?

**Vardı — ama SQLite gizliyordu.** SQLite `BEGIN IMMEDIATE` ile **tüm yazıcıları sıraya
sokuyordu**. Yani aynı anda iki yazıcı zaten olamıyordu.

Doğruluğu, veritabanının **eşzamanlılık yeteneksizliğinden** alıyorduk. PostgreSQL çok
yazıcılı olduğu için o bedava koruma kalktı ve garantiyi **açıkça istemek** zorunda kaldık.

> Sunumda anlatılacak en iyi cümlelerden biri: *"Bir garantinin çalıştığını görmek yetmiyor;
> onu neyin sağladığını bilmek gerekiyor."*

---

## 7. Ölçüm — iddia değil, kanıt

`backend/test-concurrency.js` 40 paralel worker açıyor, kapasite 10. Dört senaryo:

| Yol | Sonuç |
|---|---|
| İSPARK (tek satır compare-and-set) | tam 10 ✓ |
| READ COMMITTED (aynı kod, düşük izolasyon) | **18-22** ✗ overbook |
| **SERIALIZABLE + retry** (üretimdeki yol) | **tam 10** ✓ |
| Transaction dışı oku-sonra-yaz | **18-26** ✗ overbook |

**Aynı uygulama kodu**, izolasyon seçimine göre doğru ya da yanlış çalışıyor.

### Her şey SERIALIZABLE olmak zorunda değil

Projede bilinçli olarak üç farklı seviye kullanılıyor:

**İSPARK yer kapma — READ COMMITTED yeterli:**
```sql
UPDATE ispark_status SET occupied = occupied + 1
WHERE facility_id = $1 AND occupied < capacity;
```
Koşul `UPDATE`'in içinde. Çakışma **var olan tek satırda**, phantom yok, satır kilidi
yeterli. Buna **compare-and-set** denir.

**Rollup yeniden inşası — REPEATABLE READ:**
Tüm tabloyu okuyan toplu bir iş. SERIALIZABLE altında her eşzamanlı rezervasyonla çakışıp
boşuna yeniden denerdi. Tutarlı tek snapshot yeterli.

**Rezervasyon — SERIALIZABLE:**
Phantom çakışması var, başka çare yok.

> **Ders:** "En güvenlisini kullan" doğru cevap değil. SERIALIZABLE bedava değildir —
> çakışma ve yeniden deneme üretir. Her işlem için **gereken** seviye seçilir.

### Neden `SELECT ... FOR UPDATE` değil?

Tesis satırını kilitleyip mutex gibi kullanmak da işe yarardı ve daha ucuzdu. Reddedildi:
korumayı **çağrı yerinin disiplinine** bağlar. İleride eklenecek yeni bir sorgu kilit
almayı unutabilir ve hata sessizce geri gelir. SSI'yı ise atlayamazsınız.

---

## 8. Kendin dene

### Ölçümü kendiniz yapın

```bash
node backend/test-concurrency.js
```

```
[demo] READ COMMITTED: booked=18 (kapasite 10), başarılı=18
[demo] SERIALIZABLE : booked=10 (kapasite 10), başarılı=10
[demo] NAİF (txn yok): booked=24 (kapasite 10), başarılı=24
```

Birkaç kez çalıştırın — sayılar değişir ama **SERIALIZABLE hep 10'da durur**.

### Kilidi gözünüzle görün

İki terminal açın.

**Terminal 1:**
```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis
```
```sql
BEGIN;
UPDATE facilities SET capacity = capacity + 1 WHERE id = 1;
-- COMMIT YAZMAYIN, burada durun
```

**Terminal 2:**
```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis
```
```sql
UPDATE facilities SET capacity = capacity + 100 WHERE id = 1;
-- BEKLER. İmleç döner. İşte kilit budur.
```

**Terminal 3** — kim kimi bekliyor:
```sql
SELECT bekleyen.pid, engelleyen.pid AS engelleyen, bekleyen.wait_event
FROM pg_stat_activity bekleyen
JOIN pg_stat_activity engelleyen ON engelleyen.pid = ANY(pg_blocking_pids(bekleyen.pid))
WHERE cardinality(pg_blocking_pids(bekleyen.pid)) > 0;
```

**Terminal 1'e dönün:**
```sql
ROLLBACK;
```

Terminal 2'nin beklemesi **anında** biter. Ve Terminal 1'in `+1`'i **hiç olmamış gibi**
kaybolur — atomiklik budur.

### İzolasyon seviyesini görün

```bash
PGPASSWORD=mufettis-dev psql -h 127.0.0.1 -U mufettis -d mufettis \
  -c "SHOW default_transaction_isolation;"
```

`read committed` — PostgreSQL'in varsayılanı. Uygulamanın rezervasyon transaction'ı bu
varsayılanı **kullanmıyor**, açıkça SERIALIZABLE istiyor:

```bash
grep -n "ISOLATION LEVEL" backend/database.js
```

---

## 9. Mentör sorarsa

**"İki kişi aynı anda son yeri alırsa ne olur?"**
> *"Okuma-kontrol-yazma dizisi tek transaction'da ve o transaction SERIALIZABLE. PostgreSQL
> çakışan iki işlemden birini 40001 ile geri çeviriyor, ben sınırlı sayıda yeniden
> deniyorum. 40 paralel worker'la ölçtüm: READ COMMITTED'da 18-22 rezervasyon geçiyor,
> SERIALIZABLE'da tam 10."*

**"Transaction kullanmak yetmiyor mu?"**
> *"Hayır — bu en önemli öğrendiğim şeydi. Kod zaten tek transaction'daydı ama varsayılan
> READ COMMITTED altında write skew'e açıktı. Atomiklik ile izolasyon farklı şeyler."*

**"Neden satır kilidi kullanmadın?"**
> *"Çakışma henüz var olmayan satırlarda — ikisi de yeni satır ekliyor. Olmayan bir şeyi
> kilitleyemezsiniz, buna phantom deniyor. FOR UPDATE ile tesis satırını mutex gibi
> kullanabilirdim ama o, korumayı çağrı yerinin disiplinine bağlardı; yeni bir sorgu kilit
> almayı unutabilirdi. SSI atlanamaz."*

**"Her şeyi SERIALIZABLE yapsan olmaz mı?"**
> *"Bedava değil — çakışma ve yeniden deneme üretiyor. İSPARK'ta çakışma tek satırda
> olduğu için READ COMMITTED yetiyor; rollup'ta tutarlı snapshot yettiği için REPEATABLE
> READ kullanıyorum. Her işlem için gereken seviyeyi seçiyorum."*

---

## Sırada ne var

Veriyi koruduk. Peki kullanıcıların kim olduğunu nasıl biliyoruz?
**[07 — Kimlik ve şifreleme](07-kimlik-ve-sifreleme.md)**
