export interface SceneRow {
  title_id: string;
  scene_id: string;
  start_ms: number;
  end_ms: number;
  frame_url: string | null;
  has_dialogue: boolean;
}

export interface PerformanceRow {
  promo_id: string;
  impressions: number;
  view_3s: number;
  views_complete: number;
  clicks: number;
  published_at?: string;
}

export interface ClickHousePort {
  scenesForTitle(titleId: string): Promise<SceneRow[]>;
  promoPerformance(): Promise<PerformanceRow[]>;
}
