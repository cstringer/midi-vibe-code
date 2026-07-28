# Generative Scale Synth

A browser-based generative synthesizer built with the Web Audio API.

This project creates layered sine-wave voices from musical scales and chord formulas, then reshapes the result with a resonant low-pass filter. It is intentionally lightweight: no build tools, no external dependencies, and no framework.

## Project Goals

- Explore procedural pitch generation with musical constraints.
- Keep interaction immediate through simple HTML controls.
- Demonstrate practical Web Audio patterns (oscillators, gain envelopes, filters, scheduling).
- Stay easy to run and modify locally.

## Current Feature Set

### Sound Engine

- 4 oscillator voices generated on every beat.
- Sine oscillators with short attack and release envelopes to reduce clicks.
- Shared resonant low-pass filter in the master signal path.
- Master gain control for overall output level.

### Musical Generation

- Selectable root note.
- Selectable scale/chord source.
- Multi-octave candidate pool for richer pitch spread.
- Per-beat unique voice frequencies (no duplicate pitch choices within a beat).

### Automation

- Auto-root mode:
  - Periodically reassigns the root note from a randomly chosen currently playing voice.
  - Synchronizes the root dropdown to show the active automated root.
- Auto-scale mode:
  - Randomly switches scale/chord at randomized beat intervals.
  - Visually highlights the scale selector when the value changes.

### Tempo and Timing

- Tempo range from 40 to 400 BPM.
- Beat-driven scheduling with interval recalculation when tempo changes.
- Voices are regenerated and aligned on each beat.

## Available Scale/Chord Sources

- Major Pentatonic
- Whole Tone
- Minor Pentatonic
- Diminished
- Quartal Tone
- Major Triad
- Minor Triad
- Diminished Triad
- Augmented Triad
- Major Seventh
- Minor Seventh
- Dominant Seventh
- Minor Seven Flat Five
- Major Seven Sharp 11

## UI Controls

- Root note selector
- Scale/Chord selector
- Tempo slider
- Low-pass cutoff slider
- Resonance (Q) slider
- Master gain slider
- Auto-root checkbox
- Auto-scale checkbox
- Start/Stop audio button
- Live frequency list for the current beat

## Signal Flow

Oscillator -> Voice Gain Envelope -> Shared Low-Pass Filter -> Master Gain -> Audio Destination

## File Structure

- index.html: UI structure and control elements.
- styles.css: Visual styling and responsive flexbox layout.
- app.js: Web Audio engine, musical logic, scheduling, and event handling.

## How to Run

1. Open the project folder in VS Code.
2. Start a local static server from the project root.
   - Example using Python:
     - python3 -m http.server 8000
3. Open your browser to:
   - http://localhost:8000
4. Click Start and allow audio playback when prompted by the browser.

Note: Most browsers require a user gesture before audio can start.

## Development Notes

- The app uses one AudioContext and lazily initializes audio nodes when playback begins.
- Filter and master gain parameters are smoothed with setTargetAtTime for cleaner transitions.
- Auto modes are designed to remain deterministic per beat while still producing variation over time.

## Possible Next Enhancements

- Add waveform selection per voice.
- Add stereo spread or panning controls.
- Add recording/export (WAV) support.
- Add MIDI input mapping for root/scale selection.
- Add preset save/load for control states.

## License

This project is licensed under the MIT License.
See [LICENSE](LICENSE) for details.
