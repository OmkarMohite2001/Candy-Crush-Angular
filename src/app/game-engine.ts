// @ts-nocheck
import { animate, stagger } from "animejs";

const ROWS = 8;
const COLS = 8;
const CANDY_COLORS = 6;
const START_MOVES = 15;
const LEVEL_TARGET_BASE = 1200;
const LEVEL_TARGET_STEP = 450;
const STATE_STORAGE_KEY_BASE = "candy-crush-state-v3";
const PROGRESS_STORAGE_KEY_BASE = "candy-crush-progress-v3";
const STATE_STORAGE_VERSION = 2;

const ANIMATION_MS = {
  SWAP: 186,
  INVALID_SWAP: 176,
  CRUSH: 242,
  DROP: 266,
};

const SPECIAL = {
  STRIPED_H: "striped-h",
  STRIPED_V: "striped-v",
  WRAPPED: "wrapped",
  BOMB: "bomb",
};

let boardEl = null;
let boardWrapEl = null;
let scoreEl = null;
let movesEl = null;
let levelEl = null;
let meterFillEl = null;
let meterValueEl = null;
let statusEl = null;
let announcerEl = null;
let initialized = false;

let board = [];
let score = 0;
let moves = START_MOVES;
let currentLevel = 1;
let highestUnlockedLevel = 1;
let selectedCell = null;
let crushingKeys = new Set();
let shockKeys = new Set();
let createdSpecialKeys = new Set();
let dropDistances = new Map();
let slideOffsets = new Map();
let busy = false;
let shouldAnimateIntro = false;
let announcerToken = 0;
let storageScope = "default";
let forcedInitialLevel = 1;
let lockToSingleLevel = false;
let levelReadyTemplate = "Level {level} ready. Reach {target} points!";

export type EngineElements = {
  boardEl: HTMLElement;
  scoreEl: HTMLElement;
  movesEl: HTMLElement;
  levelEl: HTMLElement;
  meterFillEl: HTMLElement;
  meterValueEl: HTMLElement;
  statusEl: HTMLElement;
  announcerEl?: HTMLElement | null;
};

export type EngineConfig = {
  storageScope?: string;
  initialLevel?: number;
  lockToLevel?: boolean;
  levelReadyTemplate?: string;
};

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.musicBus = null;
    this.musicTone = null;
    this.musicDuck = null;
    this.musicLoopTimer = null;
    this.musicStep = 0;
    this.fxSend = null;
    this.delay = null;
    this.delayFeedback = null;
    this.delayTone = null;
    this.lastVoiceAt = 0;
    this.preferredVoice = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return null;
      }
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;
      this.master.gain.value = 0.92;

      this.fxSend = this.ctx.createGain();
      this.fxSend.gain.value = 0.36;
      this.delay = this.ctx.createDelay(0.35);
      this.delay.delayTime.value = 0.16;
      this.delayFeedback = this.ctx.createGain();
      this.delayFeedback.gain.value = 0.24;
      this.delayTone = this.ctx.createBiquadFilter();
      this.delayTone.type = "lowpass";
      this.delayTone.frequency.value = 2600;
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.23;
      this.musicTone = this.ctx.createBiquadFilter();
      this.musicTone.type = "lowpass";
      this.musicTone.frequency.value = 2250;
      this.musicTone.Q.value = 0.8;
      this.musicDuck = this.ctx.createGain();
      this.musicDuck.gain.value = 1;

      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicBus.connect(this.musicTone);
      this.musicTone.connect(this.musicDuck);
      this.musicDuck.connect(this.compressor);

      this.master.connect(this.fxSend);
      this.fxSend.connect(this.delay);
      this.delay.connect(this.delayFeedback);
      this.delayFeedback.connect(this.delay);
      this.delay.connect(this.delayTone);
      this.delayTone.connect(this.compressor);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  triggerMusicDuck(amount = 0.62, returnIn = 0.2) {
    const ctx = this.ensureContext();
    if (!ctx || !this.musicDuck) {
      return;
    }
    const now = ctx.currentTime;
    const floor = Math.max(0.4, Math.min(0.85, amount));
    this.musicDuck.gain.cancelScheduledValues(now);
    this.musicDuck.gain.setValueAtTime(this.musicDuck.gain.value, now);
    this.musicDuck.gain.linearRampToValueAtTime(floor, now + 0.015);
    this.musicDuck.gain.exponentialRampToValueAtTime(1, now + returnIn);
  }

  playMusicNote({
    from = 220,
    to = from,
    duration = 0.2,
    volume = 0.04,
    type = "sine",
    pan = 0,
    delay = 0,
    attack = 0.02,
  } = {}) {
    const ctx = this.ensureContext();
    if (!ctx || !this.musicBus) {
      return;
    }
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const shimmer = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.linearRampToValueAtTime(to, start + duration);

    shimmer.type = "triangle";
    shimmer.frequency.setValueAtTime(from * 1.995, start);
    shimmer.frequency.linearRampToValueAtTime(to * 1.995, start + duration);

    panner.pan.value = pan;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    shimmer.connect(gain);
    gain.connect(panner);
    panner.connect(this.musicBus);
    osc.start(start);
    shimmer.start(start);
    osc.stop(start + duration + 0.04);
    shimmer.stop(start + duration + 0.04);
  }

  playMusicBar() {
    const roots = [196, 220, 247, 220];
    const root = roots[this.musicStep % roots.length];
    const barStart = 0.02;

    this.playMusicNote({
      from: root * 0.5,
      to: root * 0.48,
      duration: 0.72,
      volume: 0.048,
      type: "triangle",
      delay: barStart,
      pan: -0.08,
      attack: 0.03,
    });
    this.playMusicNote({
      from: root * 0.75,
      to: root * 0.74,
      duration: 0.68,
      volume: 0.03,
      type: "sine",
      delay: barStart + 0.02,
      pan: 0.1,
      attack: 0.04,
    });

    const melody = [0, 4, 7, 11];
    for (let i = 0; i < melody.length; i += 1) {
      this.playMusicNote({
        from: this.noteHz(melody[i], root),
        to: this.noteHz(melody[i] - 1, root),
        duration: 0.16,
        volume: 0.022,
        type: "triangle",
        delay: barStart + i * 0.18,
        pan: i % 2 === 0 ? -0.16 : 0.16,
        attack: 0.01,
      });
    }

    this.musicStep += 1;
  }

  startBackgroundMusic() {
    const ctx = this.ensureContext();
    if (!ctx || this.musicLoopTimer) {
      return;
    }
    const barMs = 720;
    this.playMusicBar();
    this.musicLoopTimer = window.setInterval(() => {
      this.playMusicBar();
    }, barMs);
  }

  stopBackgroundMusic() {
    if (this.musicLoopTimer) {
      window.clearInterval(this.musicLoopTimer);
      this.musicLoopTimer = null;
    }
  }

  dispose() {
    this.stopBackgroundMusic();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (this.ctx) {
      void this.ctx.close();
    }
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.musicBus = null;
    this.musicTone = null;
    this.musicDuck = null;
    this.fxSend = null;
    this.delay = null;
    this.delayFeedback = null;
    this.delayTone = null;
    this.preferredVoice = null;
    this.musicStep = 0;
  }

  unlock() {
    this.ensureContext();
    this.resolveVoice();
    this.startBackgroundMusic();
  }

  resolveVoice() {
    if (!("speechSynthesis" in window)) {
      return null;
    }
    if (this.preferredVoice) {
      return this.preferredVoice;
    }
    const voices = window.speechSynthesis.getVoices?.() || [];
    const preferred =
      voices.find((v) => /en-us/i.test(v.lang) && /female|zira|samantha|aria|alloy|victoria/i.test(v.name)) ||
      voices.find((v) => /en/i.test(v.lang)) ||
      null;
    this.preferredVoice = preferred;
    return preferred;
  }

  playTone({
    from = 440,
    to = from,
    duration = 0.12,
    volume = 0.054,
    type = "sine",
    delay = 0,
    pan = 0,
    fx = 0.18,
    attack = 0.014,
    vibrato = 0,
  } = {}) {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) {
      return;
    }

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.linearRampToValueAtTime(to, start + duration);
    if (vibrato > 0) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = "sine";
      lfo.frequency.value = 8;
      lfoGain.gain.value = vibrato;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + duration + 0.04);
    }
    panner.pan.value = pan;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    const send = ctx.createGain();
    send.gain.value = Math.max(0, Math.min(0.7, fx));

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(send);
    send.connect(this.fxSend);
    panner.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  playNoise({
    duration = 0.1,
    volume = 0.026,
    delay = 0,
    highpass = 800,
    lowpass = 14000,
    bandpass = null,
    pan = 0,
    fx = 0.08,
  } = {}) {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) {
      return;
    }

    const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.7;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpass;

    const topFilter = ctx.createBiquadFilter();
    topFilter.type = "lowpass";
    topFilter.frequency.value = lowpass;

    const midFilter = ctx.createBiquadFilter();
    midFilter.type = "bandpass";
    midFilter.frequency.value = bandpass || 1200;
    midFilter.Q.value = bandpass ? 0.6 : 0.2;

    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const send = ctx.createGain();
    const start = ctx.currentTime + delay;
    panner.pan.value = pan;
    send.gain.value = fx;

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter);
    filter.connect(topFilter);
    topFilter.connect(midFilter);
    midFilter.connect(gain);
    gain.connect(panner);
    panner.connect(send);
    send.connect(this.fxSend);
    panner.connect(this.master);
    src.start(start);
    src.stop(start + duration + 0.03);
  }

  noteHz(semitones, root = 440) {
    return root * 2 ** (semitones / 12);
  }

  playCandyPluck({
    semitone = 0,
    root = 392,
    delay = 0,
    volume = 0.03,
    pan = 0,
    fx = 0.2,
  } = {}) {
    const base = this.noteHz(semitone, root);
    this.playTone({
      from: base,
      to: base * 0.96,
      duration: 0.085,
      volume,
      type: "triangle",
      delay,
      pan,
      fx,
      attack: 0.008,
      vibrato: 3.2,
    });
    this.playTone({
      from: base * 2,
      to: base * 1.74,
      duration: 0.065,
      volume: volume * 0.46,
      type: "sine",
      delay: delay + 0.006,
      pan,
      fx: fx * 0.7,
      attack: 0.006,
    });
  }

  slide() {
    this.triggerMusicDuck(0.74, 0.12);
    this.playNoise({
      duration: 0.07,
      volume: 0.01,
      highpass: 900,
      lowpass: 4500,
      bandpass: 1600,
      pan: (Math.random() - 0.5) * 0.4,
      fx: 0.12,
    });
    this.playCandyPluck({ semitone: 3, root: 430, volume: 0.031, pan: -0.16, fx: 0.18 });
    this.playCandyPluck({ semitone: 6, root: 430, volume: 0.024, delay: 0.024, pan: 0.16, fx: 0.2 });
  }

  crush(power = 1, chain = 1) {
    this.triggerMusicDuck(0.6, 0.16);
    const strength = Math.min(2, 0.74 + power / 14);
    const chainBoost = 1 + Math.min(0.46, (chain - 1) * 0.1);
    const body = 0.02 * strength * chainBoost;
    const note = -4 + Math.min(10, chain * 2);

    this.playNoise({
      duration: 0.11,
      volume: body * 0.75,
      highpass: 720,
      lowpass: 3600,
      bandpass: 1400,
      pan: (Math.random() - 0.5) * 0.4,
      fx: 0.1,
    });
    this.playTone({
      from: this.noteHz(note, 220),
      to: this.noteHz(note - 10, 220),
      duration: 0.12,
      volume: body * 1.6,
      type: "triangle",
      pan: (Math.random() - 0.5) * 0.3,
      fx: 0.14,
      vibrato: 2.6,
    });
    this.playCandyPluck({
      semitone: note + 7,
      root: 350,
      delay: 0.018,
      volume: 0.018 * chainBoost,
      pan: (Math.random() - 0.5) * 0.55,
      fx: 0.24,
    });

    if (power >= 8) {
      this.playTone({
        from: this.noteHz(-18, 220),
        to: this.noteHz(-23, 220),
        duration: 0.15,
        volume: 0.028,
        type: "sawtooth",
        fx: 0.06,
      });
    }
  }

  combo(chain) {
    if (chain <= 1) {
      return;
    }
    const steps = Math.min(4, 1 + Math.floor(chain / 2));
    const intervals = [0, 4, 7, 12, 16];
    const root = 490 + Math.min(chain, 6) * 18;
    for (let i = 0; i < steps; i += 1) {
      this.playCandyPluck({
        semitone: intervals[Math.min(intervals.length - 1, i + 1)],
        root,
        delay: i * 0.045,
        volume: 0.015 + i * 0.0035,
        pan: i % 2 === 0 ? -0.1 : 0.1,
        fx: 0.28,
      });
    }
  }

  comboImpact(reason) {
    this.triggerMusicDuck(0.52, 0.28);
    if (reason === "double-striped") {
      this.playNoise({ duration: 0.09, volume: 0.026, highpass: 1300, lowpass: 6000, bandpass: 2400, fx: 0.18 });
      this.playTone({ from: 900, to: 520, duration: 0.12, volume: 0.038, type: "square", fx: 0.22 });
      return;
    }
    if (reason === "double-bomb") {
      this.playTone({ from: 180, to: 80, duration: 0.24, volume: 0.094, type: "sawtooth", fx: 0.12 });
      this.playNoise({ duration: 0.24, volume: 0.08, highpass: 300, lowpass: 4200, bandpass: 900, fx: 0.2 });
      this.playCandyPluck({ semitone: 12, root: 500, delay: 0.08, volume: 0.026, fx: 0.36 });
      this.playTone({ from: 1280, to: 620, duration: 0.07, volume: 0.04, type: "square", delay: 0.045, fx: 0.26 });
      this.playNoise({ duration: 0.12, volume: 0.032, highpass: 2300, lowpass: 9200, bandpass: 4200, delay: 0.03, fx: 0.24 });
      return;
    }
    if (reason === "color-bomb-striped" || reason === "color-bomb-wrapped") {
      this.playTone({ from: 560, to: 980, duration: 0.1, volume: 0.05, type: "triangle", fx: 0.25 });
      this.playNoise({ duration: 0.1, volume: 0.028, highpass: 1600, lowpass: 7600, bandpass: 3000, fx: 0.2 });
    }
  }

  special(kind) {
    this.triggerMusicDuck(0.64, 0.2);
    if (kind === SPECIAL.BOMB) {
      this.playTone({ from: 300, to: 760, duration: 0.13, volume: 0.058, type: "square", fx: 0.2 });
      this.playTone({ from: 920, to: 560, duration: 0.14, volume: 0.04, type: "triangle", delay: 0.05, fx: 0.26 });
      this.playCandyPluck({ semitone: 14, root: 420, delay: 0.03, volume: 0.024, fx: 0.4 });
      this.playNoise({ duration: 0.09, volume: 0.022, highpass: 1800, lowpass: 8000, bandpass: 3300, delay: 0.02, fx: 0.22 });
      this.playTone({ from: 700, to: 1180, duration: 0.08, volume: 0.026, type: "sine", delay: 0.015, fx: 0.22 });
      return;
    }
    if (kind === SPECIAL.WRAPPED) {
      this.playTone({ from: 420, to: 620, duration: 0.11, volume: 0.033, type: "triangle", fx: 0.14 });
      this.playTone({ from: 620, to: 500, duration: 0.1, volume: 0.028, type: "sine", delay: 0.06, fx: 0.2 });
      this.playNoise({ duration: 0.06, volume: 0.011, highpass: 1000, lowpass: 5000, bandpass: 2200, delay: 0.01, fx: 0.1 });
      return;
    }
    this.playTone({ from: 520, to: 760, duration: 0.09, volume: 0.03, type: "square", fx: 0.15, pan: -0.1 });
    this.playTone({ from: 740, to: 960, duration: 0.07, volume: 0.024, type: "triangle", delay: 0.045, fx: 0.22, pan: 0.1 });
  }

  bomb() {
    this.triggerMusicDuck(0.46, 0.3);
    this.playTone({ from: 220, to: 70, duration: 0.24, volume: 0.092, type: "sawtooth", fx: 0.1 });
    this.playNoise({ duration: 0.22, volume: 0.078, highpass: 360, lowpass: 4300, bandpass: 980, fx: 0.18 });
    this.playCandyPluck({ semitone: 19, root: 480, delay: 0.075, volume: 0.026, fx: 0.42 });
    this.playTone({ from: 1480, to: 640, duration: 0.06, volume: 0.045, type: "square", delay: 0.018, fx: 0.3, pan: 0.08 });
    this.playNoise({ duration: 0.14, volume: 0.034, highpass: 2600, lowpass: 9000, bandpass: 4600, delay: 0.022, fx: 0.26 });
  }

  levelComplete() {
    this.triggerMusicDuck(0.44, 0.46);
    const notes = [0, 4, 7, 12, 16];
    for (let i = 0; i < notes.length; i += 1) {
      this.playCandyPluck({
        semitone: notes[i],
        root: 420,
        delay: i * 0.08,
        volume: 0.019 + i * 0.003,
        fx: 0.33,
        pan: i % 2 === 0 ? -0.08 : 0.08,
      });
    }
  }

  invalid() {
    this.triggerMusicDuck(0.7, 0.14);
    this.playTone({ from: 300, to: 180, duration: 0.1, volume: 0.028, type: "square", fx: 0.06 });
    this.playTone({ from: 210, to: 140, duration: 0.08, volume: 0.02, type: "triangle", delay: 0.015, fx: 0.04 });
  }

  speakCallout(text) {
    if (!text || !("speechSynthesis" in window)) {
      return;
    }
    const now = performance.now();
    if (now - this.lastVoiceAt < 1650) {
      return;
    }
    this.lastVoiceAt = now;

    const voice = this.resolveVoice();
    const utterance = new SpeechSynthesisUtterance(text.replace(/!/g, ""));
    utterance.lang = voice?.lang || "en-US";
    utterance.voice = voice || null;
    utterance.rate = 0.95;
    utterance.pitch = /sugar crush/i.test(text) ? 1.03 : 1.14;
    utterance.volume = 0.86;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    this.playCandyPluck({
      semitone: /sugar crush/i.test(text) ? 12 : 7,
      root: 480,
      volume: 0.016,
      fx: 0.3,
    });
  }
}

const sound = new SoundEngine();

function getStateStorageKey() {
  return `${STATE_STORAGE_KEY_BASE}-${storageScope}`;
}

function getProgressStorageKey() {
  return `${PROGRESS_STORAGE_KEY_BASE}-${storageScope}`;
}

function formatReadyMessage(level, target) {
  return levelReadyTemplate
    .replaceAll("{level}", String(level))
    .replaceAll("{target}", String(target));
}

export function initializeGameEngine(elements: EngineElements, config: EngineConfig = {}) {
  storageScope =
    typeof config.storageScope === "string" && config.storageScope.trim()
      ? config.storageScope.trim().toLowerCase().replace(/\s+/g, "-")
      : "default";
  forcedInitialLevel = Number.isFinite(config.initialLevel)
    ? Math.max(1, Math.floor(config.initialLevel))
    : 1;
  lockToSingleLevel = Boolean(config.lockToLevel);
  levelReadyTemplate =
    typeof config.levelReadyTemplate === "string" && config.levelReadyTemplate.trim()
      ? config.levelReadyTemplate.trim()
      : "Level {level} ready. Reach {target} points!";

  boardEl = elements.boardEl;
  boardWrapEl = boardEl?.closest(".board-wrap") || null;
  scoreEl = elements.scoreEl;
  movesEl = elements.movesEl;
  levelEl = elements.levelEl;
  meterFillEl = elements.meterFillEl;
  meterValueEl = elements.meterValueEl;
  statusEl = elements.statusEl;
  announcerEl = elements.announcerEl || null;

  if (!boardEl || !scoreEl || !movesEl || !levelEl || !meterFillEl || !meterValueEl || !statusEl) {
    throw new Error("Game elements are not wired correctly.");
  }

  const loadedProgress = lockToSingleLevel ? null : loadProgress();
  if (loadedProgress) {
    currentLevel = Math.max(forcedInitialLevel, loadedProgress.currentLevel || forcedInitialLevel);
    highestUnlockedLevel = Math.max(currentLevel, loadedProgress.highestUnlockedLevel || 1);
  } else {
    currentLevel = forcedInitialLevel;
    highestUnlockedLevel = forcedInitialLevel;
  }

  if (!restoreSavedState()) {
    resetGame(false);
  } else {
    updateStats();
    renderBoard();
    const target = getTargetScore(currentLevel);
    setStatus(`Level ${currentLevel} resumed. Target score: ${target}.`, "strong");
  }

  initialized = true;
}

export function destroyGameEngine() {
  initialized = false;
  boardEl = null;
  boardWrapEl = null;
  scoreEl = null;
  movesEl = null;
  levelEl = null;
  meterFillEl = null;
  meterValueEl = null;
  statusEl = null;
  announcerEl = null;
  announcerToken += 1;
  busy = false;
  selectedCell = null;
  crushingKeys = new Set();
  shockKeys = new Set();
  createdSpecialKeys = new Set();
  dropDistances = new Map();
  slideOffsets = new Map();
  sound.dispose();
}

export function onBoardClickEngine(event) {
  if (!initialized) {
    return;
  }
  void onBoardClick(event);
}

export function onNewGameEngine() {
  if (!initialized) {
    return;
  }
  sound.unlock();
  sound.slide();
  resetGame(false);
}

function getTargetScore(level) {
  return LEVEL_TARGET_BASE + (Math.max(1, level) - 1) * LEVEL_TARGET_STEP;
}

function getMovesForLevel(level) {
  const bonus = Math.min(6, Math.floor((Math.max(1, level) - 1) / 2));
  return START_MOVES + bonus;
}

function saveProgress(bestScore = null) {
  if (lockToSingleLevel) {
    return;
  }
  const payload = {
    currentLevel,
    highestUnlockedLevel,
    bestScore: bestScore ?? score,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(getProgressStorageKey(), JSON.stringify(payload));
  } catch {
    // no-op: storage can be blocked in private mode
  }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(getProgressStorageKey());
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!Number.isFinite(parsed.currentLevel) || !Number.isFinite(parsed.highestUnlockedLevel)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(getStateStorageKey());
  } catch {
    // no-op
  }
}

function snapshotBoardState() {
  return board.map((row) =>
    row.map((cell) => (cell ? { color: cell.color, special: cell.special || null } : null)),
  );
}

function saveState() {
  const payload = {
    version: STATE_STORAGE_VERSION,
    board: snapshotBoardState(),
    score,
    moves,
    currentLevel,
    highestUnlockedLevel,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(getStateStorageKey(), JSON.stringify(payload));
  } catch {
    // no-op
  }
}

function isValidCellShape(cell) {
  if (!cell || typeof cell !== "object") {
    return false;
  }
  if (!Number.isInteger(cell.color) || cell.color < 0 || cell.color >= CANDY_COLORS) {
    return false;
  }
  if (cell.special === null || cell.special === undefined) {
    return true;
  }
  return Object.values(SPECIAL).includes(cell.special);
}

function restoreSavedState() {
  try {
    const raw = localStorage.getItem(getStateStorageKey());
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STATE_STORAGE_VERSION) {
      return false;
    }
    if (!Array.isArray(parsed.board) || parsed.board.length !== ROWS) {
      return false;
    }
    const restoredBoard = parsed.board.map((row) => {
      if (!Array.isArray(row) || row.length !== COLS) {
        return null;
      }
      const mapped = [];
      for (const cell of row) {
        if (!isValidCellShape(cell)) {
          return null;
        }
        mapped.push({ color: cell.color, special: cell.special || null });
      }
      return mapped;
    });
    if (restoredBoard.some((row) => row === null)) {
      return false;
    }

    board = restoredBoard;
    score = Number.isFinite(parsed.score) ? Math.max(0, Math.floor(parsed.score)) : 0;
    moves = Number.isFinite(parsed.moves) ? Math.max(0, Math.floor(parsed.moves)) : START_MOVES;
    currentLevel = Number.isFinite(parsed.currentLevel) ? Math.max(1, Math.floor(parsed.currentLevel)) : 1;
    highestUnlockedLevel = Number.isFinite(parsed.highestUnlockedLevel)
      ? Math.max(currentLevel, Math.floor(parsed.highestUnlockedLevel))
      : currentLevel;

    if (lockToSingleLevel && currentLevel !== forcedInitialLevel) {
      return false;
    }
    if (lockToSingleLevel) {
      currentLevel = forcedInitialLevel;
      highestUnlockedLevel = forcedInitialLevel;
    }

    selectedCell = null;
    crushingKeys = new Set();
    shockKeys = new Set();
    createdSpecialKeys = new Set();
    dropDistances = new Map();
    slideOffsets = new Map();
    busy = false;
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyOf(row, col) {
  return `${row},${col}`;
}

function parseKey(key) {
  const [row, col] = key.split(",").map(Number);
  return { row, col };
}

function isInside(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function isAdjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function randomCandyColor() {
  return Math.floor(Math.random() * CANDY_COLORS);
}

function createCandy(color = randomCandyColor(), special = null) {
  return { color, special };
}

function setStatus(text, tone = "") {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = text;
  statusEl.className = "status";
  if (tone) {
    statusEl.classList.add(tone);
  }
}

function updateStats() {
  if (!scoreEl || !movesEl || !levelEl) {
    return;
  }
  scoreEl.textContent = String(score);
  movesEl.textContent = String(moves);
  levelEl.textContent = String(currentLevel);

  const levelMoves = getMovesForLevel(currentLevel);
  const ratio = Math.max(0, Math.min(1, moves / levelMoves));
  if (meterFillEl) {
    meterFillEl.style.width = `${ratio * 100}%`;
  }
  if (meterValueEl) {
    meterValueEl.textContent = `${moves}/${levelMoves}`;
  }
}

function reducedMotionEnabled() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animateCellEffects() {
  if (!boardEl || reducedMotionEnabled()) {
    return;
  }

  const slidingCandies = boardEl.querySelectorAll(".cell.sliding .candy");
  for (const candy of slidingCandies) {
    const cell = candy.closest(".cell");
    const slideX = Number(cell?.style.getPropertyValue("--slide-x") || 0);
    const slideY = Number(cell?.style.getPropertyValue("--slide-y") || 0);
    const bias = slideX !== 0 ? Math.sign(slideX) : Math.sign(slideY || 1);
    const startX = slideX * 102;
    const startY = slideY * 102;
    const arcLift = slideX !== 0 ? -24 : -12;
    animate(candy, {
      x: [`${startX}%`, `${startX * 0.34}%`, "0%"],
      y: [`${startY}%`, `${startY * 0.34 + arcLift}%`, "0%"],
      rotate: [`${bias * -13}deg`, "0deg"],
      scale: [0.94, 1.03, 1],
      duration: ANIMATION_MS.SWAP + 54,
      ease: "inOutSine",
    });
  }

  const crushingCandies = boardEl.querySelectorAll(".cell.crushing .candy");
  for (const candy of crushingCandies) {
    const spin = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 14);
    animate(candy, {
      scale: [1, 1.14, 0.2],
      rotate: ["0deg", `${spin}deg`],
      opacity: [1, 1, 0],
      duration: ANIMATION_MS.CRUSH + 10,
      ease: "outExpo",
    });
  }

  const shockCandies = boardEl.querySelectorAll(".cell.shock .candy");
  for (const candy of shockCandies) {
    animate(candy, {
      scale: [1, 1.15, 0.94, 1.02, 1],
      rotate: ["0deg", "-5deg", "4deg", "-1deg", "0deg"],
      duration: ANIMATION_MS.CRUSH,
      ease: "inOutSine",
    });
  }

  const fallingCandies = boardEl.querySelectorAll(".cell.falling .candy");
  for (const candy of fallingCandies) {
    const cell = candy.closest(".cell");
    const drop = Number((cell?.style.getPropertyValue("--drop") || "0").replace("%", ""));
    const dropPx = Math.max(22, drop * 28);
    const tilt = (Math.random() > 0.5 ? 1 : -1) * Math.min(14, 2 + drop * 1.2);
    animate(candy, {
      y: [`-${dropPx}px`, "5px", "0px"],
      scale: [0.86, 1.03, 1],
      rotate: [`${tilt}deg`, "0deg"],
      duration: ANIMATION_MS.DROP + Math.min(140, drop * 16),
      ease: "outCubic",
    });
  }

  const createdSpecialCandies = boardEl.querySelectorAll(".cell.special-created .candy");
  for (const candy of createdSpecialCandies) {
    const rotate = (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 10);
    animate(candy, {
      scale: [0.58, 1.12, 0.97, 1.02, 1],
      rotate: [`${rotate}deg`, "0deg"],
      opacity: [0.25, 1],
      duration: 560,
      ease: "outBack(2.2)",
    });
  }
}

function animateBoardIntroIfNeeded() {
  if (!boardEl || !shouldAnimateIntro || reducedMotionEnabled()) {
    return;
  }

  shouldAnimateIntro = false;
  const candies = boardEl.querySelectorAll(".candy");
  if (!candies.length) {
    return;
  }

  animate(candies, {
    opacity: [0, 1],
    y: ["-24%", "0%"],
    scale: [0.88, 1.02, 1],
    delay: stagger(18, { from: "center", grid: [ROWS, COLS] }),
    duration: 500,
    ease: "outCubic",
  });
}

function showVibeCallout(text, tone = "sweet") {
  if (!announcerEl || !text) {
    return;
  }

  sound.speakCallout(text);

  announcerToken += 1;
  const token = announcerToken;
  announcerEl.textContent = text;
  announcerEl.className = `vibe-announcer ${tone}`;

  if (reducedMotionEnabled()) {
    announcerEl.classList.add("visible");
    window.setTimeout(() => {
      if (announcerToken !== token) {
        return;
      }
      announcerEl.classList.remove("visible");
    }, 700);
    return;
  }

  animate(announcerEl, {
    opacity: [0, 1, 1, 0],
    scale: [0.55, 1.08, 1, 0.92],
    y: ["12%", "-8%", "-8%", "-25%"],
    duration: 980,
    ease: "outExpo",
    complete: () => {
      if (announcerToken !== token) {
        return;
      }
      announcerEl.className = "vibe-announcer";
      announcerEl.textContent = "";
    },
  });
}

function chainCallout(chain) {
  if (chain >= 5) {
    return { text: "Delicious!", tone: "delicious" };
  }
  if (chain >= 4) {
    return { text: "Divine!", tone: "divine" };
  }
  if (chain >= 3) {
    return { text: "Sweet!", tone: "sweet" };
  }
  return null;
}

function isBombComboReason(reason) {
  return (
    reason === "bomb" ||
    reason === "double-bomb" ||
    reason === "color-bomb-striped" ||
    reason === "color-bomb-wrapped"
  );
}

function getCellCenter(row, col) {
  if (!boardEl) {
    return null;
  }
  const cell = boardEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  if (!cell) {
    return null;
  }
  const rect = cell.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function buildBurstPointsFromResolution(resolution, a, b) {
  const points = [];
  const sourcePoints = [a, b];
  for (const pos of sourcePoints) {
    const center = getCellCenter(pos.row, pos.col);
    if (center) {
      points.push(center);
    }
  }

  let sampled = 0;
  for (const key of resolution.clearSet) {
    if (sampled >= 5) {
      break;
    }
    if (Math.random() > 0.45) {
      continue;
    }
    const pos = parseKey(key);
    const center = getCellCenter(pos.row, pos.col);
    if (center) {
      points.push(center);
      sampled += 1;
    }
  }

  if (!points.length && boardEl) {
    const rect = boardEl.getBoundingClientRect();
    points.push({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }

  return points;
}

function triggerScreenShake(intensity = 1) {
  if (!boardWrapEl || reducedMotionEnabled()) {
    return;
  }
  const amp = Math.max(4, Math.min(22, 8 + intensity * 7));
  animate(boardWrapEl, {
    keyframes: [
      { x: `${-amp}px`, y: `${amp * 0.15}px`, rotate: `${-0.8 * intensity}deg` },
      { x: `${amp * 0.95}px`, y: `${-amp * 0.28}px`, rotate: `${0.65 * intensity}deg` },
      { x: `${-amp * 0.7}px`, y: `${amp * 0.24}px`, rotate: `${-0.45 * intensity}deg` },
      { x: `${amp * 0.55}px`, y: `${-amp * 0.16}px`, rotate: `${0.25 * intensity}deg` },
      { x: `${-amp * 0.28}px`, y: `${amp * 0.1}px`, rotate: `${-0.12 * intensity}deg` },
      { x: "0px", y: "0px", rotate: "0deg" },
    ],
    duration: 340 + intensity * 80,
    ease: "outCirc",
  });
}

function triggerBoardFlash(intensity = 1) {
  if (!boardWrapEl || reducedMotionEnabled()) {
    return;
  }

  const flash = document.createElement("span");
  flash.className = "board-flash";
  boardWrapEl.append(flash);

  animate(flash, {
    opacity: [0, 0.8, 0],
    scale: [0.92, 1.03 + intensity * 0.04, 1.06 + intensity * 0.03],
    duration: 280 + intensity * 100,
    ease: "outQuad",
    complete: () => flash.remove(),
  });

  animate(boardWrapEl, {
    scale: [1, 1.01 + intensity * 0.02, 1],
    duration: 260 + intensity * 70,
    ease: "outQuad",
  });
}

function spawnSugarBurst(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const colors = ["#ff5f6d", "#ffd84f", "#5de18b", "#62c2ff", "#cf83ff", "#ffffff", "#ff9c4a"];
  const particleBase = Math.round(14 + intensity * 8);

  for (const origin of points) {
    const count = Math.min(42, particleBase + Math.round(Math.random() * 8));
    const burstNodes = [];

    for (let i = 0; i < count; i += 1) {
      const particle = document.createElement("span");
      particle.className = "sugar-particle";
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = 4 + Math.random() * 7;
      particle.style.left = `${origin.x}px`;
      particle.style.top = `${origin.y}px`;
      particle.style.width = `${size}px`;
      particle.style.height = `${size * (0.8 + Math.random() * 0.8)}px`;
      particle.style.setProperty("--sugar-color", color);
      document.body.append(particle);
      burstNodes.push(particle);
    }

    burstNodes.forEach((particle, index) => {
      const angle = (Math.PI * 2 * index) / burstNodes.length + Math.random() * 0.5;
      const radius = 22 + Math.random() * (52 + intensity * 24);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius - Math.random() * 26;
      const startRotate = Math.random() * 360;
      const endRotate =
        startRotate + (Math.random() > 0.5 ? 1 : -1) * (220 + Math.random() * 260);
      animate(particle, {
        x: [0, `${x}px`],
        y: [0, `${y}px`],
        rotate: [`${startRotate}deg`, `${endRotate}deg`],
        opacity: [1, 0.9, 0],
        scale: [0.55, 1.2, 0.14],
        duration: 380 + Math.random() * 260,
        ease: "outExpo",
        complete: () => particle.remove(),
      });
    });
  }
}

function spawnComboRipples(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const colors = ["#ffe07a", "#ffffff", "#9ddaff", "#ff97be"];
  for (const point of points) {
    const ring = document.createElement("span");
    ring.className = "combo-ripple";
    ring.style.left = `${point.x}px`;
    ring.style.top = `${point.y}px`;
    ring.style.setProperty("--ripple-color", colors[Math.floor(Math.random() * colors.length)]);
    document.body.append(ring);

    animate(ring, {
      scale: [0.16, 1.36 + intensity * 0.45],
      opacity: [0.92, 0],
      duration: 390 + Math.random() * 180,
      ease: "outQuad",
      complete: () => ring.remove(),
    });
  }
}

function spawnComboRays(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const colors = ["#fff2b3", "#ffffff", "#ffd16c", "#8ed1ff", "#ffa4cf"];
  for (const point of points) {
    const rayCount = Math.round(8 + intensity * 5);
    for (let i = 0; i < rayCount; i += 1) {
      const ray = document.createElement("span");
      ray.className = "combo-ray";
      ray.style.left = `${point.x}px`;
      ray.style.top = `${point.y}px`;
      ray.style.setProperty("--ray-color", colors[Math.floor(Math.random() * colors.length)]);
      document.body.append(ray);

      const angle = (Math.PI * 2 * i) / rayCount + Math.random() * 0.26;
      const drift = 44 + Math.random() * (54 + intensity * 28);
      const raySize = 16 + Math.random() * (32 + intensity * 20);
      const x = Math.cos(angle) * drift;
      const y = Math.sin(angle) * drift;
      const endScale = raySize / 24;
      const rotation = `${(angle * 180) / Math.PI}deg`;

      animate(ray, {
        x: [0, `${x}px`],
        y: [0, `${y}px`],
        rotate: [rotation, rotation],
        scaleX: [0.2, endScale, 0],
        opacity: [0, 0.95, 0],
        duration: 250 + Math.random() * 170,
        ease: "outExpo",
        complete: () => ray.remove(),
      });
    }
  }
}

function spawnBombHalo(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const tones = ["#ffe47b", "#ff7bb7", "#81c8ff", "#88ffbf", "#ffffff"];

  for (const point of points) {
    const halo = document.createElement("span");
    halo.className = "bomb-halo";
    halo.style.left = `${point.x}px`;
    halo.style.top = `${point.y}px`;
    halo.style.setProperty("--bomb-halo-color", tones[Math.floor(Math.random() * tones.length)]);
    document.body.append(halo);

    animate(halo, {
      scale: [0.2, 1.25 + intensity * 0.5],
      opacity: [0.95, 0],
      duration: 420 + Math.random() * 160,
      ease: "outExpo",
      complete: () => halo.remove(),
    });

    const core = document.createElement("span");
    core.className = "bomb-core";
    core.style.left = `${point.x}px`;
    core.style.top = `${point.y}px`;
    core.style.setProperty("--bomb-halo-color", tones[Math.floor(Math.random() * tones.length)]);
    document.body.append(core);

    animate(core, {
      scale: [0.38, 1.35, 0.16],
      opacity: [0.92, 0.8, 0],
      duration: 350 + Math.random() * 120,
      ease: "outQuad",
      complete: () => core.remove(),
    });
  }
}

function spawnBombStars(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const colors = ["#fff4bc", "#fff", "#ff95cb", "#8fd1ff", "#84ffbe", "#ffd777"];

  for (const point of points) {
    const count = Math.round(12 + intensity * 7);
    for (let i = 0; i < count; i += 1) {
      const star = document.createElement("span");
      star.className = "bomb-star";
      star.style.left = `${point.x}px`;
      star.style.top = `${point.y}px`;
      star.style.setProperty("--bomb-star-color", colors[Math.floor(Math.random() * colors.length)]);
      document.body.append(star);

      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const drift = 58 + Math.random() * (58 + intensity * 30);
      const x = Math.cos(angle) * drift;
      const y = Math.sin(angle) * drift;
      const rotate = `${(angle * 180) / Math.PI}deg`;

      animate(star, {
        x: [0, `${x}px`],
        y: [0, `${y}px`],
        rotate: [rotate, `${Number.parseFloat(rotate) + 55}deg`],
        scale: [0.25, 1.08, 0],
        opacity: [0, 0.95, 0],
        duration: 300 + Math.random() * 220,
        ease: "outExpo",
        complete: () => star.remove(),
      });
    }
  }
}

function spawnBombCharge(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const colors = ["#ffe883", "#ff9cd0", "#8fd3ff", "#9bffca"];
  for (const point of points) {
    const charge = document.createElement("span");
    charge.className = "bomb-charge";
    charge.style.left = `${point.x}px`;
    charge.style.top = `${point.y}px`;
    charge.style.setProperty("--bomb-charge-color", colors[Math.floor(Math.random() * colors.length)]);
    document.body.append(charge);

    animate(charge, {
      scale: [0.16, 0.5, 0.86, 0.2],
      opacity: [0, 0.7, 0.95, 0],
      duration: 280 + intensity * 90,
      ease: "outExpo",
      complete: () => charge.remove(),
    });
  }
}

function spawnBombShockwave(points, intensity = 1) {
  if (!points?.length || reducedMotionEnabled()) {
    return;
  }

  const colors = ["#fff0a6", "#ff9ecf", "#9fd9ff", "#ffffff"];
  for (const point of points) {
    const wave = document.createElement("span");
    wave.className = "bomb-shockwave";
    wave.style.left = `${point.x}px`;
    wave.style.top = `${point.y}px`;
    wave.style.setProperty("--bomb-shock-color", colors[Math.floor(Math.random() * colors.length)]);
    document.body.append(wave);

    animate(wave, {
      scale: [0.1, 1.36 + intensity * 0.64],
      opacity: [0.95, 0],
      duration: 460 + Math.random() * 180,
      ease: "outExpo",
      complete: () => wave.remove(),
    });
  }
}

function triggerBombComboVisuals(resolution, a, b) {
  if (!resolution || (!isBombComboReason(resolution.reason) && resolution.reason !== "double-striped")) {
    return;
  }
  let intensity = 1.05;
  if (resolution.reason === "double-bomb") {
    intensity = 1.75;
  } else if (resolution.reason === "color-bomb-striped" || resolution.reason === "color-bomb-wrapped") {
    intensity = 1.36;
  } else if (resolution.reason === "bomb") {
    intensity = 1.2;
  }
  const points = buildBurstPointsFromResolution(resolution, a, b);
  const bombReason = isBombComboReason(resolution.reason);
  if (bombReason) {
    spawnBombCharge(points, intensity * 0.95);
  }
  triggerScreenShake(intensity);
  triggerBoardFlash(intensity * 0.9);
  if (bombReason) {
    spawnBombShockwave(points, intensity);
  }
  spawnSugarBurst(points, bombReason ? intensity * 1.18 : intensity);
  spawnComboRipples(points, bombReason ? intensity * 1.14 : intensity);
  if (bombReason) {
    spawnBombHalo(points, intensity);
    spawnBombStars(points, intensity);
  }
  if (resolution.reason !== "bomb" || bombReason) {
    spawnComboRays(points, intensity * 1.1);
  }
}

function triggerCascadeBombVisuals(specialBlastOnly, chain = 1) {
  if (!specialBlastOnly?.size) {
    return;
  }
  let hasBomb = false;
  const points = [];

  for (const key of specialBlastOnly) {
    const { row, col } = parseKey(key);
    const cell = board[row]?.[col];
    if (cell?.special === SPECIAL.BOMB) {
      hasBomb = true;
    }
    if (points.length < 3 && Math.random() > 0.45) {
      const center = getCellCenter(row, col);
      if (center) {
        points.push(center);
      }
    }
  }

  if (!hasBomb) {
    return;
  }

  const intensity = Math.min(1.4, 0.8 + chain * 0.15);
  triggerScreenShake(intensity * 0.8);
  triggerBoardFlash(intensity * 0.72);
  spawnBombCharge(points, intensity * 0.65);
  spawnBombShockwave(points, intensity * 0.8);
  spawnSugarBurst(points, intensity);
  spawnComboRipples(points, intensity * 0.78);
  spawnBombHalo(points, intensity * 0.92);
  spawnBombStars(points, intensity * 0.82);
}

function reasonCallout(reason) {
  if (reason === "double-bomb") {
    return { text: "Sugar Crush!", tone: "sugar" };
  }
  if (reason === "color-bomb-striped" || reason === "color-bomb-wrapped") {
    return { text: "Divine!", tone: "divine" };
  }
  if (reason === "bomb") {
    return { text: "Delicious!", tone: "delicious" };
  }
  if (reason === "double-striped") {
    return { text: "Tasty!", tone: "tasty" };
  }
  return null;
}

function setSlideAnimation(a, b) {
  slideOffsets = new Map([
    [keyOf(a.row, a.col), { x: b.col - a.col, y: b.row - a.row }],
    [keyOf(b.row, b.col), { x: a.col - b.col, y: a.row - b.row }],
  ]);
}

function renderBoard() {
  if (!boardEl) {
    return;
  }
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = board[row][col];
      const key = keyOf(row, col);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", `row ${row + 1} column ${col + 1}`);

      if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
        button.classList.add("selected");
      }
      if (crushingKeys.has(key)) {
        button.classList.add("crushing");
      }
      if (shockKeys.has(key)) {
        button.classList.add("shock");
      }
      if (createdSpecialKeys.has(key)) {
        button.classList.add("special-created");
      }
      if (dropDistances.has(key)) {
        button.classList.add("falling");
        button.style.setProperty("--drop", `${dropDistances.get(key) * 100}%`);
      }
      if (slideOffsets.has(key)) {
        const offset = slideOffsets.get(key);
        button.classList.add("sliding");
        button.style.setProperty("--slide-x", String(offset.x));
        button.style.setProperty("--slide-y", String(offset.y));
      }

      const candy = document.createElement("div");
      candy.className = `candy color-${cell.color}`;
      if (cell.special) {
        candy.classList.add(`special-${cell.special}`);
      }
      candy.setAttribute("aria-hidden", "true");

      button.append(candy);
      fragment.append(button);
    }
  }

  boardEl.replaceChildren(fragment);
  animateCellEffects();
  animateBoardIntroIfNeeded();
  createdSpecialKeys = new Set();
}

function getMatchColor(cell) {
  if (!cell || cell.special === SPECIAL.BOMB) {
    return null;
  }
  return cell.color;
}

function hasImmediateMatchAt(row, col) {
  const color = getMatchColor(board[row][col]);
  if (color === null) {
    return false;
  }

  if (
    col >= 2 &&
    getMatchColor(board[row][col - 1]) === color &&
    getMatchColor(board[row][col - 2]) === color
  ) {
    return true;
  }

  if (
    row >= 2 &&
    getMatchColor(board[row - 1][col]) === color &&
    getMatchColor(board[row - 2][col]) === color
  ) {
    return true;
  }

  return false;
}

function buildFreshBoard() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      board[row][col] = createCandy();
      while (hasImmediateMatchAt(row, col)) {
        board[row][col] = createCandy();
      }
    }
  }
}

function swapPositions(a, b) {
  const temp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = temp;
}

function chooseSpawnKey(runKeys, lastSwap) {
  if (lastSwap) {
    const preferredB = keyOf(lastSwap.b.row, lastSwap.b.col);
    if (runKeys.includes(preferredB)) {
      return preferredB;
    }
    const preferredA = keyOf(lastSwap.a.row, lastSwap.a.col);
    if (runKeys.includes(preferredA)) {
      return preferredA;
    }
  }
  return runKeys[Math.floor((runKeys.length - 1) / 2)];
}

function addSpecialCreation(map, key, special, color) {
  const priority = (name) => {
    if (name === SPECIAL.BOMB) {
      return 3;
    }
    if (name === SPECIAL.WRAPPED) {
      return 2;
    }
    if (name === SPECIAL.STRIPED_H || name === SPECIAL.STRIPED_V) {
      return 1;
    }
    return 0;
  };

  const existing = map.get(key);
  if (!existing || priority(special) > priority(existing.special)) {
    map.set(key, { special, color });
  }
}

function findMatchInfo(lastSwap = null) {
  const clearSet = new Set();
  const specialCreates = new Map();
  const horizontalMatched = new Set();
  const verticalMatched = new Set();

  for (let row = 0; row < ROWS; row += 1) {
    let col = 0;
    while (col < COLS) {
      const color = getMatchColor(board[row][col]);
      if (color === null) {
        col += 1;
        continue;
      }

      let runEnd = col + 1;
      while (runEnd < COLS && getMatchColor(board[row][runEnd]) === color) {
        runEnd += 1;
      }

      const runLength = runEnd - col;
      if (runLength >= 3) {
        const runKeys = [];
        for (let k = col; k < runEnd; k += 1) {
          const key = keyOf(row, k);
          clearSet.add(key);
          horizontalMatched.add(key);
          runKeys.push(key);
        }
        if (runLength >= 4) {
          const spawnKey = chooseSpawnKey(runKeys, lastSwap);
          const special = runLength >= 5 ? SPECIAL.BOMB : SPECIAL.STRIPED_V;
          addSpecialCreation(specialCreates, spawnKey, special, color);
        }
      }

      col = runEnd;
    }
  }

  for (let col = 0; col < COLS; col += 1) {
    let row = 0;
    while (row < ROWS) {
      const color = getMatchColor(board[row][col]);
      if (color === null) {
        row += 1;
        continue;
      }

      let runEnd = row + 1;
      while (runEnd < ROWS && getMatchColor(board[runEnd][col]) === color) {
        runEnd += 1;
      }

      const runLength = runEnd - row;
      if (runLength >= 3) {
        const runKeys = [];
        for (let k = row; k < runEnd; k += 1) {
          const key = keyOf(k, col);
          clearSet.add(key);
          verticalMatched.add(key);
          runKeys.push(key);
        }
        if (runLength >= 4) {
          const spawnKey = chooseSpawnKey(runKeys, lastSwap);
          const special = runLength >= 5 ? SPECIAL.BOMB : SPECIAL.STRIPED_H;
          addSpecialCreation(specialCreates, spawnKey, special, color);
        }
      }

      row = runEnd;
    }
  }

  const wrappedCandidates = [];
  for (const key of horizontalMatched) {
    if (verticalMatched.has(key)) {
      wrappedCandidates.push(key);
    }
  }

  for (const key of wrappedCandidates) {
    const { row, col } = parseKey(key);
    const color = getMatchColor(board[row][col]);
    if (color !== null) {
      addSpecialCreation(specialCreates, key, SPECIAL.WRAPPED, color);
    }
  }

  return { clearSet, specialCreates };
}

function expandClearWithSpecials(baseClear, preserveKeys) {
  const expanded = new Set(baseClear);
  const queue = [...baseClear];
  const visited = new Set();

  while (queue.length > 0) {
    const key = queue.pop();
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    if (preserveKeys.has(key)) {
      continue;
    }

    const { row, col } = parseKey(key);
    const cell = board[row][col];
    if (!cell) {
      continue;
    }

    if (cell.special === SPECIAL.STRIPED_H) {
      for (let c = 0; c < COLS; c += 1) {
        const blastKey = keyOf(row, c);
        if (!expanded.has(blastKey)) {
          expanded.add(blastKey);
          queue.push(blastKey);
        }
      }
    }

    if (cell.special === SPECIAL.STRIPED_V) {
      for (let r = 0; r < ROWS; r += 1) {
        const blastKey = keyOf(r, col);
        if (!expanded.has(blastKey)) {
          expanded.add(blastKey);
          queue.push(blastKey);
        }
      }
    }

    if (cell.special === SPECIAL.WRAPPED) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const nr = row + dr;
          const nc = col + dc;
          if (!isInside(nr, nc)) {
            continue;
          }
          const nearKey = keyOf(nr, nc);
          if (!expanded.has(nearKey)) {
            expanded.add(nearKey);
            queue.push(nearKey);
          }
        }
      }
    }

    if (cell.special === SPECIAL.BOMB) {
      const colorPool = [];
      for (let r = 0; r < ROWS; r += 1) {
        for (let c = 0; c < COLS; c += 1) {
          const each = board[r][c];
          if (!each || each.special === SPECIAL.BOMB) {
            continue;
          }
          colorPool.push(each.color);
        }
      }

      if (colorPool.length > 0) {
        const pickedColor = colorPool[Math.floor(Math.random() * colorPool.length)];
        for (let r = 0; r < ROWS; r += 1) {
          for (let c = 0; c < COLS; c += 1) {
            const each = board[r][c];
            if (!each || each.color !== pickedColor) {
              continue;
            }
            const blastKey = keyOf(r, c);
            if (!expanded.has(blastKey)) {
              expanded.add(blastKey);
              queue.push(blastKey);
            }
          }
        }
      }
    }
  }

  return expanded;
}

function subtractSet(input, remove) {
  const result = new Set();
  for (const key of input) {
    if (!remove.has(key)) {
      result.add(key);
    }
  }
  return result;
}

function clearCandies(clearSet) {
  for (const key of clearSet) {
    const { row, col } = parseKey(key);
    board[row][col] = null;
  }
}

function applySpecialCreations(specialCreates) {
  let madeStriped = false;
  let madeWrapped = false;
  let madeBomb = false;
  createdSpecialKeys = new Set(specialCreates.keys());

  for (const [key, entry] of specialCreates.entries()) {
    const { row, col } = parseKey(key);
    const current = board[row][col] || createCandy(entry.color, entry.special);
    current.color = entry.color;
    current.special = entry.special;
    board[row][col] = current;

    if (entry.special === SPECIAL.STRIPED_H || entry.special === SPECIAL.STRIPED_V) {
      madeStriped = true;
    } else if (entry.special === SPECIAL.WRAPPED) {
      madeWrapped = true;
    } else if (entry.special === SPECIAL.BOMB) {
      madeBomb = true;
    }
  }

  if (madeBomb) {
    sound.special(SPECIAL.BOMB);
  } else if (madeWrapped) {
    sound.special(SPECIAL.WRAPPED);
  } else if (madeStriped) {
    sound.special(SPECIAL.STRIPED_H);
  }
}

function collapseAndRefill() {
  const nextDrops = new Map();

  for (let col = 0; col < COLS; col += 1) {
    let writeRow = ROWS - 1;

    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const cell = board[row][col];
      if (!cell) {
        continue;
      }
      if (writeRow !== row) {
        board[writeRow][col] = cell;
        board[row][col] = null;
        nextDrops.set(keyOf(writeRow, col), writeRow - row);
      }
      writeRow -= 1;
    }

    for (let row = writeRow; row >= 0; row -= 1) {
      board[row][col] = createCandy();
      nextDrops.set(keyOf(row, col), row + 1);
    }
  }

  dropDistances = nextDrops;
}

function calculatePoints(clearCount, specialCreates, chain) {
  let points = clearCount * 20 * chain;
  for (const entry of specialCreates.values()) {
    if (entry.special === SPECIAL.STRIPED_H || entry.special === SPECIAL.STRIPED_V) {
      points += 100;
    } else if (entry.special === SPECIAL.WRAPPED) {
      points += 170;
    } else if (entry.special === SPECIAL.BOMB) {
      points += 260;
    }
  }
  return points;
}

function isBombSwap(a, b) {
  return (
    board[a.row][a.col].special === SPECIAL.BOMB ||
    board[b.row][b.col].special === SPECIAL.BOMB
  );
}

function isStripedType(special) {
  return special === SPECIAL.STRIPED_H || special === SPECIAL.STRIPED_V;
}

function isStripedSwap(a, b) {
  return (
    isStripedType(board[a.row][a.col].special) &&
    isStripedType(board[b.row][b.col].special)
  );
}

function buildStripedSwapResolution(a, b) {
  const clearSet = new Set();

  for (let c = 0; c < COLS; c += 1) {
    clearSet.add(keyOf(a.row, c));
    clearSet.add(keyOf(b.row, c));
  }
  for (let r = 0; r < ROWS; r += 1) {
    clearSet.add(keyOf(r, a.col));
    clearSet.add(keyOf(r, b.col));
  }

  return { clearSet, specialCreates: new Map(), reason: "double-striped" };
}

function buildBombSwapResolution(a, b) {
  const first = board[a.row][a.col];
  const second = board[b.row][b.col];
  const firstBomb = first.special === SPECIAL.BOMB;
  const secondBomb = second.special === SPECIAL.BOMB;
  const clearSet = new Set();

  if (firstBomb && secondBomb) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        clearSet.add(keyOf(row, col));
      }
    }
    return { clearSet, specialCreates: new Map(), reason: "double-bomb" };
  }

  const bombPos = firstBomb ? a : b;
  const otherPos = firstBomb ? b : a;
  const other = board[otherPos.row][otherPos.col];
  const targetColor = other.color;

  const addRow = (row) => {
    for (let c = 0; c < COLS; c += 1) {
      clearSet.add(keyOf(row, c));
    }
  };

  const addCol = (col) => {
    for (let r = 0; r < ROWS; r += 1) {
      clearSet.add(keyOf(r, col));
    }
  };

  const addArea3x3 = (row, col) => {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const nr = row + dr;
        const nc = col + dc;
        if (!isInside(nr, nc)) {
          continue;
        }
        clearSet.add(keyOf(nr, nc));
      }
    }
  };

  if (isStripedType(other.special)) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = board[row][col];
        if (!cell || cell.color !== targetColor) {
          continue;
        }
        if (other.special === SPECIAL.STRIPED_H) {
          addRow(row);
        } else {
          addCol(col);
        }
        clearSet.add(keyOf(row, col));
      }
    }
    clearSet.add(keyOf(bombPos.row, bombPos.col));
    clearSet.add(keyOf(otherPos.row, otherPos.col));
    return { clearSet, specialCreates: new Map(), reason: "color-bomb-striped" };
  }

  if (other.special === SPECIAL.WRAPPED) {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = board[row][col];
        if (!cell || cell.color !== targetColor) {
          continue;
        }
        addArea3x3(row, col);
        clearSet.add(keyOf(row, col));
      }
    }
    clearSet.add(keyOf(bombPos.row, bombPos.col));
    clearSet.add(keyOf(otherPos.row, otherPos.col));
    return { clearSet, specialCreates: new Map(), reason: "color-bomb-wrapped" };
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = board[row][col];
      if (cell && cell.color === targetColor) {
        clearSet.add(keyOf(row, col));
      }
    }
  }
  clearSet.add(keyOf(bombPos.row, bombPos.col));
  clearSet.add(keyOf(otherPos.row, otherPos.col));

  return { clearSet, specialCreates: new Map(), reason: "bomb" };
}

async function resolveBoard(initialResolution = null) {
  let chain = 0;
  let pending = initialResolution;

  while (true) {
    let clearSet;
    let specialCreates;

    if (pending) {
      clearSet = pending.clearSet;
      specialCreates = pending.specialCreates || new Map();
      pending = null;
    } else {
      const matchInfo = findMatchInfo();
      clearSet = matchInfo.clearSet;
      specialCreates = matchInfo.specialCreates;
    }

    if (clearSet.size === 0) {
      break;
    }

    chain += 1;
    const chainBanner = chainCallout(chain);
    if (chainBanner) {
      showVibeCallout(chainBanner.text, chainBanner.tone);
    }
    const preserveKeys = new Set(specialCreates.keys());
    const expandedClear = expandClearWithSpecials(clearSet, preserveKeys);
    const finalClear = subtractSet(expandedClear, preserveKeys);
    const specialBlastOnly = subtractSet(expandedClear, clearSet);

    if (specialBlastOnly.size > 0) {
      sound.bomb();
    } else {
      sound.crush(finalClear.size, chain);
    }
    sound.combo(chain);
    triggerCascadeBombVisuals(specialBlastOnly, chain);

    crushingKeys = new Set(finalClear);
    shockKeys = new Set(specialBlastOnly);
    renderBoard();
    await sleep(ANIMATION_MS.CRUSH);

    clearCandies(finalClear);
    applySpecialCreations(specialCreates);

    score += calculatePoints(finalClear.size, specialCreates, chain);
    updateStats();

    collapseAndRefill();
    crushingKeys = new Set();
    shockKeys = new Set();
    renderBoard();
    await sleep(ANIMATION_MS.DROP);

    dropDistances = new Map();
    renderBoard();
  }

  saveState();
}

function describeResolution(resolution) {
  if (resolution.reason === "double-striped") {
    return {
      status: "Double striped combo! Candy wave exploded!",
      tone: "strong",
    };
  }

  if (resolution.reason === "color-bomb-striped") {
    return {
      status: "Color bomb + striped combo! Whole board is sparkling!",
      tone: "strong",
    };
  }

  if (resolution.reason === "color-bomb-wrapped") {
    return {
      status: "Color bomb + wrapped combo! Massive sugar blast!",
      tone: "strong",
    };
  }

  if (resolution.reason === "double-bomb") {
    return {
      status: "Double color bomb! Sugar burst across the board!",
      tone: "strong",
    };
  }

  if (resolution.reason === "bomb") {
    return {
      status: "Color bomb activated! Delicious full-color crush!",
      tone: "strong",
    };
  }

  let stripedMade = 0;
  let wrappedMade = 0;
  let bombMade = 0;
  for (const entry of resolution.specialCreates.values()) {
    if (entry.special === SPECIAL.STRIPED_H || entry.special === SPECIAL.STRIPED_V) {
      stripedMade += 1;
    }
    if (entry.special === SPECIAL.WRAPPED) {
      wrappedMade += 1;
    }
    if (entry.special === SPECIAL.BOMB) {
      bombMade += 1;
    }
  }

  if (bombMade > 0) {
    return {
      status: "Perfect 5-match! Color bomb created. Delicious!",
      tone: "strong",
    };
  }

  if (wrappedMade > 0) {
    return {
      status: "Great move! Wrapped candy created!",
      tone: "strong",
    };
  }

  if (stripedMade > 0) {
    return {
      status: "Nice! Striped candy created!",
      tone: "strong",
    };
  }

  return { status: "Great move. Keep matching candies.", tone: "strong" };
}

function hasPlayableSwap(a, b) {
  if (
    board[a.row][a.col].special === SPECIAL.BOMB ||
    board[b.row][b.col].special === SPECIAL.BOMB ||
    isStripedSwap(a, b)
  ) {
    return true;
  }
  swapPositions(a, b);
  const hasMatch = findMatchInfo({ a, b }).clearSet.size > 0;
  swapPositions(a, b);
  return hasMatch;
}

function checkAnyPossibleMove() {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const pos = { row, col };
      const right = { row, col: col + 1 };
      if (isInside(right.row, right.col) && hasPlayableSwap(pos, right)) {
        return true;
      }
      const down = { row: row + 1, col };
      if (isInside(down.row, down.col) && hasPlayableSwap(pos, down)) {
        return true;
      }
    }
  }
  return false;
}

function shuffleBoardUntilPlayable() {
  const values = board.flat().filter(Boolean);
  let safety = 0;

  do {
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
    }

    board = Array.from({ length: ROWS }, (_, row) =>
      Array.from({ length: COLS }, (_, col) => values[row * COLS + col]),
    );
    safety += 1;
  } while ((findMatchInfo().clearSet.size > 0 || !checkAnyPossibleMove()) && safety < 280);
}

async function attemptSwap(a, b) {
  if (busy || moves <= 0) {
    return;
  }

  busy = true;
  swapPositions(a, b);
  setSlideAnimation(a, b);
  sound.slide();
  renderBoard();
  await sleep(ANIMATION_MS.SWAP);
  slideOffsets = new Map();
  renderBoard();

  let resolution;
  if (isBombSwap(a, b)) {
    resolution = buildBombSwapResolution(a, b);
  } else if (isStripedSwap(a, b)) {
    resolution = buildStripedSwapResolution(a, b);
  } else {
    const matchInfo = findMatchInfo({ a, b });
    resolution = matchInfo.clearSet.size > 0 ? matchInfo : null;
  }

  if (!resolution || resolution.clearSet.size === 0) {
    swapPositions(a, b);
    setSlideAnimation(a, b);
    sound.invalid();
    renderBoard();
    await sleep(ANIMATION_MS.INVALID_SWAP);
    slideOffsets = new Map();
    selectedCell = null;
    renderBoard();
    setStatus("No match. Try another move.", "warn");
    saveState();
    busy = false;
    return;
  }

  selectedCell = null;
  moves -= 1;
  updateStats();
  if (resolution.reason) {
    sound.comboImpact(resolution.reason);
    triggerBombComboVisuals(resolution, a, b);
    const banner = reasonCallout(resolution.reason);
    if (banner) {
      showVibeCallout(banner.text, banner.tone);
    }
  }
  await resolveBoard(resolution);

  if (moves <= 0) {
    const target = getTargetScore(currentLevel);
    if (score >= target) {
      const finishedLevel = currentLevel;
      sound.levelComplete();
      showVibeCallout("Sugar Crush!", "sugar");
      if (lockToSingleLevel) {
        setStatus(`Level ${finishedLevel} complete! Replaying Level ${finishedLevel}.`, "strong");
      } else {
        highestUnlockedLevel = Math.max(highestUnlockedLevel, finishedLevel + 1);
        currentLevel = finishedLevel + 1;
        setStatus(`Level ${finishedLevel} complete! Level ${currentLevel} unlocked.`, "strong");
      }
      saveProgress(score);
      clearSavedState();
      resetGame(false);
      busy = false;
      return;
    }

    setStatus(
      `Level ${currentLevel} over. Target ${target}, your score ${score}. Try again!`,
      "end",
    );
    showVibeCallout("So Close!", "tasty");
    saveProgress(score);
    clearSavedState();
    busy = false;
    return;
  }

  if (!checkAnyPossibleMove()) {
    shuffleBoardUntilPlayable();
    renderBoard();
    setStatus("No more possible moves. Shuffling board...", "warn");
    saveState();
    busy = false;
    return;
  }

  const feedback = describeResolution(resolution);
  setStatus(feedback.status, feedback.tone);
  if (!resolution.reason) {
    let hasBombCreate = false;
    for (const entry of resolution.specialCreates.values()) {
      if (entry.special === SPECIAL.BOMB) {
        hasBombCreate = true;
      }
    }

    if (hasBombCreate) {
      showVibeCallout("Delicious!", "delicious");
    }
  }
  saveState();
  busy = false;
}

function getCellFromEvent(target) {
  if (!(target instanceof Element)) {
    return null;
  }
  const cell = target.closest(".cell");
  if (!cell) {
    return null;
  }
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (Number.isNaN(row) || Number.isNaN(col)) {
    return null;
  }
  return { row, col };
}

async function onBoardClick(event) {
  if (busy || moves <= 0) {
    return;
  }

  sound.unlock();

  const clicked = getCellFromEvent(event.target);
  if (!clicked) {
    return;
  }

  if (!selectedCell) {
    selectedCell = clicked;
    renderBoard();
    return;
  }

  if (selectedCell.row === clicked.row && selectedCell.col === clicked.col) {
    selectedCell = null;
    renderBoard();
    return;
  }

  if (!isAdjacent(selectedCell, clicked)) {
    selectedCell = clicked;
    renderBoard();
    return;
  }

  const source = selectedCell;
  await attemptSwap(source, clicked);
}

function resetGame(resetFromLevelOne = false) {
  if (resetFromLevelOne) {
    currentLevel = lockToSingleLevel ? forcedInitialLevel : 1;
    highestUnlockedLevel = Math.max(highestUnlockedLevel, currentLevel);
  }

  selectedCell = null;
  crushingKeys = new Set();
  shockKeys = new Set();
  createdSpecialKeys = new Set();
  dropDistances = new Map();
  slideOffsets = new Map();
  score = 0;
  moves = getMovesForLevel(currentLevel);
  busy = false;

  buildFreshBoard();
  if (!checkAnyPossibleMove()) {
    shuffleBoardUntilPlayable();
  }

  updateStats();
  shouldAnimateIntro = true;
  renderBoard();
  const target = getTargetScore(currentLevel);
  setStatus(formatReadyMessage(currentLevel, target), "strong");

  saveProgress();
  saveState();
}
