# DBeaver

## 1. Tek cümlede

DBeaver, veritabanına grafik arayüzle bağlanıp tabloları gezmenizi, sorgu yazmanızı, ER
diyagramı üretmenizi ve — PostGIS için — **geometriyi harita üstünde görmenizi** sağlayan
ücretsiz masaüstü aracıdır.

**Bu projede:** sunum aracı. Uygulamada bir işlem yapıp DBeaver'da satırın belirdiğini
göstermek için.

---

## 2. Hangi problemi çözmek için doğdu

`psql` güçlüdür ama üç şeyi iyi yapmaz:

1. **Keşif.** "Bu veritabanında ne var?" sorusunun cevabı `\dt`, `\d tablo`, `\di`
   komutlarını bilmeyi gerektirir. DBeaver bir ağaç gösterir.
2. **Görselleştirme.** ER diyagramı, sorgu planı ağacı, geometri haritası — hiçbiri
   terminalde olmaz.
3. **Gösterim.** Mentöre `psql` çıktısı göstermek ile bir tabloyu tıklayıp **F5'e basıp
   yeni satırın belirdiğini** göstermek arasında büyük fark var.

Üçüncüsü bu proje için belirleyici: **sunumun kalbi "F5'e bas, satır belirdi" anı.**

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **`psql`** | her yerde var, script'lenebilir | görsel yok; sunumda etkisiz. *(Yine de `queries.sql` ile birlikte hâlâ kullanılıyor)* |
| **pgAdmin** | PostgreSQL'in resmî aracı | web tabanlı, ağırca; PostGIS harita görünümü DBeaver kadar iyi değil |
| **TablePlus / DataGrip** | cilalı arayüz | ücretli |
| **QGIS** | GIS için çok daha güçlü | mekansal veriye odaklı; sipariş/rezervasyon tablolarını göstermek için uygun değil |

**Belirleyici sebep:** DBeaver ücretsiz, çok platformlu, ve **hem** ilişkisel tabloları
**hem** PostGIS geometrisini iyi gösteriyor. Bu projede ikisine de ihtiyaç var.

---

## 4. Bu projede tam olarak nerede

DBeaver kod değil, **süreç** parçası. Kullanımı iki yerde:

**(a) Geliştirme sırasında** — bir sorgunun ne döndürdüğünü hızlıca görmek, `EXPLAIN`
planına bakmak, geometrinin doğru yere düştüğünü kontrol etmek.

**(b) Sunumda** — `docs/dbeaver-rehberi.md`'deki **9 adımlık senaryo**:

| Adım | Uygulamada | DBeaver'da (F5) |
|---|---|---|
| 1 | Kayıt ol | `users`'ta yeni satır; parola PHC formatında, **salt her satırda farklı** |
| 2 | Rezervasyon yap | `reservations` + `crypto_signature` |
| 3 | Sipariş ver | `orders` + `order_items` + `reservations.amount_minor` arttı |
| 4 | — | menü fiyatını DBeaver'dan değiştir → **eski sipariş değişmiyor** (snapshot) |
| 5 | Siparişi iptal et | `amount_minor` geri düştü + `audit_log`'da kayıt |
| 6 | — | DBeaver'dan kapasite üstü INSERT → kısıt hatası |
| 7 | — | `node backend/test-concurrency.js` → write skew |
| 8 | — | `ST_Contains` + **harita sekmesi** |
| 9 | — | 425 bin satırda `EXPLAIN ANALYZE` |

**Bağlantı ayarları:**

```
Host: localhost      Port: 5432
Database: mufettis   User: mufettis    Password: mufettis-dev
```

Sunum için `demo` şeması kullanılıyor (`npm run demo:reset && npm run demo:start`) —
5 tesis, 3 kullanıcı, 0 rezervasyon. Tertemiz bir tablo, her işlem gözle görünür.

---

## 5. Bilinmesi gereken üç tuzak

### (a) **F5'e basmayı unutmak** — sunumun en olası kazası

DBeaver sonucu **önbelleğe alır.** Uygulamada rezervasyon yaptınız, DBeaver'a döndünüz,
tablo eskisi gibi… ve "çalışmıyor" dediniz. Aslında çalışıyor, sadece ekran eski.

> Bu, provada gerçekten yaşanacak tek şeydir. Kas hafızası: **sekmeye tıkla → F5.**

### (b) Yanlış şemaya bakmak

`demo:start` ile sunum yapıyorsanız veri `demo` şemasında, ama DBeaver varsayılan olarak
`public`'i açar. Ağaçta `public` altına bakıp "satır yok" demek çok kolay.

Ağaçta: `mufettis > Şemalar > demo > Tablolar`.

### (c) Açık transaction tabloyu kilitler

DBeaver'da manuel commit modundaysanız, çalıştırdığınız `UPDATE` **commit edilmemiş**
kalır ve o satır kilitli olur. Sonra uygulamadan aynı satıra dokunmaya çalışırsınız ve
uygulama **donar** — sebebi görünmez.

Bu aslında öğretici bir andır (senaryo Adım 7 bunu kasten yapıyor), ama **kazara** olursa
sunumu bozar. Kural: DBeaver'da yazma yaptıysanız **commit edin** ya da otomatik commit
modunda kalın.

---

## 6. Kendin dene

```bash
# sunum ortamını hazırlayın
npm run demo:reset
npm run demo:start          # PG_SCHEMA=demo ile backend
```

DBeaver'da:

1. Yeni bağlantı → PostgreSQL → yukarıdaki ayarlar → **Test Connection**
2. Ağaç: `mufettis > Schemas > demo > Tables`
3. `reservations` tablosuna çift tıklayın → **Data** sekmesi
4. Tarayıcıda bir rezervasyon yapın
5. DBeaver'a dönün → **F5** → satır belirdi

Geometriyi harita üstünde görmek için:

```sql
SELECT ad, geom FROM facilities;
```

Sonuç grid'inde `geom` kolonuna tıklayın → sağ panelde **Spatial/Map** sekmesi.

---

## 7. Daha fazlası için

- İndirme: <https://dbeaver.io/download/>
- **Projede tam rehber:** [`../../dbeaver-rehberi.md`](../../dbeaver-rehberi.md) —
  kurulum, arayüz turu, ER diyagramı, harita görünümü, `EXPLAIN` görselleştirme,
  9 adımlık prova edilmiş senaryo, sorun giderme tablosu, sunum öncesi kontrol listesi
- Sorgu malzemesi: `queries.sql` (16 bölüm) + [`../../sorgu-defteri.md`](../../sorgu-defteri.md)
