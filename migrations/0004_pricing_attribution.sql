-- Keep exact, mutually exclusive token categories for future model pricing.
-- Existing rollups are intentionally left untouched; their category samples
-- remain unavailable until those historical rows age out.
ALTER TABLE codex_rollup_model_hourly ADD COLUMN pricing_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_rollup_model_hourly ADD COLUMN pricing_cached_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_rollup_model_hourly ADD COLUMN pricing_cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_rollup_model_hourly ADD COLUMN pricing_output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_rollup_model_hourly ADD COLUMN pricing_sample_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codex_rollup_model_hourly ADD COLUMN pricing_category_overlap_tokens INTEGER NOT NULL DEFAULT 0;
