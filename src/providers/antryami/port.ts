export interface AntryamiScene {
  scene_id: string;
  start_ms: number;
  end_ms: number;
  frame_url: string | null;
  has_dialogue: boolean;
  summary?: string;
  label?: string;
  spoiler?: boolean;
  intensity?: number;
  characters?: string[];
  conflict?: string;
  quotable?: string | null;
}

export interface AntryamiShot {
  shot_id: string;
  scene_id: string;
  start_ms: number;
  end_ms: number;
  shot_scale: string;
  action: string;
  camera: string;
  characters: string[];
}

export interface AntryamiAssets {
  video_url: string | null;
  poster_url: string | null;
  runtime_sec: number;
}

export interface AntryamiPort {
  listTitles(args: { dialect?: string; limit?: number; cursor?: string }): Promise<{
    titles: import("@/domain").Title[];
    cursor: string | null;
  }>;
  getTitle(id: string): Promise<import("@/domain").Title>;
  getScenes(id: string): Promise<AntryamiScene[]>;
  getShots?(id: string): Promise<AntryamiShot[]>;
  getAssets?(id: string): Promise<AntryamiAssets>;
}
