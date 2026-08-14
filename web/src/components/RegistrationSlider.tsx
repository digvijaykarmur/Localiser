import { useRef, useState } from "react";

type Region = {
  id: string;
  bbox: number[];
  status: string;
  confidence?: number;
  source?: string;
};

type Note = { id: string; x?: number; y?: number; body: string };

export function RegistrationSlider({
  beforeUrl,
  afterUrl,
  regions,
  selected,
  onSelect,
  notes,
  onCanvasClick,
}: {
  beforeUrl: string;
  afterUrl: string;
  regions: Region[];
  selected: string | null;
  onSelect: (id: string) => void;
  notes: Note[];
  onCanvasClick?: (x: number, y: number) => void;
}) {
  const [pos, setPos] = useState(0.5);
  const wrap = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [natural, setNatural] = useState({ w: 1, h: 1 });

  const onMove = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={wrap}
      className="relative w-full h-full overflow-auto select-none"
      onPointerMove={(e) => dragging.current && onMove(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onClick={(e) => {
        if (!onCanvasClick || !wrap.current) return;
        const img = wrap.current.querySelector("img");
        if (!img) return;
        const rect = img.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        if (x >= 0 && y >= 0 && x <= 1 && y <= 1) onCanvasClick(x, y);
      }}
    >
      <div className="relative mx-auto max-h-full w-fit">
        <img
          src={beforeUrl}
          alt="original"
          className="max-h-[calc(100vh-110px)] block"
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${pos * 100}%)` }}
        >
          <img src={afterUrl} alt="final" className="max-h-[calc(100vh-110px)] block" />
        </div>

        {/* region overlays */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {regions.map((r) => {
            const [x, y, w, h] = r.bbox;
            const color =
              r.status === "approved"
                ? "#7C8B6F"
                : r.status === "flagged"
                  ? "#C8372A"
                  : r.confidence && r.confidence < 0.7
                    ? "#D97706"
                    : "#2B3A5B";
            const isSel = selected === r.id;
            return (
              <rect
                key={r.id}
                x={`${(x / natural.w) * 100}%`}
                y={`${(y / natural.h) * 100}%`}
                width={`${(w / natural.w) * 100}%`}
                height={`${(h / natural.h) * 100}%`}
                fill="transparent"
                stroke={color}
                strokeWidth={isSel ? 3 : 1.5}
                className="pointer-events-auto cursor-pointer"
                style={{
                  transition: "transform 180ms ease",
                  transform: isSel ? "scale(1.01)" : undefined,
                  transformOrigin: "center",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(r.id);
                }}
              />
            );
          })}
        </svg>

        {notes.map((n, i) =>
          n.x != null && n.y != null ? (
            <div
              key={n.id}
              className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-vermilion text-paper text-[10px] flex items-center justify-center font-mono"
              style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}
              title={n.body}
            >
              {i + 1}
            </div>
          ) : null
        )}

        {/* registration mark handle */}
        <div
          className="absolute top-0 bottom-0 w-0 z-10"
          style={{ left: `${pos * 100}%` }}
        >
          <div className="absolute inset-y-0 -left-px w-0.5 bg-ink/70" />
          <div className="halftone-edge absolute inset-y-0 -left-3 w-6 opacity-40 pointer-events-none" />
          <button
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 border border-ink bg-paper flex items-center justify-center cursor-ew-resize"
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            aria-label="Registration slider"
          >
            {/* crosshair + corner ticks */}
            <svg width="20" height="20" viewBox="0 0 20 20">
              <path d="M10 2 v16 M2 10 h16" stroke="#141210" strokeWidth="1.2" />
              <path d="M3 3 h3 M3 3 v3 M17 3 h-3 M17 3 v3 M3 17 h3 M3 17 v-3 M17 17 h-3 M17 17 v-3" stroke="#141210" strokeWidth="1" fill="none" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
