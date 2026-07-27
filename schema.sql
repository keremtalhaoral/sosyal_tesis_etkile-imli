-- =============================================================================
-- schema.sql — TÜRETİLMİŞ (derived) veritabanı şeması / DERIVED database schema
-- =============================================================================
-- Bu dosya ELLE DÜZENLENMEZ. Kanonik kaynak:
--   * Yapı  : backend/database.js  (MIGRATIONS dizisi)
--   * Veri  : data/seed.json  (kanonik başlangıç verisi)
-- Yeniden üretmek için:  node scripts/export-schema.js
--
-- Veritabanı: PostgreSQL 16.13 + PostGIS 3.4.2
-- Uygulanmış migration sürümleri: 1, 2, 3, 4, 5, 6, 7, 8
-- Üretim zamanı: 2026-07-27T07:02:44.629Z
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE audit_log (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  actor_user_id integer NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  detail jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);

CREATE TABLE daily_stats (
  stat_date date NOT NULL,
  facility_id integer NOT NULL,
  revenue_minor integer DEFAULT 0 NOT NULL,
  reservation_count integer DEFAULT 0 NOT NULL,
  guest_count integer DEFAULT 0 NOT NULL,
  highchair_count integer DEFAULT 0 NOT NULL,
  cancelled_count integer DEFAULT 0 NOT NULL,
  order_count integer DEFAULT 0 NOT NULL,
  CONSTRAINT daily_stats_pkey PRIMARY KEY (stat_date, facility_id),
  CONSTRAINT daily_stats_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE
);

CREATE TABLE districts (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  population integer NOT NULL,
  geom geometry,
  CONSTRAINT districts_pkey PRIMARY KEY (id),
  CONSTRAINT districts_name_key UNIQUE (name),
  CONSTRAINT districts_population_check CHECK ((population >= 0))
);

CREATE INDEX idx_districts_geom ON public.districts USING gist (geom);

CREATE TABLE facilities (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  kod text NOT NULL,
  ad text NOT NULL,
  adres text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  capacity integer NOT NULL,
  manual_occupancy integer DEFAULT 0 NOT NULL,
  iett_info text DEFAULT 'Mevcut Değil'::text NOT NULL,
  vapur_info text DEFAULT 'Mevcut Değil'::text NOT NULL,
  transit_transfer text DEFAULT 'Mevcut Değil'::text NOT NULL,
  route_description text DEFAULT 'Mevcut Değil'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  geom geometry GENERATED ALWAYS AS (st_setsrid(st_makepoint(lng, lat), 4326)) STORED,
  CONSTRAINT facilities_pkey PRIMARY KEY (id),
  CONSTRAINT facilities_kod_key UNIQUE (kod),
  CONSTRAINT facilities_capacity_check CHECK ((capacity > 0)),
  CONSTRAINT facilities_lat_check CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision))),
  CONSTRAINT facilities_lng_check CHECK (((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision))),
  CONSTRAINT facilities_occupancy_check CHECK (((manual_occupancy >= 0) AND (manual_occupancy <= 100)))
);

CREATE INDEX idx_facilities_geog ON public.facilities USING gist (((geom)::geography));

CREATE INDEX idx_facilities_geom ON public.facilities USING gist (geom);

CREATE TABLE ispark_status (
  facility_id integer NOT NULL,
  capacity integer NOT NULL,
  occupied integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ispark_status_pkey PRIMARY KEY (facility_id),
  CONSTRAINT ispark_status_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
  CONSTRAINT ispark_status_capacity_check CHECK ((capacity > 0)),
  CONSTRAINT ispark_status_check CHECK (((occupied >= 0) AND (occupied <= capacity)))
);

CREATE TABLE menu_items (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  facility_id integer NOT NULL,
  name text NOT NULL,
  category text DEFAULT 'Genel'::text NOT NULL,
  price_minor integer NOT NULL,
  is_available boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT menu_items_pkey PRIMARY KEY (id),
  CONSTRAINT menu_items_facility_id_name_key UNIQUE (facility_id, name),
  CONSTRAINT menu_items_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
  CONSTRAINT menu_items_price_minor_check CHECK ((price_minor >= 0))
);

CREATE INDEX idx_menu_items_facility ON public.menu_items USING btree (facility_id);

CREATE TABLE order_items (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  order_id integer NOT NULL,
  menu_item_id integer NOT NULL,
  quantity integer NOT NULL,
  unit_price_minor integer NOT NULL,
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
  CONSTRAINT order_items_unit_price_minor_check CHECK ((unit_price_minor >= 0))
);

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);

CREATE TABLE orders (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  reservation_id integer NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  total_minor integer DEFAULT 0 NOT NULL,
  crypto_signature text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  payment_type text,
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT orders_payment_type_check CHECK ((payment_type = ANY (ARRAY['cash'::text, 'card'::text, 'online'::text]))),
  CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['open'::text, 'submitted'::text, 'served'::text, 'paid'::text, 'cancelled'::text]))),
  CONSTRAINT orders_total_minor_check CHECK ((total_minor >= 0))
);

CREATE INDEX idx_orders_reservation ON public.orders USING btree (reservation_id);

CREATE TABLE reservations (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  user_id integer NOT NULL,
  facility_id integer NOT NULL,
  reserve_date date NOT NULL,
  reserve_time time without time zone NOT NULL,
  guests integer NOT NULL,
  crypto_signature text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'confirmed'::text NOT NULL,
  amount_minor integer DEFAULT 0 NOT NULL,
  payment_type text,
  highchair_count integer DEFAULT 0 NOT NULL,
  CONSTRAINT reservations_pkey PRIMARY KEY (id),
  CONSTRAINT reservations_user_id_facility_id_reserve_date_reserve_time_key UNIQUE (user_id, facility_id, reserve_date, reserve_time),
  CONSTRAINT reservations_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
  CONSTRAINT reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT reservations_amount_minor_check CHECK ((amount_minor >= 0)),
  CONSTRAINT reservations_guests_check CHECK ((guests > 0)),
  CONSTRAINT reservations_highchair_count_check CHECK ((highchair_count >= 0)),
  CONSTRAINT reservations_payment_type_check CHECK ((payment_type = ANY (ARRAY['cash'::text, 'card'::text, 'online'::text]))),
  CONSTRAINT reservations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text])))
);

CREATE INDEX idx_reservations_date ON public.reservations USING btree (reserve_date);

CREATE INDEX idx_reservations_facility_date ON public.reservations USING btree (facility_id, reserve_date);

CREATE INDEX idx_reservations_slot ON public.reservations USING btree (facility_id, reserve_date, reserve_time);

CREATE INDEX idx_reservations_user ON public.reservations USING btree (user_id);

CREATE TABLE schema_migrations (
  version integer NOT NULL,
  applied_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);

CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  role text DEFAULT 'user'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))
);
