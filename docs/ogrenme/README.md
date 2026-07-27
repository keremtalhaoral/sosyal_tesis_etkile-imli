# Öğrenme Kitabı — Bu Projeyi Sıfırdan Anlamak

> **Bu kitap kimin için?** Bu projeyi yazdınız (ya da devraldınız) ama içindeki teknolojileri
> "kullandım" düzeyinde biliyorsunuz. Amaç bunu **anladım** düzeyine çıkarmak.
>
> **Yöntem: Feynman tekniği.** Bir şeyi gerçekten anlamanın testi, onu basit kelimelerle
> anlatabilmektir. O yüzden her bölüm en basit hâliyle başlar, sonra katman katman derinleşir.
> Anlamadığınız bir yer olursa, o noktada durup bir önceki katmana dönün — bu bir eksiklik
> değil, yöntemin kendisi.

## İki eksen

Bu klasörde **iki farklı okuma yolu** var:

### 1. Katmanlı kitap (00 → 11) — "neden" anlatır

Sırayla okunur. Her bölüm bir öncekini varsayar, sıfır ön bilgiyle başlar.

| # | Bölüm | Şunu öğrenirsiniz |
|---|---|---|
| [00](00-bu-proje-ne-yapiyor.md) | Bu proje ne yapıyor? | Hiç teknik terim yok. Hangi sorun, hangi çözüm |
| [01](01-web-nasil-calisir.md) | Web nasıl çalışır? | İstemci/sunucu, HTTP, port, API |
| [02](02-veritabani-nedir.md) | Veritabanı nedir? | Neden dosyaya yazmıyoruz; tablo, satır, anahtar |
| [03](03-sql-ile-konusmak.md) | SQL ile konuşmak | SELECT/INSERT/UPDATE/DELETE, JOIN, GROUP BY |
| [04](04-neden-postgresql.md) | Neden PostgreSQL? | SQLite'tan neden geçtik, neyi kaybettik |
| [05](05-harita-verisi-postgis.md) | Harita verisi ve PostGIS | Koordinat, SRID, poligon, mekansal sorgu |
| [06](06-ayni-anda-iki-kisi.md) | Aynı anda iki kişi | Transaction, ACID, write skew, izolasyon |
| [07](07-kimlik-ve-sifreleme.md) | Kimlik ve şifreleme | Hash vs şifreleme, salt, PBKDF2, JWT |
| [08](08-backend-node-express.md) | Backend: Node ve Express | Olay döngüsü, async, middleware, havuz |
| [09](09-frontend-harita.md) | Frontend ve harita | DOM, Leaflet, katman, vendoring, çift mod |
| [10](10-veri-nereden-geliyor.md) | Veri nereden geliyor? | GTFS, İBB API, SOAP vs REST, türetilmiş veri |
| [11](11-sozluk.md) | Sözlük | A-Z bütün terimler, her biri bölüme bağlı |

### 2. Teknoloji dosyaları — "ne" anlatır

[`teknoloji/`](teknoloji/) klasöründe, her teknoloji için bağımsız bir dosya. Referans
olarak kullanılır: *"Leaflet tam olarak ne, neden o seçildi, alternatifi neydi?"*

Her dosyanın yapısı aynı: **ne olduğu → hangi problemi çözmek için doğdu → alternatifleri
ve neden seçilmedikleri → bu projede tam olarak nerede → bilinmesi gereken tuzaklar.**

---

## Her bölümün iskeleti

Katmanlı kitaptaki her bölüm aynı 7 adımı izler:

1. **Bir cümlede** — 12 yaşındaki birine anlatır gibi.
2. **Benzetme** — günlük hayattan bir karşılık… **ve benzetmenin nerede bozulduğu.**
   *(Bu ikinci kısım kritik: benzetmenin sınırını söylemezseniz yanlış bir zihinsel model
   kurulur ve o model ileride sizi yanıltır.)*
3. **Biraz daha derin** — gerçek terimler, ilk katmanın üstüne.
4. **Projede tam olarak nerede** — dosya adı, satır, çalıştırılabilir komut.
5. **Kendin dene** — kopyalayıp çalıştıracağınız komut + beklenen çıktı.
6. **Mentör sorarsa** — muhtemel soru ve kısa cevabı.
7. **Sırada ne var** — bir sonraki bölüm.

---

## Nereden başlamalı?

- **Hiçbir şey bilmiyorum:** [00](00-bu-proje-ne-yapiyor.md)'dan başlayın, sırayla gidin.
- **Yazılım biliyorum, veritabanı zayıf:** [02](02-veritabani-nedir.md)'den başlayın.
- **Yarın sunum var:** [`../anlatim-rehberi.md`](../anlatim-rehberi.md) +
  [`../dbeaver-rehberi.md`](../dbeaver-rehberi.md). Bu kitap uzun vadeli.
- **Belirli bir teknoloji:** doğrudan [`teknoloji/`](teknoloji/) klasörüne.

## Kitabı okurken

Yanınızda **çalışan bir sistem** olsun. Her bölümdeki "Kendin dene" kısımları gerçek
komutlar — okumak yerine çalıştırmak, on kat daha iyi öğretir.

```bash
npm install
npm run db:up          # PostgreSQL + PostGIS
npm start              # backend
npm run db:load-geo    # ilçe sınırları (bir kez)
```
