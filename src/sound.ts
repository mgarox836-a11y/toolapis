/* The interaction layer's sound.

   Synthesised rather than loaded: a noise burst plus a pitched body, generated
   into an AudioBuffer on the fly. That costs zero bytes in the bundle, needs no
   asset to lazy-load, and is one file instead of an mp3 and a preload tag.

   Off until the user asks for it, and remembered after that. Autoplay policy
   means nothing can sound before a gesture anyway, which is why the toggle
   itself is what starts the context. */

const STORAGE_KEY = "toolapis:sound";

let context: AudioContext | null = null;
let enabled = false;

/* Guarded because storage throws outright in some privacy modes, and a sound
   preference is never worth breaking initialisation over. */
const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
};

const writeStored = (on: boolean): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* Preference simply will not survive the session. */
  }
};

const getContext = (): AudioContext | null => {
  if (context) {
    return context;
  }
  if (typeof window.AudioContext === "undefined") {
    return null;
  }
  context = new AudioContext();
  return context;
};

export const isSoundEnabled = (): boolean => enabled;

export const setSoundEnabled = (on: boolean): void => {
  enabled = on;
  writeStored(on);

  /* Built eagerly on enable so the first press is not paying for construction. */
  if (on) {
    const audio = getContext();
    if (audio?.state === "suspended") {
      void audio.resume();
    }
  }
};

export const restoreSoundPreference = (): boolean => {
  enabled = readStored();
  return enabled;
};

const NOISE_SECONDS = 0.05;
const BODY_SECONDS = 0.09;

/** One short physical-feeling strike. No-op while sound is off. */
export const clack = (): void => {
  if (!enabled) {
    return;
  }

  const audio = getContext();
  if (!audio) {
    return;
  }
  if (audio.state === "suspended") {
    void audio.resume();
  }

  const now = audio.currentTime;

  /* The hit itself. The cubic decay is what makes it read as something being
     struck rather than a tone being played. */
  const frames = Math.floor(audio.sampleRate * NOISE_SECONDS);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < frames; i += 1) {
    channel[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  }

  const noise = audio.createBufferSource();
  noise.buffer = buffer;

  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1800;
  band.Q.value = 0.8;

  /* A short pitched drop underneath, so the hit has a body the noise alone
     cannot give. */
  const body = audio.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(220, now);
  body.frequency.exponentialRampToValueAtTime(90, now + BODY_SECONDS);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + BODY_SECONDS);

  noise.connect(band).connect(gain);
  body.connect(gain);
  gain.connect(audio.destination);

  noise.start(now);
  noise.stop(now + NOISE_SECONDS);
  body.start(now);
  body.stop(now + BODY_SECONDS);
};
