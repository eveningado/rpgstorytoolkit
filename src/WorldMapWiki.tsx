import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import type { MapTextLabel } from "./types";
import { pinGlyph, mapTextFontPx, mapTextHalo, MAP_TEXT_DEFAULT_COLOR, MAP_TEXT_FONT } from "./mapLabels";

interface BorderPoint { x: number; y: number }

interface DocPin {
  id: string;
  docId: string;
  x: number;
  y: number;
  border?: BorderPoint[];
  icon?: string;
  color?: string;
}

interface LabelPin {
  id: string;
  collectionId: string;
  entityId: string;
  x: number;
  y: number;
  border?: BorderPoint[];
  icon?: string;
  color?: string;
}

interface WorldMapData {
  imagePath: string | null;
  name: string;
  docPins: DocPin[];
  labelPins: LabelPin[];
  texts?: MapTextLabel[];
}

interface WorldMapWikiProps {
  worldMap: WorldMapData;
  docs: any[];
  cols: any[];
  slug: string;
  goto: (path: string) => void;
}

const WorldMapWiki: React.FC<WorldMapWikiProps> = ({ worldMap, docs, cols, slug, goto }) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [popupPinId, setPopupPinId] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!worldMap.imagePath) return;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from("assets")
          .createSignedUrl(worldMap.imagePath!, 60 * 60);
        if (!error && data?.signedUrl && !cancelled) {
          setImageUrl(data.signedUrl);
          return;
        }
      } catch {
        // fall through to public URL
      }

      try {
        const pub = supabase.storage.from("assets").getPublicUrl(worldMap.imagePath!) as any;
        const url = pub?.data?.publicUrl as string | undefined;
        if (url && !cancelled) setImageUrl(url);
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [worldMap.imagePath]);

  if (!imageUrl) {
    return (
      <div style={{ padding: 20, opacity: 0.6, fontSize: 13 }}>
        {worldMap.imagePath ? "Loading map…" : "No map image available."}
      </div>
    );
  }

  const popupPin = worldMap.docPins.find((p) => p.id === popupPinId);
  const popupDoc = popupPin ? docs.find((d) => d.id === popupPin.docId) : null;

  return (
    <div>
      {worldMap.name && (
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 12, color: "#f5f5f5" }}>
          {worldMap.name}
        </div>
      )}

      <div
        style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}
        onClick={() => setPopupPinId(null)}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt={worldMap.name || "World map"}
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ display: "block", maxWidth: "100%", borderRadius: 10, userSelect: "none" }}
        />

        {/* Text labels (sea names, regions): drawn in image pixels so they scale with the map */}
        {(worldMap.texts?.length ?? 0) > 0 && natural.w > 0 && (
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
            viewBox={`0 0 ${natural.w} ${natural.h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {(worldMap.texts ?? []).map((l) => {
              const fs = mapTextFontPx(l.size, natural.w);
              const color = l.color ?? MAP_TEXT_DEFAULT_COLOR;
              const x = (l.x / 100) * natural.w;
              const y = (l.y / 100) * natural.h;
              const lines = String(l.text ?? "").split("\n");
              const shown = l.caps ? lines.map((s) => s.toUpperCase()) : lines;
              return (
                <text
                  key={l.id}
                  x={x}
                  y={y}
                  transform={l.rotation ? `rotate(${l.rotation} ${x} ${y})` : undefined}
                  textAnchor="middle"
                  fill={color}
                  stroke={mapTextHalo(color)}
                  strokeWidth={Math.max(1, fs * 0.12)}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  fontFamily={MAP_TEXT_FONT}
                  fontSize={fs}
                  fontWeight={700}
                  fontStyle={l.italic ? "italic" : "normal"}
                  letterSpacing={l.caps ? fs * 0.2 : fs * 0.02}
                >
                  {shown.map((line, i) => (
                    <tspan key={i} x={x} dy={i === 0 ? `${0.35 - (shown.length - 1) * 0.55}em` : "1.1em"}>{line}</tspan>
                  ))}
                </text>
              );
            })}
          </svg>
        )}

        {/* Region borders (read-only) */}
        {(() => {
          const regions = [
            ...worldMap.docPins.map((p) => ({ kind: "doc" as const, pin: p as DocPin | LabelPin })),
            ...worldMap.labelPins.map((p) => ({ kind: "label" as const, pin: p as DocPin | LabelPin })),
          ].filter(({ pin }) => pin.border && pin.border.length >= 3);
          if (regions.length === 0) return null;
          return (
            <svg
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {regions.map(({ kind, pin }) => {
                const c = pin.color ?? (kind === "label" ? (cols.find((co: any) => co.id === (pin as LabelPin).collectionId)?.color ?? "#9aa0a6") : "#9aa0a6");
                const pts = (pin.border ?? []).map((p) => `${p.x},${p.y}`).join(" ");
                return (
                  <polygon
                    key={`brd-${pin.id}`}
                    points={pts}
                    fill={c}
                    fillOpacity={0.28}
                    stroke={c}
                    strokeOpacity={0.95}
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          );
        })()}

        {/* Doc pins */}
        {worldMap.docPins.map((pin) => {
          const doc = docs.find((d) => d.id === pin.docId);
          const glyph = pinGlyph(pin.icon);
          return (
            <div
              key={pin.id}
              style={{
                position: "absolute",
                left: `${pin.x}%`,
                top: `${pin.y}%`,
                transform: "translate(-50%, -100%)",
                cursor: "pointer",
                zIndex: popupPinId === pin.id ? 20 : 10,
                userSelect: "none",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setPopupPinId(pin.id === popupPinId ? null : pin.id);
              }}
              title={doc?.title ?? ""}
            >
              <div
                style={{
                  width: glyph ? 26 : 22,
                  height: glyph ? 26 : 22,
                  borderRadius: "50% 50% 50% 0",
                  transform: "rotate(-45deg)",
                  background: pin.color ?? "#4f8cff",
                  border: "2px solid white",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {glyph && (
                  <span style={{ transform: "rotate(45deg)", color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>{glyph}</span>
                )}
              </div>
              {doc && (
                <div
                  style={{
                    position: "absolute",
                    bottom: glyph ? 30 : 26,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#0f0f0f",
                    border: "1px solid #333",
                    borderRadius: 6,
                    padding: "2px 6px",
                    fontSize: 10,
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    color: "#f5f5f5",
                  }}
                >
                  {doc.title || doc.id}
                </div>
              )}
            </div>
          );
        })}

        {/* Label pins */}
        {worldMap.labelPins.map((pin) => {
          const col = cols.find((c) => c.id === pin.collectionId);
          const row = (col?.rows ?? []).find((r: any) => r.id === pin.entityId);
          const label = row
            ? String(
                row?.values?.name ??
                row?.values?.Name ??
                row?.values?.title ??
                row.id
              )
            : pin.entityId;
          const c = pin.color ?? col?.color;
          const glyph = pinGlyph(pin.icon);

          return (
            <div
              key={pin.id}
              style={{
                position: "absolute",
                left: `${pin.x}%`,
                top: `${pin.y}%`,
                transform: "translate(-50%, -50%)",
                zIndex: 10,
                userSelect: "none",
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: c ? `${c}22` : "#1a1a1a",
                border: `1px solid ${c ?? "#444"}`,
                borderRadius: 20,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 700,
                color: c ?? "#f5f5f5",
                boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                backdropFilter: "blur(4px)",
                cursor: col ? "pointer" : "default",
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (col) goto(`/${slug}/collection/${col.id}?entity=${encodeURIComponent(pin.entityId)}`);
              }}
              title={col ? `Go to ${label} in ${col.name}` : label}
            >
              {glyph && <span style={{ lineHeight: 1 }}>{glyph}</span>}
              {label}
            </div>
          );
        })}

        {/* Doc pin popup */}
        {popupPin && popupDoc && (
          <div
            style={{
              position: "absolute",
              left: `${popupPin.x}%`,
              top: `${popupPin.y}%`,
              transform: "translate(-50%, 10px)",
              zIndex: 30,
              background: "#0f0f0f",
              border: "1px solid #333",
              borderRadius: 10,
              padding: 14,
              maxWidth: 300,
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              pointerEvents: "all",
              color: "#f5f5f5",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
              {popupDoc.title || popupDoc.id}
            </div>
            <div
              style={{
                fontSize: 12,
                opacity: 0.85,
                lineHeight: 1.55,
                marginBottom: 10,
                maxHeight: 100,
                overflow: "hidden",
              }}
            >
              {String(popupDoc.content ?? "").replace(/\s+/g, " ").slice(0, 240)}
              {String(popupDoc.content ?? "").length > 240 ? "…" : ""}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  goto(`/${slug}/page/${popupDoc.id}`);
                  setPopupPinId(null);
                }}
                style={{
                  borderRadius: 6,
                  border: "1px solid #4f8cff",
                  background: "rgba(79,140,255,0.15)",
                  color: "#8ab4f8",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "5px 10px",
                }}
              >
                Read more
              </button>
              <button
                type="button"
                onClick={() => setPopupPinId(null)}
                style={{
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "transparent",
                  color: "#aaa",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "5px 10px",
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorldMapWiki;
