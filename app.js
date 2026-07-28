const rootNoteSelect = document.getElementById("rootNote");
const toggleAudioButton = document.getElementById("toggleAudio");
const freqList = document.getElementById("freqList");
const scaleSelect = document.getElementById("scaleSelect");
const autoScaleRandomizeCheckbox = document.getElementById("autoScaleRandomize");
const tempoSlider = document.getElementById("tempoSlider");
const tempoValue = document.getElementById("tempoValue");
const filterCutoffSlider = document.getElementById("filterCutoffSlider");
const filterCutoffValue = document.getElementById("filterCutoffValue");
const filterResonanceSlider = document.getElementById("filterResonanceSlider");
const filterResonanceValue = document.getElementById("filterResonanceValue");
const masterGainSlider = document.getElementById("masterGainSlider");
const masterGainValue = document.getElementById("masterGainValue");
const autoRootOverrideCheckbox = document.getElementById("autoRootOverride");

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
const AUTO_ROOT_SHIFT_BEAT_RANGE = { min: 1, max: 4 };
const AUTO_SCALE_SHIFT_BEAT_RANGE = { min: 4, max: 12 };
const VOICE_ATTACK_SECONDS = 0.03;
const VOICE_RELEASE_SECONDS = 0.08;
const SEMITONE_TO_NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

let audioContext;
let masterGain;
let lowPassFilter;
let activeVoices = [];
let isPlaying = false;
let beatIntervalId;
let tempoBpm = DEFAULT_TEMPO;
let masterGainLevel = Number(masterGainSlider.value) || DEFAULT_MASTER_GAIN;
let filterCutoffHz = Number(filterCutoffSlider.value) || DEFAULT_FILTER_CUTOFF_HZ;
let filterQ = Number(filterResonanceSlider.value) || DEFAULT_FILTER_Q;
let autoRootEnabled = false;
let overrideRootNote = rootNoteSelect.value;
let beatsUntilRootShift = AUTO_ROOT_SHIFT_BEAT_RANGE.min;
let autoScaleEnabled = false;
let beatsUntilScaleShift = AUTO_SCALE_SHIFT_BEAT_RANGE.min;
let scaleHighlightTimeoutId;

function midiToFrequency(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

function midiToNoteName(midiNote) {
  const semitone = ((midiNote % 12) + 12) % 12;
  return SEMITONE_TO_NOTE[semitone];
}

function getPentatonicNoteFromStep(rootNoteName, step, octaveOffset = 0) {
  const rootSemitone = NOTE_TO_SEMITONE[rootNoteName];
  const rootMidi = 12 * (REFERENCE_OCTAVE + 1) + rootSemitone + octaveOffset * 12;
  const midiNote = rootMidi + step;

  return {
    frequency: midiToFrequency(midiNote),
    noteName: midiToNoteName(midiNote),
  };
}

function getUniqueBeatNotes(rootNoteName, count) {
  const scaleKey = scaleSelect.value;
  const scaleSteps = SCALE_INTERVALS[scaleKey] || SCALE_INTERVALS.majorPentatonic;
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

function scheduleNextRootShift() {
  const shiftRange = AUTO_ROOT_SHIFT_BEAT_RANGE.max - AUTO_ROOT_SHIFT_BEAT_RANGE.min + 1;
  beatsUntilRootShift =
    AUTO_ROOT_SHIFT_BEAT_RANGE.min + Math.floor(Math.random() * shiftRange);
}

function scheduleNextScaleShift() {
  const shiftRange =
    AUTO_SCALE_SHIFT_BEAT_RANGE.max - AUTO_SCALE_SHIFT_BEAT_RANGE.min + 1;
  beatsUntilScaleShift =
    AUTO_SCALE_SHIFT_BEAT_RANGE.min + Math.floor(Math.random() * shiftRange);
}

function highlightScaleSelection() {
  scaleSelect.classList.add("scaleChanged");

  if (scaleHighlightTimeoutId) {
    clearTimeout(scaleHighlightTimeoutId);
  }

  scaleHighlightTimeoutId = setTimeout(() => {
    scaleSelect.classList.remove("scaleChanged");
  }, 320);
}

function selectRandomScale() {
  const scaleNames = Object.keys(SCALE_INTERVALS);

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

function applyMasterGainSettings() {
  if (!masterGain || !audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(masterGainLevel, now, 0.015);
}

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

function createVoice(frequency) {
  const oscillator = audioContext.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;

  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0;

  oscillator.connect(gainNode);
  gainNode.connect(lowPassFilter);

  oscillator.start();

  // Fast fade-in avoids clicks when voices start.
  const now = audioContext.currentTime;
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

function triggerBeat() {
  let root = autoRootEnabled ? overrideRootNote : rootNoteSelect.value;

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

async function startAudio() {
  await ensureAudioReady();
  triggerBeat();
  scheduleBeats();

  toggleAudioButton.textContent = "Stop";
  isPlaying = true;
}

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

  triggerBeat();
});

scaleSelect.addEventListener("change", () => {
  highlightScaleSelection();

  if (isPlaying) {
    triggerBeat();
  }
});

autoScaleRandomizeCheckbox.addEventListener("change", () => {
  autoScaleEnabled = autoScaleRandomizeCheckbox.checked;
  scaleSelect.disabled = autoScaleEnabled;

  if (autoScaleEnabled) {
    scheduleNextScaleShift();
  }
});

autoRootOverrideCheckbox.addEventListener("change", () => {
  autoRootEnabled = autoRootOverrideCheckbox.checked;
  rootNoteSelect.disabled = autoRootEnabled;

  if (autoRootEnabled) {
    overrideRootNote = rootNoteSelect.value;
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
