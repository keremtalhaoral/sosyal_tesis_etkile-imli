# Sosyal Tesis Etkileşimli Harita Projesi (Web GIS)

Bu proje, sosyal tesislerin coğrafi verilerini harita üzerinde etkileşimli olarak görselleştirmek, sorgulamak ve analiz etmek amacıyla geliştirilmiş modern bir **Web GIS (Coğrafi Bilgi Sistemi)** uygulamasıdır. 

## 🚀 Özellikler
- **Etkileşimli Harita Katmanları:** Altlık haritalar arasında geçiş ve özel sosyal tesis katmanlarının yönetimi.
- **Mekansal Sorgulama:** Harita üzerindeki tesislere tıklandığında dinamik bilgi pencereleri (Popup) ve detay gösterimi.
- **Veri Filtreleme:** Türlerine, konumlarına veya kapasitelerine göre tesis analizleri.

## 🛠️ Teknolojiler ve Bağımlılıklar
Projenin geliştirilmesinde aşağıdaki teknoloji yığını ve kütüphaneler kullanılmıştır:
- **Frontend:** HTML5, CSS3, JavaScript (ES6+)
- **GIS Altyapısı:** OpenLayers / Leaflet (Kullandığınız kütüphaneye göre güncelleyin)
- **Veritabanı & Backend:** Merkezi SQLite (WAL modu) — tüm servislerin paylaştığı tek gerçek kaynak; tasarım ve PostgreSQL + PostGIS geçiş yolu için bkz. [DATABASE.md](DATABASE.md)

## 💻 Yerel Geliştirme ve Çalıştırma

Projenin yerel bilgisayarınızda (Ubuntu) çalıştırılması için aşağıdaki adımları takip edebilirsiniz:

1. **Depoyu Klonlayın:**
```bash
   git clone [https://github.com/keremtalhaoral/sosyal_tesis_etkile-imli.git](https://github.com/keremtalhaoral/sosyal_tesis_etkile-imli.git)
   cd sosyal_tesis_etkile-imli
