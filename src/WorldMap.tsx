import React, { useEffect, useRef, useState } from "react";
import type { Id, Document, Collection, WorldMapDocPin, WorldMapLabelPin, WorldNameCtx, MapScale, MapTextLabel, MapPinPatch } from "./types";
import { entityLabel } from "./entityLabel";
import { useLang } from "./i18n";
import { MAP_PIN_ICONS, pinGlyph, MAP_TEXT_SIZES, MAP_TEXT_COLORS, MAP_TEXT_DEFAULT_COLOR, MAP_TEXT_FONT, mapTextFontPx, mapTextHalo, isLightColor as isLightText } from "./mapLabels";

const MAP_PIN_COLORS = ["#4f8cff", "#e5484d", "#f5a524", "#30a46c", "#12a594", "#8e4ec6", "#e93d82", "#a18072", "#9aa0a6", "#f1f1f1"];

// Map layer visibility + pins panel are per-device view prefs (not project data).
type MapLayers = { docs: boolean; records: boolean; regions: boolean; names: boolean; texts: boolean };
const LAYERS_KEY = "rpgst_wmap_layers";
const PANEL_KEY = "rpgst_wmap_panel";
const readLayers = (): MapLayers => {
  const d: MapLayers = { docs: true, records: true, regions: true, names: true, texts: true };
  try { return { ...d, ...(JSON.parse(localStorage.getItem(LAYERS_KEY) || "{}") as Partial<MapLayers>) }; } catch { return d; }
};

// 1-2-5 "nice" number at or below n, for the scale bar.
const niceFloor = (n: number) => {
  if (!(n > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
};
const fmtNum = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));

interface WorldMapProps {
  imageUrl: string | null;
  worldName: string;
  worldNameCollectionId?: Id;
  worldNameEntityId?: Id;
  worldMapIncludeInWiki: boolean;
  docPins: WorldMapDocPin[];
  labelPins: WorldMapLabelPin[];
  documents: Document[];
  collections: Collection[];
  onClose: () => void;
  onUploadImage: (file: File, nameCtx?: WorldNameCtx) => Promise<void>;
  onPickImagePath: (path: string) => void;
  onRemoveImage: () => Promise<void>;
  onSetWorldName: (name: string, collectionId?: Id, entityId?: Id) => void;
  onSetIncludeInWiki: (include: boolean) => void;
  onAddDocPin: (docId: Id, x: number, y: number) => void;
  onMoveDocPin: (pinId: Id, x: number, y: number) => void;
  onRemoveDocPin: (pinId: Id) => void;
  onAddLabelPin: (collectionId: Id, entityId: Id, x: number, y: number) => void;
  onMoveLabelPin: (pinId: Id, x: number, y: number) => void;
  onRemoveLabelPin: (pinId: Id) => void;
  onSetDocPinBorder: (pinId: Id, border: { x: number; y: number }[] | null) => void;
  onSetLabelPinBorder: (pinId: Id, border: { x: number; y: number }[] | null) => void;
  onOpenDoc: (id: Id) => void;
  onOpenRecord?: (collectionId: Id, entityId: Id) => void;
  onSave: () => void;
  // Marker look per pin (icon + colour). Optional so older callers keep working.
  onSetPinStyle?: (pinKind: "doc" | "label", pinId: Id, style: MapPinPatch) => void;
  // Measure tool scale for the open map (full image width = distance units).
  scale?: MapScale | null;
  onSetScale?: (scale: MapScale | null) => void;
  // Free text labels on the open map (sea names, regions, notes). Optional: no button without onAddText.
  texts?: MapTextLabel[];
  onAddText?: (label: MapTextLabel) => void;
  onUpdateText?: (label: MapTextLabel) => void; // replaces the label with the same id
  onRemoveText?: (id: Id) => void;
  showWikiOption?: boolean; // hide the "Include in wiki" toggle on desktop
  embedded?: boolean; // when true, fill the parent container instead of a full-screen overlay

  // Multi-map management (File menu)
  savedMaps: { id: string; name: string; hasImage: boolean; collectionId?: string; entityId?: string }[];
  activeMapId?: string;
  onMakeNewMap: () => void;
  onLoadMap: (id: string) => void;
  onSelectRecord: (collectionId: Id, entityId: Id, name: string) => void;
  onClearDocPins: () => void;
  onClearLabelPins: () => void;
  saveMessage?: string | null;
}

type AddMode = "none" | "addDoc" | "addLabel" | "addText";

// Id used for a text label that is being written but not placed yet.
const NEW_TEXT_ID = "__new_text__";
// Drop default values so saved labels stay small (defaults: size m, white, upright, roman).
const cleanTextLabel = (l: MapTextLabel): MapTextLabel => {
  const out: MapTextLabel = { id: l.id, text: l.text.replace(/^\s+|\s+$/g, ""), x: l.x, y: l.y };
  if (l.size && l.size !== "m") out.size = l.size;
  if (l.color && l.color.toLowerCase() !== MAP_TEXT_DEFAULT_COLOR) out.color = l.color;
  if (l.rotation && Number.isFinite(l.rotation)) out.rotation = Math.max(-90, Math.min(90, Math.round(l.rotation)));
  if (l.italic) out.italic = true;
  if (l.caps) out.caps = true;
  if (l.secret) out.secret = true;
  return out;
};

const WorldMap: React.FC<WorldMapProps> = ({
  imageUrl,
  worldName,
  worldNameCollectionId,
  worldNameEntityId,
  worldMapIncludeInWiki,
  docPins,
  labelPins,
  documents,
  collections,
  onClose,
  onUploadImage,
  onPickImagePath,
  onSetWorldName,
  onSetIncludeInWiki,
  onAddDocPin,
  onMoveDocPin,
  onRemoveDocPin,
  onAddLabelPin,
  onMoveLabelPin,
  onRemoveLabelPin,
  onSetDocPinBorder,
  onSetLabelPinBorder,
  onOpenDoc,
  onOpenRecord,
  onSave,
  onSetPinStyle,
  scale = null,
  onSetScale,
  texts = [],
  onAddText,
  onUpdateText,
  onRemoveText,
  showWikiOption = true,
  embedded = false,
  savedMaps,
  activeMapId,
  onMakeNewMap,
  onLoadMap,
  onSelectRecord,
  onClearDocPins,
  onClearLabelPins,
  saveMessage,
}) => {
  const { t } = useLang();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const didDrag = useRef(false);
  // Timestamp of the last pin drag end. Used to ignore the click that browsers fire
  // right after a drag (which previously could place a stray pin or get permanently
  // "stuck" because didDrag was never reset).
  const dragEndedAt = useRef(0);
  // Synchronous "ready to place" flag. `addMode` is React state (async), so two clicks in
  // quick succession can both read the stale "addDoc"/"addLabel" value and place twice.
  // This ref is set false the instant a pin is placed, blocking the duplicate immediately.
  const armedRef = useRef(false);

  const [addMode, setAddMode] = useState<AddMode>("none");
  const [pendingDocId, setPendingDocId] = useState<string>("");
  const [pendingLabelCollectionId, setPendingLabelCollectionId] = useState<string>("");
  const [pendingLabelEntityId, setPendingLabelEntityId] = useState<string>("");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(worldName);
  const [nameSourceMode, setNameSourceMode] = useState<"text" | "entity">(
    worldNameCollectionId ? "entity" : "text"
  );
  const [nameCollectionId, setNameCollectionId] = useState(worldNameCollectionId ?? "");
  const [nameEntityId, setNameEntityId] = useState(worldNameEntityId ?? "");

  const [popupPinId, setPopupPinId] = useState<string | null>(null);
  // Private note editor inside a pin's popup (only one at a time).
  const [noteEdit, setNoteEdit] = useState<{ pinId: string; draft: string } | null>(null);
  useEffect(() => {
    if (noteEdit && noteEdit.pinId !== popupPinId) setNoteEdit(null);
  }, [popupPinId, noteEdit]);
  const [draggingPin, setDraggingPin] = useState<{ id: string; kind: "doc" | "label" } | null>(null);

  // ── Pan / zoom canvas ───────────────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Map a percentage map-point to a pixel position within the viewport. Pins + borders
  // render in a non-transformed overlay using this, so they stay crisp at any zoom.
  const toScreen = (xPct: number, yPct: number) => ({
    left: pan.x + (xPct / 100) * imgNatural.w * zoom,
    top: pan.y + (yPct / 100) * imgNatural.h * zoom,
  });
  const panningRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const ZOOM_MIN = 0.15;
  const ZOOM_MAX = 8;

  // Center + fit the map so even a small image fills a good portion of the view
  // (scales up to a minimum, down to fit a large one), leaving a margin.
  const fitToView = () => {
    const vp = viewportRef.current;
    const img = imgRef.current;
    if (!vp || !img) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (vw <= 0 || vh <= 0 || iw <= 0 || ih <= 0) return; // not laid out / not loaded yet
    const pad = 0.92; // leave a small margin
    // Fit large images down; scale small images up to at least fill ~70% of the view.
    const fit = Math.min((vw / iw) * pad, (vh / ih) * pad);
    const minFill = Math.min((vw * 0.7) / iw, (vh * 0.7) / ih);
    const z = Math.max(Math.min(fit, ZOOM_MAX), Math.min(minFill, ZOOM_MAX), ZOOM_MIN);
    setZoom(z);
    setPan({ x: (vw - iw * z) / 2, y: (vh - ih * z) / 2 });
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    setZoom((z) => {
      const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor));
      const k = nz / z;
      setPan((p) => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
      return nz;
    });
  };

  const onCanvasWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  // Pan when dragging empty map area (not on a pin, not while placing a pin).
  const startPan = (e: React.MouseEvent) => {
    if (addMode !== "none" || drawing) return;
    if (e.button !== 0) return;
    panningRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    panMovedRef.current = false;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setIsPanning(true);
    const onMove = (ev: MouseEvent) => {
      const s = panningRef.current;
      if (!s) return;
      if (Math.abs(ev.clientX - s.startX) + Math.abs(ev.clientY - s.startY) > 4) panMovedRef.current = true;
      setPan({ x: s.panX + (ev.clientX - s.startX), y: s.panY + (ev.clientY - s.startY) });
    };
    const onUp = () => {
      panningRef.current = null;
      setIsPanning(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Pin region drawing (polygonal lasso) ────────────────────────────────────
  const [pinCtxMenu, setPinCtxMenu] = useState<{ kind: "doc" | "label"; pinId: string; x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState<{ kind: "doc" | "label"; pinId: string } | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null);
  const [highlightPinId, setHighlightPinId] = useState<string | null>(null);

  const pctFromEvent = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const pinColor = (kind: "doc" | "label", pin: WorldMapDocPin | WorldMapLabelPin): string => {
    if (pin.color) return pin.color;
    if (kind === "label") {
      const lp = pin as WorldMapLabelPin;
      return collections.find((c) => c.id === lp.collectionId)?.color ?? "#9aa0a6";
    }
    return "#9aa0a6"; // doc pins → neutral grey
  };

  // ── Layers, pins panel, pin styling, measuring, sub-maps ────────────────────
  const [layers, setLayersState] = useState<MapLayers>(readLayers);
  const setLayer = (k: keyof MapLayers, v: boolean) => {
    setLayersState((cur) => {
      const next = { ...cur, [k]: v };
      try { localStorage.setItem(LAYERS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };
  const [panelOpen, setPanelOpenState] = useState<boolean>(() => {
    try { return localStorage.getItem(PANEL_KEY) === "1"; } catch { return false; }
  });
  const setPanelOpen = (v: boolean) => {
    setPanelOpenState(v);
    try { localStorage.setItem(PANEL_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  };
  const [pinSearch, setPinSearch] = useState("");
  const [styleEditor, setStyleEditor] = useState<{ kind: "doc" | "label"; pinId: string; x: number; y: number } | null>(null);

  // Player view: a clean presenting mode for GMs (no editing tools, no notes, secret
  // pins and text hidden). Session-only, so the map always reopens in the editor.
  const [playerView, setPlayerView] = useState(false);

  const [measuring, setMeasuring] = useState(false);
  const [measurePts, setMeasurePts] = useState<{ x: number; y: number }[]>([]);
  const [scaleForm, setScaleForm] = useState<{ distance: string; unit: string } | null>(null);
  const panMovedRef = useRef(false);

  // Maps opened by drilling into a pin ("Open map"), so "Back" returns to the parent.
  const [mapStack, setMapStack] = useState<string[]>([]);

  // Text label being written or edited (draft shown live on the map until Done / Cancel).
  const [textEditor, setTextEditor] = useState<{ id: string; draft: MapTextLabel } | null>(null);
  const openTextEditor = (label: MapTextLabel) => {
    setPopupPinId(null);
    setTextEditor({ id: label.id, draft: { ...label } });
  };
  const patchTextDraft = (patch: Partial<MapTextLabel>) =>
    setTextEditor((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur));
  const commitTextEditor = () => {
    if (!textEditor) return;
    const d = cleanTextLabel(textEditor.draft);
    if (d.text) {
      if (textEditor.id === NEW_TEXT_ID) onAddText?.({ ...d, id: `wmtxt_${Date.now()}` });
      else onUpdateText?.(d);
      onSave();
    }
    setTextEditor(null);
  };
  const deleteTextLabel = (id: string) => {
    setTextEditor(null);
    onRemoveText?.(id as Id);
    onSave();
  };

  // Length of a measured polyline as a fraction of the map image's width (aspect-correct).
  const lineWidthFraction = (pts: { x: number; y: number }[]) => {
    const w = imgNatural.w || 1;
    const h = imgNatural.h || 1;
    let px = 0;
    for (let i = 1; i < pts.length; i++) {
      px += Math.hypot(((pts[i].x - pts[i - 1].x) / 100) * w, ((pts[i].y - pts[i - 1].y) / 100) * h);
    }
    return px / w;
  };
  const describeLength = (fraction: number) =>
    scale && scale.distance > 0
      ? `${fmtNum(fraction * scale.distance)} ${scale.unit}`
      : `${fmtNum(fraction * 100)}% ${t("wmap.ofMapWidth", "of map width")}`;

  const stopMeasuring = () => { setMeasuring(false); setMeasurePts([]); setScaleForm(null); };

  useEffect(() => {
    if (!measuring) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); stopMeasuring(); }
      else if (e.key === "Backspace" && !(e.target instanceof HTMLInputElement)) { setMeasurePts((p) => p.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measuring]);

  // Smoothly move the view (used to fly to a pin from the pins panel).
  const animRef = useRef<number | null>(null);
  const animateView = (tz: number, tp: { x: number; y: number }) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const z0 = zoom;
    const p0 = pan;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 300);
      const e = 1 - Math.pow(1 - k, 3);
      setZoom(z0 + (tz - z0) * e);
      setPan({ x: p0.x + (tp.x - p0.x) * e, y: p0.y + (tp.y - p0.y) * e });
      animRef.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    animRef.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  const flyToPin = (pin: { id: string; x: number; y: number }) => {
    const vp = viewportRef.current;
    if (!vp || !imgNatural.w) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const fit = Math.min(vw / imgNatural.w, vh / imgNatural.h) * 0.92;
    const tz = Math.min(ZOOM_MAX, Math.max(zoom, fit * 2.2));
    // Centre in the part of the map not covered by the pins panel.
    const cx = panelOpen ? (Math.min(262, vw) + vw) / 2 : vw / 2;
    animateView(tz, {
      x: cx - (pin.x / 100) * imgNatural.w * tz,
      y: vh / 2 - (pin.y / 100) * imgNatural.h * tz,
    });
    setHighlightPinId(pin.id);
    setPopupPinId(pin.id);
  };

  // A saved map whose world record is this record (lets a pin open its own sub-map).
  const mapForRecord = (collectionId: string, entityId: string) =>
    savedMaps.find((m) => m.id !== activeMapId && m.hasImage && m.collectionId === collectionId && m.entityId === entityId);
  const openSubMap = (id: string) => {
    if (activeMapId) setMapStack((s) => [...s, activeMapId]);
    setPopupPinId(null);
    stopMeasuring();
    onLoadMap(id);
  };
  const goBackMap = () => {
    const prev = mapStack[mapStack.length - 1];
    if (!prev) return;
    setMapStack((s) => s.slice(0, -1));
    stopMeasuring();
    onLoadMap(prev);
  };

  const startDrawBorder = (kind: "doc" | "label", pinId: string) => {
    stopMeasuring();
    setPinCtxMenu(null);
    setAddMode("none");
    setPopupPinId(null);
    setDrawPoints([]);
    setCursorPt(null);
    setDrawing({ kind, pinId });
  };

  const completeBorder = () => {
    if (!drawing) return;
    const pts = drawPoints;
    if (pts.length >= 3) {
      if (drawing.kind === "doc") onSetDocPinBorder(drawing.pinId as Id, pts);
      else onSetLabelPinBorder(drawing.pinId as Id, pts);
      onSave();
    }
    setDrawing(null);
    setDrawPoints([]);
    setCursorPt(null);
  };

  const cancelDrawing = () => {
    setDrawing(null);
    setDrawPoints([]);
    setCursorPt(null);
  };

  const deleteBorder = (kind: "doc" | "label", pinId: string) => {
    if (kind === "doc") onSetDocPinBorder(pinId as Id, null);
    else onSetLabelPinBorder(pinId as Id, null);
    onSave();
  };

  // Esc cancels an in-progress drawing; Enter completes it.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); cancelDrawing(); }
      else if (e.key === "Enter") { e.preventDefault(); completeBorder(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, drawPoints]);

  const [uploading, setUploading] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);

  // In-component confirm dialog (window.confirm is a no-op inside the Tauri webview).
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; confirmLabel: string; danger?: boolean; onYes: () => void } | null>(null);
  const askConfirm = (message: string, onYes: () => void, opts?: { confirmLabel?: string; danger?: boolean }) =>
    setConfirmDialog({ message, onYes, confirmLabel: opts?.confirmLabel ?? "Confirm", danger: opts?.danger });

  // Current name selection, packaged so an upload can be filed against the right record.
  const currentNameCtx = (): WorldNameCtx =>
    nameSourceMode === "entity" && nameCollectionId && nameEntityId
      ? { mode: "entity", collectionId: nameCollectionId as Id, entityId: nameEntityId as Id }
      : { mode: "text", name: nameDraft.trim() };

  // Image attachments on a single record — the source for "choose from this record's images".
  const recordImageAssets = (colId?: string, entId?: string) => {
    const col = collections.find((c) => c.id === colId);
    const row = col?.rows.find((r) => r.id === entId);
    if (!col || !row) return [] as { path: string; name: string; sub: string }[];
    return (row.assets ?? [])
      .filter((a) => (a.mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(a.name))
      .map((a) => ({ path: a.path, name: a.name, sub: `${col.name} › ${entityLabel(row) || row.id}` }));
  };

  // The list currently shown by the floating asset picker (map view).
  const [pickerAssets, setPickerAssets] = useState<{ path: string; name: string; sub: string }[]>([]);
  const openAssetPicker = (list: { path: string; name: string; sub: string }[]) => {
    setPickerAssets(list);
    setShowAssetPicker(true);
  };

  // Fit the map when its image changes (covers cached images where onLoad is immediate
  // and the case where the viewport lays out after the image is ready).
  useEffect(() => {
    if (!imageUrl) return;
    const id = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Two-step setup wizard: 1 = create/select the world record, 2 = set its map image.
  const [setupStep, setSetupStep] = useState<1 | 2>(1);
  useEffect(() => {
    if (!imageUrl) setSetupStep(1);
  }, [imageUrl]);

  // Tracks when the map image fails to load (e.g. the underlying asset was deleted
  // from the record). We keep the world's reference but show a "replace it" prompt.
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => { setImageBroken(false); }, [imageUrl]);

  const startDragPin = (
    e: React.MouseEvent,
    pinId: string,
    kind: "doc" | "label"
  ) => {
    if (drawing) return; // don't move pins while drawing a border
    e.preventDefault();
    e.stopPropagation();
    didDrag.current = false;
    setDraggingPin({ id: pinId, kind });
    setPopupPinId(null);

    // Grabbing an existing pin means the user wants to move it, not place a new one.
    // Exit placement mode so a stray map click during/after the drag can't add a pin.
    armedRef.current = false;
    if (addMode !== "none") {
      setAddMode("none");
      setPendingDocId("");
      setPendingLabelCollectionId("");
      setPendingLabelEntityId("");
    }

    // Capture rect once at drag start — re-renders during drag shift the image
    // position slightly, so calling getBoundingClientRect() on every move causes jitter.
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      didDrag.current = true;
      if (kind === "doc") onMoveDocPin(pinId as Id, x, y);
      else onMoveLabelPin(pinId as Id, x, y);
    };

    const onUp = () => {
      setDraggingPin(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (didDrag.current) {
        onSave();
        dragEndedAt.current = Date.now();
      }
      // Always reset so the next map click can place a pin.
      didDrag.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag a text label to move it (moves the draft instead while its editor is open).
  const startDragText = (e: React.MouseEvent, label: MapTextLabel) => {
    if (drawing || measuring || addMode !== "none") return;
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const editingThis = textEditor?.id === label.id;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      if (editingThis) patchTextDraft({ x, y });
      else onUpdateText?.({ ...label, x, y });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) {
        dragEndedAt.current = Date.now();
        if (!editingThis) onSave();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag an existing border: "move" shifts the whole shape; "vertex" reshapes one point.
  const startBorderDrag = (
    e: React.MouseEvent,
    kind: "doc" | "label",
    pinId: string,
    mode: "move" | "vertex",
    vertexIndex?: number
  ) => {
    if (drawing || addMode !== "none") return;
    if ((e as React.MouseEvent).button === 2) return;
    e.preventDefault();
    e.stopPropagation();
    const pin = (kind === "doc" ? docPins : labelPins).find((p) => p.id === pinId) as
      | WorldMapDocPin
      | WorldMapLabelPin
      | undefined;
    if (!pin?.border || pin.border.length < 3) return;
    const startBorder = pin.border.map((p) => ({ ...p }));
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const at = (cx: number, cy: number) => ({
      x: ((cx - rect.left) / rect.width) * 100,
      y: ((cy - rect.top) / rect.height) * 100,
    });
    const start = at(e.clientX, e.clientY);
    setHighlightPinId(pinId);
    const setBorder = kind === "doc" ? onSetDocPinBorder : onSetLabelPinBorder;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const cur = at(ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      moved = true;
      const next =
        mode === "move"
          ? startBorder.map((p) => ({ x: clamp(p.x + dx), y: clamp(p.y + dy) }))
          : startBorder.map((p, i) => (i === vertexIndex ? { x: clamp(p.x + dx), y: clamp(p.y + dy) } : p));
      setBorder(pinId as Id, next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) { onSave(); dragEndedAt.current = Date.now(); }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    // Clicking the map while writing a label finishes it (a pan-drag doesn't).
    if (textEditor) {
      if (panMovedRef.current) { panMovedRef.current = false; return; }
      commitTextEditor();
      return;
    }
    if (measuring) {
      if (panMovedRef.current) { panMovedRef.current = false; return; }
      const pt = pctFromEvent(e.clientX, e.clientY);
      if (pt) { setMeasurePts((p) => [...p, pt]); setScaleForm(null); }
      return;
    }
    // Drawing a border: each click adds a vertex; clicking near the first point
    // (a "full circle") closes the shape.
    if (drawing) {
      const pt = pctFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      if (drawPoints.length >= 3) {
        const first = drawPoints[0];
        if (Math.hypot(pt.x - first.x, pt.y - first.y) < 3) { completeBorder(); return; }
      }
      setDrawPoints((p) => [...p, pt]);
      return;
    }
    if (addMode === "none") return;
    // Text: open the label editor at the clicked spot; nothing is saved until Done.
    if (addMode === "addText") {
      if (!armedRef.current) return;
      const pt = pctFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      armedRef.current = false;
      setAddMode("none");
      setTextEditor({ id: NEW_TEXT_ID, draft: { id: NEW_TEXT_ID, text: "", x: pt.x, y: pt.y } });
      return;
    }
    // Never place while a pin drag is in progress or just finished.
    if (draggingPin) return;
    if (Date.now() - dragEndedAt.current < 250) return;
    // Synchronous guard — blocks a duplicate placement before React re-renders.
    if (!armedRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (addMode === "addDoc" && pendingDocId) {
      armedRef.current = false;
      onAddDocPin(pendingDocId as Id, x, y);
      onSave();
      setAddMode("none");
      setPendingDocId("");
    } else if (addMode === "addLabel" && pendingLabelCollectionId && pendingLabelEntityId) {
      armedRef.current = false;
      onAddLabelPin(pendingLabelCollectionId as Id, pendingLabelEntityId as Id, x, y);
      onSave();
      setAddMode("none");
      setPendingLabelCollectionId("");
      setPendingLabelEntityId("");
    }
  };

  const toggleMeasure = () => {
    if (measuring) { stopMeasuring(); return; }
    setAddMode("none");
    armedRef.current = false;
    setPopupPinId(null);
    setTextEditor(null);
    setMeasuring(true);
  };
  const toggleTextMode = () => {
    const next: AddMode = addMode === "addText" ? "none" : "addText";
    stopMeasuring();
    setPopupPinId(null);
    setTextEditor(null);
    setAddMode(next);
    armedRef.current = next !== "none";
  };

  // Switch to player view: drop every in-progress tool so nothing editable shows.
  const enterPlayerView = () => {
    stopMeasuring();
    setAddMode("none");
    armedRef.current = false;
    setTextEditor(null);
    setPopupPinId(null);
    setNoteEdit(null);
    setPinCtxMenu(null);
    setStyleEditor(null);
    setFileMenuOpen(false);
    setEditingName(false);
    setDrawing(null);
    setDrawPoints([]);
    setCursorPt(null);
    setPlayerView(true);
  };

  // Keyboard shortcuts: F fit, M measure, P pins panel, T add text, V player view,
  // Esc leaves placing mode (or player view).
  // Embedded (dual view on web) they only apply after the map itself was clicked, so typing
  // shortcuts never fire while someone works in the editor beside it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapActiveRef = useRef(!embedded);
  useEffect(() => {
    if (!embedded) return;
    const onDown = (e: MouseEvent) => {
      mapActiveRef.current = !!(rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target));
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [embedded]);
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutRef.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable)) return;
    if (!mapActiveRef.current || !imageUrl || imageBroken || drawing || textEditor || confirmDialog) return;
    const k = e.key.toLowerCase();
    if (playerView) {
      if (k === "f") fitToView();
      else if (k === "v" || e.key === "Escape") setPlayerView(false);
      else return;
      e.preventDefault();
      return;
    }
    if (k === "f") fitToView();
    else if (k === "v") enterPlayerView();
    else if (k === "m") toggleMeasure();
    else if (k === "p") setPanelOpen(!panelOpen);
    else if (k === "t" && onAddText) toggleTextMode();
    else if (e.key === "Escape" && addMode !== "none") { setAddMode("none"); armedRef.current = false; }
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commitName = () => {
    setEditingName(false);
    if (nameSourceMode === "entity" && nameCollectionId && nameEntityId) {
      const col = collections.find((c) => c.id === nameCollectionId);
      const row = col?.rows.find((r) => r.id === nameEntityId);
      const entityName = row ? entityLabel(row) : "";
      onSetWorldName(entityName, nameCollectionId as Id, nameEntityId as Id);
    } else {
      onSetWorldName(nameDraft.trim());
    }
    onSave();
  };

  const overlayStyle: React.CSSProperties = {
    position: embedded ? "absolute" : "fixed",
    inset: 0,
    zIndex: embedded ? 1 : 85,
    background: "var(--bg)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const toolbarStyle: React.CSSProperties = {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-2)",
    background: "var(--bg-panel)",
    flexWrap: "wrap",
  };

  const btnBase: React.CSSProperties = {
    borderRadius: 6,
    border: "1px solid var(--border-3)",
    backgroundColor: "transparent",
    color: "var(--text-2)",
    cursor: "pointer",
    fontSize: 12,
    padding: "5px 10px",
  };

  const btnActive: React.CSSProperties = {
    ...btnBase,
    border: "1px solid var(--accent)",
    backgroundColor: "var(--accent-bg)",
    color: "var(--text)",
  };

  const inputStyle: React.CSSProperties = {
    borderRadius: 6,
    border: "1px solid var(--border-2)",
    backgroundColor: "var(--bg-surface)",
    color: "var(--text)",
    padding: "5px 8px",
    fontSize: 12,
  };

  const menuDivider: React.CSSProperties = { height: 1, background: "var(--border)", margin: "4px 0" };

  // File menu — matches the top-bar File menu: bordered items + right-flyout submenus.
  const fileItem: React.CSSProperties = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--border-3)",
    backgroundColor: "transparent",
    color: "var(--text-2)",
    cursor: "pointer",
    padding: "8px 10px",
    fontSize: 13,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };
  const flyoutPanel: React.CSSProperties = {
    position: "absolute",
    left: "100%",
    top: -10,
    marginLeft: 4,
    minWidth: 220,
    backgroundColor: "var(--bg-elevated)",
    border: "1px solid var(--border-2)",
    borderRadius: 10,
    padding: 10,
    zIndex: 112,
    boxShadow: "0 10px 25px var(--overlay-3, rgba(0,0,0,0.45))",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const renderFileMenu = (inMap: boolean) => {
    const loadable = savedMaps.filter((m) => m.hasImage);
    const closeMenu = () => { setFileMenuOpen(false); setLoadOpen(false); setReplaceOpen(false); };
    const recAssets = recordImageAssets(worldNameCollectionId, worldNameEntityId);
    return (
      <div style={{ position: "relative" }}>
        <button type="button" style={fileMenuOpen ? btnActive : btnBase} onClick={() => setFileMenuOpen((o) => !o)}>{t("menu.file")} ▾</button>
        {fileMenuOpen && (
          <>
            <div onClick={closeMenu} style={{ position: "fixed", inset: 0, zIndex: 110 }} />
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 6,
                zIndex: 111,
                minWidth: 230,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-2)",
                borderRadius: 10,
                padding: 10,
                boxShadow: "0 10px 25px var(--overlay-3, rgba(0,0,0,0.45))",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {inMap && (
                <>
                  <button
                    type="button"
                    style={fileItem}
                    onMouseEnter={() => { setLoadOpen(false); setReplaceOpen(false); }}
                    onClick={() => { closeMenu(); onSave(); }}
                  >
                    <span>{t("file.saveNow")}</span>
                  </button>
                  <div style={menuDivider} />
                  <button
                    type="button"
                    style={fileItem}
                    onMouseEnter={() => { setLoadOpen(false); setReplaceOpen(false); }}
                    onClick={() => {
                      closeMenu();
                      askConfirm(
                        "This map is saved — you can reopen it any time from File ▸ Load map. Start a new map?",
                        () => onMakeNewMap(),
                        { confirmLabel: t("wmap.makeNewMap") }
                      );
                    }}
                  >
                    <span>{t("wmap.makeNewMap")}</span>
                  </button>
                </>
              )}

              {/* Load map ▸ */}
              <div style={{ position: "relative" }} onMouseLeave={() => setLoadOpen(false)}>
                <button
                  type="button"
                  style={fileItem}
                  onMouseEnter={() => { setLoadOpen(loadable.length > 0); setReplaceOpen(false); }}
                  onClick={() => loadable.length > 0 && setLoadOpen((o) => !o)}
                >
                  <span style={{ opacity: loadable.length > 0 ? 1 : 0.5 }}>{t("wmap.loadMap")}</span>
                  <span style={{ opacity: 0.9 }}>▸</span>
                </button>
                {loadOpen && (
                  <div style={flyoutPanel} onMouseEnter={() => setLoadOpen(true)}>
                    {loadable.length === 0 ? (
                      <div style={{ ...fileItem, border: "none", cursor: "default", opacity: 0.5 }}>{t("wmap.noSavedMaps")}</div>
                    ) : (
                      loadable.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          style={{ ...fileItem, opacity: m.id === activeMapId ? 0.6 : 1 }}
                          onClick={() => { closeMenu(); if (m.id !== activeMapId) onLoadMap(m.id); }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.name || "(unnamed)"}
                          </span>
                          {m.id === activeMapId && <span>✓</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {inMap && (
                <>
                  <div style={menuDivider} />

                  {/* Replace image ▸ */}
                  <div style={{ position: "relative" }} onMouseLeave={() => setReplaceOpen(false)}>
                    <button
                      type="button"
                      style={fileItem}
                      onMouseEnter={() => { setReplaceOpen(true); setLoadOpen(false); }}
                      onClick={() => setReplaceOpen((o) => !o)}
                    >
                      <span>{uploading ? t("common.uploading") : t("wmap.replaceImage")}</span>
                      <span style={{ opacity: 0.9 }}>▸</span>
                    </button>
                    {replaceOpen && (
                      <div style={flyoutPanel} onMouseEnter={() => setReplaceOpen(true)}>
                        <label style={{ ...fileItem, cursor: uploading ? "default" : "pointer" }}>
                          <span>{t("wmap.uploadNewImage")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            disabled={uploading}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.currentTarget.value = "";
                              if (!f) return;
                              closeMenu();
                              askConfirm(
                                "Replace the current map image with this upload? The previous image stays attached to the record as an asset.",
                                async () => { setUploading(true); await onUploadImage(f); setUploading(false); },
                                { confirmLabel: "Replace" }
                              );
                            }}
                          />
                        </label>
                        {recAssets.length > 0 && (
                          <button
                            type="button"
                            style={fileItem}
                            onClick={() => { closeMenu(); openAssetPicker(recAssets); }}
                          >
                            <span>{t("wmap.chooseFromAssets")}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={menuDivider} />

                  <button
                    type="button"
                    style={fileItem}
                    onMouseEnter={() => { setLoadOpen(false); setReplaceOpen(false); }}
                    onClick={() => {
                      closeMenu();
                      askConfirm("Clear all document pins from this map?", () => onClearDocPins(), { confirmLabel: "Clear", danger: true });
                    }}
                  >
                    <span>{t("wmap.clearDocPins")}</span>
                  </button>
                  <button
                    type="button"
                    style={fileItem}
                    onMouseEnter={() => { setLoadOpen(false); setReplaceOpen(false); }}
                    onClick={() => {
                      closeMenu();
                      askConfirm("Clear all record pins from this map?", () => onClearLabelPins(), { confirmLabel: "Clear", danger: true });
                    }}
                  >
                    <span>{t("wmap.clearRecordPins")}</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  // Setup phase: a standalone "Load map" button (no File menu needed there).
  const renderLoadMapButton = () => {
    const loadable = savedMaps.filter((m) => m.hasImage);
    const empty = loadable.length === 0;
    return (
      <div style={{ position: "relative" }}>
        <button
          type="button"
          style={{ ...(loadOpen ? btnActive : btnBase), opacity: empty ? 0.5 : 1, cursor: empty ? "default" : "pointer" }}
          title={empty ? t("wmap.noSavedMaps") : t("wmap.loadMap")}
          onClick={() => !empty && setLoadOpen((o) => !o)}
        >
          Load map ▾
        </button>
        {loadOpen && !empty && (
          <>
            <div onClick={() => setLoadOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 110 }} />
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                zIndex: 111,
                minWidth: 200,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-2)",
                borderRadius: 10,
                padding: 10,
                boxShadow: "0 10px 25px var(--overlay-3, rgba(0,0,0,0.45))",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {loadable.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  style={{ ...fileItem, opacity: m.id === activeMapId ? 0.6 : 1 }}
                  onClick={() => { setLoadOpen(false); if (m.id !== activeMapId) onLoadMap(m.id); }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.name || "(unnamed)"}
                  </span>
                  {m.id === activeMapId && <span>✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  // Confirm dialog (used in both views; works inside the Tauri webview).
  const confirmModal = confirmDialog ? (
    <div
      onClick={() => setConfirmDialog(null)}
      style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}
      >
        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, marginBottom: 16 }}>{confirmDialog.message}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={btnBase} onClick={() => setConfirmDialog(null)}>{t("common.cancel")}</button>
          <button
            type="button"
            style={confirmDialog.danger
              ? { ...btnBase, border: "1px solid var(--danger-border-2)", color: "var(--danger-text)" }
              : btnActive}
            onClick={() => { const fn = confirmDialog.onYes; setConfirmDialog(null); fn(); }}
          >
            {confirmDialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // Shared "Choose an image asset" picker (rendered in both setup and map views).
  const pickerModal = showAssetPicker ? (
    <div
      onClick={() => setShowAssetPicker(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-2)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 460,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--text)" }}>{t("wmap.chooseImageAsset")}</div>
          <button type="button" onClick={() => setShowAssetPicker(false)} style={btnBase}>{t("common.close")}</button>
        </div>
        <div style={{ overflow: "auto", padding: 8 }}>
          {pickerAssets.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, opacity: 0.7 }}>
              No image assets on this record yet. Upload one instead.
            </div>
          ) : (
            pickerAssets.map((a) => (
              <button
                key={a.path}
                type="button"
                onClick={() => {
                  onPickImagePath(a.path);
                  setShowAssetPicker(false);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  width: "100%",
                  textAlign: "left",
                  border: "1px solid transparent",
                  borderRadius: 8,
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  padding: "8px 10px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {a.name}
                </span>
                <span style={{ fontSize: 11, opacity: 0.6 }}>{a.sub}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  ) : null;

  // ---- Setup wizard (no image yet) ----
  if (!imageUrl) {
    const selectedRow = collections.find((c) => c.id === nameCollectionId)?.rows.find((r) => r.id === nameEntityId) ?? null;
    const existingEntityName = selectedRow ? entityLabel(selectedRow) : "";
    const step1Valid =
      nameSourceMode === "entity" ? !!(nameCollectionId && nameEntityId) : !!nameDraft.trim();
    const step2Assets = nameSourceMode === "entity" ? recordImageAssets(nameCollectionId, nameEntityId) : [];
    const worldLabel = nameSourceMode === "entity" ? existingEntityName : nameDraft.trim() || "your world";

    const uploadDropzone = (
      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          border: "2px dashed var(--border-2)",
          borderRadius: 10,
          padding: "20px 16px",
          cursor: uploading ? "default" : "pointer",
          color: "var(--text-dim)",
          fontSize: 13,
          background: "var(--bg-surface)",
        }}
      >
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            await onUploadImage(file, currentNameCtx());
            setUploading(false);
          }}
        />
        {uploading ? t("common.uploading") : t("wmap.clickToUpload")}
      </label>
    );

    return (
      <div style={overlayStyle}>
        {confirmModal}
        <div style={toolbarStyle}>
          <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{t("term.worldMap")}</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>Step {setupStep} of 2</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {renderLoadMapButton()}
            <button type="button" onClick={onClose} style={btnBase}>{t("common.close")}</button>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-2)",
              borderRadius: 14,
              padding: 28,
              maxWidth: 480,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {setupStep === 1 ? (
              <>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{t("wmap.createWorld")}</div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => setNameSourceMode("text")} style={nameSourceMode === "text" ? btnActive : btnBase}>
                    Create new
                  </button>
                  <button type="button" onClick={() => setNameSourceMode("entity")} style={nameSourceMode === "entity" ? btnActive : btnBase}>
                    Use existing record
                  </button>
                </div>

                {nameSourceMode === "text" ? (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", marginBottom: 6 }}>{t("wmap.worldName")}</div>
                    <input
                      autoFocus
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      placeholder={t("wmap.worldNamePh")}
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && step1Valid) setSetupStep(2); }}
                    />
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                      Creates a record (in a <b>Map</b> table) named after your world. The map image attaches to it.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", marginBottom: 6 }}>{t("wmap.pickRecord")}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select
                        className="themed-select"
                        style={{ ...inputStyle, flex: 1 }}
                        value={nameCollectionId}
                        onChange={(e) => { setNameCollectionId(e.target.value); setNameEntityId(""); }}
                      >
                        <option value="">{t("cond.phTable")}</option>
                        {collections.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                      </select>
                      <select
                        className="themed-select"
                        style={{ ...inputStyle, flex: 1 }}
                        value={nameEntityId}
                        onChange={(e) => setNameEntityId(e.target.value)}
                        disabled={!nameCollectionId}
                      >
                        <option value="">{t("cond.phRecord")}</option>
                        {(collections.find((c) => c.id === nameCollectionId)?.rows ?? []).map((r) => (
                          <option key={r.id} value={r.id}>{entityLabel(r)}</option>
                        ))}
                      </select>
                    </div>
                    {existingEntityName && (
                      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
                        World name will be: <b>{existingEntityName}</b>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    disabled={!step1Valid}
                    onClick={() => {
                      if (nameSourceMode === "entity" && nameCollectionId && nameEntityId) {
                        onSelectRecord(nameCollectionId as Id, nameEntityId as Id, existingEntityName);
                      }
                      setSetupStep(2);
                    }}
                    style={{ ...(step1Valid ? btnActive : btnBase), opacity: step1Valid ? 1 : 0.5, cursor: step1Valid ? "pointer" : "default" }}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{t("wmap.setMapImage")}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: -8 }}>
                  for <b>{worldLabel}</b>
                </div>

                {step2Assets.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", marginBottom: 6 }}>
                      Choose from this record's images
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflow: "auto" }}>
                      {step2Assets.map((a) => (
                        <button
                          key={a.path}
                          type="button"
                          onClick={() => onPickImagePath(a.path)}
                          style={{
                            textAlign: "left",
                            border: "1px solid var(--border-2)",
                            borderRadius: 8,
                            background: "var(--bg-surface)",
                            color: "var(--text)",
                            cursor: "pointer",
                            padding: "8px 10px",
                            fontSize: 13,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 4px" }}>
                      <div style={{ flex: 1, height: 1, background: "var(--border-2)" }} />
                      <span style={{ fontSize: 11, opacity: 0.6 }}>or upload a new image</span>
                      <div style={{ flex: 1, height: 1, background: "var(--border-2)" }} />
                    </div>
                  </div>
                )}

                {uploadDropzone}
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: -8 }}>{t("wmap.imageFormats")}</div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <button type="button" onClick={() => setSetupStep(1)} style={btnBase}>{t("common.back")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Map view ----
  const selectedCollection = collections.find((c) => c.id === nameCollectionId);
  const selectedEntity = selectedCollection?.rows.find((r) => r.id === nameEntityId);
  const entityDisplayName = selectedEntity
    ? entityLabel(selectedEntity)
    : "";

  // Note block for a pin popup: shows the note, or a small editor while editing.
  const saveNote = (kind: "doc" | "label", pinId: string, text: string) => {
    if (!onSetPinStyle) return;
    onSetPinStyle(kind, pinId as Id, { note: text.trim() ? text.trim() : null });
    onSave();
    setNoteEdit(null);
  };
  const renderPinNote = (kind: "doc" | "label", pin: { id: string; note?: string }) => {
    if (noteEdit && noteEdit.pinId === pin.id && onSetPinStyle) {
      const ed = noteEdit;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10, textAlign: "start" }}>
          <textarea
            autoFocus
            rows={4}
            maxLength={2000}
            value={ed.draft}
            placeholder={t("wmap.notePh", "Travel notes, secrets, reminders...")}
            onChange={(e) => setNoteEdit({ pinId: ed.pinId, draft: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { e.preventDefault(); setNoteEdit(null); }
              else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(kind, ed.pinId, ed.draft); }
            }}
            style={{ ...inputStyle, width: 260, maxWidth: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 70, fontSize: 12, lineHeight: 1.5, fontFamily: "inherit" }}
          />
          <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.4 }}>{t("wmap.notePrivate", "Only you see this. Notes aren't shown on the public wiki.")}</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" style={{ ...btnBase, fontSize: 11 }} onClick={() => setNoteEdit(null)}>{t("common.cancel")}</button>
            <button type="button" style={{ ...btnActive, fontSize: 11 }} onClick={() => saveNote(kind, ed.pinId, ed.draft)}>{t("common.save")}</button>
          </div>
        </div>
      );
    }
    if (!pin.note) return null;
    return (
      <div
        onClick={onSetPinStyle ? () => setNoteEdit({ pinId: pin.id, draft: pin.note ?? "" }) : undefined}
        title={onSetPinStyle ? t("wmap.editNote", "Edit note") : undefined}
        style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text)", textAlign: "start", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 140, overflowY: "auto", background: "var(--bg-hover)", borderLeft: "3px solid var(--accent)", borderRadius: 6, padding: "6px 8px", marginBottom: 10, cursor: onSetPinStyle ? "text" : "default" }}
      >
        {pin.note}
      </div>
    );
  };
  const noteButton = (pin: { id: string; note?: string }) =>
    onSetPinStyle && !(noteEdit && noteEdit.pinId === pin.id) ? (
      <button type="button" onClick={() => setNoteEdit({ pinId: pin.id, draft: pin.note ?? "" })} style={{ ...btnBase, fontSize: 11 }}>
        ✎ {pin.note ? t("wmap.editNote", "Edit note") : t("wmap.addNote", "Add note")}
      </button>
    ) : null;

  const popupPin = docPins.find((p) => p.id === popupPinId);
  const popupDoc = popupPin ? documents.find((d) => d.id === popupPin.docId) : null;
  // Record (label) pin popup: same "read more" card, showing the record's description.
  const popupLabelPin = labelPins.find((p) => p.id === popupPinId);
  const popupLabelCol = popupLabelPin ? collections.find((c) => c.id === popupLabelPin.collectionId) : null;
  const popupLabelRow = popupLabelCol?.rows.find((r) => r.id === popupLabelPin?.entityId) ?? null;

  return (
    <div ref={rootRef} style={overlayStyle}>
      {pickerModal}
      {confirmModal}
      {/* Toolbar (hidden in player view) */}
      {!playerView && <div style={toolbarStyle}>
        {/* File menu (left, next to the name) */}
        {renderFileMenu(true)}

        <div style={{ width: 1, height: 20, background: "var(--border-2)", margin: "0 4px" }} />

        {/* Add doc pin */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              const next = addMode === "addDoc" ? "none" : "addDoc";
              stopMeasuring();
              setAddMode(next);
              armedRef.current = next !== "none";
            }}
            style={addMode === "addDoc" ? btnActive : btnBase}
          >
            {t("wmap.addDocPin")}
          </button>
          {addMode === "addDoc" && (
            <select
              className="themed-select"
              style={{ ...inputStyle, maxWidth: 180 }}
              value={pendingDocId}
              onChange={(e) => setPendingDocId(e.target.value)}
            >
              <option value="">{t("wmap.selectDocument")}</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>{d.title || d.id}</option>
              ))}
            </select>
          )}
          {addMode === "addDoc" && pendingDocId && (
            <span style={{ fontSize: 11, color: "var(--accent-text)", opacity: 0.8 }}>
              {t("wmap.clickToPlace")}
            </span>
          )}
        </div>

        {/* Add record pin */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              const next = addMode === "addLabel" ? "none" : "addLabel";
              stopMeasuring();
              setAddMode(next);
              armedRef.current = next !== "none";
            }}
            style={addMode === "addLabel" ? btnActive : btnBase}
          >
            {t("wmap.addRecordPin")}
          </button>
          {addMode === "addLabel" && (
            <>
              <select
                className="themed-select"
                style={{ ...inputStyle, maxWidth: 140 }}
                value={pendingLabelCollectionId}
                onChange={(e) => { setPendingLabelCollectionId(e.target.value); setPendingLabelEntityId(""); }}
              >
                <option value="">{t("cond.phTable")}</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {pendingLabelCollectionId && (
                <select
                  className="themed-select"
                  style={{ ...inputStyle, maxWidth: 160 }}
                  value={pendingLabelEntityId}
                  onChange={(e) => setPendingLabelEntityId(e.target.value)}
                >
                  <option value="">{t("cond.phRecord")}</option>
                  {(collections.find((c) => c.id === pendingLabelCollectionId)?.rows ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {entityLabel(r)}
                    </option>
                  ))}
                </select>
              )}
              {pendingLabelCollectionId && pendingLabelEntityId && (
                <span style={{ fontSize: 11, color: "var(--accent-text)", opacity: 0.8 }}>
                  {t("wmap.clickToPlace")}
                </span>
              )}
            </>
          )}
        </div>

        {/* Pins panel + measure tool */}
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          style={panelOpen ? btnActive : btnBase}
          title={`${t("wmap.pinsTitle", "List, search and filter the pins on this map")} (P)`}
        >
          ☰ {t("wmap.pins", "Pins")} ({docPins.length + labelPins.length})
        </button>
        <button
          type="button"
          onClick={toggleMeasure}
          style={measuring ? btnActive : btnBase}
          title={`${t("wmap.measureHint", "Click points on the map to measure a route. Backspace removes the last point, Esc stops.")} (M)`}
        >
          ⟷ {t("wmap.measure", "Measure")}
        </button>
        {onAddText && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={toggleTextMode}
              style={addMode === "addText" ? btnActive : btnBase}
              title={`${t("wmap.addTextTitle", "Write a name or note on the map, like a sea, a region or a road")} (T)`}
            >
              <span style={{ fontFamily: MAP_TEXT_FONT, fontWeight: 700 }}>T</span> {t("wmap.addText", "Text")}
            </button>
            {addMode === "addText" && (
              <span style={{ fontSize: 11, color: "var(--accent-text)", opacity: 0.8 }}>
                {t("wmap.clickToPlaceText", "Click the map where the text goes")}
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={enterPlayerView}
          style={btnBase}
          title={`${t("wmap.playerViewTitle", "Show the map to your players: no tools, no notes, secret pins and text hidden")} (V)`}
        >
          ◉ {t("wmap.playerView", "Player view")}
        </button>

        <div style={{ width: 1, height: 20, background: "var(--border-2)", margin: "0 4px" }} />

        {mapStack.length > 0 && (
          <button type="button" onClick={goBackMap} style={btnBase} title={t("wmap.backTo", "Back to")}>
            ◂ {savedMaps.find((m) => m.id === mapStack[mapStack.length - 1])?.name || t("wmap.backTo", "Back to")}
          </button>
        )}

        {/* World name — click to edit in a small popover */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              if (editingName) { setEditingName(false); return; }
              setNameDraft(worldName);
              setNameSourceMode(worldNameCollectionId ? "entity" : "text");
              setNameCollectionId(worldNameCollectionId ?? "");
              setNameEntityId(worldNameEntityId ?? "");
              setEditingName(true);
            }}
            style={{
              border: "1px solid transparent",
              borderRadius: 6,
              background: "transparent",
              color: "var(--text)",
              fontWeight: 700,
              cursor: "pointer",
              padding: "4px 8px",
              fontSize: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.border = "1px solid var(--border-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.border = "1px solid transparent")}
            title={t("wmap.editWorldName")}
          >
            {worldName || entityDisplayName || "Unnamed World"}
            <span style={{ opacity: 0.5, fontSize: 12 }}>✎</span>
          </button>

          {editingName && (
            <>
              <div onClick={() => setEditingName(false)} style={{ position: "fixed", inset: 0, zIndex: 110 }} />
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 6,
                  zIndex: 111,
                  width: 250,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 10,
                  padding: 12,
                  boxShadow: "0 10px 25px var(--overlay-3, rgba(0,0,0,0.45))",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)" }}>{t("wmap.worldName")}</div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => setNameSourceMode("text")} style={{ ...(nameSourceMode === "text" ? btnActive : btnBase), flex: 1 }}>
                    Type a name
                  </button>
                  <button type="button" onClick={() => setNameSourceMode("entity")} style={{ ...(nameSourceMode === "entity" ? btnActive : btnBase), flex: 1 }}>
                    From record
                  </button>
                </div>

                {nameSourceMode === "text" ? (
                  <input
                    autoFocus
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                    placeholder={t("wmap.worldNameInputPh")}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditingName(false); }}
                  />
                ) : (
                  <>
                    <select
                      className="themed-select"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      value={nameCollectionId}
                      onChange={(e) => { setNameCollectionId(e.target.value); setNameEntityId(""); }}
                    >
                      <option value="">{t("cond.phTable")}</option>
                      {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select
                      className="themed-select"
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      value={nameEntityId}
                      onChange={(e) => setNameEntityId(e.target.value)}
                      disabled={!nameCollectionId}
                    >
                      <option value="">{t("cond.phRecord")}</option>
                      {(collections.find((c) => c.id === nameCollectionId)?.rows ?? []).map((r) => (
                        <option key={r.id} value={r.id}>{entityLabel(r)}</option>
                      ))}
                    </select>
                  </>
                )}

                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
                  <button type="button" onClick={() => setEditingName(false)} style={btnBase}>{t("common.cancel")}</button>
                  <button type="button" onClick={commitName} style={btnActive}>{t("common.save")}</button>
                </div>
              </div>
            </>
          )}
        </div>

        {saveMessage && <span style={{ fontSize: 12, opacity: 0.8 }}>{saveMessage}</span>}

        {showWikiOption && (
          <>
            <div style={{ width: 1, height: 20, background: "var(--border-2)", margin: "0 4px" }} />

            {/* Wiki toggle */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={worldMapIncludeInWiki}
                onChange={(e) => { onSetIncludeInWiki(e.target.checked); onSave(); }}
              />
              {t("wmap.includeInWiki")}
            </label>
          </>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={onClose} style={btnBase}>{t("common.close")}</button>
        </div>
      </div>}

      {/* Map canvas (pan + zoom) */}
      <div
        ref={viewportRef}
        style={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          cursor: (addMode !== "none" || drawing || measuring) ? "crosshair" : isPanning ? "grabbing" : "grab",
          touchAction: "none",
          // FigJam-style dot grid that pans + scales with the canvas, for orientation.
          backgroundColor: "var(--bg)",
          backgroundImage: "radial-gradient(circle, var(--canvas-dot, rgba(255,255,255,0.08)) 1px, transparent 1.5px)",
          backgroundSize: `${Math.min(60, Math.max(16, 22 * zoom))}px ${Math.min(60, Math.max(16, 22 * zoom))}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        onClick={() => { setPopupPinId(null); }}
        onMouseDown={startPan}
        onMouseMove={(e) => { if (drawing) { const p = pctFromEvent(e.clientX, e.clientY); if (p) setCursorPt(p); } }}
        onWheel={onCanvasWheel}
      >
        {/* Zoom controls */}
        {!imageBroken && (
          <div style={{ position: "absolute", right: 14, bottom: 14, zIndex: 60, display: "flex", flexDirection: "column", gap: 6 }} onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" title={t("wmap.zoomIn")} onClick={() => { const vp = viewportRef.current; if (vp) zoomAt(vp.getBoundingClientRect().left + vp.clientWidth / 2, vp.getBoundingClientRect().top + vp.clientHeight / 2, 1.25); }}
              style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--bg-elevated)", color: "var(--text)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>+</button>
            <button type="button" title={t("wmap.zoomOut")} onClick={() => { const vp = viewportRef.current; if (vp) zoomAt(vp.getBoundingClientRect().left + vp.clientWidth / 2, vp.getBoundingClientRect().top + vp.clientHeight / 2, 1 / 1.25); }}
              style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--bg-elevated)", color: "var(--text)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>−</button>
            <button type="button" title={`${t("wmap.fitToView")} (F)`} onClick={fitToView}
              style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--bg-elevated)", color: "var(--text)", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>⤢</button>
          </div>
        )}
        {/* Player view bar: what the players see is everything else on screen */}
        {playerView && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 12, insetInlineEnd: 12, zIndex: 60, display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 999, padding: "4px 4px 4px 12px", boxShadow: "0 6px 18px rgba(0,0,0,0.35)", cursor: "default", maxWidth: "calc(100% - 24px)", flexWrap: "wrap" }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>◉ {t("wmap.playerView", "Player view")}</span>
            {mapStack.length > 0 && (
              <button type="button" onClick={goBackMap} style={{ ...btnBase, borderRadius: 999, fontSize: 11 }}>
                ◂ {savedMaps.find((m) => m.id === mapStack[mapStack.length - 1])?.name || t("wmap.backTo", "Back to")}
              </button>
            )}
            {typeof document !== "undefined" && document.fullscreenEnabled && (
              <button
                type="button"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
                  else void rootRef.current?.requestFullscreen().catch(() => {});
                }}
                style={{ ...btnBase, borderRadius: 999, fontSize: 11 }}
              >
                ⛶ {t("wmap.fullScreen", "Full screen")}
              </button>
            )}
            <button
              type="button"
              onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); setPlayerView(false); }}
              style={{ ...btnActive, borderRadius: 999, fontSize: 11 }}
              title={`${t("wmap.exitPlayerView", "Back to editing")} (Esc)`}
            >
              {t("wmap.exitPlayerView", "Back to editing")}
            </button>
          </div>
        )}

        {/* Pins panel: search, layer toggles, click a pin to fly to it */}
        {panelOpen && !playerView && !imageBroken && (() => {
          const q = pinSearch.trim().toLowerCase();
          type Row = { kind: "doc" | "label" | "text"; pin: { id: string; x: number; y: number; secret?: boolean }; name: string; group: string; color: string; glyph: string; region: boolean; hidden: boolean; note?: string };
          const all: Row[] = [
            ...docPins.map((p): Row => {
              const d = documents.find((x) => x.id === p.docId);
              return { kind: "doc", pin: p, name: d?.title || p.docId, group: t("wmap.layerDocs", "Documents"), color: p.color ?? "var(--accent)", glyph: pinGlyph(p.icon), region: !!p.border && p.border.length >= 3, hidden: !layers.docs, note: p.note };
            }),
            ...labelPins.map((p): Row => {
              const col = collections.find((c) => c.id === p.collectionId);
              const row = col?.rows.find((r) => r.id === p.entityId);
              return { kind: "label", pin: p, name: row ? entityLabel(row) || row.id : p.entityId, group: col?.name ?? "?", color: p.color ?? col?.color ?? "var(--accent)", glyph: pinGlyph(p.icon), region: !!p.border && p.border.length >= 3, hidden: !layers.records, note: p.note };
            }),
            ...(onAddText ? texts : []).map((p): Row => {
              const c = p.color ?? MAP_TEXT_DEFAULT_COLOR;
              return { kind: "text", pin: p, name: p.text.replace(/\s+/g, " "), group: t("wmap.layerTexts", "Text"), color: isLightText(c) ? "#555" : c, glyph: "T", region: false, hidden: !layers.texts };
            }),
          ];
          const rows = all.filter((r) => !q || r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q));
          const groups = new Map<string, Row[]>();
          for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
          const toggle = (k: keyof MapLayers, label: string) => (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayer(k, e.target.checked)} />
              {label}
            </label>
          );
          return (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              style={{ position: "absolute", left: 12, top: 12, bottom: 12, width: 250, maxWidth: "calc(100% - 24px)", zIndex: 55, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 10, boxShadow: "0 10px 25px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", overflow: "hidden", cursor: "default" }}
            >
              <div style={{ padding: 10, borderBottom: "1px solid var(--border-2)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t("wmap.pins", "Pins")}</span>
                  <button type="button" onClick={() => setPanelOpen(false)} style={{ border: "none", background: "transparent", color: "var(--text-2)", cursor: "pointer", fontSize: 13 }} title={t("common.close")}>✕</button>
                </div>
                <input
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                  placeholder={t("wmap.pinsSearch", "Search pins…")}
                  value={pinSearch}
                  onChange={(e) => setPinSearch(e.target.value)}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {toggle("docs", t("wmap.layerDocs", "Documents"))}
                  {toggle("records", t("wmap.layerRecords", "Records"))}
                  {toggle("regions", t("wmap.layerRegions", "Regions"))}
                  {toggle("names", t("wmap.layerNames", "Names"))}
                  {onAddText && toggle("texts", t("wmap.layerTexts", "Text"))}
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
                {all.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 8, lineHeight: 1.5 }}>{t("wmap.noPins", "No pins on this map yet. Use Add document pin or Add record pin.")}</div>}
                {all.length > 0 && rows.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 8 }}>{t("wmap.noPinsMatch", "No pins match.")}</div>}
                {[...groups.entries()].map(([group, list]) => (
                  <div key={group} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-dim)", padding: "6px 6px 4px" }}>{group} · {list.length}</div>
                    {list.map((r) => (
                      <button
                        key={r.pin.id}
                        type="button"
                        onClick={() => {
                          if (r.hidden) setLayer(r.kind === "doc" ? "docs" : r.kind === "text" ? "texts" : "records", true);
                          stopMeasuring();
                          flyToPin(r.pin);
                        }}
                        onMouseEnter={() => setHighlightPinId(r.pin.id)}
                        onMouseLeave={() => setHighlightPinId((cur) => (cur === r.pin.id ? null : cur))}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", border: "none", borderRadius: 6, background: highlightPinId === r.pin.id ? "var(--bg-hover)" : "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left", opacity: r.hidden ? 0.45 : 1 }}
                      >
                        <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 9, background: r.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, lineHeight: 1 }}>
                          {r.kind === "text" ? <span style={{ fontFamily: MAP_TEXT_FONT, fontWeight: 700 }}>T</span> : r.glyph}
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                          {r.note && <span style={{ fontSize: 10.5, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note.replace(/\s+/g, " ")}</span>}
                        </span>
                        {(r.region || r.pin.secret) && (
                          <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                            {r.pin.secret && <span style={{ fontSize: 9.5, color: "var(--text-dim)", border: "1px dashed var(--border-3)", borderRadius: 4, padding: "0 4px", whiteSpace: "nowrap" }} title={t("wmap.secretTitle", "Hidden in player view and on the public wiki")}>{t("wmap.secretShort", "Secret")}</span>}
                            {r.region && <span style={{ fontSize: 10, color: "var(--text-dim)" }} title={t("wmap.layerRegions", "Regions")}>▱</span>}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Measure readout */}
        {measuring && !playerView && !imageBroken && (() => {
          const frac = lineWidthFraction(measurePts);
          const fieldStyle: React.CSSProperties = { ...inputStyle, width: 80 };
          return (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 56, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 10, padding: "8px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: 8, maxWidth: "calc(100% - 24px)", cursor: "default" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {measurePts.length < 2 ? (
                  <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("wmap.measureHint", "Click points on the map to measure a route. Backspace removes the last point, Esc stops.")}</span>
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{describeLength(frac)}</span>
                )}
                {measurePts.length >= 2 && onSetScale && !scaleForm && (
                  <button type="button" style={{ ...btnBase, fontSize: 11 }} onClick={() => setScaleForm({ distance: "", unit: scale?.unit ?? "" })}>
                    {t("wmap.setScale", "Set scale from this line")}
                  </button>
                )}
                {measurePts.length > 0 && (
                  <button type="button" style={{ ...btnBase, fontSize: 11 }} onClick={() => { setMeasurePts([]); setScaleForm(null); }}>{t("wmap.clearLine", "Clear line")}</button>
                )}
                <button type="button" style={{ ...btnActive, fontSize: 11 }} onClick={stopMeasuring}>{t("common.finish")}</button>
              </div>
              {scaleForm && onSetScale && (
                <form
                  style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const d = parseFloat(scaleForm.distance);
                    if (!(d > 0) || !(frac > 0)) return;
                    onSetScale({ distance: d / frac, unit: scaleForm.unit.trim() || t("wmap.unitPh", "miles") });
                    onSave();
                    setScaleForm(null);
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("wmap.scaleThisLine", "This line is")}</span>
                  <input autoFocus type="number" min="0" step="any" style={fieldStyle} value={scaleForm.distance} onChange={(e) => setScaleForm({ ...scaleForm, distance: e.target.value })} />
                  <input style={fieldStyle} placeholder={t("wmap.unitPh", "miles")} value={scaleForm.unit} onChange={(e) => setScaleForm({ ...scaleForm, unit: e.target.value })} />
                  <button type="submit" style={{ ...btnActive, fontSize: 11 }}>{t("common.save")}</button>
                  <button type="button" style={{ ...btnBase, fontSize: 11 }} onClick={() => setScaleForm(null)}>{t("common.cancel")}</button>
                </form>
              )}
              {scale && onSetScale && !scaleForm && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-dim)" }}>
                  <span>{t("wmap.scaleIs", "Map width")} = {fmtNum(scale.distance)} {scale.unit}</span>
                  <button type="button" style={{ border: "none", background: "transparent", color: "var(--text-2)", cursor: "pointer", fontSize: 11, textDecoration: "underline", padding: 0 }} onClick={() => { onSetScale(null); onSave(); }}>
                    {t("wmap.clearScale", "Remove scale")}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Text label editor (new or existing label); the label previews live on the map */}
        {textEditor && !playerView && !imageBroken && (() => {
          const d = textEditor.draft;
          const isNew = textEditor.id === NEW_TEXT_ID;
          const vp = viewportRef.current;
          const vw = vp?.clientWidth ?? 800;
          const vh = vp?.clientHeight ?? 600;
          const at = toScreen(d.x, d.y);
          const W = 330;
          const fs = mapTextFontPx(d.size, imgNatural.w) * zoom;
          const left = Math.max(8, Math.min(vw - W - 8, at.left - W / 2));
          // Below the label when there is room, otherwise above it.
          const below = at.top + fs / 2 + 14;
          const top = below + 320 < vh ? below : Math.max(8, at.top - fs / 2 - 14 - 320);
          const curColor = (d.color ?? MAP_TEXT_DEFAULT_COLOR).toLowerCase();
          const chip = (active: boolean): React.CSSProperties => ({ ...(active ? btnActive : btnBase), padding: "4px 8px", minWidth: 30 });
          const sizeLabel: Record<string, string> = { s: "S", m: "M", l: "L", xl: "XL" };
          return (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTextEditor(null); }
              }}
              role="dialog"
              aria-label={t("wmap.textEditor", "Map text")}
              style={{ position: "absolute", left, top, width: W, zIndex: 70, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 10, padding: 12, boxShadow: "0 10px 28px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", gap: 10, cursor: "default" }}
            >
              <textarea
                autoFocus
                rows={2}
                value={d.text}
                placeholder={t("wmap.textInputPh", "e.g. The Sunken Sea")}
                onChange={(e) => patchTextDraft({ text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitTextEditor(); }
                }}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: MAP_TEXT_FONT, fontSize: 14 }}
              />
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: -6 }}>{t("wmap.textEnterHint", "Enter to finish · Shift+Enter for a new line")}</div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--text-2)", width: 52 }}>{t("wmap.textSize", "Size")}</span>
                {MAP_TEXT_SIZES.map((sz) => (
                  <button key={sz} type="button" style={chip((d.size ?? "m") === sz)} onClick={() => patchTextDraft({ size: sz })}>{sizeLabel[sz]}</button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--text-2)", width: 52 }}>{t("wmap.textStyle", "Style")}</span>
                <button type="button" style={{ ...chip(!!d.italic), fontStyle: "italic", fontFamily: MAP_TEXT_FONT }} onClick={() => patchTextDraft({ italic: !d.italic })} title={t("wmap.textItalic", "Italic")} aria-pressed={!!d.italic}>I</button>
                <button type="button" style={{ ...chip(!!d.caps), letterSpacing: "0.12em", fontFamily: MAP_TEXT_FONT }} onClick={() => patchTextDraft({ caps: !d.caps })} title={t("wmap.textCaps", "Spaced capitals")} aria-pressed={!!d.caps}>AA</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--text-2)", width: 52 }}>{t("wmap.pinColor", "Colour")}</span>
                {MAP_TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => patchTextDraft({ color: c })}
                    style={{ width: 20, height: 20, borderRadius: 10, background: c, border: curColor === c ? "2px solid var(--accent, #4f8cff)" : "1px solid var(--border-3)", boxShadow: curColor === c ? "0 0 0 2px var(--bg-elevated) inset" : "none", cursor: "pointer", padding: 0 }}
                  />
                ))}
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(curColor) ? curColor : "#ffffff"}
                  onChange={(e) => patchTextDraft({ color: e.target.value })}
                  title={t("wmap.customColor", "Custom colour")}
                  style={{ width: 24, height: 22, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-2)", width: 52 }}>{t("wmap.textAngle", "Angle")}</span>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={1}
                  value={d.rotation ?? 0}
                  onChange={(e) => patchTextDraft({ rotation: Number(e.target.value) })}
                  style={{ flex: 1 }}
                  aria-label={t("wmap.textAngle", "Angle")}
                />
                <button type="button" style={{ ...btnBase, padding: "2px 6px", fontSize: 11, minWidth: 40 }} onClick={() => patchTextDraft({ rotation: 0 })} title={t("wmap.resetStyle", "Reset")}>
                  {Math.round(d.rotation ?? 0)}°
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!d.secret} onChange={(e) => patchTextDraft({ secret: e.target.checked })} />
                {t("wmap.hideFromPlayers", "Hide from players")}
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                {!isNew && (
                  <button type="button" style={{ ...btnBase, color: "var(--danger, #e5484d)", borderColor: "var(--danger, #e5484d)" }} onClick={() => deleteTextLabel(textEditor.id)}>
                    {t("common.delete", "Delete")}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" style={btnBase} onClick={() => setTextEditor(null)}>{t("common.cancel", "Cancel")}</button>
                <button type="button" style={{ ...btnActive, opacity: d.text.trim() ? 1 : 0.5 }} disabled={!d.text.trim()} onClick={commitTextEditor}>
                  {isNew ? t("wmap.placeText", "Place text") : t("common.done", "Done")}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Scale bar (once the map has a scale) */}
        {scale && scale.distance > 0 && imgNatural.w > 0 && !imageBroken && (() => {
          const unitsPerPx = scale.distance / (imgNatural.w * zoom);
          const nice = niceFloor(120 * unitsPerPx);
          if (!(nice > 0)) return null;
          const barPx = nice / unitsPerPx;
          return (
            <div style={{ position: "absolute", left: panelOpen && !playerView ? 274 : 14, bottom: 14, zIndex: 50, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>{fmtNum(nice)} {scale.unit}</span>
              <div style={{ width: barPx, height: 6, border: "2px solid #fff", borderTop: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.8)" }} />
            </div>
          );
        })()}

        {imageBroken && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: "var(--bg-panel)",
              zIndex: 50,
            }}
          >
            <div
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-2)",
                borderRadius: 14,
                padding: 28,
                maxWidth: 420,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>
                {t("wmap.imageMissing")}
              </div>
              <div style={{ fontSize: 13, opacity: 0.8, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {t("wmap.imageMissingDesc")}
              </div>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  ...btnActive,
                  cursor: uploading ? "default" : "pointer",
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  disabled={uploading}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (!f) return;
                    setUploading(true);
                    await onUploadImage(f, currentNameCtx());
                    setUploading(false);
                  }}
                />
                {uploading ? t("common.uploading") : t("wmap.uploadNewImage")}
              </label>
              {(() => {
                const assets = recordImageAssets(worldNameCollectionId, worldNameEntityId);
                if (assets.length === 0) return null;
                return (
                  <button
                    type="button"
                    style={btnBase}
                    onClick={() => openAssetPicker(assets)}
                  >
                    {t("wmap.chooseFromRecord")}
                  </button>
                );
              })()}
            </div>
          </div>
        )}
        {/* This wrapper must tightly hug the image — pins use percentage coordinates
            relative to this element, and those percentages are calculated from the
            image's bounding rect. If this div is larger than the image the two
            coordinate systems diverge and pins land in the wrong place. */}
        <div style={{ position: "absolute", left: 0, top: 0, display: "inline-block", transformOrigin: "0 0", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt={t("term.worldMap")}
            draggable={false}
            onError={() => setImageBroken(true)}
            onLoad={(e) => { setImageBroken(false); const im = e.currentTarget; setImgNatural({ w: im.naturalWidth, h: im.naturalHeight }); fitToView(); }}
            onClick={handleImageClick}
            onDoubleClick={(e) => { if (drawing) { e.preventDefault(); completeBorder(); } }}
            style={{
              display: "block",
              userSelect: "none",
              cursor: (addMode !== "none" || drawing || measuring) ? "crosshair" : "default",
            }}
          />
        </div>

        {/* Pins + borders overlay — NOT transformed, positioned in screen pixels via
            toScreen() so they stay crisp at any zoom and dots render as true circles. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {/* Region borders + in-progress lasso */}
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
            {[
              ...docPins.map((p) => ({ kind: "doc" as const, pin: p as WorldMapDocPin | WorldMapLabelPin })),
              ...labelPins.map((p) => ({ kind: "label" as const, pin: p as WorldMapDocPin | WorldMapLabelPin })),
            ].map(({ kind, pin }) => {
              if (!pin.border || pin.border.length < 3) return null;
              if (!layers.regions || (kind === "doc" ? !layers.docs : !layers.records)) return null;
              if (playerView && pin.secret) return null;
              const c = pinColor(kind, pin);
              const active = highlightPinId === pin.id;
              const pts = pin.border.map((p) => { const s = toScreen(p.x, p.y); return `${s.left},${s.top}`; }).join(" ");
              return (
                <g key={`brd-${pin.id}`}>
                  <polygon
                    points={pts}
                    fill={c}
                    fillOpacity={active ? 0.5 : 0.28}
                    stroke={c}
                    strokeOpacity={active ? 1 : 0.95}
                    strokeWidth={active ? 4 : 3}
                    strokeLinejoin="round"
                    strokeDasharray={pin.secret ? "10 6" : undefined}
                    style={{ pointerEvents: (drawing || addMode !== "none" || measuring || playerView) ? "none" : "auto", cursor: "move", transition: "fill-opacity 120ms" }}
                    onMouseDown={(e) => startBorderDrag(e, kind, pin.id, "move")}
                    onMouseEnter={() => setHighlightPinId(pin.id)}
                    onMouseLeave={() => setHighlightPinId((cur) => (cur === pin.id ? null : cur))}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPinCtxMenu({ kind, pinId: pin.id, x: e.clientX, y: e.clientY }); }}
                  />
                  {!playerView && pin.border.map((p, i) => {
                    const s = toScreen(p.x, p.y);
                    const interactive = !drawing && addMode === "none" && !measuring;
                    return (
                      <circle
                        key={i}
                        cx={s.left}
                        cy={s.top}
                        r={active ? 5 : 4}
                        fill="#fff"
                        stroke={c}
                        strokeWidth={2}
                        style={{ pointerEvents: interactive ? "auto" : "none", cursor: "grab" }}
                        onMouseDown={(e) => startBorderDrag(e, kind, pin.id, "vertex", i)}
                        onMouseEnter={() => setHighlightPinId(pin.id)}
                        onMouseLeave={() => setHighlightPinId((cur) => (cur === pin.id ? null : cur))}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setPinCtxMenu({ kind, pinId: pin.id, x: e.clientX, y: e.clientY }); }}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* Measured route */}
            {measuring && measurePts.length > 0 && (() => {
              const pts = measurePts.map((p) => toScreen(p.x, p.y));
              const last = pts[pts.length - 1];
              const label = measurePts.length > 1 ? describeLength(lineWidthFraction(measurePts)) : "";
              return (
                <g>
                  <polyline points={pts.map((p) => `${p.left},${p.top}`).join(" ")} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
                  <polyline points={pts.map((p) => `${p.left},${p.top}`).join(" ")} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="8 5" strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p, i) => <circle key={i} cx={p.left} cy={p.top} r={i === 0 ? 5 : 4} fill={i === 0 ? "#fff" : "var(--accent, #4f8cff)"} stroke="#000" strokeOpacity={0.5} strokeWidth={1.5} />)}
                  {label && (
                    <text x={last.left + 10} y={last.top - 10} fill="#fff" stroke="#000" strokeOpacity={0.7} strokeWidth={3} paintOrder="stroke" fontSize={13} fontWeight={700}>
                      {label}
                    </text>
                  )}
                </g>
              );
            })()}

            {/* In-progress drawing: dashed rubber-band + a circle dot at each clicked point */}
            {drawing && drawPoints.length > 0 && (
              <>
                <polyline
                  points={[...drawPoints, ...(cursorPt ? [cursorPt] : [])].map((p) => { const s = toScreen(p.x, p.y); return `${s.left},${s.top}`; }).join(" ")}
                  fill="none"
                  stroke="var(--accent, #4f8cff)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
                {drawPoints.map((p, i) => { const s = toScreen(p.x, p.y); return <circle key={i} cx={s.left} cy={s.top} r={4.5} fill="#fff" stroke="var(--accent, #4f8cff)" strokeWidth={2} />; })}
              </>
            )}
          </svg>

          {/* Text labels: painted on the map, so they scale with zoom (pins sit above them) */}
          {layers.texts && imgNatural.w > 0 && (() => {
            const list: MapTextLabel[] = texts.map((l) => (textEditor && textEditor.id === l.id ? textEditor.draft : l));
            if (textEditor && textEditor.id === NEW_TEXT_ID) list.push(textEditor.draft);
            const interactive = !drawing && !measuring && addMode === "none" && !playerView;
            return list.map((lbl) => {
              if (playerView && lbl.secret) return null;
              const s = toScreen(lbl.x, lbl.y);
              const fs = mapTextFontPx(lbl.size, imgNatural.w) * zoom;
              const editing = textEditor?.id === lbl.id;
              if (fs < 4 && !editing) return null; // too small to read at this zoom
              const color = lbl.color ?? MAP_TEXT_DEFAULT_COLOR;
              const halo = mapTextHalo(color);
              const blur = Math.max(2, fs * 0.14);
              const empty = !lbl.text.trim();
              return (
                <div
                  key={`txt-${lbl.id}`}
                  data-map-text={lbl.id}
                  style={{
                    position: "absolute",
                    left: s.left,
                    top: s.top,
                    transform: `translate(-50%, -50%) rotate(${lbl.rotation ?? 0}deg)`,
                    fontFamily: MAP_TEXT_FONT,
                    fontSize: Math.max(fs, 4),
                    fontWeight: 700,
                    fontStyle: lbl.italic ? "italic" : "normal",
                    letterSpacing: lbl.caps ? "0.2em" : "0.02em",
                    textTransform: lbl.caps ? "uppercase" : "none",
                    color,
                    opacity: empty ? 0.55 : lbl.secret ? 0.6 : 1,
                    textDecoration: lbl.secret ? "underline dashed" : "none",
                    textShadow: `0 0 ${blur}px ${halo}, 0 0 ${blur / 2}px ${halo}, 0 0 1px ${halo}`,
                    whiteSpace: "pre",
                    textAlign: "center",
                    lineHeight: 1.1,
                    padding: "0 0.15em",
                    borderRadius: 4,
                    outline: editing ? "1px dashed var(--accent, #4f8cff)" : highlightPinId === lbl.id ? `1px solid ${halo}` : "none",
                    outlineOffset: 4,
                    cursor: "move",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    pointerEvents: interactive ? "auto" : "none",
                    zIndex: 5,
                  }}
                  title={interactive ? `${lbl.secret ? `${t("wmap.secretTag", "Hidden from players")} · ` : ""}${t("wmap.textEditHint", "Drag to move · double-click or right-click to edit")}` : undefined}
                  onMouseDown={(e) => { if (e.button === 2) { e.preventDefault(); return; } startDragText(e, lbl); }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => { e.stopPropagation(); if (!editing) openTextEditor(lbl); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!editing) openTextEditor(lbl); }}
                  onMouseEnter={() => setHighlightPinId(lbl.id)}
                  onMouseLeave={() => setHighlightPinId((cur) => (cur === lbl.id ? null : cur))}
                >
                  {empty ? t("wmap.textPh", "Your text") : lbl.text}
                </div>
              );
            });
          })()}

          {/* Doc pins */}
          {layers.docs && docPins.map((pin) => {
            if (playerView && pin.secret) return null;
            const doc = documents.find((d) => d.id === pin.docId);
            const glyph = pinGlyph(pin.icon);
            return (
              <div
                key={pin.id}
                style={{
                  position: "absolute",
                  left: `${toScreen(pin.x, pin.y).left}px`,
                  top: `${toScreen(pin.x, pin.y).top}px`,
                  transform: "translate(-50%, -100%)",
                  transformOrigin: "center bottom",
                  cursor: playerView ? "default" : draggingPin?.id === pin.id ? "grabbing" : "grab",
                  zIndex: popupPinId === pin.id ? 20 : 10,
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  pointerEvents: (drawing || measuring) ? "none" : "auto",
                  opacity: pin.secret ? 0.75 : 1,
                }}
                onMouseDown={(e) => { if (playerView) { e.stopPropagation(); return; } if (e.button === 2) { e.preventDefault(); return; } startDragPin(e, pin.id, "doc"); }}
                onMouseEnter={() => pin.border && setHighlightPinId(pin.id)}
                onMouseLeave={() => setHighlightPinId((cur) => (cur === pin.id ? null : cur))}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!playerView) setPinCtxMenu({ kind: "doc", pinId: pin.id, x: e.clientX, y: e.clientY }); }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (playerView) return; // players only see the pin and its name
                  if (Date.now() - dragEndedAt.current < 250) return;
                  if (pin.border) setHighlightPinId(pin.id);
                  setPopupPinId(pin.id === popupPinId ? null : pin.id);
                }}
                title={`${doc?.title ?? pin.docId}${pin.secret && !playerView ? ` · ${t("wmap.secretTag", "Hidden from players")}` : ""}`}
              >
                <div
                  style={{
                    width: glyph ? 26 : 22,
                    height: glyph ? 26 : 22,
                    borderRadius: "50% 50% 50% 0",
                    transform: "rotate(-45deg)",
                    background: pin.color ?? "var(--accent)",
                    border: pin.secret ? "2px dashed white" : "2px solid white",
                    boxShadow: highlightPinId === pin.id ? `0 0 0 2px ${pinColor("doc", pin)}, 0 0 10px 2px ${pinColor("doc", pin)}` : "0 2px 8px rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {glyph && (
                    <span style={{ transform: "rotate(45deg)", color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                      {glyph}
                    </span>
                  )}
                </div>
                {doc && layers.names && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: glyph ? 30 : 26,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-2)",
                      borderRadius: 6,
                      padding: "2px 6px",
                      fontSize: 10,
                      whiteSpace: "nowrap",
                      pointerEvents: "auto",
                      cursor: "inherit",
                      color: "var(--text)",
                    }}
                  >
                    {doc.title || doc.id}
                  </div>
                )}
              </div>
            );
          })}

          {/* Label pins */}
          {layers.records && labelPins.map((pin) => {
            if (playerView && pin.secret) return null;
            const col = collections.find((c) => c.id === pin.collectionId);
            const row = col?.rows.find((r) => r.id === pin.entityId);
            const label = row ? entityLabel(row) : pin.entityId;
            const c = pin.color ?? col?.color;
            const glyph = pinGlyph(pin.icon);
            const dotOnly = !layers.names;
            // In player view a record pin that has its own map opens it on click (a city map, say).
            const playerSub = playerView ? mapForRecord(pin.collectionId, pin.entityId) : undefined;
            return (
              <div
                key={pin.id}
                style={{
                  position: "absolute",
                  left: `${toScreen(pin.x, pin.y).left}px`,
                  top: `${toScreen(pin.x, pin.y).top}px`,
                  transform: "translate(-50%, -50%)",
                  cursor: playerView ? (playerSub ? "pointer" : "default") : draggingPin?.id === pin.id ? "grabbing" : "grab",
                  zIndex: 10,
                  opacity: pin.secret ? 0.75 : 1,
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  pointerEvents: (drawing || measuring) ? "none" : "auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  background: dotOnly ? (c ?? "var(--accent)") : c ? `${c}22` : "var(--bg-elevated)",
                  border: dotOnly ? `2px ${pin.secret ? "dashed" : "solid"} #fff` : `1px ${pin.secret ? "dashed" : "solid"} ${c ?? "var(--border-2)"}`,
                  borderRadius: 20,
                  padding: dotOnly ? 0 : "3px 8px 3px 8px",
                  width: dotOnly ? (glyph ? 22 : 14) : undefined,
                  height: dotOnly ? (glyph ? 22 : 14) : undefined,
                  fontSize: 11,
                  fontWeight: 700,
                  color: dotOnly ? "#fff" : c ?? "var(--text)",
                  boxShadow: highlightPinId === pin.id ? `0 0 0 2px ${c ?? "var(--accent)"}, 0 0 10px 1px ${c ?? "var(--accent)"}` : "0 2px 6px rgba(0,0,0,0.4)",
                  backdropFilter: "blur(4px)",
                }}
                title={playerSub ? `${t("wmap.openMap", "Open map")}: ${label}` : pin.secret && !playerView ? `${label} · ${t("wmap.secretTag", "Hidden from players")}` : dotOnly ? label : undefined}
                onMouseDown={(e) => { if (playerView) { e.stopPropagation(); return; } if (e.button === 2) { e.preventDefault(); return; } startDragPin(e, pin.id, "label"); }}
                onMouseEnter={() => pin.border && setHighlightPinId(pin.id)}
                onMouseLeave={() => setHighlightPinId((cur) => (cur === pin.id ? null : cur))}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!playerView) setPinCtxMenu({ kind: "label", pinId: pin.id, x: e.clientX, y: e.clientY }); }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (playerView) { if (playerSub) openSubMap(playerSub.id); return; }
                  if (Date.now() - dragEndedAt.current < 250) return;
                  if (pin.border) setHighlightPinId(pin.id);
                  setPopupPinId(pin.id === popupPinId ? null : pin.id);
                }}
              >
                {glyph && <span style={{ fontSize: dotOnly ? 12 : 12, lineHeight: 1, textShadow: dotOnly ? "0 1px 2px rgba(0,0,0,0.6)" : undefined }}>{glyph}</span>}
                {!dotOnly && label}
                {!dotOnly && !playerView && <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveLabelPin(pin.id as Id);
                    onSave();
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 10,
                    lineHeight: 1,
                    color: "inherit",
                    opacity: 0.6,
                  }}
                  title={t("wmap.removeLabel")}
                >
                  ✕
                </button>}
              </div>
            );
          })}

          {/* Doc pin excerpt popup */}
          {popupPin && popupDoc && (
            <div
              style={{
                position: "absolute",
                left: `${toScreen(popupPin.x, popupPin.y).left}px`,
                top: `${toScreen(popupPin.x, popupPin.y).top}px`,
                transform: "translate(-50%, 10px)",
                transformOrigin: "center top",
                zIndex: 30,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-2)",
                borderRadius: 10,
                padding: 14,
                maxWidth: 300,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                pointerEvents: "all",
                cursor: "default",
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: "var(--text)" }}>
                {popupDoc.title || popupDoc.id}
              </div>
              {renderPinNote("doc", popupPin)}
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.85,
                  lineHeight: 1.55,
                  marginBottom: 10,
                  color: "var(--text)",
                }}
              >
                {(() => {
                  const t = popupDoc.content.replace(/\s+/g, " ").trim();
                  return t.length > 150 ? t.slice(0, 150).trimEnd() + "…" : t;
                })()}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => { onOpenDoc(popupDoc.id as Id); setPopupPinId(null); }}
                  style={{ ...btnActive, fontSize: 11 }}
                >
                  {t("common.readMore")}
                </button>
                {noteButton(popupPin)}
              </div>
            </div>
          )}

          {/* Record (label) pin popup */}
          {popupLabelPin && popupLabelRow && (
            <div
              style={{
                position: "absolute",
                left: `${toScreen(popupLabelPin.x, popupLabelPin.y).left}px`,
                top: `${toScreen(popupLabelPin.x, popupLabelPin.y).top}px`,
                transform: "translate(-50%, 16px)",
                transformOrigin: "center top",
                zIndex: 30,
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-2)",
                borderRadius: 10,
                padding: 14,
                maxWidth: 300,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                pointerEvents: "all",
                cursor: "default",
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: popupLabelCol?.color ?? "var(--text)" }}>
                {entityLabel(popupLabelRow) || popupLabelRow.id}
              </div>
              {renderPinNote("label", popupLabelPin)}
              {(() => {
                const desc = String((popupLabelRow.values as any)?.description ?? "").replace(/\s+/g, " ").trim();
                if (!desc) {
                  return <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10, color: "var(--text)" }}>{t("common.noDescription")}</div>;
                }
                return (
                  <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.55, marginBottom: 10, color: "var(--text)" }}>
                    {desc.length > 150 ? desc.slice(0, 150).trimEnd() + "…" : desc}
                  </div>
                );
              })()}
              {(() => {
                const sub = mapForRecord(popupLabelPin.collectionId, popupLabelPin.entityId);
                const noteBtn = noteButton(popupLabelPin);
                if (!onOpenRecord && !sub && !noteBtn) return null;
                return (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {onOpenRecord && (
                      <button
                        type="button"
                        onClick={() => { onOpenRecord(popupLabelPin.collectionId, popupLabelPin.entityId); setPopupPinId(null); }}
                        style={{ ...btnActive, fontSize: 11 }}
                      >
                        {t("common.readMore")}
                      </button>
                    )}
                    {sub && (
                      <button type="button" onClick={() => openSubMap(sub.id)} style={{ ...btnBase, fontSize: 11 }}>
                        {t("wmap.openMap", "Open map")} ▸
                      </button>
                    )}
                    {noteBtn}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Drawing hint */}
      {drawing && (
        <div style={{ position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)", zIndex: 120, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("wmap.drawHint")}</span>
          <button type="button" onClick={completeBorder} style={{ ...btnActive, fontSize: 12, padding: "4px 10px" }}>{t("common.finish")}</button>
          <button type="button" onClick={cancelDrawing} style={{ ...btnBase, fontSize: 12, padding: "4px 10px" }}>{t("common.cancel")}</button>
        </div>
      )}

      {/* Pin right-click menu */}
      {pinCtxMenu && (() => {
        const m = pinCtxMenu;
        const pin = m.kind === "doc" ? docPins.find((p) => p.id === m.pinId) : labelPins.find((p) => p.id === m.pinId);
        if (!pin) return null;
        const hasBorder = !!(pin.border && pin.border.length >= 3);
        const close = () => setPinCtxMenu(null);
        const item: React.CSSProperties = { textAlign: "left", border: "none", background: "transparent", color: "var(--text-2)", cursor: "pointer", padding: "7px 10px", fontSize: 13, borderRadius: 6, whiteSpace: "nowrap" };
        return (
          <>
            <div onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} style={{ position: "fixed", inset: 0, zIndex: 130 }} />
            <div style={{ position: "fixed", top: Math.min(m.y + 4, window.innerHeight - 210), left: Math.max(8, Math.min(m.x, window.innerWidth - 200)), zIndex: 131, minWidth: 170, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 8, padding: 6, boxShadow: "0 10px 25px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", gap: 2 }}>
              {onSetPinStyle && (
                <button type="button" style={item} onClick={() => { close(); setStyleEditor({ kind: m.kind, pinId: m.pinId, x: m.x, y: m.y }); }}>{t("wmap.pinStyle", "Icon and colour…")}</button>
              )}
              {onSetPinStyle && (
                <button type="button" style={item} onClick={() => { close(); setPopupPinId(m.pinId); setNoteEdit({ pinId: m.pinId, draft: pin.note ?? "" }); }}>
                  {pin.note ? t("wmap.editNote", "Edit note") : t("wmap.addNote", "Add note")}…
                </button>
              )}
              {onSetPinStyle && (
                <button type="button" style={item} onClick={() => { close(); onSetPinStyle(m.kind, m.pinId as Id, { secret: pin.secret ? null : true }); onSave(); }}>
                  {pin.secret ? t("wmap.showToPlayers", "Show to players") : t("wmap.hideFromPlayers", "Hide from players")}
                </button>
              )}
              {hasBorder ? (
                <button type="button" style={item} onClick={() => { close(); deleteBorder(m.kind, m.pinId); }}>{t("wmap.deleteBorder")}</button>
              ) : (
                <button type="button" style={item} onClick={() => { close(); startDrawBorder(m.kind, m.pinId); }}>{t("wmap.drawBorder")}</button>
              )}
              <button type="button" style={{ ...item, color: "var(--danger-text)" }}
                onClick={() => { close(); if (m.kind === "doc") onRemoveDocPin(m.pinId as Id); else onRemoveLabelPin(m.pinId as Id); onSave(); }}>
                {t("wmap.deletePin")}
              </button>
            </div>
          </>
        );
      })()}

      {/* Pin icon + colour picker */}
      {styleEditor && onSetPinStyle && (() => {
        const ed = styleEditor;
        const pin = ed.kind === "doc" ? docPins.find((p) => p.id === ed.pinId) : labelPins.find((p) => p.id === ed.pinId);
        if (!pin) return null;
        const close = () => setStyleEditor(null);
        const apply = (style: MapPinPatch) => { onSetPinStyle(ed.kind, ed.pinId as Id, style); onSave(); };
        const cur = pinColor(ed.kind, pin);
        const cell: React.CSSProperties = { width: 30, height: 30, borderRadius: 7, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, lineHeight: 1 };
        return (
          <>
            <div onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} style={{ position: "fixed", inset: 0, zIndex: 130 }} />
            <div style={{ position: "fixed", top: Math.max(8, Math.min(ed.y + 4, window.innerHeight - 300)), left: Math.max(8, Math.min(ed.x, window.innerWidth - 230)), zIndex: 131, width: 214, background: "var(--bg-elevated)", border: "1px solid var(--border-2)", borderRadius: 10, padding: 10, boxShadow: "0 10px 25px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)" }}>{t("wmap.pinIcon", "Icon")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 30px)", gap: 4 }}>
                <button type="button" title={t("wmap.icon.none", "No icon")} onClick={() => apply({ icon: null })}
                  style={{ ...cell, border: !pin.icon ? "2px solid var(--accent)" : "1px solid var(--border-3)", background: "transparent", color: "var(--text-dim)", fontSize: 11 }}>∅</button>
                {MAP_PIN_ICONS.map((ic) => (
                  <button key={ic.key} type="button" title={t(`wmap.icon.${ic.key}`, ic.key)} onClick={() => apply({ icon: ic.key })}
                    style={{ ...cell, border: pin.icon === ic.key ? "2px solid var(--accent)" : "1px solid var(--border-3)", background: cur, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                    {ic.glyph}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", marginTop: 2 }}>{t("wmap.pinColor", "Colour")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {MAP_PIN_COLORS.map((col) => (
                  <button key={col} type="button" title={col} onClick={() => apply({ color: col })}
                    style={{ width: 22, height: 22, borderRadius: 11, cursor: "pointer", background: col, border: pin.color === col ? "2px solid var(--text)" : "1px solid var(--border-3)" }} />
                ))}
                <label title={t("wmap.customColor", "Custom colour")} style={{ width: 22, height: 22, borderRadius: 11, border: "1px dashed var(--border-3)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 12, color: "var(--text-2)", position: "relative", overflow: "hidden" }}>
                  +
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(cur) ? cur : "#4f8cff"} onChange={(e) => onSetPinStyle(ed.kind, ed.pinId as Id, { color: e.target.value })} onBlur={() => onSave()} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <button type="button" style={{ ...btnBase, fontSize: 11 }} onClick={() => apply({ icon: null, color: null })}>{t("wmap.resetStyle", "Reset")}</button>
                <button type="button" style={{ ...btnActive, fontSize: 11 }} onClick={close}>{t("common.finish")}</button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
};

export default WorldMap;
