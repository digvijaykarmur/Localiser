SELECT
  {id:String} AS title_id,
  concat('sc_', toString(scene_index)) AS scene_id,
  toInt32(round(greatest(scene_start_sec - episode_offset_sec, 0) * 1000)) AS start_ms,
  toInt32(round(greatest(ifNull(scene_end_sec, scene_start_sec + 4) - episode_offset_sec, 0) * 1000)) AS end_ms,
  CAST(NULL, 'Nullable(String)') AS frame_url,
  1 AS has_dialogue
FROM analytics_prod_prep.int_content_seg_scenes
WHERE slug = {id:String}
   OR base_slug = {id:String}
   OR (
        (
          slug = replaceRegexpOne({id:String}, '-s[0-9]+e[0-9]+$', '')
          OR base_slug = replaceRegexpOne({id:String}, '-s[0-9]+e[0-9]+$', '')
        )
        AND toUInt16OrZero(extract({id:String}, '-s([0-9]+)e[0-9]+$')) > 0
        AND season_order = toUInt16OrZero(extract({id:String}, '-s([0-9]+)e[0-9]+$'))
        AND episode_order = toUInt16OrZero(extract({id:String}, '-s[0-9]+e([0-9]+)$'))
      )
ORDER BY scene_start_sec
LIMIT 80;
