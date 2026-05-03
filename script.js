/* ============================================================
   ClearEar AI — Real-Time Hearing Aid Engine
   Uses: Web Audio API (WDRC + Noise Gate + Soft Clip)
         Web Speech API (Google Cloud Transcription)
   ============================================================ */

/* ---- State ---- */
let audioCtx       = null;
let sourceNode     = null;
let gainNode       = null;
let compressorNode = null;
let analyserNode   = null;
let stream         = null;
let recognition    = null;
let animFrame      = null;
let isActive       = false;
let wdrcInterval   = null;

const MAX_GAIN = 100;

/* ---- UI refs ---- */
const toggleBtn    = document.getElementById('toggleBtn');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const gainSlider   = document.getElementById('gainSlider');
const gateSlider   = document.getElementById('gateSlider');
const gainDisplay  = document.getElementById('gainDisplay');
const gateDisplay  = document.getElementById('gateDisplay');
const inputVolEl   = document.getElementById('inputVol');
const outputVolEl  = document.getElementById('outputVol');
const appliedEl    = document.getElementById('appliedGain');
const inputBar     = document.getElementById('inputBar');
const gainBar      = document.getElementById('gainBar');
const outputBar    = document.getElementById('outputBar');
const transcriptEl = document.getElementById('transcriptOutput');
const warnBanner   = document.getElementById('warnBanner');
const canvas       = document.getElementById('waveform');
const navDot       = document.getElementById('navDot');

/* ---- Slider live labels ---- */
gainSlider.addEventListener('input', () => {
  gainDisplay.textContent = gainSlider.value + '×';
  if (gainNode) gainNode.gain.setTargetAtTime(parseFloat(gainSlider.value), audioCtx.currentTime, 0.01);
});

gateSlider.addEventListener('input', () => {
  gateDisplay.textContent = gateSlider.value;
});

/* ---- Main Toggle ---- */
async function toggleHearingAid() {
  if (isActive) {
    stopHearingAid();
  } else {
    await startHearingAid();
  }
}

async function startHearingAid() {
  // Show headphone warning
  warnBanner.classList.add('show');

  try {
    // 1. Get Microphone
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  false,
        sampleRate: 48000
      }
    });
  } catch(e) {
    statusText.textContent = 'Microphone access denied. Please allow microphone.';
    return;
  }

  // 2. Build Web Audio Pipeline
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

  sourceNode    = audioCtx.createMediaStreamSource(stream);
  analyserNode  = audioCtx.createAnalyser();
  gainNode      = audioCtx.createGain();
  compressorNode = audioCtx.createDynamicsCompressor();

  // WDRC / Compressor settings (matches Python WDRC behaviour)
  compressorNode.threshold.value = -50;  // Compress anything above -50dB
  compressorNode.knee.value      = 20;   // Soft knee
  compressorNode.ratio.value     = 4;    // 4:1 compression ratio
  compressorNode.attack.value    = 0.003;// 3ms fast attack
  compressorNode.release.value   = 0.8;  // 800ms slow release (avoids "pumping")

  // Initial gain from slider
  gainNode.gain.setValueAtTime(parseFloat(gainSlider.value), audioCtx.currentTime);

  // Analyser for waveform
  analyserNode.fftSize = 2048;

  // Pipeline: source → gain → compressor → analyser → output speakers
  sourceNode.connect(gainNode);
  gainNode.connect(compressorNode);
  compressorNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);

  // 3. Start Speech Recognition
  startTranscription();

  // 4. Start Waveform Animation
  drawWaveform();

  // 5. Start Noise Gate & Meter updates
  wdrcInterval = setInterval(updateMeters, 80);

  // 6. Update UI
  isActive = true;
  toggleBtn.textContent  = '■ Stop Hearing Aid';
  toggleBtn.classList.add('active');
  statusDot.classList.add('active');
  statusText.textContent = 'Active — Amplifying & Transcribing...';
  navDot.style.background = 'var(--success)';
}

function stopHearingAid() {
  isActive = false;

  if (stream)        { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (analyserNode)  { analyserNode.disconnect(); analyserNode = null; }
  if (gainNode)      { gainNode.disconnect(); gainNode = null; }
  if (compressorNode){ compressorNode.disconnect(); compressorNode = null; }
  if (sourceNode)    { sourceNode.disconnect(); sourceNode = null; }
  if (audioCtx)      { audioCtx.close(); audioCtx = null; }
  if (recognition)   { recognition.stop(); recognition = null; }
  if (animFrame)     { cancelAnimationFrame(animFrame); animFrame = null; }
  if (wdrcInterval)  { clearInterval(wdrcInterval); wdrcInterval = null; }

  toggleBtn.textContent = '▶ Start Hearing Aid';
  toggleBtn.classList.remove('active');
  statusDot.classList.remove('active');
  statusText.textContent = 'Stopped — Click Start to activate';
  navDot.style.background = 'var(--danger)';
  warnBanner.classList.remove('show');

  // Reset meters
  inputVolEl.textContent  = '0 dB';
  outputVolEl.textContent = '0 dB';
  appliedEl.textContent   = '0×';
  inputBar.style.width  = '0%';
  gainBar.style.width   = '0%';
  outputBar.style.width = '0%';

  // Clear canvas
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* ---- Waveform Visualiser ---- */
function drawWaveform() {
  const ctx    = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  const bufferLen = analyserNode.frequencyBinCount;
  const dataArr   = new Float32Array(bufferLen);

  function render() {
    if (!isActive || !analyserNode) return;
    animFrame = requestAnimationFrame(render);
    canvas.width = canvas.offsetWidth;

    analyserNode.getFloatTimeDomainData(dataArr);

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth   = 2;
    ctx.strokeStyle = '#06b6d4';
    ctx.beginPath();

    const sliceW = canvas.width / bufferLen;
    let x = 0;
    for (let i = 0; i < bufferLen; i++) {
      const v = dataArr[i];
      const y = (v * 0.5 + 0.5) * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.stroke();
  }
  render();
}

/* ---- Volume Meters & Noise Gate ---- */
function rmsToDb(rms) {
  return rms < 0.00001 ? -100 : 20 * Math.log10(rms);
}

function updateMeters() {
  if (!analyserNode || !audioCtx) return;

  const bufLen = analyserNode.frequencyBinCount;
  const data   = new Float32Array(bufLen);
  analyserNode.getFloatTimeDomainData(data);

  // Input RMS
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
  const rms = Math.sqrt(sumSq / data.length);
  const dbIn = rmsToDb(rms);

  // Noise Gate: if rms below threshold (scaled 0–1), cut gain to 0.01
  const gate = parseFloat(gateSlider.value) / 1000; // scale slider 0-40 → 0-0.04
  const currentGain = parseFloat(gainSlider.value);
  if (rms < gate && gainNode) {
    // Slower release (0.2s) so it doesn't chop the tail end of words
    gainNode.gain.setTargetAtTime(0.01, audioCtx.currentTime, 0.2); 
    appliedEl.textContent = '0.01×';
    gainBar.style.width = '0%';
  } else if (gainNode) {
    // Fast attack (0.02s) to instantly catch the beginning of words
    gainNode.gain.setTargetAtTime(currentGain, audioCtx.currentTime, 0.02); 
    appliedEl.textContent = currentGain + '×';
    gainBar.style.width = Math.min((currentGain / MAX_GAIN) * 100, 100) + '%';
  }

  // Estimated output dB
  const dbOut = dbIn + 20 * Math.log10(Math.max(currentGain, 0.01));

  inputVolEl.textContent  = dbIn  > -80 ? dbIn.toFixed(1)  + ' dB' : '— dB';
  outputVolEl.textContent = dbOut > -80 ? dbOut.toFixed(1) + ' dB' : '— dB';

  const inPct  = Math.min(Math.max((dbIn  + 60) / 60 * 100, 0), 100);
  const outPct = Math.min(Math.max((dbOut + 60) / 60 * 100, 0), 100);
  inputBar.style.width  = inPct  + '%';
  outputBar.style.width = outPct + '%';
}

/* ---- Transcription ---- */
let fullTranscript = '';

function startTranscription() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    transcriptEl.innerHTML = '<span style="color:var(--warn)">⚠ Speech Recognition is not supported in this browser. Please use Google Chrome.</span>';
    return;
  }

  recognition = new SR();
  recognition.continuous    = true;
  recognition.interimResults = true;
  recognition.lang          = 'hi-IN'; // Hindi/Urdu — outputs Roman via ITRANS phonetics

  recognition.onstart = () => {
    transcriptEl.innerHTML = '<span style="color:var(--muted)">Listening...<span class="t-cursor"></span></span>';
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript + ' ';
      } else {
        interim += transcript;
      }
    }

    if (finalText) {
      fullTranscript += finalText;
    }

    // Show last ~300 chars of final + current partial
    const display = fullTranscript.slice(-300);
    transcriptEl.innerHTML =
      `<span class="live-text">${display}</span>` +
      (interim ? `<span class="partial"> ${interim}<span class="t-cursor"></span></span>` : '<span class="t-cursor"></span>');
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  };

  recognition.onerror = (e) => {
    if (e.error === 'network') {
      transcriptEl.innerHTML += '<br><span style="color:var(--warn)">⚠ Network error. Make sure your laptop is connected to Wi-Fi.</span>';
    }
    if (e.error !== 'no-speech') {
      setTimeout(() => { if (isActive && recognition) { recognition.stop(); recognition.start(); } }, 1000);
    }
  };

  recognition.onend = () => {
    if (isActive) recognition.start(); // Auto-restart for continuous recognition
  };

  recognition.start();
}

/* ---- Scroll Fade-in ---- */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

/* ---- Stagger feature cards ---- */
document.querySelectorAll('.feature-card, .step-card').forEach((card, i) => {
  card.style.transitionDelay = `${i * 70}ms`;
  card.classList.add('fade-in');
  observer.observe(card);
});
