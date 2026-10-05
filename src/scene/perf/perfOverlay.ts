/**
 * Performance overlay: a small read-out in the top-right of the 3D view (under the toolbar) that
 * shows whether WebGL runs on a GPU, the frame rate, frame and CPU time, and what the renderer
 * drew in the last frame.
 *
 * It must not change what it measures. Hidden, it costs one boolean check per frame. Shown, each
 * frame reads the clock twice and zeroes three.js's counters; the DOM is written four times a
 * second, only where the text changed, inside a contained box with no backdrop blur.
 *
 * Shown by default on the dev server (but not in automated browsers, so screenshots stay clean)
 * and anywhere with `?perf`; `?perf=0` hides it. The P key toggles it.
 */
import type * as THREE from 'three';
import { classifyGpu, fmtCount, FrameMeter, type GpuInfo } from './perfStats';
import './perfOverlay.css';

export interface PerfOverlay {
  readonly visible: boolean;
  setVisible(on: boolean): void;
  toggle(): void;
  /** Call first thing in the frame, before any update or draw. */
  begin(): void;
  /** Call after the frame's last draw. */
  end(): void;
  /** What the GPU check found; null until the overlay has been shown once. Re-checked after a context restore. */
  readonly gpu: GpuInfo | null;
  /** Screen edges covered by UI (px), so the read-out sits in the free part of the view. */
  setInsets(insets: { top: number; right: number }): void;
  dispose(): void;
}

/** Below this the frame-rate figure turns red. */
const LOW_FPS = 30;

export function createPerfOverlay(
  renderer: THREE.WebGLRenderer,
  mount: HTMLElement,
  visibleAtStart = requestedAtStart(),
): PerfOverlay {
  // `renderer.info` is read at each use, never kept: after a lost WebGL context is restored,
  // three.js replaces it with a new object (and carries `autoReset` over to it).
  const meter = new FrameMeter();
  let visible = false;
  let gpu: GpuInfo | null = null;
  let view: ReturnType<typeof buildView> | null = null;
  let probeTimer = 0;
  let frameStart = 0;
  /** Main-thread time of the last finished frame (ms); recorded when the next one starts. */
  let lastCpuMs = 0;
  let autoResetBefore = renderer.info.autoReset;
  const insets = { top: 0, right: 0 };

  /** Name the GPU from its renderer string; probe for a slow context only if the browser hides it. */
  function checkGpu() {
    clearTimeout(probeTimer);
    gpu = readGpu(renderer);
    view?.setGpu(gpu);
    if (gpu.verdict !== 'unknown') return;
    // The probe creates a second WebGL context, which can stall the main thread for tens of
    // milliseconds: run it after the overlay has painted, not inside a frame or a key press.
    const rendererName = gpu.renderer;
    probeTimer = window.setTimeout(() => {
      gpu = classifyGpu(rendererName, probeCaveat());
      view?.setGpu(gpu);
    }, 250);
  }

  function setVisible(on: boolean) {
    if (on === visible) return;
    visible = on;
    const info = renderer.info;
    if (on) {
      view ??= buildView(mount);
      if (!gpu) checkGpu();
      view.place(insets);
      view.root.hidden = false;
      // The composer draws several passes per frame (scene, ambient occlusion, output). Left on
      // auto, three.js zeroes the counters at every pass and only the last one survives: the
      // full-screen output quad, 1 draw and 1 triangle. Zero them once per frame instead.
      autoResetBefore = info.autoReset;
      info.autoReset = false;
      info.reset();
      meter.reset();
      view.clear();
    } else {
      if (view) view.root.hidden = true;
      info.autoReset = autoResetBefore;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'p' && e.key !== 'P') return;
    const target = e.target instanceof Element ? e.target : null;
    // Never steal the key from text entry or from the open About dialog.
    if (target?.closest('textarea, select, dialog, [contenteditable=""], [contenteditable="true"], input:not([type="range"])')) return;
    e.preventDefault();
    setVisible(!visible);
  }
  window.addEventListener('keydown', onKey);
  // A hidden tab gets no frames; the gap until it is shown again is not a slow frame.
  const onVisibility = () => meter.restart();
  document.addEventListener('visibilitychange', onVisibility);
  // A restored context may be on another device: after a GPU-process crash Chrome can bring
  // the page back on its software fallback, which is exactly what the verdict exists to show.
  // three.js handles the event first (it registered in its constructor), so renderer.info is new.
  const onRestored = () => {
    if (gpu) checkGpu();
    if (visible) {
      meter.reset();
      view?.clear();
    }
  };
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);

  setVisible(visibleAtStart);

  return {
    get visible() {
      return visible;
    },
    get gpu() {
      return gpu;
    },
    setVisible,
    toggle() {
      setVisible(!visible);
    },
    setInsets(next) {
      insets.top = next.top;
      insets.right = next.right;
      view?.place(insets);
    },
    begin() {
      if (!visible || !view) return;
      const now = performance.now();
      const info = renderer.info;
      // Close the previous frame here, so its CPU time is paired with the interval it ran in.
      // The counters still hold that frame's totals: paint them, then zero them for this one.
      if (meter.record(now, lastCpuMs)) view.paint(meter, info);
      frameStart = now;
      info.reset();
    },
    end() {
      if (!visible) return;
      lastCpuMs = performance.now() - frameStart;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      clearTimeout(probeTimer);
      if (visible) renderer.info.autoReset = autoResetBefore;
      visible = false;
      view?.root.remove();
      view = null;
    },
  };
}

/** `?perf` / `?perf=1` shows it, `?perf=0` hides it; otherwise on for the dev server only. */
function requestedAtStart(): boolean {
  const flag = new URLSearchParams(location.search).get('perf');
  if (flag !== null) return flag !== '0' && flag !== 'false';
  return import.meta.env.DEV && !navigator.webdriver;
}

// ── GPU check ──────────────────────────────────────────────────────────────────────────────────

/** Verdict from the renderer string alone ('unknown' when the browser hides it). */
function readGpu(renderer: THREE.WebGLRenderer): GpuInfo {
  const gl = renderer.getContext();
  let name = '';
  try {
    name = String(gl.getParameter(gl.RENDERER) ?? '');
    // Chrome and Safari report "WebKit WebGL" here and name the device only through the debug
    // extension. Firefox names it directly and warns that the extension is deprecated, so ask
    // for the extension only when the plain answer says nothing.
    if (/^(webkit webgl|webgl)?$/i.test(name.trim())) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? name);
    }
  } catch {
    // Keep whatever was read; an unnamed renderer falls through to the probe.
  }
  return classifyGpu(name, null);
}

/**
 * True when the browser refuses a context that would be slow, i.e. WebGL is running on the CPU.
 * The probe context is released at once so it never counts against the browser's context limit.
 */
function probeCaveat(): boolean | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return true; // The app already runs on WebGL 2, so a refusal here is the caveat.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return false;
  } catch {
    return null;
  }
}

// ── DOM ────────────────────────────────────────────────────────────────────────────────────────

const VERDICT_LABEL = { hardware: 'Hardware', software: 'Software', unknown: 'Unknown' } as const;

function buildView(mount: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'perf-overlay';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Rendering performance');

  const head = el('div', 'perf-gpu');
  const verdict = el('span', 'perf-verdict');
  const name = el('span', 'perf-gpu-name');
  head.append(el('span', 'perf-dot'), verdict, name);

  const grid = el('dl', 'perf-grid');
  const cell = (label: string, title: string) => {
    const dt = el('dt', '', label);
    dt.title = title;
    const dd = el('dd');
    grid.append(dt, dd);
    return { dd, set: textSlot(dd) };
  };
  const fps = cell('FPS', 'Frames per second, last ¼ s');
  const avg = cell('avg', 'Frames per second, last 10 s');
  const frame = cell('Frame', 'Time between frames');
  const cpu = cell('CPU', 'Main-thread time spent inside the frame (update + draw calls)');
  const draws = cell('Draws', 'Draw calls in the last frame, all passes and shadows');
  const tris = cell('Tris', 'Triangles drawn in the last frame, all passes and shadows');
  const geom = cell('Geom', 'Geometries held on the GPU');
  const tex = cell('Tex', 'Textures held on the GPU');
  const fpsTone = attrSlot(fps.dd, 'data-tone');
  const insetTop = styleSlot(root, '--perf-inset-top');
  const insetRight = styleSlot(root, '--perf-inset-right');

  root.append(head, grid);
  mount.append(root);

  return {
    root,
    setGpu(gpu: GpuInfo) {
      root.dataset.gpu = gpu.verdict;
      verdict.textContent = VERDICT_LABEL[gpu.verdict];
      name.textContent = gpu.name;
      head.title = gpu.renderer || 'The browser does not name its renderer';
    },
    /** On phones the header spans the top, and on short wide screens a panel takes the right. */
    place(i: { top: number; right: number }) {
      insetTop(`${Math.round(i.top)}px`);
      insetRight(`${Math.round(i.right)}px`);
    },
    /** Placeholders until the first window closes. */
    clear() {
      for (const c of [fps, avg, frame, cpu, draws, tris, geom, tex]) c.set('–');
      fpsTone('');
    },
    paint(m: FrameMeter, i: THREE.WebGLInfo) {
      fps.set(fmtFps(m.fps));
      fpsTone(m.fps < LOW_FPS ? 'low' : '');
      avg.set(fmtFps(m.avgFps));
      frame.set(`${m.frameMs.toFixed(1)} ms`);
      cpu.set(`${m.cpuMs.toFixed(1)} ms`);
      draws.set(fmtCount(i.render.calls));
      tris.set(fmtCount(i.render.triangles));
      geom.set(fmtCount(i.memory.geometries));
      tex.set(fmtCount(i.memory.textures));
    },
  };
}

/** "120", "24", and "0.7" when a software renderer takes over a second per frame. */
const fmtFps = (fps: number) => (fps < 10 ? fps.toFixed(1) : String(Math.round(fps)));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Writes text only when it changed, so an unchanged figure costs no DOM work at all. */
function textSlot(node: Element): (value: string) => void {
  let last: string | undefined;
  return (value) => {
    if (value === last) return;
    last = value;
    node.textContent = value;
  };
}

function styleSlot(node: HTMLElement, prop: string): (value: string) => void {
  let last: string | undefined;
  return (value) => {
    if (value === last) return;
    last = value;
    node.style.setProperty(prop, value);
  };
}

function attrSlot(node: Element, name: string): (value: string) => void {
  let last: string | undefined;
  return (value) => {
    if (value === last) return;
    last = value;
    if (value) node.setAttribute(name, value);
    else node.removeAttribute(name);
  };
}
