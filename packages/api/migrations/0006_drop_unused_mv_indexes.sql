-- city_name / prefix_len btree indexes on MV are rarely used for equality filters;
-- country_iso_code and network indexes cover the hot browse paths.

DROP INDEX IF EXISTS mv_city_blocks_analytics_city_idx;
DROP INDEX IF EXISTS mv_city_blocks_analytics_prefix_len_idx;
