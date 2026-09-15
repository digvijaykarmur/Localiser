SELECT promo_id, published_at, impressions, view_3s, views_complete, clicks
FROM analytics.promo_performance
WHERE published_at >= now() - INTERVAL {since_days:UInt32} DAY
