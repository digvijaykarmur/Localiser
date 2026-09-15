SELECT seq, start_ms, end_ms
FROM screening.scenes
WHERE title_id = {title_id:String}
ORDER BY seq
