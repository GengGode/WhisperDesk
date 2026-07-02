/** AudioEngine 事件回调 */
export interface AudioEngineCallbacks {
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
}

/**
 * 全局音频播放引擎单例。
 * 持有唯一 HTMLAudioElement，生命周期与页面切换无关。
 */
class AudioEngine {
  private audio: HTMLAudioElement;
  private callbacks: AudioEngineCallbacks = {};

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";

    this.audio.addEventListener("timeupdate", () => {
      this.callbacks.onTimeUpdate?.(this.audio.currentTime);
    });
    this.audio.addEventListener("loadedmetadata", () => {
      this.callbacks.onDurationChange?.(this.audio.duration || 0);
    });
    this.audio.addEventListener("play", () => {
      this.callbacks.onPlay?.();
    });
    this.audio.addEventListener("pause", () => {
      this.callbacks.onPause?.();
    });
    this.audio.addEventListener("ended", () => {
      this.callbacks.onEnded?.();
    });
    this.audio.addEventListener("error", () => {
      const err = this.audio.error;
      const msg = err?.message ?? "未知错误";
      this.callbacks.onError?.(`音频加载失败 (code=${err?.code}): ${msg}`);
    });
  }

  setCallbacks(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks;
  }

  /** 加载音频源（不自动播放） */
  load(src: string) {
    if (this.audio.src !== src) {
      this.audio.src = src;
      this.audio.load();
    }
  }

  async play(): Promise<void> {
    await this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(time: number) {
    if (!Number.isFinite(time)) return;
    this.audio.currentTime = time;
    this.callbacks.onTimeUpdate?.(time);
  }

  setVolume(volumePercent: number, muted: boolean) {
    this.audio.volume = Math.min(1, Math.max(0, volumePercent / 100));
    this.audio.muted = muted;
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  getDuration(): number {
    return this.audio.duration || 0;
  }

  getSrc(): string {
    return this.audio.src;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  getElement(): HTMLAudioElement {
    return this.audio;
  }
}

export const audioEngine = new AudioEngine();
