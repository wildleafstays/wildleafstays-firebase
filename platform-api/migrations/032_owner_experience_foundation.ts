import { sql, type Kysely } from "kysely";

const PROPERTY_AMENITY_CODES = [
  "HIGH_SPEED_WIFI",
  "MOBILE_NETWORK",
  "FREE_PARKING",
  "PAID_PARKING",
  "VALET_PARKING",
  "AIRPORT_TRANSFER",
  "TAXI_SERVICE",
  "DRIVER_ACCOMMODATION",
  "CAFE",
  "BAR",
  "BBQ",
  "PRIVATE_DINING",
  "ACCESSIBLE_PARKING",
  "ACCESSIBLE_WASHROOM",
  "RAMP_ACCESS",
  "INDOOR_POOL",
  "SAUNA",
  "STEAM_ROOM",
  "YOGA_SPACE",
  "GAMES_ROOM",
  "INDOOR_GAMES",
  "BABY_COT",
  "HIGH_CHAIR",
  "BABYSITTING",
  "IRONING_SERVICE",
  "FRONT_DESK_24H",
  "CONCIERGE",
  "LUGGAGE_STORAGE",
  "GENERATOR",
  "DAILY_CLEANING",
  "SECURITY",
  "SMOKE_ALARM",
  "FIRST_AID",
  "EMERGENCY_LIGHTING",
  "LAWN",
  "OUTDOOR_SEATING",
  "TERRACE",
  "ROOFTOP",
  "PICNIC_AREA",
  "NATURE_TRAIL",
  "BANQUET_HALL",
  "CONFERENCE_ROOM",
  "MEETING_ROOM",
  "EVENT_SPACE",
  "PET_FRIENDLY",
  "COMMON_LOUNGE",
  "LIBRARY",
  "PRAYER_SPACE"
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into amenity_catalog (code, name, category, sort_order)
    values
      ('HIGH_SPEED_WIFI', 'High-speed Wi-Fi', 'CONNECTIVITY', 210),
      ('MOBILE_NETWORK', 'Good mobile network', 'CONNECTIVITY', 220),

      ('FREE_PARKING', 'Free Parking', 'PARKING_TRANSPORT', 230),
      ('PAID_PARKING', 'Paid Parking', 'PARKING_TRANSPORT', 240),
      ('VALET_PARKING', 'Valet Parking', 'PARKING_TRANSPORT', 250),
      ('AIRPORT_TRANSFER', 'Airport Transfer', 'PARKING_TRANSPORT', 260),
      ('TAXI_SERVICE', 'Taxi Service', 'PARKING_TRANSPORT', 270),
      ('DRIVER_ACCOMMODATION', 'Driver Accommodation', 'PARKING_TRANSPORT', 280),

      ('CAFE', 'Cafe', 'FOOD_BEVERAGE', 290),
      ('BAR', 'Bar', 'FOOD_BEVERAGE', 300),
      ('BBQ', 'BBQ', 'FOOD_BEVERAGE', 310),
      ('PRIVATE_DINING', 'Private Dining', 'FOOD_BEVERAGE', 320),

      ('ACCESSIBLE_PARKING', 'Accessible Parking', 'ACCESSIBILITY', 330),
      ('ACCESSIBLE_WASHROOM', 'Accessible Washroom', 'ACCESSIBILITY', 340),
      ('RAMP_ACCESS', 'Ramp Access', 'ACCESSIBILITY', 350),

      ('INDOOR_POOL', 'Indoor Pool', 'LEISURE', 360),
      ('SAUNA', 'Sauna', 'LEISURE', 370),
      ('STEAM_ROOM', 'Steam Room', 'LEISURE', 380),
      ('YOGA_SPACE', 'Yoga Space', 'LEISURE', 390),
      ('GAMES_ROOM', 'Games Room', 'LEISURE', 400),
      ('INDOOR_GAMES', 'Indoor Games', 'LEISURE', 410),

      ('BABY_COT', 'Baby Cot Available', 'FAMILY', 420),
      ('HIGH_CHAIR', 'High Chair', 'FAMILY', 430),
      ('BABYSITTING', 'Babysitting', 'FAMILY', 440),

      ('IRONING_SERVICE', 'Ironing Service', 'SERVICES', 450),
      ('FRONT_DESK_24H', '24-hour Front Desk', 'SERVICES', 460),
      ('CONCIERGE', 'Concierge', 'SERVICES', 470),
      ('LUGGAGE_STORAGE', 'Luggage Storage', 'SERVICES', 480),
      ('GENERATOR', 'Generator', 'SERVICES', 490),
      ('DAILY_CLEANING', 'Daily Cleaning', 'SERVICES', 500),

      ('SECURITY', 'Security', 'SAFETY', 510),
      ('SMOKE_ALARM', 'Smoke Alarms', 'SAFETY', 520),
      ('FIRST_AID', 'First-aid Kit', 'SAFETY', 530),
      ('EMERGENCY_LIGHTING', 'Emergency Lighting', 'SAFETY', 540),

      ('LAWN', 'Lawn', 'OUTDOOR', 550),
      ('OUTDOOR_SEATING', 'Outdoor Seating', 'OUTDOOR', 560),
      ('TERRACE', 'Terrace', 'OUTDOOR', 570),
      ('ROOFTOP', 'Rooftop Area', 'OUTDOOR', 580),
      ('PICNIC_AREA', 'Picnic Area', 'OUTDOOR', 590),
      ('NATURE_TRAIL', 'Nature Trail', 'OUTDOOR', 600),

      ('BANQUET_HALL', 'Banquet Hall', 'BUSINESS', 610),
      ('CONFERENCE_ROOM', 'Conference Room', 'BUSINESS', 620),
      ('MEETING_ROOM', 'Meeting Room', 'BUSINESS', 630),
      ('EVENT_SPACE', 'Event Space', 'BUSINESS', 640),

      ('PET_FRIENDLY', 'Pet Friendly', 'OTHER', 650),
      ('COMMON_LOUNGE', 'Common Lounge', 'OTHER', 660),
      ('LIBRARY', 'Library', 'OTHER', 670),
      ('PRAYER_SPACE', 'Prayer / Meditation Space', 'OTHER', 680)
    on conflict (code) do nothing
  `.execute(db);

  await sql`
    create table room_amenity_catalog (
      code text primary key,
      name text not null,
      category text not null check (
        category in (
          'COMFORT',
          'BATHROOM',
          'ENTERTAINMENT',
          'FOOD_BEVERAGE',
          'FURNITURE_STORAGE',
          'OUTDOOR_VIEW'
        )
      ),
      active boolean not null default true,
      sort_order integer not null default 0 check (sort_order >= 0),
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    insert into room_amenity_catalog (code, name, category, sort_order)
    values
      ('AIR_CONDITIONING', 'Air Conditioning', 'COMFORT', 10),
      ('ROOM_HEATER', 'Room Heater', 'COMFORT', 20),
      ('CENTRAL_HEATING', 'Central Heating', 'COMFORT', 30),
      ('FAN', 'Fan', 'COMFORT', 40),
      ('ELECTRIC_BLANKET', 'Electric Blanket', 'COMFORT', 50),
      ('SOUNDPROOFING', 'Soundproofing', 'COMFORT', 60),
      ('BLACKOUT_CURTAINS', 'Blackout Curtains', 'COMFORT', 70),

      ('PRIVATE_BATHROOM', 'Private Bathroom', 'BATHROOM', 80),
      ('HOT_WATER', 'Hot Water', 'BATHROOM', 90),
      ('GEYSER', 'Geyser', 'BATHROOM', 100),
      ('SHOWER', 'Shower', 'BATHROOM', 110),
      ('BATHTUB', 'Bathtub', 'BATHROOM', 120),
      ('HAIR_DRYER', 'Hair Dryer', 'BATHROOM', 130),
      ('TOILETRIES', 'Toiletries', 'BATHROOM', 140),
      ('SLIPPERS', 'Slippers', 'BATHROOM', 150),
      ('BATHROBE', 'Bathrobe', 'BATHROOM', 160),

      ('TV', 'Television', 'ENTERTAINMENT', 170),
      ('SMART_TV', 'Smart TV', 'ENTERTAINMENT', 180),
      ('CABLE_TV', 'Cable / Satellite TV', 'ENTERTAINMENT', 190),

      ('TEA_COFFEE', 'Tea / Coffee Maker', 'FOOD_BEVERAGE', 200),
      ('ELECTRIC_KETTLE', 'Electric Kettle', 'FOOD_BEVERAGE', 210),
      ('MINIBAR', 'Minibar', 'FOOD_BEVERAGE', 220),
      ('REFRIGERATOR', 'Refrigerator', 'FOOD_BEVERAGE', 230),

      ('WARDROBE', 'Wardrobe', 'FURNITURE_STORAGE', 240),
      ('SAFE', 'In-room Safe', 'FURNITURE_STORAGE', 250),
      ('WORK_DESK', 'Work Desk', 'FURNITURE_STORAGE', 260),
      ('SOFA', 'Sofa', 'FURNITURE_STORAGE', 270),
      ('SEATING_AREA', 'Seating Area', 'FURNITURE_STORAGE', 280),
      ('DINING_AREA', 'Dining Area', 'FURNITURE_STORAGE', 290),
      ('IRON', 'Iron', 'FURNITURE_STORAGE', 300),
      ('IRONING_BOARD', 'Ironing Board', 'FURNITURE_STORAGE', 310),

      ('PRIVATE_BALCONY', 'Private Balcony', 'OUTDOOR_VIEW', 320),
      ('PRIVATE_TERRACE', 'Private Terrace', 'OUTDOOR_VIEW', 330),
      ('MOUNTAIN_VIEW', 'Mountain View', 'OUTDOOR_VIEW', 340),
      ('VALLEY_VIEW', 'Valley View', 'OUTDOOR_VIEW', 350),
      ('GARDEN_VIEW', 'Garden View', 'OUTDOOR_VIEW', 360),
      ('FOREST_VIEW', 'Forest View', 'OUTDOOR_VIEW', 370),
      ('POOL_VIEW', 'Pool View', 'OUTDOOR_VIEW', 380),
      ('CITY_VIEW', 'City View', 'OUTDOOR_VIEW', 390)
  `.execute(db);

  await sql`
    create table room_category_amenities (
      organization_id uuid not null,
      property_id uuid not null,
      room_category_id uuid not null,
      amenity_code text not null references room_amenity_catalog(code) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (room_category_id, amenity_code),
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index room_category_amenities_category_idx
      on room_category_amenities (room_category_id, amenity_code)
  `.execute(db);

  await sql`
    create table room_category_media (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      room_category_id uuid not null,
      storage_provider text not null check (
        storage_provider in ('FIREBASE', 'GCS', 'OTHER')
      ),
      storage_key text not null,
      mime_type text,
      alt_text text,
      caption text,
      sort_order integer not null default 0 check (sort_order >= 0),
      status text not null default 'ACTIVE' check (
        status in ('ACTIVE', 'ARCHIVED')
      ),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (storage_provider, storage_key),
      unique (id, room_category_id, property_id, organization_id),
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index room_category_media_category_idx
      on room_category_media (
        room_category_id,
        status,
        sort_order,
        created_at
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists room_category_media`.execute(db);
  await sql`drop table if exists room_category_amenities`.execute(db);
  await sql`drop table if exists room_amenity_catalog`.execute(db);

  await sql`
    delete from property_amenities
    where amenity_code = any(${sql.val(PROPERTY_AMENITY_CODES)})
  `.execute(db);

  await sql`
    delete from amenity_catalog
    where code = any(${sql.val(PROPERTY_AMENITY_CODES)})
  `.execute(db);
}
