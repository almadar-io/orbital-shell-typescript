import type { AudioPlay } from '@almadar/core';
import type { HostAudioAsk } from '@almadar/shell-runtime/kernel/host';

const FADE_STEP_MS = 50;

/**
 * Plays what std-audio-cue resolved: pooled one-shots (`playPlan`) and one crossfading music track
 * (`playMusicPlan`). Browsers block audio until a user gesture, so autostart sounds and music asked
 * for before then start on the first click, key or touch.
 */
export class AudioOut {
    private readonly pools = new Map<string, HTMLAudioElement[]>();
    private readonly poolPlans = new Map<string, AudioPlay>();
    private musicKey: string | null = null;
    private musicPlan: AudioPlay | null = null;
    private musicEl: HTMLAudioElement | null = null;
    private musicFade: ReturnType<typeof setInterval> | null = null;
    private pendingMusic: AudioPlay | null = null;
    private autostart: AudioPlay[] = [];
    private unlocked = false;
    private unlockListening = false;
    private readonly listeners = new Set<() => void>();
    private mutedValue: boolean;
    private volumeValue: number;

    constructor(muted = false, volume = 1) {
        this.mutedValue = muted;
        this.volumeValue = volume;
    }

    get muted(): boolean {
        return this.mutedValue;
    }

    get masterVolume(): number {
        return this.volumeValue;
    }

    /** Called whenever muted or the master volume changes; the returned function unsubscribes. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private changed(): void {
        for (const listener of this.listeners) listener();
    }

    private element(plan: AudioPlay): HTMLAudioElement | null {
        this.poolPlans.set(plan.key, plan);
        let pool = this.pools.get(plan.key);
        if (!pool) {
            pool = [];
            this.pools.set(plan.key, pool);
        }
        for (const audio of pool) {
            if (audio.paused && (audio.ended || audio.currentTime === 0)) return audio;
        }
        if (pool.length < Math.max(1, plan.poolSize)) {
            const audio = new Audio(plan.source);
            audio.loop = plan.loop;
            pool.push(audio);
            return audio;
        }
        if (plan.loop) return null;
        let oldest = pool[0];
        for (const audio of pool) {
            if (audio.currentTime > oldest.currentTime) oldest = audio;
        }
        oldest.pause();
        oldest.currentTime = 0;
        oldest.src = plan.source;
        return oldest;
    }

    playPlan(plan: AudioPlay): void {
        if (this.mutedValue || !plan.key) return;
        const audio = this.element(plan);
        if (!audio) return;
        audio.volume = Math.min(1, plan.volume * this.volumeValue);
        if (!plan.loop) audio.currentTime = 0;
        audio.play()?.catch(() => undefined);
    }

    stop(key: string): void {
        for (const audio of this.pools.get(key) ?? []) {
            audio.pause();
            audio.currentTime = 0;
        }
    }

    private clearMusicFade(): void {
        if (this.musicFade) {
            clearInterval(this.musicFade);
            this.musicFade = null;
        }
    }

    private startMusic(plan: AudioPlay): void {
        if (plan.key === this.musicKey) return;
        this.pendingMusic = plan;
        this.listenForUnlock();
        const totalSteps = Math.max(1, plan.fadeMs / FADE_STEP_MS);
        const targetVolume = Math.min(1, plan.volume * this.volumeValue);
        this.clearMusicFade();

        const incoming = new Audio(plan.source);
        incoming.loop = true;
        incoming.volume = 0;
        const outgoing = this.musicEl;
        const outgoingStartVol = outgoing?.volume ?? 0;
        const outgoingKey = this.musicKey;
        const outgoingPlan = this.musicPlan;
        this.musicKey = plan.key;
        this.musicPlan = plan;
        this.musicEl = incoming;

        if (!this.mutedValue) {
            incoming.play().catch(() => {
                this.musicKey = outgoingKey;
                this.musicPlan = outgoingPlan;
                this.musicEl = outgoing;
            });
        }

        let step = 0;
        this.musicFade = setInterval(() => {
            step++;
            const progress = Math.min(step / totalSteps, 1);
            incoming.volume = Math.min(1, targetVolume * progress);
            if (outgoing) outgoing.volume = Math.max(0, outgoingStartVol * (1 - progress));
            if (progress >= 1) {
                this.clearMusicFade();
                if (outgoing) {
                    outgoing.pause();
                    outgoing.src = '';
                }
            }
        }, FADE_STEP_MS);
    }

    stopMusic(fadeDurationMs: number): void {
        this.pendingMusic = null;
        const outgoing = this.musicEl;
        if (!outgoing) return;
        this.musicKey = null;
        this.musicPlan = null;
        this.musicEl = null;
        this.clearMusicFade();
        const startVolume = outgoing.volume;
        const totalSteps = Math.max(1, fadeDurationMs / FADE_STEP_MS);
        let step = 0;
        this.musicFade = setInterval(() => {
            step++;
            const progress = step / totalSteps;
            outgoing.volume = Math.max(0, startVolume * (1 - progress));
            if (progress >= 1) {
                this.clearMusicFade();
                outgoing.pause();
                outgoing.src = '';
            }
        }, FADE_STEP_MS);
    }

    /** Crossfade to a resolved track; an empty key fades the current one out over `fadeMs`. */
    playMusicPlan(plan: AudioPlay): void {
        if (plan.key) this.startMusic(plan);
        else this.stopMusic(plan.fadeMs);
    }

    stopAll(): void {
        for (const pool of this.pools.values()) {
            for (const audio of pool) {
                audio.pause();
                audio.currentTime = 0;
            }
        }
        this.stopMusic(0);
    }

    setMuted(value: boolean): void {
        this.mutedValue = value;
        const autostartKeys = new Set(this.autostart.map((p) => p.key));
        for (const [key, pool] of this.pools.entries()) {
            if (!this.poolPlans.get(key)?.loop) continue;
            for (const audio of pool) {
                if (value && !audio.paused) audio.pause();
                else if (!value && audio.paused && autostartKeys.has(key)) audio.play().catch(() => undefined);
            }
        }
        if (value) this.musicEl?.pause();
        else this.musicEl?.play().catch(() => undefined);
        this.changed();
    }

    setMasterVolume(volume: number): void {
        const clamped = Math.max(0, Math.min(1, volume));
        this.volumeValue = clamped;
        for (const [key, pool] of this.pools.entries()) {
            const entryVol = this.poolPlans.get(key)?.volume ?? 1;
            for (const audio of pool) audio.volume = Math.min(1, entryVol * clamped);
        }
        if (!this.musicFade && this.musicEl) {
            this.musicEl.volume = Math.min(1, (this.musicPlan?.volume ?? 1) * clamped);
        }
        this.changed();
    }

    /** The resolved sounds started on the first user gesture while unmuted. */
    setAutostart(plans: AudioPlay[]): void {
        this.autostart = plans;
        if (plans.length > 0) this.listenForUnlock();
    }

    private readonly unlock = (): void => {
        this.stopListening();
        if (this.unlocked) return;
        this.unlocked = true;
        if (this.mutedValue) return;
        for (const plan of this.autostart) this.playPlan(plan);
        const pending = this.pendingMusic;
        if (pending && pending.key !== this.musicKey) this.startMusic(pending);
    };

    private listenForUnlock(): void {
        if (this.unlocked || this.unlockListening || typeof document === 'undefined') return;
        this.unlockListening = true;
        document.addEventListener('click', this.unlock);
        document.addEventListener('keydown', this.unlock);
        document.addEventListener('touchstart', this.unlock);
    }

    private stopListening(): void {
        if (!this.unlockListening) return;
        this.unlockListening = false;
        document.removeEventListener('click', this.unlock);
        document.removeEventListener('keydown', this.unlock);
        document.removeEventListener('touchstart', this.unlock);
    }

    /** Stops and releases every element. */
    dispose(): void {
        this.stopListening();
        this.clearMusicFade();
        for (const pool of this.pools.values()) {
            for (const audio of pool) {
                audio.pause();
                audio.src = '';
            }
        }
        this.pools.clear();
        if (this.musicEl) {
            this.musicEl.pause();
            this.musicEl.src = '';
            this.musicEl = null;
        }
        this.musicKey = null;
        this.musicPlan = null;
        this.pendingMusic = null;
    }
}

/** The shell's audio: what every `audio/*` host ask plays through, installed with the shell. */
export const shellAudio = new AudioOut();

/** Answers one `audio/*` host ask on the shell's audio. */
export function answerAudioAsk(ask: HostAudioAsk): void {
    if (ask.op === 'audio/play-sound') shellAudio.playPlan(ask.play);
    else if (ask.op === 'audio/stop-sound') {
        if (ask.key !== undefined) shellAudio.stop(ask.key);
        else shellAudio.stopAll();
    } else if (ask.op === 'audio/change-music') shellAudio.playMusicPlan(ask.play);
    else shellAudio.stopMusic(ask.fadeMs);
}
