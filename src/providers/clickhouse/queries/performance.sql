SELECT promo_id, impressions, view_3s, views_complete, clicks, published_at
FROM analytics.promo_performance
WHERE published_at >= now() - INTERVAL 30 DAY;
