import sounddevice as sd
import numpy as np
import sys
import os
import threading
import queue
import json
import zipfile
import urllib.request
import speech_recognition as sr
from indic_transliteration import sanscript

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────
SAMPLE_RATE  = 48000
BLOCK_SIZE   = 256          # ~5ms per block — ultra-low latency, glitch-free
CHANNELS     = 1
DTYPE        = 'float32'    # sounddevice works in float32 (-1.0 to +1.0)

# WDRC — increase these if you need louder
TARGET_LEVEL = 0.60         # Target output level (60% of max speaker)
MAX_GAIN     = 80.0         # Maximum amplification multiplier
MIN_GAIN     = 1.0          # Never lower the volume

# Envelope tracker smoothing (per BLOCK)
# Slower release = more consistent volume, no "bouncing"
ATTACK_COEFF  = 0.30
RELEASE_COEFF = 0.9995

# ─────────────────────────────────────────────
# WDRC STATE (shared with audio callback)
# ─────────────────────────────────────────────
envelope = np.array([0.001], dtype=np.float64)   # mutable via array

def audio_callback(indata, outdata, frames, time, status):
    """
    Called by the audio DRIVER directly — runs in a high-priority hardware thread.
    Python GIL and scheduling do NOT affect this. This is why sounddevice is
    the correct tool for real-time audio (PyAudio's blocking read/write is not).
    """
    audio = indata[:, 0].copy()  # float32 mono

    # ── 1. RMS of this block ──────────────────────────────────────────────────
    rms = np.sqrt(np.mean(audio ** 2)) + 1e-9

    # ── 2. Smooth envelope tracker (WDRC attack/release) ─────────────────────
    if rms > envelope[0]:
        envelope[0] = ATTACK_COEFF  * envelope[0] + (1 - ATTACK_COEFF)  * rms
    else:
        envelope[0] = RELEASE_COEFF * envelope[0] + (1 - RELEASE_COEFF) * rms

    # ── 3. Compute gain ───────────────────────────────────────────────────────
    gain = TARGET_LEVEL / (envelope[0] + 1e-9)
    gain = float(np.clip(gain, MIN_GAIN, MAX_GAIN))

    # ── 4. Amplify ────────────────────────────────────────────────────────────
    amplified = audio * gain

    # ── 5. Soft-clip (tanh limiter) — absolutely no digital distortion ────────
    amplified = np.tanh(amplified)

    # ── 6. Write to output ────────────────────────────────────────────────────
    outdata[:, 0] = amplified

    # ── 7. Send copy to transcription queue (non-blocking, never stalls audio)─
    try:
        transcript_queue.put_nowait(amplified.copy())
    except queue.Full:
        pass  # Drop silently — audio is never affected


# ─────────────────────────────────────────────
# TRANSCRIPTION
# ─────────────────────────────────────────────
transcript_queue = queue.Queue(maxsize=600)

def transcription_worker():
    """Accumulates ~2 seconds of audio then sends to Google Speech API."""
    r = sr.Recognizer()
    target_samples = SAMPLE_RATE * 2      # 2-second chunks
    buffer = np.zeros(0, dtype=np.float32)

    while True:
        chunk = transcript_queue.get()
        if chunk is None:
            break
        buffer = np.concatenate([buffer, chunk])

        if len(buffer) >= target_samples:
            # Downsample float32 → int16 at 16kHz for Google API
            pcm_48k  = (buffer[:target_samples] * 32767).astype(np.int16)
            pcm_16k  = pcm_48k[::3]          # 48k→16k: take every 3rd sample
            raw_bytes = pcm_16k.tobytes()
            buffer   = buffer[target_samples:]

            # Fire-and-forget in a daemon thread so transcription NEVER blocks audio
            threading.Thread(target=_send_to_google, args=(r, raw_bytes), daemon=True).start()


def _send_to_google(r, raw_bytes):
    audio_data = sr.AudioData(raw_bytes, sample_rate=16000, sample_width=2)
    try:
        text = r.recognize_google(audio_data, language='hi-IN')
        # Convert Devanagari Hindi to Roman Urdu/Hinglish
        roman = sanscript.transliterate(text, sanscript.DEVANAGARI, sanscript.ITRANS).lower()
        sys.stdout.write(f'\r[Transcript] {roman}\n')
        sys.stdout.flush()
    except sr.UnknownValueError:
        pass
    except sr.RequestError:
        sys.stdout.write('\r[Network] Cannot reach Google — check Wi-Fi\n')
        sys.stdout.flush()


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    print('=' * 58)
    print('  ClearEar AI — Real-Time Hearing Aid')
    print('=' * 58)
    print(f'  Engine  : sounddevice callback (hardware-level, glitch-free)')
    print(f'  Rate    : {SAMPLE_RATE} Hz  |  Block: {BLOCK_SIZE} samples (~{round(BLOCK_SIZE/SAMPLE_RATE*1000,1)}ms)')
    print(f'  Max Gain: {MAX_GAIN}×  |  Target: {int(TARGET_LEVEL*100)}% max volume')
    print()
    print('  ⚠ WEAR HEADPHONES before continuing!')
    print('    Using laptop speakers will cause loud feedback.')
    print('=' * 58)
    input('\n  Press ENTER when headphones are on...\n')

    # Start transcription worker thread
    t = threading.Thread(target=transcription_worker, daemon=True)
    t.start()

    print('  ✓ Hearing Aid ACTIVE — speak or play audio near mic.')
    print('  Press Ctrl+C to stop.\n')

    # ── Device selection ───────────────────────────────────────────────────
    # WASAPI Mic (device 9) → WDRC → Headphones output (device 22)
    # These are your exact detected hardware devices.
    INPUT_DEVICE  = 9   # Microphone Array (Realtek) WASAPI
    OUTPUT_DEVICE = 22  # Headphones (your AirPods/earbuds)

    print(f'  Input  device #{INPUT_DEVICE}: Microphone Array (Realtek WASAPI)')
    print(f'  Output device #{OUTPUT_DEVICE}: Headphones (AirPods/Earbuds)')
    print()

    try:
        with sd.Stream(
            samplerate    = SAMPLE_RATE,
            blocksize     = BLOCK_SIZE,
            channels      = CHANNELS,
            dtype         = DTYPE,
            device        = (INPUT_DEVICE, OUTPUT_DEVICE),
            callback      = audio_callback,
            latency       = 'low',
        ):
            while True:
                sd.sleep(1000)
    except sd.PortAudioError as e:
        print(f'\n  [Audio Error] {e}')
        print('  Trying default devices instead...')
        with sd.Stream(
            samplerate = SAMPLE_RATE,
            blocksize  = BLOCK_SIZE,
            channels   = CHANNELS,
            dtype      = DTYPE,
            callback   = audio_callback,
            latency    = 'low',
        ):
            while True:
                sd.sleep(1000)

    except KeyboardInterrupt:
        print('\n  Stopping...')
    finally:
        transcript_queue.put(None)


if __name__ == '__main__':
    main()
