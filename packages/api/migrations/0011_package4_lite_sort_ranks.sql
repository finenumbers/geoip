-- Package 4-lite: redundant single-column btree indexes on RU partial MV
-- (composite sort indexes country_name_id / city_name_id cover these paths).

DROP INDEX IF EXISTS mv_city_blocks_ru_country_name_idx;
DROP INDEX IF EXISTS mv_city_blocks_ru_city_name_idx;
