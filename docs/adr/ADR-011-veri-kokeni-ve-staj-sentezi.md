# ADR-011 — Veri Kökeni, Gerçek Hayat Bütünlüğü ve Staj Sentezi

- **Durum:** Kabul edildi
- **Tarih:** 2026-07-31
- **Bağlam:** 7. Hafta Finali — Staj teslimi, sistem denetimi ve veri dürüstlüğü

---

## 1. Neden Bu Kayda İhtiyaç Duyuldu?

Bir yazılım veya CBS projesini sunarken en büyük tuzak, *"her şey çalışıyor"* deyip neyin gerçek, neyin simülasyon olduğunu gizlemektir. Bu projede hem teknik jürinin hem de kodu inceleyecek bir mühendisin aklına gelebilecek en haklı soru şudur:

> *"Gerçekten tüm noktalar birbirine bağlı mı, yoksa bazı yerleri uygulama sorunsuz görünsün diye uyduruldu mu?"*

Bu ADR; 30 iş günlük staj boyunca projenin omurgasını oluşturan verilerin kaynağını, nerede gerçek kamu verisine tutunduğumuzu, nerede simülasyon yaptığımızı ve bu tercihlerin arkasındaki teknik gerekçeleri hiçbir yapay süsleme olmadan, açık yüreklilikle kayda geçirmek için yazıldı.

---

## 2. Gerçek Hayat Verileri (Kanonik Kaynaklar)

Uygulamada haritada gördüğünüz ve veritabanında sorguladığınız coğrafi varlıklar masa başında elle uydurulmamıştır:

1. **30 İBB Sosyal Tesisi (Noktasal CBS Verisi):**
   * Tesis adları, coğrafi koordinatları (`lat`, `lng`), gerçek sokak adresleri ve ruhsatlı müşteri oturma kapasiteleri İBB Sosyal Tesisleri açık verisinden ve CBS katmanlarından alınmıştır.
   * PostGIS'te `GEOMETRY(Point, 4326)` olarak saklanır ve `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` ile üretilir.
2. **39 İlçe Poligonu ve Demografi:**
   * `docs/data/istanbul-districts.geojson` dosyası, İBB Coğrafi Bilgi Sistemi'nin resmi sınır verisidir.
   * İlçe nüfusları TÜİK'in en güncel İstanbul sayımlarına dayanır. PostGIS `districts` tablosunda `GEOMETRY(MultiPolygon, 4326)` tipindedir ve `ST_Contains` mekansal sorgularında kullanılır.
3. **Canlı Hava Durumu (OpenWeather API):**
   * Herhangi bir tesisin detayına tıklandığında gelen sıcaklık, nem ve rüzgar bilgisi mock değildir; doğrudan `.env` içindeki API anahtarıyla OpenWeather sunucularından anlık çekilir. Ağ koparsa dahi deterministik bir hücre önbelleği (`weather.js`) devreye girer.
4. **Toplu Taşıma ve GTFS Güzergahları:**
   * `docs/data/transit-routes.geojson` katmanı, İBB Açık Veri Portalı'ndan indirilen gerçek GTFS verilerinin (metro, tramvay, vapur ve metrobüs hatları) filtrelenmesiyle üretilmiştir.
5. **Menü Kalemleri ve Fiyatlar:**
   * Tesislerde sunulan çorba, ana yemek, kahvaltı ve tatlı çeşitleri İBB Sosyal Tesisleri'nin resmi menü listesinden derlenmiştir. Fiyatlar kuruş bazında tamsayı (`price_minor`) olarak tutulur.

---

## 3. Sentetik / Simülasyon Verileri (Ve Neden Zorunluydu?)

Veritabanındaki her şey kamuya açık bir API'den canlı akamaz. Bunun iki temel sebebi vardı:

1. **KVKK ve Kurumsal Güvenlik Sınırı:**
   Bir stajyer olarak İBB'nin canlı müşteri rezervasyon ve kasa sistemine doğrudan bağlanmak yasal olarak imkânsızdır ve teknik bir güvenlik ihlalidir.
2. **Dağıtık Sistem ve Eşzamanlılık Stres Testi:**
   Boş bir veritabanıyla *"Bakın sistem çalışıyor"* demek mühendislik açısından anlamsızdır. DDIA (Designing Data-Intensive Applications) prensiplerini gerçekten test edebilmek için veritabanında yük ve eşzamanlı çakışma senaryoları yaratmamız gerekiyordu.

Bu doğrultuda üretilen sentetik bileşenler:

* **Müşteriler, Rezervasyonlar ve Siparişler (`seed-500-orders.js`):**
  Son 45 güne yayılan 500 sipariş ve rezervasyon; gerçek menü fiyatları, gerçek tesis kapasiteleri ve gerçek saat dilimleri (`SLOTS`) baz alınarak üretilmiştir.
  * Bu veriler rastgele saçılmamış, `uq_reservations_active_slot` kısmi indeksiyle kapasite aşımı (overbooking) kuralına bağlanmıştır.
  * Sipariş toplamları ile rezervasyon tutarları kuruşu kuruşuna tutarlıdır.
* **İSPARK Doluluk Oranları:**
  İSPARK açık veri servisi zaman zaman kota aşımı veya erişim engeli verdiği için, canlı servise ulaşılamadığında tesis kapasitesine bağlı deterministik bir doluluk üretilir (`ispark_status`).

---

## 4. Staj Yolculuğu ve Mimari Hatalardan Çıkarılan Dersler

Stajın başında her şey pürüzsüz ilerlemedi; bu proje çok sayıda deneme-yanılma ve yeniden yazımın sonucudur:

1. **Python İkizi Denemesi ve Sadeleşme:**
   Stajın 2. haftasında backend için önce Python (FastAPI/Flask) ile bir ikiz yazmayı denedim. Ancak hem kütüphane bağımlılıkları arttı hem de JavaScript tabanlı Leaflet/Turf dünyasıyla senkronizasyonu takip etmek iki kat zorlaştı. APoSD (A Philosophy of Software Design) kitabının *"derin modül ve karmaşıklığı azaltma"* ilkesini benimseyerek Python'ı kaldırdım ve tüm backend'i tek bir yalın Node.js çekirdeğinde birleştirdim.
2. **SQLite'tan PostgreSQL + PostGIS'e Zorunlu Geçiş (ADR-009):**
   İlk haftalarda dosya tabanlı SQLite çok pratik görünüyordu. Fakat rezervasyonlarda aynı anda iki kişi aynı koltuğu rezerve etmeye çalıştığında (write-skew), SQLite'ın kilit mekanizması yetersiz kaldı. Dahası, coğrafi mesafe sorgularını veritabanında indeksli yapabilmek için PostgreSQL 16 ve PostGIS GiST indekslerine geçmek şart oldu.
3. **Para Yönetimi (Float vs Kuruş):**
   İlk sipariş denemelerinde JavaScript `float` hesaplamaları `0.1 + 0.2 = 0.30000000000000004` gibi yuvarlama hataları üretti. Finansal sistemlerin altın kuralı uygulandı: Tüm para alanları veritabanında kuruş (`minor`) cinsinden tamsayı olarak saklandı.
4. **Canlı İzleme (SSE Tercihi - ADR-010):**
   Grafiklerin güncellenmesi için WebSocket kurmak projeye gereksiz ağırlık getirecekti. Tek yönlü akış için tarayıcıda yerleşik olan Server-Sent Events (`EventSource`) tercih edildi; sipariş verildiğinde 400ms debounce ile grafikler yerinde animasyonla yenilenir hale geldi.
5. **Geliştirici Erişimi:**
   Geliştirme ve jüri sunumu sırasında rastgele üretilen 16 haneli karmaşık şifrelerin pratikte mülakat ve sunumu tıkadığı görüldü; standart test hesapları `admin / admin1234` ve `user / user1234` olarak sabitlendi.

---

## 5. Sonuç

Bu projede hiçbir şey *"öylesine, arayüz dolu gözüksün diye"* havadan bırakılmadı. Coğrafya, harita ve koordinatlar gerçektir. Arka plandaki 500 sipariş ise bu gerçek coğrafyanın üzerinde çalışan işlemsel motorun (OLTP) ve analitik göstergelerin (OLAP) doğruluğunu ispatlayan kontrollü mühendislik simülasyonudur.
