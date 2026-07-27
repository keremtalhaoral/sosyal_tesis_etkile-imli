# 11 — Sözlük

> Kitapta geçen her terim burada, A'dan Z'ye. Her tanım **iki cümle**: ne olduğu ve
> **bu projede nerede karşınıza çıktığı**. Daha derini için bölüm bağlantısını izleyin.
>
> Türkçe alfabetik sıra kullanıldı (ç, ğ, ı, i, ö, ş, ü kendi yerlerinde).

---

## A

**ACID** — Bir transaction'ın taşıması gereken dört garanti: Atomicity (ya hep ya hiç),
Consistency (kısıtlar korunur), Isolation (eşzamanlı işlemler birbirini bozmaz), Durability
(commit edilen kaybolmaz). Projede sipariş verme işlemi bunun canlı örneği: sipariş +
kalemler + rezervasyon tutarı + audit kaydı ya hep birlikte yazılır ya hiçbiri.
→ [06](06-ayni-anda-iki-kisi.md)

**Agregasyon** — Birçok satırı tek değere indiren SQL fonksiyonları: `COUNT`, `SUM`, `AVG`,
`MIN`, `MAX`. Projede analitik panelin tamamı bunlardan besleniyor (`backend/analytics.js`).
→ [03](03-sql-ile-konusmak.md)

**ADR** (Architecture Decision Record) — Bir mimari kararın **neden** alındığını, hangi
alternatiflerin elendiğini ve **neyin feda edildiğini** kaydeden kısa belge. Projede
`docs/adr/` altında 9 tane var; her faz bir ADR üretiyor.

**API** (Application Programming Interface) — Bir programın başka bir programa sunduğu
arayüz; insan için değil makine için tasarlanmış "menü". Projede backend 24 uçtan oluşan
bir HTTP API sunuyor. → [01](01-web-nasil-calisir.md)

**Append-only** — Yalnızca ekleme yapılan, hiç güncellenmeyen ve silinmeyen tablo.
Projede `audit_log` böyle: bir kaydı değiştirebilseydiniz denetim kaydı olmaktan çıkardı.
→ [06](06-ayni-anda-iki-kisi.md)

**Async / await** — Beklemeli bir işi, kodu bloke etmeden yazmayı sağlayan JavaScript
sözdizimi. Projede **tüm** veri erişimi async — PostgreSQL'e geçişin zorunlu sonucu.
→ [08](08-backend-node-express.md)

**Audit log** — Kim, ne zaman, neyi değiştirdi kaydı. Projede mutasyonla **aynı
transaction'da** yazılıyor; yani işlem geri alınırsa kayıt da geri alınır ve ikisi asla
ayrışmaz. → [06](06-ayni-anda-iki-kisi.md)

## B

**Backend** — Sunucuda çalışan, kullanıcının doğrudan görmediği kod. Projede
`backend/` klasörü: 24 uç, veritabanı erişimi, kimlik doğrulama.
→ [08](08-backend-node-express.md)

**Bağlantı havuzu** (connection pool) — Veritabanı bağlantılarını her istekte yeniden açmak
yerine saklayıp ödünç veren yapı. Projede en fazla 10 eşzamanlı bağlantı; geçişte
"commit edilmemiş veriyi okuma" hatasını bu ortaya çıkardı. → [08](08-backend-node-express.md)

**Base64** — İkili veriyi metne çeviren kodlama. **Şifreleme değildir** — geri çevirmek
tek komut. JWT'nin okunabilir olmasının sebebi budur. → [07](07-kimlik-ve-sifreleme.md)

**Bildirimsel** (declarative) — "Ne istediğini" söyleyip "nasıl yapılacağını" sisteme
bırakan dil. SQL böyledir: `WHERE` yazarsınız, indeks kullanılıp kullanılmayacağına
PostgreSQL karar verir. → [03](03-sql-ile-konusmak.md)

**Birincil anahtar** (primary key) — Her satırı benzersiz tanımlayan kolon. Projede her
tabloda `id`. → [02](02-veritabani-nedir.md)

## C — Ç

**CHECK kısıtı** — Bir kolonun alabileceği değerleri sınırlayan kural. Projede kapasite > 0,
doluluk 0-100, koordinatlar geçerli aralıkta. İhlal edilince PostgreSQL `23514` hata koduyla
reddeder. → [02](02-veritabani-nedir.md)

**Chart.js** — Tarayıcıda grafik çizen kütüphane (v4.5.1). Projede dashboard grafikleri;
`docs/vendor/chartjs/` altında vendored. → [teknoloji/chartjs.md](teknoloji/chartjs.md)

**Commit (git)** — Değişikliklerin kalıcı bir anlık görüntüsü. **Commit (SQL)** — bir
transaction'ın kalıcı hale gelmesi. Aynı kelime, iki ayrı dünya; karıştırmak yaygın.

**CORS** (Cross-Origin Resource Sharing) — Bir web sayfasının başka bir adresten veri
çekmesine izin veren tarayıcı mekanizması. Projede `CORS_ORIGIN` ile daraltılabilir.
→ [08](08-backend-node-express.md)

**Compare-and-set** — "Değer hâlâ beklediğim gibiyse değiştir" biçiminde atomik güncelleme.
Projede İSPARK yer kapmada kullanılıyor; tek satır çakışması olduğu için SERIALIZABLE'a
gerek yok. → [06](06-ayni-anda-iki-kisi.md)

**Çift mod** (dual mode) — Sayfanın canlı backend varsa ona, yoksa tarayıcı-içi replikaya
bağlanması. Projede üç sayfa da böyle; ekrandaki rozet hangi modda olduğunuzu söyler.
→ [09](09-frontend-harita.md)

## D

**DDIA** — *Designing Data-Intensive Applications* (Martin Kleppmann). Bu projenin rehber
kitabı; captured/derived ayrımı, izolasyon seviyeleri ve write skew anlatımı oradan.

**DBeaver** — Veritabanına grafik arayüzle bağlanan araç. Projede sunum aracı: uygulamada
bir şey yapıp DBeaver'da satırın belirdiğini göstermek için.
→ [`../dbeaver-rehberi.md`](../dbeaver-rehberi.md)

**Derived data** (türetilmiş veri) — Başka veriden yeniden üretilebilen veri. Projede
`daily_stats` rollup'ı, `docs/data/transit-routes.geojson`, `schema.sql` ve veritabanının
kendisi türetilmiş. Karşıtı **captured data** (yakalanmış): sipariş kalemi fiyatı gibi,
o an neydiyse öyle kalması gereken veri. → [10](10-veri-nereden-geliyor.md)

**Docker / docker compose** — Uygulamaları izole "konteyner"larda çalıştıran araç. Projede
PostgreSQL + PostGIS `npm run db:up` ile tek komutta ayağa kalkıyor.
→ [teknoloji/docker.md](teknoloji/docker.md)

**DOM** (Document Object Model) — Tarayıcının bellekte tuttuğu, HTML'in canlı ağaç hali.
JavaScript bu ağacı değiştirince ekran anında değişir. → [09](09-frontend-harita.md)

## E

**Endpoint** (uç) — API'nin tek bir adresi; ne yaptığı URL + HTTP fiiliyle belirlenir.
Projede 24 tane. → [01](01-web-nasil-calisir.md)

**Entropi (parola)** — Bir parolanın tahmin edilebilirliğinin ölçüsü. Projede minimum
parola uzunluğu 4'ten 8'e çıkarıldı: 600.000 iterasyonlu hash bile 10.000 olasılıklı bir
arama uzayını koruyamaz. → [07](07-kimlik-ve-sifreleme.md)

**EXPLAIN** — PostgreSQL'e "bu sorguyu nasıl çalıştıracaksın?" diye sormak. Index Scan mı
Seq Scan mı göreceğiniz yer. → [02](02-veritabani-nedir.md), [05](05-harita-verisi-postgis.md)

**Express** — Node.js için "hangi URL hangi fonksiyona gitsin" eşleştirmesi yapan ince
kütüphane. → [08](08-backend-node-express.md), [teknoloji/express.md](teknoloji/express.md)

**Event loop** (olay döngüsü) — Node'un tek iş parçacığında sürekli dönen iş kuyruğu.
Bloke edilirse **tüm sunucu** durur; projede ölçüldü: senkron PBKDF2 döngüyü 106 ms
kilitliyor. → [08](08-backend-node-express.md)

## F

**Feynman tekniği** — Bir şeyi gerçekten anlamanın testi olarak, onu basit kelimelerle
anlatabilmek. Kritik adımı çoğu kişinin atladığı yerdir: **benzetmenin nerede bozulduğunu**
söylemek. Bu kitabın yöntemi.

**Foreign key** (yabancı anahtar) — Bir tablodaki satırın başka bir tablodaki satıra
işaret etmesi. Projede `reservations.facility_id → facilities.id`. Olmayan bir tesise
rezervasyon yazmaya çalışırsanız `23503` hatası alırsınız. → [02](02-veritabani-nedir.md)

**Frontend** — Tarayıcıda çalışan, kullanıcının gördüğü kod. Projede `docs/` klasörü.
**Kullanıcının kontrolündedir** — sır konulamaz, doğrulamasına güvenilmez.
→ [09](09-frontend-harita.md)

## G — Ğ

**Generated column** — Değeri başka kolonlardan otomatik hesaplanan, elle yazılamayan kolon.
Projede `facilities.geom` lat/lng'den üretiliyor; böylece koordinat ile geometri **asla
ayrışamaz**. → [05](05-harita-verisi-postgis.md)

**Geography vs Geometry** — PostGIS'te iki uzamsal tip. `geometry` düzlem varsayar
(derece cinsinden ölçer), `geography` küre üstünde metre ölçer. 41° enlemde ikisi **farklı
sıralama** üretebilir — projede gerçekten oldu. → [05](05-harita-verisi-postgis.md)

**GeoJSON** — Coğrafi veriyi JSON olarak taşıyan standart format. Projede ilçe sınırları
ve toplu taşıma güzergahları bu formatta.
→ [teknoloji/geojson.md](teknoloji/geojson.md)

**GiST indeksi** — PostGIS'in mekansal indeksi. Onsuz her mekansal sorgu tüm tabloyu tarar.
→ [05](05-harita-verisi-postgis.md)

**GitHub Pages** — Depodaki dosyaları statik web sitesi olarak yayınlayan ücretsiz servis.
**Kod çalıştırmaz** — projedeki çift modun tek gerçek sebebi bu.
→ [09](09-frontend-harita.md), [teknoloji/git-github-pages.md](teknoloji/git-github-pages.md)

**GTFS** (General Transit Feed Specification) — Toplu taşıma verisinin dünya standardı
formatı; ZIP içinde CSV dosyaları. Projede güzergah çizgileri `shapes.txt`'ten geliyor.
→ [10](10-veri-nereden-geliyor.md), [teknoloji/gtfs.md](teknoloji/gtfs.md)

**GROUP BY** — Satırları gruplayıp her grup için tek özet satır üreten SQL yapısı.
→ [03](03-sql-ile-konusmak.md)

## H

**Hash** — Bir veriyi geri çevrilemez biçimde sabit uzunlukta bir değere dönüştürme.
**Şifreleme değildir**: şifrelemenin anahtarı vardır ve geri açılır, hash'in yoktur.
Projede parolalar hash'lenir, hiçbir yerde çözülemez. → [07](07-kimlik-ve-sifreleme.md)

**HAVING** — `GROUP BY`'dan **sonra** grupları eleyen filtre. `WHERE` ise gruplamadan
**önce** satırları eler. → [03](03-sql-ile-konusmak.md)

**HMAC** — Bir gizli anahtarla üretilen mesaj doğrulama kodu; "bu mesajı anahtarı bilen
biri yazdı" der. Projede JWT imzası ve rezervasyon imzası HMAC-SHA256.
→ [07](07-kimlik-ve-sifreleme.md)

**HTTP** — Web'in konuşma protokolü: istek gider, yanıt gelir, bağlantı biter.
**Durumsuzdur** — sunucu iki isteği kendiliğinden ilişkilendirmez; JWT tam bu yüzden var.
→ [01](01-web-nasil-calisir.md)

**HTTP durum kodu** — Yanıtın sonucunu özetleyen üç haneli sayı: `200` tamam, `201`
oluşturuldu, `400` istek hatalı, `401` giriş gerekli, `403` yetki yok, `404` bulunamadı,
`409` çakışma, `429` çok fazla istek, `500` sunucu hatası. → [01](01-web-nasil-calisir.md)

## I — İ

**Idempotent** — Aynı işlemi bir kez de yapsanız beş kez de yapsanız sonucun aynı olması.
Projede migration'lar böyle: `npm start` kaç kez çalışırsa çalışsın şema aynı yere gelir.

**Index** (indeks) — Veritabanının aramayı hızlandırmak için tuttuğu yardımcı yapı; kitabın
sonundaki dizin gibi. Projede ölçüldü: indeksli sorgu 0,01 ms, indekssiz tarama 45 ms.
→ [02](02-veritabani-nedir.md)

**int4 / bigint** — PostgreSQL'de 4 baytlık ve 8 baytlık tam sayı tipleri. `int4` üst sınırı
2.147.483.647; kuruş cinsinden bu **yalnızca 21,5 milyon TL** ve projenin gerçek cirosu
106 milyon TL. Para toplamları bu yüzden `::bigint`. → [04](04-neden-postgresql.md)

**İzolasyon seviyesi** — Eşzamanlı transaction'ların birbirini ne kadar görebildiğini
belirleyen ayar. Projede kapasite koruması **SERIALIZABLE** gerektiriyor; READ COMMITTED
(PostgreSQL'in varsayılanı) korumuyor — ölçüldü. → [06](06-ayni-anda-iki-kisi.md)

**İstemci / sunucu** (client/server) — İsteyen ve veren taraf. Tarayıcı istemci, Node
sunucu. → [01](01-web-nasil-calisir.md)

## J

**JOIN** — İki tabloyu bir eşleştirme kuralıyla birleştirmek. **LEFT JOIN** farkı projede
kritik: "tesisi olmayan ilçeler" sorusunun cevabı düz `JOIN` kullanılırsa listeden düşer.
→ [03](03-sql-ile-konusmak.md)

**JSON** — Veriyi metin olarak taşıyan yaygın format. API yanıtlarının hepsi JSON.

**JWT** (JSON Web Token) — İçinde kullanıcı bilgisi taşıyan, imzalı oturum bileti. **Şifreli
değildir** — içeriği herkes okuyabilir, ama imza olmadan **değiştirilemez**. Projede HS256
ile imzalı, 8 saatlik `exp` ile. → [07](07-kimlik-ve-sifreleme.md), [teknoloji/jwt.md](teknoloji/jwt.md)

## K

**Kalite kapısı** — Bir veri eşleşmesinin yeterince güvenilir olup olmadığını sınayan eşik.
Projede güzergah eşleşmesi için: örtüşme ≥ %60 **ve** ortalama sapma ≤ 350 m. Geçemeyen
çizilmez, sebebi kaydedilir. → [10](10-veri-nereden-geliyor.md)

**Kısmi indeks** (partial index) — Yalnız belirli satırları kapsayan indeks. Projede
`WHERE status <> 'cancelled'` — iptal edilen bir rezervasyon slotu artık bloke etmiyor.
→ [06](06-ayni-anda-iki-kisi.md)

**KNN** (`<->` operatörü) — "En yakın N kayıt" sorgusu; PostGIS'te GiST indeksi üstünden
çalışır. Projede en yakın tesis araması. → [05](05-harita-verisi-postgis.md)

**Kuruş / minor unit** — Parayı tam sayı olarak tutma yöntemi (`amount_minor`). Kayan
nokta ile para tutmak yuvarlama hatası biriktirir; projede **hiçbir yerde float yok**.
→ [02](02-veritabani-nedir.md), ADR-001

## L

**Leaflet** — Açık kaynak harita kütüphanesi (v1.9.4). Projede `docs/vendor/leaflet/`
altında vendored. → [09](09-frontend-harita.md), [teknoloji/leaflet.md](teknoloji/leaflet.md)

**libuv thread pool** — Node'un altındaki, varsayılan 4 iş parçacıklı yardımcı havuz.
Hesap yoğun işler buraya atılır; projede ölçüldü: 4 parola hash'i sırayla 428 ms,
havuzda paralel 107 ms. → [08](08-backend-node-express.md)

**localStorage** — Tarayıcının kalıcı anahtar-değer deposu. Projede çevrimdışı modda
verinin durduğu yer — **ve DBeaver'da görünmemesinin sebebi.**
→ [09](09-frontend-harita.md)

## M

**Middleware** — İsteğin geçtiği boru hattındaki her halka; ya değiştirir ya `next()` ile
devreder. Projede sıra kritik: `express.json()` hız sınırlayıcıdan **önce** olmalı.
→ [08](08-backend-node-express.md)

**Migration** — Veritabanı şemasını versiyonlayarak ileri taşıyan adım. Projede
`backend/database.js` içinde numaralı; şema tek yerde tanımlı ve `schema.sql` ondan
**türetiliyor** (elle düzenlenmez). → [02](02-veritabani-nedir.md)

**Mojibake** — UTF-8 metnin yanlış kodlamayla okunmasından doğan bozuk karakterler
(`Beşiktaş` → `BeÅŸiktaÅŸ`). Projede İBB verisinde gerçekten karşılaşıldı ve onarım kodu
yazıldı. → [10](10-veri-nereden-geliyor.md)

## N

**Node.js** — JavaScript'i sunucuda çalıştıran ortam. Projede v22.
→ [08](08-backend-node-express.md), [teknoloji/nodejs.md](teknoloji/nodejs.md)

**NULL** — "Değer yok" demek; sıfır ya da boş metin **değil**. `NULL = NULL` bile doğru
değildir — karşılaştırmak için `IS NULL` gerekir. SQL'in en sık tuzağı.
→ [03](03-sql-ile-konusmak.md)

## O — Ö

**OpenWeather** — Hava durumu API'si. Projedeki tek gerçek zamanlı kaynak; anahtar
`.env`'de (git'te değil), çağrı sunucudan `https` ile. → [10](10-veri-nereden-geliyor.md)

**ORM** — Veritabanı satırlarını nesnelere çeviren katman (Prisma, Sequelize…). Projede
**bilinçli olarak kullanılmadı**: PostGIS sorguları ve izolasyon kontrolü ham SQL ister,
ve amaç SQL öğrenmekti.

**Örtüşme (match_cov)** — Bir hattın duraklarının GTFS shape'ine ne kadar oturduğunun
oranı. → [10](10-veri-nereden-geliyor.md)

## P

**Parametreli sorgu** — Değerleri SQL metnine yapıştırmak yerine `$1`, `$2` yer
tutucularıyla göndermek. SQL enjeksiyonuna karşı **tek gerçek savunma**; projede tüm
sorgular parametreli. → [03](03-sql-ile-konusmak.md)

**PBKDF2** — Parolayı kasıtlı olarak **yavaş** hash'leyen algoritma. Projede 600.000
iterasyon (OWASP 2023 önerisi); tek hash ~106 ms sürüyor, bu da kaba kuvvet saldırısını
pratikte imkânsızlaştırıyor. → [07](07-kimlik-ve-sifreleme.md), [teknoloji/pbkdf2.md](teknoloji/pbkdf2.md)

**PHC formatı** — Hash'i, üretim parametreleriyle birlikte saklayan metin biçimi:
`pbkdf2_sha256$600000$<salt>$<hash>`. Böylece iterasyon sayısı ileride artırılabilir ve
eski hash'ler yine doğrulanabilir. → [07](07-kimlik-ve-sifreleme.md)

**PostGIS** — PostgreSQL'e mekansal tip ve fonksiyon ekleyen eklenti (v3.4).
→ [05](05-harita-verisi-postgis.md), [teknoloji/postgis.md](teknoloji/postgis.md)

**PostgreSQL** — Projenin veritabanı (v16); tek gerçek kaynak.
→ [04](04-neden-postgresql.md), [teknoloji/postgresql.md](teknoloji/postgresql.md)

**Port** — Bir makinedeki bir servisi adresleyen numara. Projede backend 8085,
PostgreSQL 5432, yerel Pages önizlemesi 8092. → [01](01-web-nasil-calisir.md)

**Phantom read** — Bir transaction sürerken başka birinin **yeni satır** eklemesi sonucu
oluşan tutarsızlık. Projedeki kapasite kontrolünde tam olarak bu risk var ve SERIALIZABLE
ile kapatılıyor. → [06](06-ayni-anda-iki-kisi.md)

## R

**Rate limit** (hız sınırı) — Bir istemcinin belirli sürede yapabileceği istek sayısını
sınırlamak. Projede login için 15 dakikada 5 deneme; aşılırsa `429`. Hem kaba kuvvete hem
CPU tüketmeye karşı. → [08](08-backend-node-express.md)

**Repository katmanı** — SQL'i uygulamanın geri kalanından ayıran katman. Projede
`backend/db.js`. → [08](08-backend-node-express.md)

**REST** — Kaynakları URL ile, eylemleri HTTP fiilleriyle ifade eden API tarzı. Karşıtı
için → SOAP. → [10](10-veri-nereden-geliyor.md), [teknoloji/soap-vs-rest.md](teknoloji/soap-vs-rest.md)

**Rollup** — Sık sorulan bir özeti önceden hesaplayıp saklamak. Projede `daily_stats`;
türetilmiş olduğu için silinip yeniden üretilebilir. → [10](10-veri-nereden-geliyor.md)

**RETURNING** — PostgreSQL'in `INSERT`/`UPDATE`/`DELETE`'e eklediği, etkilenen satırı aynı
sorguda geri veren yan tümce. → [03](03-sql-ile-konusmak.md)

## S — Ş

**Salt** — Her kullanıcı için ayrı üretilen rastgele değer; parolaya eklenip öyle
hash'lenir. Aynı parolayı kullanan iki kişinin hash'i farklı olur, böylece hazır tablo
saldırıları çalışmaz. → [07](07-kimlik-ve-sifreleme.md)

**Sayfalama** (pagination) — Sonuçları `LIMIT`/`OFFSET` ile parçalara bölmek. Projede
zorunlu hale geldi: sayfalamasız admin ucu 425.139 satır / 142 MB / 8,7 saniye
döndürüyordu. → [08](08-backend-node-express.md)

**Seq Scan / Index Scan** — Tüm tabloyu tarama / indeks üzerinden gitme. `EXPLAIN`
çıktısında hangisini gördüğünüz performansın özetidir. → [02](02-veritabani-nedir.md)

**SERIALIZABLE** — En katı izolasyon seviyesi: eşzamanlı transaction'lar sanki sırayla
çalışmış gibi bir sonuç garanti eder. Projede kapasite koruması bunu **gerektiriyor**;
çakışan transaction `40001` ile reddedilir ve kod yeniden dener.
→ [06](06-ayni-anda-iki-kisi.md)

**Snapshot (fiyat)** — Sipariş kalemine, o anki fiyatın kopyalanması. Menü fiyatı sonradan
değişse bile eski sipariş değişmez. Captured data'nın ders kitabı örneği.
→ [10](10-veri-nereden-geliyor.md), ADR-005

**SOAP** — 1998'den kalma, XML zarfı tabanlı API protokolü. Her şey POST, sözleşme WSDL'de.
İETT uçları böyle. → [10](10-veri-nereden-geliyor.md), [teknoloji/soap-vs-rest.md](teknoloji/soap-vs-rest.md)

**SQL enjeksiyonu** — Kullanıcı girdisinin sorgu **metnine** karışıp kod olarak
çalıştırılması. Parametreli sorgu bunu tamamen engeller.
→ [03](03-sql-ile-konusmak.md)

**SRID 4326** — Koordinatların hangi referans sisteminde olduğunu söyleyen kod; 4326 =
WGS84, yani GPS'in kullandığı enlem/boylam. Projedeki tüm geometriler bu SRID'de.
→ [05](05-harita-verisi-postgis.md)

**ST_Contains / ST_Distance / ST_DWithin** — PostGIS fonksiyonları: içeriyor mu, mesafe
ne, şu yarıçapta mı. Projede ilçe×tesis eşlemesi ve yakınlık aramaları.
→ [05](05-harita-verisi-postgis.md)

**State machine** (durum makinesi) — İzin verilen durum geçişlerinin listesi. Projede
sipariş durumu `submitted → served → paid`; sıçrama yasak, whitelist ile zorlanıyor.
→ [06](06-ayni-anda-iki-kisi.md)

**Şema (schema)** — (1) Veritabanının tablo yapısı; (2) PostgreSQL'de tabloları gruplayan
ad alanı. Projede ikincisi test izolasyonunda ve `demo` sunum şemasında kullanılıyor.

## T

**Tile** (karo) — Haritanın 256×256 piksellik parçası. Leaflet bunları CDN'den indirip
yan yana dizer. → [09](09-frontend-harita.md)

**Timing attack** (zamanlama saldırısı) — Yanıt **süresinden** bilgi sızdırmak. Projede
iki yerde kapatıldı: `timingSafeEqual` ile hash karşılaştırma, ve kullanıcı bulunamasa bile
sahte bir PBKDF2 çalıştırma (böylece "kullanıcı yok" ile "parola yanlış" aynı süreyi alır).
→ [07](07-kimlik-ve-sifreleme.md)

**Transaction** — Ya tamamı uygulanan ya hiçbiri uygulanmayan işlem grubu.
→ [06](06-ayni-anda-iki-kisi.md)

**Turf.js** — Tarayıcıda geometri hesabı yapan kütüphane. Projede `union`, `difference`,
`buffer`, `area` için; PostGIS'in yerine değil, **yanında** — biri sunucuda kalıcı, diğeri
tarayıcıda anlık. → [09](09-frontend-harita.md), [teknoloji/turf.md](teknoloji/turf.md)

**TTL** (time to live) — Bir önbellek girdisinin geçerlilik süresi. Projede hava durumu
için varsayılan 10 dakika, `WEATHER_CACHE_TTL_MS=0` ile kapatılabilir.
→ [10](10-veri-nereden-geliyor.md)

## U — Ü

**UNIQUE kısıtı** — Bir kolon (ya da kolon grubu) değerinin tekrar etmemesini zorlayan
kural. İhlal `23505` hata koduyla reddedilir. → [02](02-veritabani-nedir.md)

**Uç** → bkz. **Endpoint**.

## V

**Vendoring** — Dış kütüphaneyi CDN'den çağırmak yerine dosyasını depoya kopyalamak.
Projede kural: **CDN yok.** Kazanç: çevrimdışı çalışır, sürüm donar, tedarik zinciri
saldırısına kapalı. Bedel: ~1 MB depo ve elle güncelleme. → [09](09-frontend-harita.md)

**Validation** (doğrulama) — Girdinin beklenen biçimde olduğunu sınamak. Projede
`backend/validate.js`; **frontend doğrulaması sayılmaz**, sunucu her zaman kendi kontrolünü
yapar. → [09](09-frontend-harita.md)

## W

**WGS84** → bkz. **SRID 4326**.

**Write skew** — İki transaction'ın ayrı ayrı geçerli, birlikte kuralı bozan yazma yapması.
Projenin en güçlü örneği: iki kişi aynı anda son yeri alır, ikisinin de kontrolü "yer var"
der. READ COMMITTED bunu **engellemez** — ölçüldü: 40 worker / kapasite 10 →
18-22 rezervasyon geçti. SERIALIZABLE tam 10'da tuttu. → [06](06-ayni-anda-iki-kisi.md)

**WSDL** — SOAP servisinin makine okunur sözleşmesi; `?wsdl` eklenerek indirilir.
→ [10](10-veri-nereden-geliyor.md)

## X

**XSS** (Cross-Site Scripting) — Kullanıcı verisinin HTML olarak yorumlanıp kod
çalıştırması. Veri veritabanında duruyorsa **kalıcı (stored)** XSS olur. Projede tüm
serbest metin alanları `escapeHtml`'den geçiyor. → [09](09-frontend-harita.md)

---

## PostgreSQL hata kodları — hızlı başvuru

Bu kodları görmek, kısıtın **gerçekten çalıştığının** kanıtıdır. `queries.sql` 13. bölüm
hepsini kasten tetikliyor.

| Kod | Anlamı | Projede ne zaman |
|---|---|---|
| `23502` | not_null_violation | zorunlu alan boş bırakıldı |
| `23503` | foreign_key_violation | olmayan tesise/kullanıcıya bağlanmaya çalışıldı |
| `23505` | unique_violation | aynı slota ikinci rezervasyon, aynı kullanıcı adı |
| `23514` | check_violation | kapasite ≤ 0, doluluk > 100, geçersiz koordinat |
| `22003` | numeric_value_out_of_range | int4 taşması (para toplamı) |
| `40001` | serialization_failure | SERIALIZABLE çakışması → **yeniden dene** |
| `22007` | invalid_datetime_format | `'2027-13-45'` gibi geçersiz tarih |

---

## Sırada ne var

Katmanlı kitap burada bitiyor. İki yol:

- **Bir teknolojiyi derinlemesine:** [`teknoloji/`](teknoloji/) klasörü.
- **Sunuma hazırlanmak:** [`../anlatim-rehberi.md`](../anlatim-rehberi.md) ve
  [`../dbeaver-rehberi.md`](../dbeaver-rehberi.md).
- **SQL ile oynamak:** [`../sorgu-defteri.md`](../sorgu-defteri.md) + `queries.sql`.
