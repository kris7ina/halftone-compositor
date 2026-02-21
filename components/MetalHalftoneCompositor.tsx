"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface HalftoneOptions {
  frequency: number;
  angle: number;
  thickness: number;
  lineColor: string;
}

interface ImageAdjustments {
  greyscale: boolean;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  overlayColor: string;
  overlayOpacity: number;
  noiseEnabled: boolean;
  noiseSize: number;
  noiseColor: string;
  noiseOpacity: number;
}

interface Mask {
  shape: "rectangle" | "circle" | "triangle";
  x: number;
  y: number;
  width: number;
  height: number;
  id: number;
}

interface DragState {
  type: "move" | "resize";
  index: number;
  offsetX?: number;
  offsetY?: number;
  anchorX?: number;
  anchorY?: number;
}

interface HandlePosition {
  x: number;
  y: number;
  pos: "tl" | "tr" | "bl" | "br";
}

const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  greyscale: false,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  overlayColor: "#0d6847",
  overlayOpacity: 0,
  noiseEnabled: false,
  noiseSize: 2,
  noiseColor: "#ffffff",
  noiseOpacity: 0.1,
};

// ─── Image Adjustment Processing ────────────────────────────────────────
function applyImageAdjustments(
  sourceCanvas: HTMLCanvasElement,
  adj: ImageAdjustments
): HTMLCanvasElement {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext("2d")!;
  const imageData = srcCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const overlayRgb = adj.overlayOpacity > 0 ? hexToRgb(adj.overlayColor) : [0, 0, 0];
  const oR = overlayRgb[0] / 255, oG = overlayRgb[1] / 255, oB = overlayRgb[2] / 255;
  const noiseRgb = adj.noiseEnabled ? hexToRgb(adj.noiseColor) : [0, 0, 0];
  const nR = noiseRgb[0] / 255, nG = noiseRgb[1] / 255, nB = noiseRgb[2] / 255;
  const grain = Math.max(1, Math.round(adj.noiseSize));
  const expFactor = Math.pow(2, adj.exposure);
  const contrastFactor = 1 + adj.contrast;

  const overlayBlend = (base: number, blend: number) =>
    base < 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 10) continue;

      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      if (adj.greyscale) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = lum;
      }

      r *= expFactor;
      g *= expFactor;
      b *= expFactor;

      r = (r - 0.5) * contrastFactor + 0.5;
      g = (g - 0.5) * contrastFactor + 0.5;
      b = (b - 0.5) * contrastFactor + 0.5;

      const lum = 0.299 * clamp01(r) + 0.587 * clamp01(g) + 0.114 * clamp01(b);
      const hW = Math.max(0, (lum - 0.5) * 2);
      const sW = Math.max(0, (0.5 - lum) * 2);
      const hsMod = adj.highlights * hW * 0.5 + adj.shadows * sW * 0.5;
      r += hsMod;
      g += hsMod;
      b += hsMod;

      if (adj.overlayOpacity > 0) {
        const oa = adj.overlayOpacity;
        const cr = clamp01(r), cg = clamp01(g), cb = clamp01(b);
        r = cr * (1 - oa) + overlayBlend(cr, oR) * oa;
        g = cg * (1 - oa) + overlayBlend(cg, oG) * oa;
        b = cb * (1 - oa) + overlayBlend(cb, oB) * oa;
      }

      if (adj.noiseEnabled && adj.noiseOpacity > 0) {
        const gx = Math.floor(x / grain);
        const gy = Math.floor(y / grain);
        const nv = ((Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453) % 1 + 1) % 1;
        const no = adj.noiseOpacity * nv;
        r = r * (1 - no) + nR * no;
        g = g * (1 - no) + nG * no;
        b = b * (1 - no) + nB * no;
      }

      data[i] = clamp255(r);
      data[i + 1] = clamp255(g);
      data[i + 2] = clamp255(b);
    }
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  outCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
  return outCanvas;
}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clamp255(v: number) { return Math.max(0, Math.min(255, Math.round(v * 255))); }

// ─── Halftone Processing ───────────────────────────────────────────────
function applyLinearHalftone(
  sourceCanvas: HTMLCanvasElement,
  options: { frequency: number; angle: number; thickness: number; lineColor: number[] }
): HTMLCanvasElement {
  const { frequency = 20, angle = 90, thickness = 0.8, lineColor = [255, 255, 255] } = options;
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext("2d")!;
  const srcData = srcCtx.getImageData(0, 0, width, height);
  const src = srcData.data;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext("2d")!;
  const outData = outCtx.createImageData(width, height);
  const dst = outData.data;

  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = dst[i + 1] = dst[i + 2] = 0;
    dst[i + 3] = 0;
  }

  let adjustedAngle = angle;
  if (angle % 90 === 0) adjustedAngle = angle + 0.01;
  const angleRad = (adjustedAngle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const lineSpacing = Math.max(2, 72 / frequency);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const srcAlpha = src[idx + 3];
      if (srcAlpha < 10) continue;

      const r = src[idx], g = src[idx + 1], b = src[idx + 2];
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const rx = x * cos + y * sin;
      const posInPeriod = ((rx % lineSpacing) + lineSpacing) % lineSpacing;
      const normalizedPos = posInPeriod / lineSpacing;
      const lineWidth = (1 - brightness) * thickness;
      const distFromCenter = Math.abs(normalizedPos - 0.5) * 2;

      if (distFromCenter < lineWidth) {
        dst[idx] = lineColor[0];
        dst[idx + 1] = lineColor[1];
        dst[idx + 2] = lineColor[2];
        dst[idx + 3] = srcAlpha;
      }
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

// ─── Draw mask shape into current path ─────────────────────────────────
function drawMaskShape(ctx: CanvasRenderingContext2D, mask: Mask, s: number) {
  const cx = mask.x * s, cy = mask.y * s;
  const w = mask.width * s, h = mask.height * s;
  if (mask.shape === "rectangle") {
    ctx.rect(cx - w / 2, cy - h / 2, w, h);
  } else if (mask.shape === "circle") {
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (mask.shape === "triangle") {
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy + h / 2);
    ctx.closePath();
  }
}

function hexToRgb(hex: string): number[] {
  const h = hex.length >= 7 ? hex : "#000000";
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return [r, g, b];
}

// ─── Slider Control ────────────────────────────────────────────────────
function Control({
  label, value, unit = "", min, max, step, onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const display = typeof value === "number" && value % 1 !== 0 ? value.toFixed(2) : value;
  return (
    <div className="mhc-control">
      <div className="mhc-control-header">
        <label>{label}</label>
        <span className="mhc-control-value">{display}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

// ─── Color Picker + Hex Input ──────────────────────────────────────────
function ColorControl({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mhc-control">
      <div className="mhc-control-header"><label>{label}</label></div>
      <div className="mhc-color-row">
        <input type="color" className="mhc-color-input" value={value.length >= 7 ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
        <input
          type="text"
          className="mhc-color-hex-input"
          value={value}
          onChange={(e) => {
            let v = e.target.value;
            if (!v.startsWith("#")) v = "#" + v;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────
export default function MetalHalftoneCompositor() {
  const [rawImageCanvas, setRawImageCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imageCanvas, setImageCanvas] = useState<HTMLCanvasElement | null>(null);
  const [halftoneCanvas, setHalftoneCanvas] = useState<HTMLCanvasElement | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  const [selectedMask, setSelectedMask] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [halftoneOpts, setHalftoneOpts] = useState<HalftoneOptions>({
    frequency: 20, angle: 90, thickness: 0.8, lineColor: "#ffffff",
  });
  const [imageAdj, setImageAdj] = useState<ImageAdjustments>({ ...DEFAULT_ADJUSTMENTS });
  const [maskContent, setMaskContent] = useState<"halftone" | "metal">("halftone");
  const [bgColor, setBgColor] = useState("#0d6847");
  const [transparentBg, setTransparentBg] = useState(true);
  const [processing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 800 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [exportScale, setExportScale] = useState(2);
  const [imageLoaded, setImageLoaded] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const halftoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adjustTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);

  const masksRef = useRef(masks);
  const selectedMaskRef = useRef(selectedMask);
  const maskContentRef = useRef(maskContent);
  const bgColorRef = useRef(bgColor);
  const transparentBgRef = useRef(transparentBg);
  const imageCanvasRef = useRef(imageCanvas);
  const halftoneCanvasRef = useRef(halftoneCanvas);
  const canvasSizeRef = useRef(canvasSize);
  const zoomRef = useRef(zoom);

  useEffect(() => { masksRef.current = masks; }, [masks]);
  useEffect(() => { selectedMaskRef.current = selectedMask; }, [selectedMask]);
  useEffect(() => { maskContentRef.current = maskContent; }, [maskContent]);
  useEffect(() => { bgColorRef.current = bgColor; }, [bgColor]);
  useEffect(() => { transparentBgRef.current = transparentBg; }, [transparentBg]);
  useEffect(() => { imageCanvasRef.current = imageCanvas; }, [imageCanvas]);
  useEffect(() => { halftoneCanvasRef.current = halftoneCanvas; }, [halftoneCanvas]);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);

  // ── Image Upload ─────────────────────────────────────────────────
  const handleImageUpload = useCallback((file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const cvs = document.createElement("canvas");
        cvs.width = img.width;
        cvs.height = img.height;
        cvs.getContext("2d")!.drawImage(img, 0, 0);
        setRawImageCanvas(cvs);
        setCanvasSize({ width: img.width, height: img.height });
        setMasks([]);
        setSelectedMask(null);
        setZoom(1);
        setImageLoaded(true);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Process Image Adjustments (debounced) ────────────────────────
  useEffect(() => {
    if (!rawImageCanvas) return;
    if (adjustTimeoutRef.current) clearTimeout(adjustTimeoutRef.current);

    adjustTimeoutRef.current = setTimeout(() => {
      const processed = applyImageAdjustments(rawImageCanvas, imageAdj);
      setImageCanvas(processed);
    }, 60);

    return () => {
      if (adjustTimeoutRef.current) clearTimeout(adjustTimeoutRef.current);
    };
  }, [rawImageCanvas, imageAdj]);

  // ── Generate Halftone (debounced) ────────────────────────────────
  useEffect(() => {
    if (!imageCanvas) return;
    if (halftoneTimeoutRef.current) clearTimeout(halftoneTimeoutRef.current);

    halftoneTimeoutRef.current = setTimeout(() => {
      const htCanvas = applyLinearHalftone(imageCanvas, {
        ...halftoneOpts,
        lineColor: hexToRgb(halftoneOpts.lineColor),
      });
      setHalftoneCanvas(htCanvas);
    }, 50);

    return () => {
      if (halftoneTimeoutRef.current) clearTimeout(halftoneTimeoutRef.current);
    };
  }, [imageCanvas, halftoneOpts]);

  // ── Keyboard: Backspace/Delete ───────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Backspace" || e.key === "Delete") && selectedMaskRef.current !== null) {
        if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
        e.preventDefault();
        setMasks((prev) => prev.filter((_, i) => i !== selectedMaskRef.current));
        setSelectedMask(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Handle positions ─────────────────────────────────────────────
  function getHandlePositions(mask: Mask, cs: number): HandlePosition[] {
    const cx = mask.x * cs, cy = mask.y * cs;
    const w = mask.width * cs, h = mask.height * cs;
    return [
      { x: cx - w / 2, y: cy - h / 2, pos: "tl" },
      { x: cx + w / 2, y: cy - h / 2, pos: "tr" },
      { x: cx - w / 2, y: cy + h / 2, pos: "bl" },
      { x: cx + w / 2, y: cy + h / 2, pos: "br" },
    ];
  }

  // ── Composite Render ─────────────────────────────────────────────
  const renderComposite = useCallback(() => {
    const canvas = mainCanvasRef.current;
    const imgCvs = imageCanvasRef.current;
    if (!canvas || !imgCvs) return;
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    requestAnimationFrame(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) { isProcessingRef.current = false; return; }

      const cSize = canvasSizeRef.current;
      const displayWidth = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(displayWidth * dpr);
      const targetH = Math.round((cSize.height / cSize.width) * displayWidth * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const drawW = displayWidth;
      const drawH = (cSize.height / cSize.width) * displayWidth;
      const cs = drawW / cSize.width;

      const currentMasks = masksRef.current;
      const currentSelected = selectedMaskRef.current;
      const currentMaskContent = maskContentRef.current;
      const currentBgColor = bgColorRef.current;
      const currentTransparentBg = transparentBgRef.current;
      const htCvs = halftoneCanvasRef.current;

      ctx.clearRect(0, 0, drawW, drawH);

      const baseCanvas = currentMaskContent === "halftone" ? imgCvs : htCvs;
      const maskedCanvas = currentMaskContent === "halftone" ? htCvs : imgCvs;

      if (currentMasks.length > 0) {
        const maskCvs = document.createElement("canvas");
        maskCvs.width = Math.round(drawW);
        maskCvs.height = Math.round(drawH);
        const maskCtx = maskCvs.getContext("2d")!;
        maskCtx.fillStyle = "#fff";
        currentMasks.forEach((m) => {
          maskCtx.beginPath();
          drawMaskShape(maskCtx, m, cs);
          maskCtx.fill();
        });

        if (baseCanvas) {
          ctx.drawImage(baseCanvas, 0, 0, drawW, drawH);
          ctx.globalCompositeOperation = "destination-out";
          ctx.drawImage(maskCvs, 0, 0);
          ctx.globalCompositeOperation = "source-over";
        }

        if (maskedCanvas) {
          ctx.save();
          ctx.globalCompositeOperation = "destination-over";
          ctx.beginPath();
          currentMasks.forEach((m) => drawMaskShape(ctx, m, cs));
          ctx.clip();
          ctx.drawImage(maskedCanvas, 0, 0, drawW, drawH);
          ctx.restore();
          ctx.globalCompositeOperation = "source-over";
        }
      } else {
        if (baseCanvas) {
          ctx.drawImage(baseCanvas, 0, 0, drawW, drawH);
        }
      }

      if (currentTransparentBg) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        const t = 8;
        for (let ty = 0; ty < drawH; ty += t) {
          for (let tx = 0; tx < drawW; tx += t) {
            ctx.fillStyle = ((Math.floor(tx / t) + Math.floor(ty / t)) % 2) === 0 ? "#141414" : "#0a0a0a";
            ctx.fillRect(tx, ty, t, t);
          }
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = currentBgColor;
        ctx.fillRect(0, 0, drawW, drawH);
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";

      if (currentSelected !== null && currentMasks[currentSelected]) {
        const mask = currentMasks[currentSelected];
        ctx.save();
        ctx.strokeStyle = "rgba(100,141,255,0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        drawMaskShape(ctx, mask, cs);
        ctx.stroke();
        ctx.setLineDash([]);

        getHandlePositions(mask, cs).forEach((h) => {
          ctx.fillStyle = "#ededed";
          ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
          ctx.strokeStyle = "#648dff";
          ctx.lineWidth = 1;
          ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
        });
        ctx.restore();
      }

      isProcessingRef.current = false;
    });
  }, []);

  useEffect(() => {
    renderComposite();
  }, [imageCanvas, halftoneCanvas, masks, selectedMask, bgColor, transparentBg, maskContent, canvasSize, zoom, renderComposite]);

  // ── Mouse ────────────────────────────────────────────────────────
  const getCanvasCoords = (e: React.MouseEvent) => {
    const rect = mainCanvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const getCS = () => {
    const c = mainCanvasRef.current;
    return c ? c.clientWidth / canvasSizeRef.current.width : 1;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e);
    const cs = getCS();
    const currentMasks = masksRef.current;
    const currentSelected = selectedMaskRef.current;

    if (currentSelected !== null && currentMasks[currentSelected]) {
      const handles = getHandlePositions(currentMasks[currentSelected], cs);
      for (const h of handles) {
        if (Math.abs(x - h.x) < 10 && Math.abs(y - h.y) < 10) {
          const mask = currentMasks[currentSelected];
          const hw = mask.width / 2, hh = mask.height / 2;
          let ax: number, ay: number;
          if (h.pos === "tl") { ax = mask.x + hw; ay = mask.y + hh; }
          else if (h.pos === "tr") { ax = mask.x - hw; ay = mask.y + hh; }
          else if (h.pos === "bl") { ax = mask.x + hw; ay = mask.y - hh; }
          else { ax = mask.x - hw; ay = mask.y - hh; }
          setDragState({ type: "resize", index: currentSelected, anchorX: ax, anchorY: ay });
          return;
        }
      }
    }

    for (let i = currentMasks.length - 1; i >= 0; i--) {
      if (isPointInMask(x, y, currentMasks[i], cs)) {
        setSelectedMask(i);
        setDragState({ type: "move", index: i, offsetX: x / cs - currentMasks[i].x, offsetY: y / cs - currentMasks[i].y });
        return;
      }
    }
    setSelectedMask(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    const { x, y } = getCanvasCoords(e);
    const cs = getCS();
    const mx = x / cs, my = y / cs;

    setMasks((prev) => {
      const u = [...prev];
      if (ds.type === "move") {
        u[ds.index] = { ...prev[ds.index], x: mx - ds.offsetX!, y: my - ds.offsetY! };
      } else if (ds.type === "resize") {
        u[ds.index] = {
          ...prev[ds.index],
          x: (ds.anchorX! + mx) / 2, y: (ds.anchorY! + my) / 2,
          width: Math.max(20, Math.abs(mx - ds.anchorX!)),
          height: Math.max(20, Math.abs(my - ds.anchorY!)),
        };
      }
      return u;
    });
  };

  const handleMouseUp = () => setDragState(null);

  function isPointInMask(px: number, py: number, mask: Mask, cs: number): boolean {
    const cx = mask.x * cs, cy = mask.y * cs;
    const w = mask.width * cs, h = mask.height * cs;
    if (mask.shape === "rectangle") return px >= cx - w / 2 && px <= cx + w / 2 && py >= cy - h / 2 && py <= cy + h / 2;
    if (mask.shape === "circle") { const rx = w / 2, ry = h / 2; return ((px - cx) ** 2) / (rx ** 2) + ((py - cy) ** 2) / (ry ** 2) <= 1; }
    if (mask.shape === "triangle") {
      const x1 = cx, y1 = cy - h / 2, x2 = cx + w / 2, y2 = cy + h / 2, x3 = cx - w / 2, y3 = cy + h / 2;
      const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      const a = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / d;
      const b = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / d;
      return a >= 0 && b >= 0 && (1 - a - b) >= 0;
    }
    return false;
  }

  const addMask = (shape: Mask["shape"]) => {
    const cs = canvasSizeRef.current;
    setMasks((prev) => {
      const newMasks = [...prev, {
        shape, x: cs.width / 2, y: cs.height / 2,
        width: cs.width * 0.35, height: cs.height * 0.35, id: Date.now(),
      }];
      setSelectedMask(newMasks.length - 1);
      return newMasks;
    });
  };

  const deleteMask = (index: number) => {
    setMasks((prev) => prev.filter((_, i) => i !== index));
    if (selectedMask === index) setSelectedMask(null);
    else if (selectedMask !== null && selectedMask > index) setSelectedMask(selectedMask - 1);
  };

  // ── Export ───────────────────────────────────────────────────────
  const exportImage = () => {
    if (!imageCanvasRef.current || !halftoneCanvasRef.current) return;
    const cSize = canvasSizeRef.current;
    const currentMasks = masksRef.current;
    const w = cSize.width * exportScale, h = cSize.height * exportScale;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    const s = exportScale;

    ctx.clearRect(0, 0, w, h);

    const base = maskContentRef.current === "halftone" ? imageCanvasRef.current : halftoneCanvasRef.current;
    const masked = maskContentRef.current === "halftone" ? halftoneCanvasRef.current : imageCanvasRef.current;

    if (currentMasks.length > 0) {
      const maskCvs = document.createElement("canvas");
      maskCvs.width = w; maskCvs.height = h;
      const maskCtx = maskCvs.getContext("2d")!;
      maskCtx.fillStyle = "#fff";
      currentMasks.forEach((m) => { maskCtx.beginPath(); drawMaskShape(maskCtx, m, s); maskCtx.fill(); });

      if (base) {
        ctx.drawImage(base, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(maskCvs, 0, 0);
        ctx.globalCompositeOperation = "source-over";
      }
      if (masked) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        ctx.beginPath();
        currentMasks.forEach((m) => drawMaskShape(ctx, m, s));
        ctx.clip();
        ctx.drawImage(masked, 0, 0, w, h);
        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
      }
    } else {
      if (base) ctx.drawImage(base, 0, 0, w, h);
    }

    if (!transparentBgRef.current) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = bgColorRef.current;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    const link = document.createElement("a");
    link.download = `composite-${s}x.png`;
    link.href = c.toDataURL("image/png");
    link.click();
  };

  // ── Zoom ─────────────────────────────────────────────────────────
  const zoomIn = () => setZoom((z) => Math.min(z * 1.25, 4));
  const zoomOut = () => setZoom((z) => Math.max(z / 1.25, 0.25));
  const zoomReset = () => setZoom(1);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z * 1.25, 4));
      else if (e.key === "-") setZoom((z) => Math.max(z / 1.25, 0.25));
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Adjustment helpers ───────────────────────────────────────────
  const adj = (key: keyof ImageAdjustments, value: number | boolean | string) =>
    setImageAdj((p) => ({ ...p, [key]: value }));

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="mhc-root">
      {/* Sidebar */}
      <div className="mhc-sidebar">
        <h1>Compositor</h1>
        <div className="mhc-subtitle">Metal → Halftone mask compositing</div>

        <div
          className={`mhc-upload ${isDragging ? "dragover" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleImageUpload(e.dataTransfer.files[0]); }}
        >
          <div className="mhc-upload-icon">↑</div>
          <div className="mhc-upload-text"><strong>Upload image</strong><br />or drag and drop</div>
          <input ref={fileInputRef} type="file" accept="image/png" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
        </div>

        {imageLoaded && (
          <>
            {/* ── Metal Image Adjustments ───────────── */}
            <div className="mhc-section">
              <div className="mhc-section-title">Metal Image</div>

              <label className="mhc-checkbox" style={{ marginBottom: 16 }}>
                <input type="checkbox" checked={imageAdj.greyscale} onChange={(e) => adj("greyscale", e.target.checked)} />
                Greyscale
              </label>

              <Control label="Exposure" value={imageAdj.exposure} min={-2} max={2} step={0.05} onChange={(v) => adj("exposure", v)} />
              <Control label="Contrast" value={imageAdj.contrast} min={-1} max={1} step={0.05} onChange={(v) => adj("contrast", v)} />
              <Control label="Highlights" value={imageAdj.highlights} min={-1} max={1} step={0.05} onChange={(v) => adj("highlights", v)} />
              <Control label="Shadows" value={imageAdj.shadows} min={-1} max={1} step={0.05} onChange={(v) => adj("shadows", v)} />

              <div className="mhc-subsection">
                <div className="mhc-subsection-title">Color Overlay</div>
                <ColorControl label="Color" value={imageAdj.overlayColor} onChange={(v) => adj("overlayColor", v)} />
                <Control label="Opacity" value={imageAdj.overlayOpacity} min={0} max={1} step={0.01} onChange={(v) => adj("overlayOpacity", v)} />
              </div>

              <div className="mhc-subsection">
                <div className="mhc-subsection-title">Noise</div>
                <label className="mhc-checkbox" style={{ marginBottom: 12 }}>
                  <input type="checkbox" checked={imageAdj.noiseEnabled} onChange={(e) => adj("noiseEnabled", e.target.checked)} />
                  Enable noise
                </label>
                {imageAdj.noiseEnabled && (
                  <>
                    <Control label="Grain Size" value={imageAdj.noiseSize} min={1} max={8} step={1} unit="px" onChange={(v) => adj("noiseSize", v)} />
                    <ColorControl label="Color" value={imageAdj.noiseColor} onChange={(v) => adj("noiseColor", v)} />
                    <Control label="Opacity" value={imageAdj.noiseOpacity} min={0} max={0.5} step={0.01} onChange={(v) => adj("noiseOpacity", v)} />
                  </>
                )}
              </div>
            </div>

            {/* ── Halftone ──────────────────────────── */}
            <div className="mhc-section">
              <div className="mhc-section-title">Halftone</div>
              <Control label="Frequency" value={halftoneOpts.frequency} unit=" lpi" min={1} max={50} step={1} onChange={(v) => setHalftoneOpts((p) => ({ ...p, frequency: v }))} />
              <Control label="Angle" value={halftoneOpts.angle} unit="°" min={0} max={180} step={1} onChange={(v) => setHalftoneOpts((p) => ({ ...p, angle: v }))} />
              <Control label="Thickness" value={halftoneOpts.thickness} min={0.1} max={1.5} step={0.05} onChange={(v) => setHalftoneOpts((p) => ({ ...p, thickness: v }))} />
              <ColorControl label="Line Color" value={halftoneOpts.lineColor} onChange={(v) => setHalftoneOpts((p) => ({ ...p, lineColor: v }))} />
            </div>

            {/* ── Composition ───────────────────────── */}
            <div className="mhc-section">
              <div className="mhc-section-title">Composition</div>
              <div className="mhc-control">
                <div className="mhc-control-header"><label>Inside Masks</label></div>
                <div className="mhc-toggle">
                  {(["halftone", "metal"] as const).map((opt) => (
                    <button key={opt} className={`mhc-toggle-btn ${maskContent === opt ? "active" : ""}`} onClick={() => setMaskContent(opt)}>{opt}</button>
                  ))}
                </div>
              </div>
              <div className="mhc-control">
                <div className="mhc-control-header"><label>Background</label></div>
                <label className="mhc-checkbox" style={{ marginBottom: 12 }}>
                  <input type="checkbox" checked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
                  Transparent background
                </label>
                {!transparentBg && (
                  <ColorControl label="Color" value={bgColor} onChange={setBgColor} />
                )}
              </div>
            </div>

            {/* ── Masks ─────────────────────────────── */}
            <div className="mhc-section">
              <div className="mhc-section-title">Masks</div>
              <div className="mhc-mask-shapes">
                {([{ s: "rectangle" as const, i: "▭" }, { s: "circle" as const, i: "○" }, { s: "triangle" as const, i: "△" }]).map(({ s, i }) => (
                  <button key={s} className="mhc-mask-shape-btn" onClick={() => addMask(s)} title={`Add ${s}`}>{i}</button>
                ))}
              </div>
              {masks.map((mask, i) => (
                <div key={mask.id} className={`mhc-mask-item ${selectedMask === i ? "selected" : ""}`} onClick={() => setSelectedMask(i)}>
                  <span>{mask.shape === "rectangle" ? "▭" : mask.shape === "circle" ? "○" : "△"} {mask.shape} {i + 1}</span>
                  <button className="mhc-mask-delete" onClick={(e) => { e.stopPropagation(); deleteMask(i); }}>×</button>
                </div>
              ))}
              {selectedMask !== null && <div className="mhc-mask-hint">⌫ Backspace to delete selected</div>}
            </div>

            {/* ── Export ─────────────────────────────── */}
            <div className="mhc-export-section">
              <div className="mhc-section-title">Export</div>
              <div className="mhc-export-options">
                {[1, 2, 3, 4].map((s) => (
                  <button key={s} className={`mhc-export-opt ${exportScale === s ? "selected" : ""}`} onClick={() => setExportScale(s)}>
                    <span className="mhc-export-scale">{s}×</span>
                    <span className="mhc-export-label">{canvasSize.width * s}px</span>
                  </button>
                ))}
              </div>
              <button className="mhc-export-btn" onClick={exportImage} disabled={!halftoneCanvas}>Export PNG</button>
            </div>
          </>
        )}
      </div>

      {/* Canvas Area */}
      <div className="mhc-canvas-area" ref={containerRef}>
        {imageLoaded && (
          <div className="mhc-zoom">
            <button className="mhc-zoom-btn" onClick={zoomOut}>−</button>
            <div className="mhc-zoom-level">{Math.round(zoom * 100)}%</div>
            <button className="mhc-zoom-btn" onClick={zoomIn}>+</button>
            <button className="mhc-zoom-btn" onClick={zoomReset}>⊡</button>
          </div>
        )}

        {!imageLoaded ? (
          <div className="mhc-placeholder">
            <div className="mhc-placeholder-icon">◐</div>
            <div className="mhc-placeholder-text">Upload an image to get started</div>
          </div>
        ) : (
          <div className="mhc-canvas-container">
            {processing && <div className="mhc-processing"><div className="mhc-spinner" /></div>}
            <canvas
              ref={mainCanvasRef}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
                cursor: dragState ? (dragState.type === "resize" ? "nwse-resize" : "grabbing") : "default",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>
        )}
      </div>
    </div>
  );
}
