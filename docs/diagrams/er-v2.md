# v_2 Varlık-İlişki (ER) Diyagramı

Bu diyagram v_2 hedef veri modelini gösterir. **Düz çizgili tablolar** uygulanmış durumdadır
(migration v1 + v2). **Kesikli/planlanan** tablolar `daily_stats`, `ispark_status`, `audit_log`
sonraki fazlarda kendi migration'larıyla eklenecek (bkz. ADR-001) — burada şemanın önden
tasarlandığını göstermek için yer alıyorlar.

Para değerleri her yerde **tam sayı kuruş** (`*_minor`) olarak tutulur (float yuvarlama
hatasından kaçınmak için — bkz. ADR-001).

```mermaid
erDiagram
    users ||--o{ reservations : "yapar"
    facilities ||--o{ reservations : "için"
    facilities ||--o{ menu_items : "sunar"
    reservations ||--o{ orders : "içerir"
    orders ||--o{ order_items : "kalemleri"
    menu_items ||--o{ order_items : "referans (fiyat snapshot'lanır)"
    districts ||..|| facilities : "mekansal join (kod dışı, coğrafi)"

    users {
        int id PK
        string username UK
        string password "PBKDF2-HMAC-SHA256 hash"
        string role "user|admin (CHECK)"
        string created_at
    }
    facilities {
        int id PK
        string kod UK "ALTY-01 (doğal iş anahtarı)"
        string ad
        string adres
        real lat "CHECK -90..90"
        real lng "CHECK -180..180"
        int capacity "CHECK > 0"
        int occupancy "0..100 (CHECK)"
        string iett_info
        string vapur_info
        string transit_transfer
        string route_description
    }
    reservations {
        int id PK
        int user_id FK
        int facility_id FK
        string reserve_date
        string reserve_time
        int guests "CHECK > 0"
        string status "pending|confirmed|cancelled"
        int amount_minor "kuruş, CHECK >= 0"
        string payment_type "cash|card|online (nullable)"
        int highchair_count "bebe sandalyesi adedi, CHECK >= 0"
        string crypto_signature
        string created_at
        string UNIQUE "user+facility+date+time"
    }
    menu_items {
        int id PK
        int facility_id FK
        string name
        string category
        int price_minor "kuruş, CHECK >= 0"
        int is_available "0|1"
        string created_at
        string UNIQUE "facility+name"
    }
    orders {
        int id PK
        int reservation_id FK "siparişi rezervasyona bağlar"
        string status "open|submitted|served|paid|cancelled"
        int total_minor "kuruş"
        string crypto_signature
        string created_at
    }
    order_items {
        int id PK
        int order_id FK
        int menu_item_id FK
        int quantity "CHECK > 0"
        int unit_price_minor "sipariş anındaki fiyat SNAPSHOT'ı"
    }
    districts {
        int id PK
        string name UK
        int population "CHECK >= 0"
    }
```

## Planlanan tablolar (sonraki fazlar — henüz migration yok)

```mermaid
erDiagram
    facilities ||--o| ispark_status : "otopark durumu (Faz v2-03)"
    facilities ||--o{ daily_stats : "günlük özet (Faz v2-04)"
    users ||--o{ audit_log : "işlem kaydı (Faz v2-07)"

    ispark_status {
        int facility_id PK_FK
        int capacity
        int occupied "eşzamanlı düşülür (Faz 3: yarış koşulu)"
        string updated_at
    }
    daily_stats {
        string date PK "rollup anahtarı"
        int facility_id PK_FK
        int revenue_minor "türetilmiş: siparişlerden"
        int guest_count
        int highchair_count
        int order_count
    }
    audit_log {
        int id PK
        int actor_user_id FK
        string action
        string entity_type
        int entity_id
        string detail
        string created_at
    }
```

> `daily_stats` **türetilmiş veri**dir (siparişlerden hesaplanır). v1'de canlı sorgu ile
> başlanacak, sonra bu rollup tablosu eklenip ikisi benchmark edilecek (DDIA Böl. 3, OLTP/OLAP).
