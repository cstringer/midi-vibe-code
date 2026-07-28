// @ts-check

/** @typedef {"C"|"C#"|"D"|"D#"|"E"|"F"|"F#"|"G"|"G#"|"A"|"A#"|"B"} NoteName */
/** @typedef {"majorPentatonic"|"wholeTone"|"minorPentatonic"|"diminished"|"quartalTone"|"majorTriad"|"minorTriad"|"diminishedTriad"|"augmentedTriad"|"majorSeventh"|"minorSeventh"|"dominantSeventh"|"minorSevenFlatFive"|"majorSevenSharpEleven"} ScaleKey */
/** @typedef {{ min: number, max: number }} BeatRange */
/** @typedef {{ frequency: number, noteName: NoteName }} BeatNote */
/** @typedef {{ step: number, octaveOffset: number }} NoteCandidate */
/** @typedef {{ oscillator: OscillatorNode, gainNode: GainNode, frequency: number, endTime: number, noteName: NoteName }} Voice */

/**
 * Returns an element by id and throws if it does not exist.
 * @param {string} id
 * @returns {HTMLElement}
 */
function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element;
}

const rootNoteSelect = /** @type {HTMLSelectElement} */ (getRequiredElement("rootNote"));
const toggleAudioButton = /** @type {HTMLButtonElement} */ (getRequiredElement("toggleAudio"));
const freqList = /** @type {HTMLUListElement} */ (getRequiredElement("freqList"));
const scaleSelect = /** @type {HTMLSelectElement} */ (getRequiredElement("scaleSelect"));
const autoScaleRandomizeCheckbox = /** @type {HTMLInputElement} */ (getRequiredElement("autoScaleRandomize"));
const tempoSlider = /** @type {HTMLInputElement} */ (getRequiredElement("tempoSlider"));
const tempoValue = /** @type {HTMLSpanElement} */ (getRequiredElement("tempoValue"));
const filterCutoffSlider = /** @type {HTMLInputElement} */ (getRequiredElement("filterCutoffSlider"));
const filterCutoffValue = /** @type {HTMLSpanElement} */ (getRequiredElement("filterCutoffValue"));
const filterResonanceSlider = /** @type {HTMLInputElement} */ (getRequiredElement("filterResonanceSlider"));
const filterResonanceValue = /** @type {HTMLSpanElement} */ (getRequiredElement("filterResonanceValue"));
const masterGainSlider = /** @type {HTMLInputElement} */ (getRequiredElement("masterGainSlider"));
const masterGainValue = /** @type {HTMLSpanElement} */ (getRequiredElement("masterGainValue"));
const autoRootOverrideCheckbox = /** @type {HTMLInputElement} */ (getRequiredElement("autoRootOverride"));

/** @type {Record<ScaleKey, number[]>} */
const SCALE_INTERVALS = {
  majorPentatonic: [0, 2, 4, 7, 9],
  wholeTone: [0, 2, 4, 6, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
  diminished: [0, 2, 3, 5, 6, 8, 9, 11],
  quartalTone: [0, 5, 10],
  majorTriad: [0, 4, 7],
  minorTriad: [0, 3, 7],
  diminishedTriad: [0, 3, 6],
  augmentedTriad: [0, 4, 8],
  majorSeventh: [0, 4, 7, 11],
  minorSeventh: [0, 3, 7, 10],
  dominantSeventh: [0, 4, 7, 10],
  minorSevenFlatFive: [0, 3, 6, 10],
  majorSevenSharpEleven: [0, 4, 6, 7, 11],
};
/** @type {Record<NoteName, number>} */
const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

const ACTIVE_VOICE_COUNT = 4;
const REFERENCE_OCTAVE = 4;
const PENTATONIC_OCTAVE_OFFSETS = [-1, 0, 1];
const DEFAULT_TEMPO = 120;
const DEFAULT_MASTER_GAIN = 0.9;
const DEFAULT_FILTER_CUTOFF_HZ = 1800;
const DEFAULT_FILTER_Q = 1.2;
/** @type {BeatRange} */
const AUTO_ROOT_SHIFT_BEAT_RANGE = { min: 1, max: 4 };
/** @type {BeatRange} */
const AUTO_SCALE_SHIFT_BEAT_RANGE = { min: 4, max: 12 };
const VOICE_ATTACK_SECONDS = 0.03;
const VOICE_RELEASE_SECONDS = 0.08;
/** @type {NoteName[]} */
const SEMITONE_TO_NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** @type {AudioContext|undefined} */
let audioContext;
/** @type {GainNode|undefined} */
let masterGain;
/** @type {BiquadFilterNode|undefined} */
let lowPassFilter;
/** @type {Voice[]} */
let activeVoices = [];
let isPlaying = false;
/** @type {ReturnType<typeof setInterval>|undefined} */
let beatIntervalId;
let tempoBpm = DEFAULT_TEMPO;
let masterGainLevel = Number(masterGainSlider.value) || DEFAULT_MASTER_GAIN;
let filterCutoffHz = Number(filterCutoffSlider.value) || DEFAULT_FILTER_CUTOFF_HZ;
let filterQ = Number(filterResonanceSlider.value) || DEFAULT_FILTER_Q;
let autoRootEnabled = false;
/** @type {NoteName} */
let overrideRootNote = /** @type {NoteName} */ (rootNoteSelect.value);
let beatsUntilRootShift = AUTO_ROOT_SHIFT_BEAT_RANGE.min;
let autoScaleEnabled = false;
let beatsUntilScaleShift = AUTO_SCALE_SHIFT_BEAT_RANGE.min;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let scaleHighlightTimeoutId;
/** @type {NoteName|null} */
let pendingRootNote = null;
/** @type {ScaleKey|null} */
let pendingScaleKey = null;

/**
 * Converts a MIDI note number to frequency in Hz.
 * @param {number} midiNote
 * @returns {number}
 */
function midiToFrequency(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

/**
 * Maps any MIDI note to its pitch class name.
 * @param {number} midiNote
 * @returns {NoteName}
 */
function midiToNoteName(midiNote) {
  const semitone = ((midiNote % 12) + 12) % 12;
  return SEMITONE_TO_NOTE[semitone];
}

/**
 * Builds a note from the selected root, scale step, and octave offset.
 * @param {NoteName} rootNoteName
 * @param {number} step
 * @param {number} [octaveOffset=0]
 * @returns {BeatNote}
 */
function getPentatonicNoteFromStep(rootNoteName, step, octaveOffset = 0) {
  const rootSemitone = NOTE_TO_SEMITONE[rootNoteName];
  const rootMidi = 12 * (REFERENCE_OCTAVE + 1) + rootSemitone + octaveOffset * 12;
  const midiNote = rootMidi + step;

  return {
    frequency: midiToFrequency(midiNote),
    noteName: midiToNoteName(midiNote),
  };
}

/**
 * Generates unique note candidates for the current beat.
 * @param {NoteName} rootNoteName
 * @param {number} count
 * @returns {BeatNote[]}
 */
function getUniqueBeatNotes(rootNoteName, count) {
  const scaleKey = /** @type {ScaleKey} */ (scaleSelect.value);
  const scaleSteps = SCALE_INTERVALS[scaleKey] || SCALE_INTERVALS.majorPentatonic;
  /** @type {NoteCandidate[]} */
  const candidates = PENTATONIC_OCTAVE_OFFSETS.flatMap((octaveOffset) =>
    scaleSteps.map((step) => ({ step, octaveOffset }))
  );

  // Fisher-Yates shuffle so we can take a unique subset without replacement.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const uniqueCount = Math.min(count, candidates.length);
  const notes = candidates
    .slice(0, uniqueCount)
    .map(({ step, octaveOffset }) =>
      getPentatonicNoteFromStep(rootNoteName, step, octaveOffset)
    );

  while (notes.length < count) {
    const randomCandidate =
      candidates[Math.floor(Math.random() * candidates.length)];
    notes.push(
      getPentatonicNoteFromStep(
        rootNoteName,
        randomCandidate.step,
        randomCandidate.octaveOffset
      )
    );
  }

  return notes;
}

/** @returns {void} */
function scheduleNextRootShift() {
  const shiftRange = AUTO_ROOT_SHIFT_BEAT_RANGE.max - AUTO_ROOT_SHIFT_BEAT_RANGE.min + 1;
  beatsUntilRootShift =
    AUTO_ROOT_SHIFT_BEAT_RANGE.min + Math.floor(Math.random() * shiftRange);
}

/** @returns {void} */
function scheduleNextScaleShift() {
  const shiftRange =
    AUTO_SCALE_SHIFT_BEAT_RANGE.max - AUTO_SCALE_SHIFT_BEAT_RANGE.min + 1;
  beatsUntilScaleShift =
    AUTO_SCALE_SHIFT_BEAT_RANGE.min + Math.floor(Math.random() * shiftRange);
}

/** @returns {void} */
function highlightScaleSelection() {
  scaleSelect.classList.add("scaleChanged");

  if (scaleHighlightTimeoutId) {
    clearTimeout(scaleHighlightTimeoutId);
  }

  scaleHighlightTimeoutId = setTimeout(() => {
    scaleSelect.classList.remove("scaleChanged");
  }, 320);
}

/** @returns {void} */
function selectRandomScale() {
  const scaleNames = /** @type {ScaleKey[]} */ (Object.keys(SCALE_INTERVALS));

  if (scaleNames.length <= 1) {
    return;
  }

  const currentScale = scaleSelect.value;
  const nextScales = scaleNames.filter((scaleName) => scaleName !== currentScale);
  const randomScale = nextScales[Math.floor(Math.random() * nextScales.length)];

  if (!randomScale) {
    return;
  }

  scaleSelect.value = randomScale;
  highlightScaleSelection();
}

/** @returns {void} */
function applyFilterSettings() {
  if (!lowPassFilter || !audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  lowPassFilter.frequency.cancelScheduledValues(now);
  lowPassFilter.Q.cancelScheduledValues(now);
  lowPassFilter.frequency.setTargetAtTime(filterCutoffHz, now, 0.015);
  lowPassFilter.Q.setTargetAtTime(filterQ, now, 0.015);
}

/** @returns {void} */
function applyMasterGainSettings() {
  if (!masterGain || !audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(masterGainLevel, now, 0.015);
}

/**
 * Renders the active beat frequencies to the status list.
 * @param {number[]} frequencies
 * @returns {void}
 */
function updateFrequencyList(frequencies) {
  freqList.innerHTML = "";

  if (frequencies.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Not running";
    freqList.appendChild(item);
    return;
  }

  frequencies.forEach((frequency, index) => {
    const item = document.createElement("li");
    item.textContent = `Oscillator ${index + 1}: ${frequency.toFixed(2)} Hz`;
    freqList.appendChild(item);
  });
}

/**
 * Creates and schedules one oscillator voice for the current beat.
 * @param {number} frequency
 * @returns {Omit<Voice, "noteName">}
 */
function createVoice(frequency) {
  if (!audioContext || !lowPassFilter) {
    throw new Error("Audio graph is not initialized");
  }

  const context = audioContext;
  const filter = lowPassFilter;

  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;

  const gainNode = context.createGain();
  gainNode.gain.value = 0;

  oscillator.connect(gainNode);
  gainNode.connect(filter);

  oscillator.start();

  // Fast fade-in avoids clicks when voices start.
  const now = context.currentTime;
  const beatDurationSeconds = 60 / tempoBpm;
  const holdTime = Math.max(0.02, beatDurationSeconds - VOICE_RELEASE_SECONDS);
  const releaseEnd = now + beatDurationSeconds;

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(0.12, now + VOICE_ATTACK_SECONDS);
  gainNode.gain.linearRampToValueAtTime(0.08, now + holdTime);
  gainNode.gain.linearRampToValueAtTime(0, releaseEnd);
  gainNode.gain.setValueAtTime(0, releaseEnd);
  oscillator.stop(releaseEnd);

  return {
    oscillator,
    gainNode,
    frequency,
    endTime: releaseEnd,
  };
}

/** @returns {void} */
function disposeVoices() {
  if (!audioContext || activeVoices.length === 0) {
    return;
  }

  const now = audioContext.currentTime;

  activeVoices.forEach(({ oscillator, gainNode }) => {
    try {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.03);
      oscillator.stop(now + 0.05);
    } catch {
      // Some voices may already be stopping due to their envelope.
    }
  });

  activeVoices = [];
}

/**
 * Lazily initializes the Web Audio graph and ensures audio is resumed.
 * @returns {Promise<void>}
 */
async function ensureAudioReady() {
  if (!audioContext) {
    audioContext = new AudioContext();
    lowPassFilter = audioContext.createBiquadFilter();
    lowPassFilter.type = "lowpass";

    masterGain = audioContext.createGain();
    masterGain.gain.value = masterGainLevel;

    lowPassFilter.connect(masterGain);
    masterGain.connect(audioContext.destination);
    applyFilterSettings();
    applyMasterGainSettings();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

/** @returns {void} */
function triggerBeat() {
  if (pendingScaleKey && !autoScaleEnabled) {
    scaleSelect.value = pendingScaleKey;
    pendingScaleKey = null;
  }

  /** @type {NoteName} */
  let root = autoRootEnabled ? overrideRootNote : /** @type {NoteName} */ (rootNoteSelect.value);

  if (pendingRootNote && !autoRootEnabled) {
    root = pendingRootNote;
    rootNoteSelect.value = pendingRootNote;
    pendingRootNote = null;
  }

  if (autoScaleEnabled) {
    beatsUntilScaleShift -= 1;

    if (beatsUntilScaleShift <= 0) {
      selectRandomScale();
      scheduleNextScaleShift();
    }
  }

  if (autoRootEnabled && activeVoices.length > 0) {
    beatsUntilRootShift -= 1;

    if (beatsUntilRootShift <= 0) {
      const pivotVoice =
        activeVoices[Math.floor(Math.random() * activeVoices.length)];
      overrideRootNote = pivotVoice.noteName;
      root = overrideRootNote;
      scheduleNextRootShift();
    }
  }

  if (autoRootEnabled) {
    rootNoteSelect.value = root;
  }

  const beatNotes = getUniqueBeatNotes(root, ACTIVE_VOICE_COUNT);
  const frequencies = beatNotes.map(({ frequency }) => frequency);

  disposeVoices();
  activeVoices = beatNotes.map(({ frequency, noteName }) => {
    const voice = createVoice(frequency);
    return { ...voice, noteName };
  });
  updateFrequencyList(frequencies);
}

/**
 * Rebuilds the beat timer using the current BPM.
 * @returns {void}
 */
function scheduleBeats() {
  if (beatIntervalId) {
    clearInterval(beatIntervalId);
  }

  const intervalMs = Math.round((60 / tempoBpm) * 1000);
  beatIntervalId = setInterval(() => {
    if (isPlaying) {
      triggerBeat();
    }
  }, intervalMs);
}

/** @returns {Promise<void>} */
async function startAudio() {
  await ensureAudioReady();
  triggerBeat();
  scheduleBeats();

  toggleAudioButton.textContent = "Stop";
  isPlaying = true;
}

/** @returns {void} */
function stopAudio() {
  if (beatIntervalId) {
    clearInterval(beatIntervalId);
    beatIntervalId = undefined;
  }

  disposeVoices();
  updateFrequencyList([]);

  toggleAudioButton.textContent = "Start";
  isPlaying = false;
}

toggleAudioButton.addEventListener("click", async () => {
  if (isPlaying) {
    stopAudio();
  } else {
    await startAudio();
  }
});

rootNoteSelect.addEventListener("change", async () => {
  if (!isPlaying || autoRootEnabled) {
    return;
  }

  pendingRootNote = /** @type {NoteName} */ (rootNoteSelect.value);
});

scaleSelect.addEventListener("change", () => {
  highlightScaleSelection();

  if (isPlaying && !autoScaleEnabled) {
    pendingScaleKey = /** @type {ScaleKey} */ (scaleSelect.value);
  }
});

autoScaleRandomizeCheckbox.addEventListener("change", () => {
  autoScaleEnabled = autoScaleRandomizeCheckbox.checked;
  scaleSelect.disabled = autoScaleEnabled;

  if (autoScaleEnabled) {
    pendingScaleKey = null;
    scheduleNextScaleShift();
  }
});

autoRootOverrideCheckbox.addEventListener("change", () => {
  autoRootEnabled = autoRootOverrideCheckbox.checked;
  rootNoteSelect.disabled = autoRootEnabled;

  if (autoRootEnabled) {
    pendingRootNote = null;
    overrideRootNote = /** @type {NoteName} */ (rootNoteSelect.value);
    rootNoteSelect.value = overrideRootNote;
    scheduleNextRootShift();
  }

  if (isPlaying) {
    triggerBeat();
  }
});

tempoSlider.addEventListener("input", () => {
  tempoBpm = Number(tempoSlider.value);
  tempoValue.textContent = String(tempoBpm);

  if (isPlaying) {
    scheduleBeats();
  }
});

filterCutoffSlider.addEventListener("input", () => {
  filterCutoffHz = Number(filterCutoffSlider.value);
  filterCutoffValue.textContent = String(Math.round(filterCutoffHz));
  applyFilterSettings();
});

filterResonanceSlider.addEventListener("input", () => {
  filterQ = Number(filterResonanceSlider.value);
  filterResonanceValue.textContent = filterQ.toFixed(1);
  applyFilterSettings();
});

masterGainSlider.addEventListener("input", () => {
  masterGainLevel = Number(masterGainSlider.value);
  masterGainValue.textContent = masterGainLevel.toFixed(2);
  applyMasterGainSettings();
});

updateFrequencyList([]);
tempoValue.textContent = String(tempoBpm);
filterCutoffValue.textContent = String(Math.round(filterCutoffHz));
filterResonanceValue.textContent = filterQ.toFixed(1);
masterGainValue.textContent = masterGainLevel.toFixed(2);
