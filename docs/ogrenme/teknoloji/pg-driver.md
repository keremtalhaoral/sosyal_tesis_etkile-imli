# `pg` — Node PostgreSQL sürücüsü

## 1. Tek cümlede

`pg` (node-postgres), Node ile PostgreSQL arasında konuşan, saf JavaScript ile yazılmış
sürücüdür: bağlantı kurar, sorgu gönderir, sonucu JS değerlerine çevirir ve **bağlantı
havuzunu** yönetir.

**Bu projede:** v8.13.1. Üç bağımlılıktan biri.

---

## 2. Hangi problemi çözmek için doğdu

PostgreSQL ile konuşmak, aslında bir **ikili protokol** konuşmaktır: TCP bağlantısı,
başlangıç mesajı, SCRAM-SHA-256 kimlik doğrulaması, `Parse`/`Bind`/`Execute` mesajları,
`RowDescription` ve `DataRow` çerçeveleri… Kimse bunu elle yazmak istemez.

`pg` bunu üç şeye indiriyor:

```js
const res = await pool.query('SELECT * FROM facilities WHERE id = $1', [id]);
res.rows   // [{ id: 1, ad: '…', … }]
```

Ama asıl değer üç yerde:

**(a) Parametreli sorgu.** `$1`, `$2` yer tutucuları sunucuya **ayrı** gönderilir. Değer
hiçbir zaman sorgu metnine karışmaz — **SQL enjeksiyonu yapısal olarak imkânsız hale
gelir**, kaçış karakteri hilesi gerekmez.

**(b) Tip dönüşümü.** PostgreSQL `date` → JS `Date`, `int8` → string (dikkat! aşağıda),
`json`/`jsonb` → JS nesnesi, `NULL` → `null`.

**(c) Bağlantı havuzu.** Her sorgu için yeni bağlantı açmak pahalıdır: TCP el sıkışması +
kimlik doğrulama + PostgreSQL tarafında **yeni bir işletim sistemi süreci**. Havuz açık
bağlantıları saklar ve ödünç verir.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Ne | Bu projede neden değil |
|---|---|---|
| **Prisma** | modern ORM, tip güvenli istemci üretir | PostGIS tiplerini bilmiyor; `SERIALIZABLE` + retry kontrolü zorlaşıyor; ham SQL'e düşmek gerekince ORM'in faydası kalmıyor |
| **Sequelize / TypeORM** | klasik ORM | aynı sorun + ek soyutlama; **amaç SQL öğrenmekti**, ORM tam da onu gizler |
| **Knex** | sorgu kurucu (query builder) | SQL'i JS çağrılarına çeviriyor; okunabilirlik kazancı bu boyutta yok |
| **`postgres` (porsager)** | daha hızlı, tagged template API | `pg` daha yaygın, dokümantasyonu ve örneği çok daha fazla |

**Belirleyici sebep:** Bu projede SQL **gizlenecek** bir şey değil, **gösterilecek** bir
şey. `queries.sql` ve `docs/sorgu-defteri.md`'nin varlık sebebi bu. ORM kullansaydık
mentöre gösterecek bir sorgu defteri olmazdı.

Ayrıca iki teknik zorunluluk: PostGIS fonksiyonları (`ST_Contains`, `<->`) ve
`SERIALIZABLE` + `40001` retry döngüsü, ORM soyutlamalarının altından zaten ham SQL'e
inmeyi gerektiriyor.

---

## 4. Bu projede tam olarak nerede

**Havuz** (`backend/database.js:423`):

```js
pool = new Pool({
  max: Number(process.env.PG_POOL_MAX || 10),   // en fazla 10 eşzamanlı bağlantı
  idleTimeoutMillis: 30000,                     // 30 sn boşta kalan kapanır
});
```

**`transaction()` sarmalayıcısı** — havuzdan **tek bir** bağlantı alıp tüm işi orada
yapar, sonunda `COMMIT`/`ROLLBACK` ve bağlantıyı geri verir. `SERIALIZABLE` çakışmasında
(`40001`) yeniden dener.

**`test-helper.js`** — her test kendi PostgreSQL **şemasında** koşar (`PG_SCHEMA` →
`search_path`). Testler gerçek veriye dokunmaz, paralel koşabilir.

**Tip ayarı** (`database.js:27`): `const { Pool, types } = require('pg');` — bazı tiplerin
varsayılan dönüşümü değiştiriliyor (aşağıdaki tuzak b).

---

## 5. Bilinmesi gereken üç tuzak

### (a) Havuz = "aynı bağlantı" garantisi YOK

`pool.query()` her çağrıda **farklı** bir bağlantı verebilir. Bu projede gerçek bir hataya
yol açtı: `createFacility` satırı ekliyor, sonra okumak için ikinci bir sorgu atıyordu.
Okuma başka bağlantıdan gitti ve **henüz commit edilmemiş** satırı göremedi → `null`.

SQLite'ta tek bağlantı olduğu için bu hata hiç görünmemişti.

**Kural:** Aynı transaction'da kalması gereken işler `transaction()` içinde, tek
`client` üstünde yapılmalı. Ya da `RETURNING` ile ekle-ve-oku tek turda yapılmalı.

### (b) `bigint` string olarak gelir

PostgreSQL `int8` (bigint) 64 bitliktir; JavaScript'in `Number`'ı **53 bitten** sonra
kesinliğini kaybeder. `pg` bu yüzden `int8`'i varsayılan olarak **string** döndürür:

```js
row.total    // "1234567890123"  ← string!
row.total + 1  // "12345678901231"  ← metin birleştirme, sayı toplama DEĞİL
```

Projede para toplamları `::bigint` cast ediliyor (int4 taşması yüzünden), yani bu tuzak
doğrudan ilgili. Değeri sayıya çevirirken kaybın olup olmayacağını düşünmek gerekiyor.

### (c) Havuz tükenirse istekler **sessizce** kuyruğa girer

`max: 10` ve 11. eşzamanlı sorgu → hata değil, **bekleme**. Bir sorgu bir bağlantıyı uzun
süre tutarsa (uzun transaction, unutulmuş `client.release()`) tüm uygulama yavaşlar ve
sebebi görünmez.

Bu yüzden `transaction()` sarmalayıcısı `finally` bloğunda **her koşulda** bağlantıyı geri
veriyor — hata fırlasa bile.

---

## 6. Kendin dene

```bash
# havuzun tip dönüşümünü görün
node -e "
const {Pool}=require('pg');
const p=new Pool({host:'127.0.0.1',user:'mufettis',password:'mufettis-dev',database:'mufettis'});
p.query(\"SELECT 1::int4 AS dort, 1::int8 AS sekiz, now() AS zaman, '{\\\"a\\\":1}'::json AS j\")
 .then(r=>{const x=r.rows[0];
   for(const k in x) console.log(k.padEnd(8), typeof x[k], JSON.stringify(x[k]));
   return p.end();});
"
```

Beklenen: `dort number`, `sekiz string` ← tuzak (b), `zaman object` (JS `Date`),
`j object`.

```bash
# parametreli sorgunun enjeksiyona kapalı olduğunu görün
node -e "
const {Pool}=require('pg');
const p=new Pool({host:'127.0.0.1',user:'mufettis',password:'mufettis-dev',database:'mufettis'});
p.query('SELECT COUNT(*) FROM facilities WHERE kod = \$1', [\"x'; DROP TABLE facilities;--\"])
 .then(r=>{console.log('sonuç:', r.rows[0].count, '— tablo hâlâ duruyor');return p.end();});
"
```

---

## 7. Daha fazlası için

- Resmî doküman: <https://node-postgres.com/>
- Havuz ayrıntıları: <https://node-postgres.com/apis/pool>
- Bu kitapta: [08 — Backend: Node ve Express](../08-backend-node-express.md) (havuz kısmı)
