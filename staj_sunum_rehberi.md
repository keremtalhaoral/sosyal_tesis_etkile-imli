# İBB Sosyal Tesis Takip Sistemi - CBS & Karar Destek Sunum Rehberi

Bu rehber, staj sunumunda projeyi akademik ve profesyonel standartlarda anlatabilmen, "neyi, neden ve nasıl yaptığını" açıklayabilmen için hazırlanmıştır. Sunum yaparken sadece kodu göstermek yerine, arkasındaki yazılım mühendisliği prensiplerini ve CBS (Coğrafi Bilgi Sistemi) kavramlarını açıklaman staj değerlendirmeni çok daha başarılı kılacaktır.

---

## 🏛️ Bölüm 1: Yazılım Tasarımı ve Mimari Kararlar
Projeyi geliştirirken **John Ousterhout (Stanford University)** tarafından yazılan *"A Philosophy of Software Design"* kitabındaki temel prensipleri uyguladık.

### 1. Derin Modüller (Deep Modules)
*   **Kavram**: Bir yazılım modülü dışarıya çok basit bir arayüz (interface) sunmalı, ancak arka planda zengin ve karmaşık işlevleri saklamalıdır (encapsulation). Arayüz basit, uygulama derin olmalıdır.
*   **Projedeki Karşılığı**:
    *   **Rota Modülü (`Routing`)**: Dış dünyaya sadece `Routing.draw(start, end)` arayüzünü sunar. Arka planda ise OSRM API ağ sorgularını yapar, Leaflet koordinat formatı (`[lat, lng]`) ile OSRM formatı (`[lng, lat]`) arasındaki dönüşümleri yönetir, eski rotaları temizler ve çizimi haritaya yansıtır.
    *   **Hava Durumu Modülü (`Weather`)**: Dış dünyaya sadece `Weather.display(lat, lng, elementId)` sunar. Arka planda HTTP fetch isteklerini, hata yakalama (error catching) süreçlerini ve DOM güncellemelerini yönetir.

### 2. Hataları Tasarımla Yok Etmek (Define Errors Out of Existence)
*   **Kavram**: Kodda sürekli `try-catch` veya `null` kontrolleriyle uğraşmak yerine, sistemin işleyişini hata oluşma ihtimalini ortadan kaldıracak veya hataları görünmez kılacak şekilde tasarlamak gerekir.
*   **Projedeki Karşılığı**:
    *   **Python Sunucu Tercihi (`server.py`)**: Node.js/NPM kurulumu ve paket bağımlılıklarının sistem yoluna (PATH) bağlı hatalar yaratma ihtimalini sıfırlamak için backend sunucusunu Python standart kütüphaneleriyle yazdık. Böylece sıfır kurulum bağımlılığı ile sistem doğrudan çalışır.
    *   **Rota Fallback Çizgisi**: OSRM API servisi kapalıysa veya internet bağlantısı yoksa haritanın çökmesi yerine, sistem otomatik olarak iki nokta arasına kesikli doğrusal bir geodezik çizgi çizerek mesafe bilgisini ekranda tutar. Hata kullanıcıya yansıtılmaz.
    *   **Hava Durumu Fallback**: OpenWeatherMap API anahtarı girilmediğinde veya API istek sınırları aşıldığında sistem çökmez; backend enlem/boylam koordinatlarını kullanarak İstanbul iklim modeline uygun gerçekçi rastgele hava durumu üretir.

---

## 🗺️ Bölüm 2: CBS ve Mekansal Analiz Metotları (Adım Adım)

### Adım 1: CBS Katman Etkileşimi (GIS Layer Interaction)
*   **Yapılan İş**: İstanbul ilçe sınırlarını (GeoJSON Polygon) ve sosyal tesisleri (Point) haritaya ekledik.
*   **Neden/Nasıl**: Kullanıcı deneyimini (UX) yormamak adına ilçelerin üzerinde fareyle gezinirken (`mouseover`) hiçbir tooltip tetiklemedik. Yalnızca ilçeye tıklandığında (`click` eventi) sınır çizgilerini kalınlaştırıp parlatarak (`resetStyle` ile eskileri sıfırlayarak) detay paneline geçiş sağladık. Tesis marker'larında ise fareyle üzerine gelindiğinde tooltip açılma özelliğini koruduk.
*   **Katman Çizim Sırası & Hover Sorunu Çözümü**: Haritada GeoJSON poligonları nokta katmanlarından sonra yüklenirse, poligon alanları görünmez bir şekilde noktaların üstüne binerek fare/hover olaylarını engeller (occlusion). Bu bug'ı çözmek için çizim sırasını (`loadData` fonksiyonunda) `renderDistrictsLayer()` altta, `renderFacilityMarkers()` üstte olacak şekilde koordine ettik. Böylece tesis pinleri her zaman tıklanabilir ve hover tooltip'leri çalışır durumda kalır.

### Adım 2: İlçelere Göre Tesis Yoğunluğu (Choropleth Map)
*   **Yapılan İş**: İlçe sınırlarını, içerdikleri sosyal tesis sayılarına göre renklendirdik (Açık sarıdan koyu yeşile).
*   **Neden/Nasıl**: Coğrafi Bilgi Sistemlerinde **Choropleth (Kloroplet)** harita tekniği, mekansal verilerin yoğunluğunu görsel olarak analiz etmenin en iyi yoludur. Backend üzerinde mekansal poligonların tesis noktalarını kapsayıp kapsamadığını hesapladık.
*   **Öğrenilen PostGIS Karşılığı (Spatial Join)**:
    ```sql
    SELECT d.name, COUNT(f.id) AS tesis_sayisi
    FROM districts d
    LEFT JOIN facilities f ON ST_Contains(d.geom, f.geom)
    GROUP BY d.id, d.name;
    ```
    *Backend'de bu mantığı hızlı ve bağımsız çalışabilmesi için **Ray-Casting (Işın Gönderme)** Nokta-Poligon kapsama algoritması ile simüle ettik.*

### Adım 3: En Yakın 3 Tesis Analizi (Proximity KNN Analysis)
*   **Yapılan İş**: Kullanıcı konumuna (GPS veya Taksim) en yakın 3 tesisi gerçek zamanlı hesaplayıp listeledik.
*   **Neden/Nasıl**: CBS'de en yakın komşu analizi (K-Nearest Neighbor) mesafe bazlı sorgulamalar için kullanılır. Ekranda mesafeleri dinamik olarak güncelledik.
*   **Öğrenilen PostGIS Karşılığı (KNN)**:
    ```sql
    SELECT id, tesis_adi, ST_Distance(geom, ST_MakePoint(user_lng, user_lat)) AS mesafe
    FROM facilities
    ORDER BY geom <-> ST_MakePoint(user_lng, user_lat)
    LIMIT 3;
    ```
    *Backend'de bu KNN indeks sorgu mantığını **Haversine (Geodezik Büyük Daire Mesafesi)** formülünü kullanarak çözdük.*

### Adım 4: Akıllı Rota Entegrasyonu (OSRM Routing)
*   **Yapılan İş**: Bir tesise tıklandığında kullanıcının mevcut konumundan tesise giden gerçek sürüş rotasını haritaya çizdik.
*   **Neden/Nasıl**: Kuş uçuşu mesafe (flight distance) gerçek hayatta yetersizdir. OpenStreetMap tabanlı **OSRM API**'sine koordinatları gönderip rotayı GeoJSON LineString olarak çektik ve haritada animasyonlu çizgi olarak görselleştirdik.

### Adım 5: Demografik Veri Bindirme & Karar Destek (Decision Support System)
*   **Yapılan İş**: TÜİK 2023 ilçe nüfus verilerini harita katmanına entegre ettik. Nüfus yoğunluğuna oranla tesis sayısını kıyaslayıp alarm sistemi kurduk.
*   **Neden/Nasıl**: Projeyi basit bir harita olmaktan çıkarıp bir **Karar Destek Sistemi (KDS)** haline getirdik. 100.000 kişi başına düşen tesis oranı kritik olan ilçelerde (örn. 978 bin nüfusa 1 tesisi olan Esenyurt veya 462 bin nüfusa 2 tesisi olan Avcılar) **Kırmızı Alarm (Kritik Tesis Açığı)** üreterek yöneticilere yatırım tavsiyesi ürettik.

### Adım 6: Anlık Hava Durumu (API Entegrasyonu)
*   **Yapılan İş**: Seçilen ilçe centroid'ine (poligonun geometrik merkez ağırlık noktası) ve seçilen tesislere göre anlık hava durumunu entegre ettik.
*   **Neden/Nasıl**: CBS projelerinde dinamik dış veri (real-time attribute data) entegrasyonu süreçlerini öğrenmek amacıyla OpenWeatherMap API entegrasyonu kurguladık.

### Adım 7: Moovit & Google Maps Tarzı Çoklu Ulaşım Planlayıcı (Transit Planner)
*   **Yapılan İş**: Seçilen tesise giden ulaşım alternatiflerini (Arabayla, Otobüs hatları, varsa Vapur, Aktarmalı Rota ve mizahi Uçarak/Sürünerek seçenekleri) dinamik mesafe, varış saati ve gerçek zamanlı kalkış takvimiyle birlikte listeledik.
*   **Neden/Nasıl**: 
    *   **İETT GTFS Saat Simülasyonu**: Büyükşehirlerin GTFS (General Transit Feed Specification) ham veri dosyaları 200MB+ büyüklüktedir ve mobil/web tarayıcılarda doğrudan pars edilmesi performans darboğazlarına yol açar. Bu sorunu aşmak için istemci tarafında kullanıcının sistem saatini (`new Date()`) referans alan matematiksel bir **Headway (Sefer Sıklığı) Simülatörü** geliştirdik. Otobüsler için 8 dk, metro için 6 dk, vapur için 20 dk frekans modellemeleriyle sıradaki 2 seferin tam kalkış saatini ve kalan dakikalarını dinamik hesaplıyoruz.
    *   **Açık Veri Kaynak Atıfları (GIS Provenance)**: Profesyonel coğrafi bilgi sistemleri standartlarına uygun olarak, her bir ulaşım kartının altında veri kaynağını (İBB Açık Veri Portalı İETT GTFS, Şehir Hatları Sefer Veritabanı, Project OSRM Routing API, OpenWeatherMap) açıkça belirttik.
    *   **Kaydırma Desteği (Details Scroll Fix)**: Çoklu ulaşım seçeneklerinin getirdiği zengin veri detay panelinin sınırlarından taşmaktaydı. CSS katmanında `.content-view` elementine `overflow-y: auto` ve özelleştirilmiş ince scrollbar ekleyerek taşan verilerin kesilmeden, akıcı bir şekilde aşağı kaydırılarak okunabilmesini sağladık.
    *   **Mizahi & Akılda Kalıcı Arayüz**: Sunumda jüriyi etkilemek ve etkileşimi artırmak amacıyla "Süper Kahraman Uçuşu" (ses hızıyla 340 m/s) ve "Müfettiş Sürünmesi" (snail speed 0.3 km/s) seçeneklerini formüllere dayandırarak ekledik.
    *   **Yazılım Tasarımı (Ousterhout Uyumluluğu)**: Karmaşık transit rota ağını doğrudan istemci tarafına gömerek (TRANSIT_LOOKUP tablosu), internet kopması veya sunucu yanıt vermeme hatalarını tasarımla yok ettik (Define Errors Out of Existence).

---

## 🎓 Bölüm 3: Sunumda Vurgulanacak Teknik Kazanımlarım
Staj kuruluna ve yöneticilerine bu projeden elde ettiğin şu kazanımları aktarabilirsin:
1.  **Mekansal Veri Modelleri**: Nokta (Point) ve Çokgen (Polygon/MultiPolygon) veri tiplerinin web haritalama ortamında Leaflet.js ile nasıl yönetildiğini öğrendim.
2.  **Mekansal Sorgular (Spatial Queries)**: Nokta-poligon ilişkilerini (Point-in-Polygon) ve koordinatlar arası küresel mesafe hesaplama (Haversine) algoritmalarını kavradım.
3.  **İstemci-Sunucu (Client-Server) Mimarisi**: Frontend arayüzü ile Python/Express backend servislerinin CORS kuralları çerçevesinde REST API üzerinden nasıl haberleştiğini deneyimledim.
4.  **Karar Destek Sistemleri (KDS)**: Coğrafi veriler ile demografik (TÜİK) verileri ilişkilendirerek ham veriden nasıl anlamlı yönetsel kararlar üretilebileceğini kurguladım.
5.  **Temiz Kod Tasarımı (Ousterhout Prensipleri)**: Kod karmaşıklığını gizleme (information hiding), derin modül yazma ve hata toleranslı (fail-safe) sistem tasarımı konularında pratik tecrübe kazandım.
6.  **Çoklu Ulaşım ve Ağ Analizi Simülasyonu**: Koordinat verileri üzerinden farklı ulaşım modlarının hız ve süre parametrelerini kullanarak gerçekçi yol tarifi modelleri kurguladım.

