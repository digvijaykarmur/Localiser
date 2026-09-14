export interface ElevenLabsPort {
  tts(args: {
    text: string;
    voiceId: string;
    model: string;
    settings: Record<string, number>;
    outPath: string;
  }): Promise<{ path: string; cost_inr: number }>;
  music(args: { brief: string; durationS: number; outPath: string }): Promise<{
    path: string;
    cost_inr: number;
  }>;
}
