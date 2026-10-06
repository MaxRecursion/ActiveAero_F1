/**
 * The DOM interface for every station: header with station tabs, toolbar, caption, the bottom
 * "spec sheet" dock (speed · readouts · chart) and the "How it works" dialog.
 *
 * The UI owns no physics. The active station pushes a view every frame; each part caches what
 * it last wrote, so a frame where nothing visible changed costs no DOM work at all. Each station
 * has its own readouts and chart; the shell swaps them (and presets, toggles, scale markers)
 * in setStation().
 */
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui.css';
import './about.css';
import './energy.css';
import './brake.css';
import './aeromap.css';

import type { Insets } from '../scene/stage';
import type { AeroMode, BrakeState, Station5View, StationId, StationUIConfig, ToggleId, UI, UIOptions } from './types';
import { h } from './dom';
import { fmtKmh, fmtKmhAtLeast } from './format';
import { icon, type IconName } from './icons';
import { createAbout } from './about';
import { createAeroReadouts } from './aeroReadouts';
import { createAeroMapChart } from './aeroMapChart';
import { createAeroMapReadouts } from './aeroMapReadouts';
import { createBrakeChart } from './brakeChart';
import { createBrakeControl } from './brakeControl';
import { brakeAction, type BrakeAction } from './brakeMath';
import { createBrakeReadouts } from './brakeReadouts';
import { createCaption } from './caption';
import { createForceChart } from './chart';
import { createEnergyReadouts } from './energyReadouts';
import { createLapControl } from './lapControl';
import { createLiverySwitch } from './liverySwitch';
import { createModeSwitch } from './modeSwitch';
import { createPowerChart } from './powerChart';
import { createReadouts } from './readouts';
import { createRideHeightControl } from './rideHeightControl';
import { createSpeedControl, type MarkerDef, type ScaleMarker } from './speedControl';
import { createTabs } from './tabs';
import { createTrackMap } from './trackMap';
import { createTowReadouts } from './towReadouts';
import { getTheme, setTheme } from '../theme';

/**
 * Must match the layout breakpoints in ui.css.
 * SHEET: the single-column sheet — phones, and every screen 600 px tall or less.
 * SIDE: short and wide (landscape phones, short laptop windows) — the sheet becomes a panel on the
 * right, so the car keeps the full height.
 * COMPACT: 600 px tall or less — readouts and chart move into drawers.
 */
const SHEET_QUERY = '(max-width: 719.98px), (max-height: 600px)';
const SIDE_QUERY = '(max-height: 600px) and (min-width: 640px) and (min-aspect-ratio: 3/2)';
const COMPACT_QUERY = '(max-height: 600px)';
/** Breathing room between the dock and whatever the stage centres above it. */
const INSET_MARGIN = 12;
const DOCK_ID = 'ui-dock';

/** `short` is shown instead of the label in narrow docks (energy.css). */
const TOGGLES: Record<ToggleId, { label: string; key: string; short?: string }> = {
  airflow: { label: 'Airflow', key: 'A' },
  exploded: { label: 'Exploded', key: 'E' },
  ceiling: { label: 'Ceiling test', key: 'C' },
  xray: { label: 'X-ray', key: 'X' },
  clipping: { label: 'Super clipping', key: 'S', short: 'Clipping' },
  brakes: { label: 'See-through wheels', key: 'W' },
};

/** Scale markers per station. Station 2's top speeds sit ~11 km/h apart, so their labels stack. */
const MARKERS: Record<StationId, MarkerDef[]> = {
  downforce: [{ tone: 'down', row: 0, side: 'right', band: 'end' }],
  activeAero: [
    { tone: 'drag', row: 1, side: 'left', band: 'next' },
    { tone: 'drag-alt', row: 0, side: 'left' },
  ],
  energy: [],
  braking: [],
  tow: [],
  // Station 6: where this set-up starts to porpoise (hidden when it never does; see aeromap.css).
  aeroMap: [
    { tone: 'drag', row: 0, side: 'left', band: 'next' },
    { tone: 'drag', row: 1, side: 'right' },
  ],
};

const SPEED_LAW: Record<StationId, string> = {
  downforce: '2× the speed → 4× the force → 8× the drag power',
  activeAero: '',
  energy: '',
  braking: '',
  tow: '',
  aeroMap: '',
};

/** What the play button plays, per main control. */
const PLAY_NOUN = { speed: 'speed sweep', lap: 'lap' } as const;

/** Icon button with a hover/focus tooltip; `ariaKeys` uses the aria-keyshortcuts syntax. */
function toolButton(name: IconName, label: string, ariaKeys?: string, shownKeys?: string) {
  const tipLabel = h('span', { class: 'tip-label', text: label });
  const btn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': label, ...(ariaKeys ? { 'aria-keyshortcuts': ariaKeys } : {}) } }, [
    icon(name),
    h('span', { class: 'tip', attrs: { 'aria-hidden': 'true' } }, [tipLabel, shownKeys ? h('kbd', { text: shownKeys }) : null]),
  ]);
  return { btn, tipLabel };
}

export function createUI(opts: UIOptions): UI {
  const { root, handlers } = opts;
  const sheetMq = window.matchMedia(SHEET_QUERY);
  const sideMq = window.matchMedia(SIDE_QUERY);
  const compactMq = window.matchMedia(COMPACT_QUERY);
  const configs = new Map(opts.stations.map((c) => [c.meta.id, c]));

  // ── header ────────────────────────────────────────────────────────────────────
  const tabs = createTabs(
    opts.stations.map((c) => c.meta),
    DOCK_ID,
    (id) => pickStation(id),
  );
  const prompt = h('p', 'prompt');
  const livery = createLiverySwitch(opts.initialLivery ?? 'clay', (id) => handlers.onLiveryChange(id));
  const header = h('header', 'ui-header', [
    h('h1', { class: 'wordmark', text: 'UNSEEN' }),
    h('p', { class: 'tagline', text: 'The 2026 grand-prix car, opened up.' }),
    h('div', 'header-meta', [tabs.el, prompt, livery.el]),
  ]);

  // ── toolbar ───────────────────────────────────────────────────────────────────
  const play = toolButton('play', 'Play speed sweep', 'Space', 'Space');
  const sound = toolButton('volumeMuted', 'Unmute car sound');
  sound.btn.classList.add('sound-btn');
  sound.btn.setAttribute('aria-pressed', 'false');
  let theme = getTheme();
  const themeButton = toolButton(theme === 'light' ? 'moon' : 'sun', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
  const reset = toolButton('reset', 'Reset view', 'R', 'R');
  const info = toolButton('about', 'How it works', 'Shift+? H', '? · H');
  const toolbar = h('div', { class: 'ui-toolbar', attrs: { role: 'toolbar', 'aria-label': 'View' } }, [themeButton.btn, sound.btn, play.btn, reset.btn, info.btn]);

  // ── dock ──────────────────────────────────────────────────────────────────────
  const speed = createSpeedControl({ ...opts, onInput: (kmh) => handlers.onSpeedInput(kmh) });
  const modeSwitch = createModeSwitch((mode) => handlers.onAeroMode(mode));
  speed.el.append(modeSwitch.el);
  const caption = createCaption();

  const s1 = { read: createReadouts(), chart: createForceChart(opts) };
  const s2 = { read: createAeroReadouts(), chart: createPowerChart() };
  // Station 4 keeps the speed slider (as "Brake from") and adds the Brake button under it.
  const brake = createBrakeControl({ onPlayToggle: () => handlers.onPlayToggle(), onRate: (rate) => handlers.onLapRate(rate) });
  const tow = createTowReadouts(handlers.onTowGapInput);
  // Station 6 adds the static ride heights under the slider.
  const ride = createRideHeightControl((setup) => handlers.onRideHeightInput(setup));
  speed.el.append(brake.el, tow.control, ride.el);
  // Station 3 swaps the speed control for the lap control, and readouts + chart for its own.
  const lap = createLapControl({
    onPlayToggle: () => handlers.onPlayToggle(),
    onRate: (rate) => handlers.onLapRate(rate),
    onScrub: (tS) => handlers.onLapScrub(tS),
  });
  const s3 = { read: createEnergyReadouts(), chart: createTrackMap((tS) => handlers.onLapScrub(tS)) };
  const s4 = { read: createBrakeReadouts(), chart: createBrakeChart((tS) => handlers.onLapScrub(tS)) };
  const s6 = { read: createAeroMapReadouts(), chart: createAeroMapChart((setup) => handlers.onRideHeightInput(setup)) };
  s1.chart.el.id = 'ui-chart-downforce';
  s2.chart.el.id = 'ui-chart-activeAero';
  s3.chart.el.id = 'ui-chart-energy';
  s4.chart.el.id = 'ui-chart-braking';
  s6.chart.el.id = 'ui-chart-aeroMap';
  s1.read.el.id = 'ui-read-downforce';
  s2.read.el.id = 'ui-read-activeAero';
  s3.read.el.id = 'ui-read-energy';
  s4.read.el.id = 'ui-read-braking';
  s6.read.el.id = 'ui-read-aeroMap';
  const panels: Record<StationId, HTMLElement[]> = {
    downforce: [s1.read.el, s1.chart.el],
    activeAero: [s2.read.el, s2.chart.el, modeSwitch.el],
    energy: [s3.read.el, s3.chart.el],
    braking: [s4.read.el, s4.chart.el, brake.el],
    tow: [tow.el],
    aeroMap: [s6.read.el, s6.chart.el, ride.el],
  };
  const panelEls = new Set(Object.values(panels).flat());

  const toggleState = new Map<ToggleId, { btn: HTMLButtonElement; hint: HTMLElement; on: boolean; available: boolean }>();
  const toggleRow = h('div', { class: 'toggles', attrs: { role: 'group', 'aria-label': 'Show' } });
  for (const [id, t] of Object.entries(TOGGLES) as [ToggleId, (typeof TOGGLES)[ToggleId]][]) {
    // Referenced by aria-describedby, so it stays hidden yet is read out while the toggle is unavailable.
    const hint = h('span', { attrs: { hidden: '', id: `toggle-hint-${id}` } });
    const btn = h('button', { class: 'toggle', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-keyshortcuts': t.key } }, [
      h('i', { class: 'toggle-led', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'toggle-label', text: t.label }),
      t.short ? h('span', { class: 'toggle-short', text: t.short, attrs: { 'aria-hidden': 'true' } }) : null,
      h('kbd', { class: 'toggle-key', text: t.key, attrs: { 'aria-hidden': 'true' } }),
      hint,
    ]);
    btn.dataset.toggle = id;
    toggleState.set(id, { btn, hint, on: false, available: true });
  }

  // Drawers: on small screens the numbers and the chart open on demand, one at a time.
  const drawerButton = (name: IconName, label: string) =>
    h('button', { class: `toggle drawer-toggle ${name}-toggle`, attrs: { type: 'button', 'aria-expanded': 'false', 'aria-label': label } }, [
      icon(name),
      h('span', { class: 'toggle-label', text: label }),
    ]);
  const numbersBtn = drawerButton('numbers', 'Numbers');
  const graphBtn = drawerButton('graph', 'Graph');
  const drawerBtns = h('div', 'drawer-btns', [numbersBtn, graphBtn]);

  const conditionsVals = h('span', 'conditions-vals');
  const conditions = h('p', 'conditions', [h('span', { class: 'micro', text: 'Test conditions' }), conditionsVals]);
  const dock = h('div', { class: 'ui-dock', attrs: { id: DOCK_ID, role: 'tabpanel' } }, [
    h('div', 'dock-strip', [conditions, h('div', 'strip-controls', [toggleRow, drawerBtns])]),
    speed.el,
    lap.el,
    s1.read.el,
    s1.chart.el,
    s2.read.el,
    s2.chart.el,
    s3.read.el,
    s3.chart.el,
    s4.read.el,
    s4.chart.el,
    s6.read.el,
    s6.chart.el,
    tow.el,
  ]);
  const bottom = h('div', 'ui-bottom', [caption.el, dock]);

  const about = createAbout(opts.stations.map((c) => c.meta));
  root.append(header, toolbar, bottom, about.el);

  // ── station switching ─────────────────────────────────────────────────────────
  let active: StationId | null = null;
  let markers: ScaleMarker[] = [];
  let control: 'speed' | 'lap' | 'brake' = 'speed';
  let playing = false;
  let soundMuted = true;
  let brakeState: BrakeState = 'ready';

  function setStation(id: StationId) {
    const cfg = configs.get(id);
    if (!cfg || id === active) return;
    active = id;
    tabs.select(id);
    prompt.textContent = cfg.meta.prompt;
    speed.setPresets(cfg.presets);
    markers = speed.setMarkers(MARKERS[id]);
    speed.setNote(SPEED_LAW[id]);
    conditionsVals.textContent = cfg.conditions;
    showToggles(cfg);
    control = cfg.control ?? 'speed';
    speed.el.hidden = control === 'lap';
    tow.control.hidden = id !== 'tow';
    speed.setLabel(control === 'brake' ? 'Brake from' : 'Speed');
    lap.el.hidden = control !== 'lap';
    const shown = new Set(panels[id]);
    for (const el of panelEls) el.hidden = !shown.has(el);
    dock.dataset.control = control;
    syncPlayLabel();
    if (id !== 'downforce') caption.renderCeiling(null);
    dock.dataset.station = id;
    dock.setAttribute('aria-labelledby', `tab-${id}`);
    graphBtn.setAttribute('aria-controls', `ui-chart-${id}`);
    numbersBtn.setAttribute('aria-controls', `ui-read-${id}`);
    notifyLayout();
  }

  function showToggles(cfg: StationUIConfig) {
    toggleRow.replaceChildren(...cfg.toggles.map((id) => toggleState.get(id)!.btn));
    toggleRow.hidden = cfg.toggles.length === 0;
  }
  const toggleShown = (id: ToggleId) => active !== null && configs.get(active)!.toggles.includes(id);

  /** User intent: present the station at once, then tell the app. */
  function pickStation(id: StationId) {
    if (id === active || !configs.has(id)) return;
    setStation(id);
    handlers.onStationChange(id);
  }

  // ── behaviour ─────────────────────────────────────────────────────────────────
  function setToggle(id: ToggleId, on: boolean) {
    const t = toggleState.get(id);
    if (!t || t.on === on) return;
    t.on = on;
    t.btn.setAttribute('aria-pressed', String(on));
  }
  function setToggleAvailable(id: ToggleId, available: boolean, reason = '') {
    const t = toggleState.get(id);
    if (!t) return;
    if (available) reason = '';
    if (t.available === available && t.hint.textContent === reason) return;
    t.available = available;
    if (available) {
      for (const attr of ['aria-disabled', 'aria-describedby', 'title']) t.btn.removeAttribute(attr);
      t.hint.textContent = '';
    } else {
      t.btn.setAttribute('aria-disabled', 'true');
      t.btn.setAttribute('aria-describedby', t.hint.id);
      t.btn.title = reason;
      t.hint.textContent = reason;
    }
  }
  function flipToggle(id: ToggleId) {
    if (!toggleState.get(id)?.available) return;
    const on = !toggleState.get(id)?.on;
    setToggle(id, on);
    handlers.onToggle(id, on);
  }
  const onToggleClick = (e: MouseEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-toggle]')?.dataset.toggle as ToggleId | undefined;
    if (id) flipToggle(id);
  };
  toggleRow.addEventListener('click', onToggleClick);

  type Drawer = 'numbers' | 'graph';
  const drawers: Record<Drawer, { btn: HTMLButtonElement; cls: string }> = {
    numbers: { btn: numbersBtn, cls: 'is-numbers-open' },
    graph: { btn: graphBtn, cls: 'is-graph-open' },
  };
  function setDrawer(which: Drawer, open: boolean) {
    for (const [id, d] of Object.entries(drawers) as [Drawer, (typeof drawers)[Drawer]][]) {
      // One drawer at a time: opening one closes the other.
      const on = id === which ? open : open ? false : d.btn.getAttribute('aria-expanded') === 'true';
      d.btn.setAttribute('aria-expanded', String(on));
      dock.classList.toggle(d.cls, on);
    }
  }
  const onDrawerClick = (e: MouseEvent) => {
    const btn = (e.target as Element).closest('button');
    const which = btn === numbersBtn ? 'numbers' : btn === graphBtn ? 'graph' : null;
    if (which) setDrawer(which, btn!.getAttribute('aria-expanded') !== 'true');
  };
  drawerBtns.addEventListener('click', onDrawerClick);
  // Escape closes an open drawer (it floats over the car on compact screens).
  const onDockKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !dock.matches('.is-numbers-open, .is-graph-open') || !compactMq.matches) return;
    const open = numbersBtn.getAttribute('aria-expanded') === 'true' ? numbersBtn : graphBtn;
    setDrawer(open === numbersBtn ? 'numbers' : 'graph', false);
    if (dock.contains(document.activeElement)) open.focus();
    e.preventDefault();
  };
  dock.addEventListener('keydown', onDockKey);

  const onPlay = () => handlers.onPlayToggle();
  function syncSoundButton() {
    const label = soundMuted ? 'Unmute car sound' : 'Mute car sound';
    sound.btn.setAttribute('aria-label', label);
    sound.btn.setAttribute('aria-pressed', String(!soundMuted));
    sound.tipLabel.textContent = label;
    sound.btn.querySelector('svg')?.replaceWith(icon(soundMuted ? 'volumeMuted' : 'volume'));
  }
  const onSoundToggle = () => {
    soundMuted = !soundMuted;
    syncSoundButton();
    handlers.onSoundToggle(soundMuted);
  };
  const onReset = () => handlers.onResetView();
  const onThemeToggle = () => {
    theme = theme === 'light' ? 'dark' : 'light';
    setTheme(theme);
    const label = `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`;
    themeButton.btn.setAttribute('aria-label', label);
    themeButton.tipLabel.textContent = label;
    themeButton.btn.querySelector('svg')?.replaceWith(icon(theme === 'light' ? 'moon' : 'sun'));
    handlers.onThemeChange(theme);
  };
  const onInfo = () => about.open(active);
  themeButton.btn.addEventListener('click', onThemeToggle);
  sound.btn.addEventListener('click', onSoundToggle);
  play.btn.addEventListener('click', onPlay);
  reset.btn.addEventListener('click', onReset);
  info.btn.addEventListener('click', onInfo);

  const KEY_TOGGLES: Record<string, ToggleId> = { a: 'airflow', e: 'exploded', c: 'ceiling', x: 'xray', s: 'clipping', w: 'brakes' };
  function flipMode() {
    const next: AeroMode = modeSwitch.mode === 'corner' ? 'straight' : 'corner';
    modeSwitch.setMode(next);
    handlers.onAeroMode(next);
  }
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || about.isOpen) return;
    const target = e.target instanceof Element ? e.target : null;
    // Never steal keys from text entry; the range input keeps its own arrows/Home/End.
    if (target?.closest('textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type="range"])')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === ' ') {
      // Space activates a focused button or control natively; only claim it elsewhere.
      if (target?.closest('button, input, a, dialog, summary')) return;
      e.preventDefault();
      if (!e.repeat) handlers.onPlayToggle();
      return;
    }
    if (e.repeat) return;
    const stationByKey = opts.stations[Number(key) - 1];
    if (/^[1-9]$/.test(key) && stationByKey) pickStation(stationByKey.meta.id);
    else if (key in KEY_TOGGLES && toggleShown(KEY_TOGGLES[key])) flipToggle(KEY_TOGGLES[key]);
    else if (key === 'm' && active === 'activeAero') flipMode();
    else if (key === 'l') livery.cycle();
    else if (key === 'r') handlers.onResetView();
    else if (key === '?' || key === 'h') about.open(active);
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  // ── layout reporting ──────────────────────────────────────────────────────────
  const layoutCbs = new Set<() => void>();
  let layoutFrame = 0;
  function notifyLayout() {
    // Several observed boxes usually change together; report once per frame.
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      for (const cb of layoutCbs) cb();
    });
  }
  // Compact drawers float above the caption (or beside the side panel): they need the caption's
  // height to clear it, and the room left below the header so they never cover it.
  function syncDrawerRoom() {
    const topBar = Math.max(header.getBoundingClientRect().bottom, toolbar.getBoundingClientRect().bottom);
    const room = sideMq.matches ? dock.getBoundingClientRect().bottom - topBar - 10 : bottom.getBoundingClientRect().top - topBar - 8;
    bottom.style.setProperty('--cap-h', `${caption.el.offsetHeight}px`);
    bottom.style.setProperty('--drawer-max', `${Math.max(120, Math.round(room))}px`);
  }
  layoutCbs.add(syncDrawerRoom);
  const ro = new ResizeObserver(notifyLayout);
  for (const el of [document.documentElement, header, dock, caption.el]) ro.observe(el);
  for (const mq of [sheetMq, sideMq, compactMq]) mq.addEventListener('change', notifyLayout);

  /**
   * The screen area the panels leave free. Drawers are not counted: they float over the car on
   * demand and close again, and re-framing the car every time one opens would make it jump.
   */
  function getInsets(): Insets {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const headerBottom = Math.round(header.getBoundingClientRect().bottom);
    // The UI root sits inside the safe area (tokens.css): a phone's notch in landscape is not free room.
    const safe = root.getBoundingClientRect();
    const safeLeft = Math.max(0, Math.round(safe.left));
    const safeRight = Math.max(0, Math.round(vw - safe.right));
    if (sideMq.matches) {
      // Panel on the right, header top-left: centre the car in the column left of the panel.
      return {
        top: headerBottom,
        right: Math.max(safeRight, Math.round(vw - bottom.getBoundingClientRect().left + INSET_MARGIN)),
        bottom: 0,
        left: safeLeft,
      };
    }
    // On sheet layouts the caption sits over the scene (or heads the sheet); keep the car clear of it.
    const sheet = sheetMq.matches;
    const top = sheet ? Math.min(caption.el.getBoundingClientRect().top, dock.getBoundingClientRect().top) : dock.getBoundingClientRect().top;
    return {
      top: sheet ? headerBottom : 0,
      right: safeRight,
      bottom: Math.max(0, Math.round(vh - top + INSET_MARGIN)),
      left: safeLeft,
    };
  }

  function setPlaying(on: boolean) {
    playing = on;
    lap.setPlaying(on);
    syncPlayLabel();
  }

  /** The toolbar's play button names what it does on this station. */
  function playAction(): BrakeAction {
    if (control === 'brake') return brakeAction(brakeState, playing);
    return { label: `${playing ? 'Pause' : 'Play'} ${PLAY_NOUN[control]}`, icon: playing ? 'pause' : 'play' };
  }
  let shownIcon: IconName | null = null;
  function syncPlayLabel() {
    const action = playAction();
    if (play.btn.getAttribute('aria-label') !== action.label) {
      play.btn.setAttribute('aria-label', action.label);
      play.tipLabel.textContent = action.label;
    }
    if (shownIcon !== action.icon) {
      shownIcon = action.icon;
      play.btn.querySelector('svg')?.replaceWith(icon(action.icon));
    }
  }

  /** The porpoising marker only exists for set-ups that porpoise (aeromap.css hides it otherwise). */
  let onsetShown: boolean | null = null;
  function setOnsetShown(on: boolean) {
    if (on === onsetShown) return;
    onsetShown = on;
    dock.dataset.onset = on ? 'yes' : 'none';
  }

  setStation(opts.initialStation);

  return {
    setStation,
    render(sv) {
      if (sv.station !== active) return;
      if (sv.station === 'downforce') {
        const v = sv.view;
        speed.render(v.speedKmh);
        markers[0]?.set(v.ceilingSpeedKmh, `Ceiling ${fmtKmhAtLeast(v.ceilingSpeedKmh)}`);
        s1.read.render(v);
        s1.chart.render(v.speedKmh, v.downforceN, v.dragN);
        caption.render(v.caption);
        caption.renderCeiling(v);
      } else if (sv.station === 'energy') {
        const v = sv.view;
        // The view carries the play state too; keep both play buttons in step with it.
        if (v.playing !== playing) setPlaying(v.playing);
        lap.render(v);
        s3.read.render(v);
        s3.chart.render(v);
        caption.render(v.caption);
      } else if (sv.station === 'braking') {
        const v = sv.view;
        if (v.playing !== playing || v.state !== brakeState) {
          brakeState = v.state;
          setPlaying(v.playing);
        }
        speed.render(v.zone.fromKmh);
        brake.render(v);
        s4.read.render(v);
        s4.chart.render(v);
        caption.render(v.caption);
      } else if (sv.station === 'activeAero') {
        const v = sv.view;
        speed.render(v.speedKmh);
        markers[0]?.set(v.topSpeedCornerKmh, `Top · Corner ${fmtKmh(v.topSpeedCornerKmh)}`);
        markers[1]?.set(v.topSpeedStraightKmh, `Top · Straight ${fmtKmh(v.topSpeedStraightKmh)}`);
        modeSwitch.render(v.straightT);
        s2.read.render(v);
        s2.chart.render(v.speedKmh, v.mode, v.availablePowerW, v.requiredPowerW);
        caption.render(v.caption);
      } else if (sv.station === 'aeroMap') {
        const v = sv.view;
        speed.render(v.speedKmh);
        const onset = v.bounce.onsetKmh;
        // The porpoising window: a short band on the scale from where it starts to where it stops again.
        markers[0]?.set(onset ?? opts.maxKmh, onset === null ? '' : `Porpoising ${fmtKmh(onset)}–${fmtKmh(v.bounce.untilKmh ?? opts.maxKmh)}`);
        markers[1]?.set(v.bounce.untilKmh ?? opts.maxKmh, '');
        setOnsetShown(onset !== null);
        ride.render(v);
        s6.read.render(v);
        s6.chart.render(v);
        caption.render(v.caption);
      } else {
        const v: Station5View = sv.view;
        speed.render(v.speedKmh);
        tow.render(v);
        caption.render(v.caption);
      }
    },
    setSpeedControl: speed.setValue,
    setToggle,
    setToggleAvailable,
    setAeroMode: modeSwitch.setMode,
    setPlaying,
    getInsets,
    onLayoutChange(cb) {
      layoutCbs.add(cb);
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      toggleRow.removeEventListener('click', onToggleClick);
      drawerBtns.removeEventListener('click', onDrawerClick);
      dock.removeEventListener('keydown', onDockKey);
      for (const mq of [sheetMq, sideMq, compactMq]) mq.removeEventListener('change', notifyLayout);
      play.btn.removeEventListener('click', onPlay);
      sound.btn.removeEventListener('click', onSoundToggle);
      themeButton.btn.removeEventListener('click', onThemeToggle);
      reset.btn.removeEventListener('click', onReset);
      info.btn.removeEventListener('click', onInfo);
      ro.disconnect();
      cancelAnimationFrame(layoutFrame);
      layoutCbs.clear();
      tabs.dispose();
      speed.dispose();
      lap.dispose();
      brake.dispose();
      tow.dispose();
      ride.dispose();
      s6.read.dispose();
      s6.chart.dispose();
      s3.chart.dispose();
      modeSwitch.dispose();
      livery.dispose();
      s1.chart.dispose();
      s2.chart.dispose();
      s4.chart.dispose();
      about.dispose();
      header.remove();
      toolbar.remove();
      bottom.remove();
      about.el.remove();
    },
  };
}
