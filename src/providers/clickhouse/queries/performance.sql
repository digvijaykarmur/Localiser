SELECT
  content_key AS promo_id,
  toInt32(0) AS impressions,
  toFloat64(0) AS view_3s,
  toFloat64(0) AS views_complete,
  toInt32(0) AS clicks,
  toString(last_seen_at) AS published_at
FROM analytics_prod_marts.dim_content_display_current
WHERE last_seen_at >= now() - INTERVAL 30 DAY
LIMIT 50;
