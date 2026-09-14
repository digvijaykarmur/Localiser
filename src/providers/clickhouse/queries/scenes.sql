SELECT title_id, scene_id, start_ms, end_ms, frame_url, has_dialogue
FROM screening.scenes
WHERE title_id = {id:String} AND usable = 1
ORDER BY start_ms;
