import type { Title } from "@/domain";

export interface AntryamiScene {
  scene_id: string;
  start_ms: number;
  end_ms: number;
  frame_url: string | null;
  has_dialogue: boolean;
}

export interface AntryamiPort {
  listTitles(args: { dialect?: string; limit?: number; cursor?: string }): Promise<{
    titles: Title[];
    cursor: string | null;
  }>;
  getTitle(id: string): Promise<Title>;
  getScenes(id: string): Promise<AntryamiScene[]>;
}
