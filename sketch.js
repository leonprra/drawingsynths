// -------------------- PAINT / UI SETUP --------------------

// Colors you specified
let colors = [
  'black',
  'white',
  'red',
  'purple',
  'blue',
  'green',
  '#00cc44',
  'yellow',
  '#ff9900'
];

let currentColor = 'black';
let sizeSlider;
let clearButton;
let scanButton;       // scanner toggle button

const PAD = 20;
let boxX, boxY, boxW, boxH;

// Off-screen drawing buffer
let drawingLayer;

// Scanner state
let scannerActive = false;  // is scanner running?
let scannerX;               // current X of scanner line
let scannerSpeed = 2;       // speed (pixels per frame)

// -------------------- AUDIO / SCANNER ANALYSIS STATE --------------------

// Per-colour audio state
let colorStates = [];   // one entry per colour
let paletteRGB = [];    // [{r,g,b}, ...] for each colour
let whiteIndex = -1;

let toneStarted = false;

// Band + smoothing parameters
const bandSize = 10;    // pixels per band
const maxBand = 5;      // maximum band index
const smoothing = 0.2;  // 0..1, how fast volume moves toward target

// Colour → pitch mapping (you can tweak this)
const pitchMap = {
  'black'   : 'C3',
  'white'   : null,   // silent
  'red'     : 'E3',
  'purple'  : 'G3',
  'blue'    : 'B3',
  'green'   : 'D4',
  '#00cc44' : 'F4',
  'yellow'  : 'A4',
  '#ff9900' : 'C5'
};

function setup() {
  textFont('"Press Start 2P"')
  createCanvas(900, 600);
  noCursor();

  // Drawing box dimensions
  boxX = PAD;
  boxY = 130;
  boxW = width - PAD * 2;
  boxH = height - 180;

  // Off-screen layer for strokes
  drawingLayer = createGraphics(width, height);
  drawingLayer.background(255);

  // Precompute palette RGB and white index
  whiteIndex = colors.indexOf('white');
  paletteRGB = colors.map(c => {
    let col = color(c);
    return {
      r: red(col),
      g: green(col),
      b: blue(col)
    };
  });

  // Brush size slider (8-bit style)
  sizeSlider = createSlider(2, 40, 8);
  sizeSlider.position(20, 55);          // your chosen position
  sizeSlider.style('width', '140px');
  stylePixelSlider(sizeSlider);

  // Color buttons (8-bit style)
  let startX = 200;                     // your chosen row origin
  let startY = 50;
  colors.forEach((c, i) => {
    let btn = createButton('');
    btn.position(startX + i * 40, startY);
    btn.size(30, 30);
    stylePixelColorButton(btn, c);
    btn.mousePressed(() => currentColor = c);
  });

  // Clear button
  clearButton = createButton('CLEAR');
  clearButton.position(22, 95);         // your chosen position
  stylePixelButton(clearButton);
  clearButton.mousePressed(() => {
    drawingLayer.background(255);
  });

  // Scanner toggle button
  scanButton = createButton('SCAN');
  scanButton.position(90, 95);          // your chosen position
  stylePixelButton(scanButton);
  scanButton.mousePressed(toggleScanner);

  // Initial scanner x at left edge of box
  scannerX = boxX;

  // Initial style reflects inactive state
  updateScanButtonStyle();

  // Set up Tone.js instruments if Tone is available
  setupAudioForColors();
}

function draw() {
  // 1. Draw on the off-screen layer (persistent)
  if (mouseIsPressed && insideBox(mouseX, mouseY)) {
    drawingLayer.stroke(currentColor);
    drawingLayer.strokeWeight(sizeSlider.value());
    drawingLayer.line(pmouseX, pmouseY, mouseX, mouseY);
  }

  // 2. Update scanner position if active
  if (scannerActive) {
    scannerX += scannerSpeed;
    // Wrap around when it leaves the drawing box
    if (scannerX > boxX + boxW) {
      scannerX = boxX;
    }
    // While active, analyse this column and update audio
    updateScannerAudio();
  }

  // 3. Clear main canvas each frame
  background(220);

  // 4. Draw the persistent drawing layer onto main canvas
  image(drawingLayer, 0, 0);

  // 5. UI: border and labels on top
  drawBorder();
  drawUIHints();

  // 6. Draw scanner line on top of drawing
  drawScanner();

  // 7. Draw brush preview cursor (no trail)
  drawCursorPreview();
}

// -------------------- GEOMETRY / UI --------------------

function insideBox(x, y) {
  return x > boxX && x < boxX + boxW && y > boxY && y < boxY + boxH;
}

function drawBorder() {
  push();
  noFill();
  stroke(0);
  strokeWeight(2);
  rect(boxX, boxY, boxW, boxH);
  pop();
}

function drawUIHints() {
  push();
  noStroke();
  fill(0);
  textSize(9);
  text('Brush size', 15, 40);
  text('Please draw inside the canvas! :)', boxX + 150, boxY - 20);
  pop();
}

// Draw a circle showing brush size at the cursor
function drawCursorPreview() {
  push();
  noFill();
  stroke(currentColor);
  strokeWeight(1);
  const d = sizeSlider.value();
  ellipse(mouseX, mouseY, d, d);
  pop();
}

// Draw the scanner line
function drawScanner() {
  if (!scannerActive) return;
  push();
  stroke('#00aaff');            // scanner line color
  strokeWeight(2);
  line(scannerX, boxY, scannerX, boxY + boxH);
  pop();
}

// Toggle scanner state when button is pressed
function toggleScanner() {
  scannerActive = !scannerActive;

  // On first interaction, start Tone audio context if available
  if (scannerActive && typeof Tone !== 'undefined' && !toneStarted) {
    Tone.start();
    toneStarted = true;
  }

  // If just activated and scanner is outside box, reset position
  if (scannerActive && (scannerX < boxX || scannerX > boxX + boxW)) {
    scannerX = boxX;
  }

  // If deactivated, release all notes
  if (!scannerActive) {
    stopAllColorNotes();
  }

  updateScanButtonStyle();
}

// Visual active / inactive state for SCAN button
function updateScanButtonStyle() {
  if (scannerActive) {
    // Pressed-in look
    scanButton.style('background-color', '#bbbbbb');
    scanButton.style('box-shadow', '1px 1px 0px #000 inset');
    scanButton.style('transform', 'translate(2px, 2px)');
  } else {
    // Normal look (same as base button)
    scanButton.style('background-color', '#f0f0f0');
    scanButton.style('box-shadow', '3px 3px 0px #000');
    scanButton.style('transform', 'translate(0px, 0px)');
  }
}

// Simple 8-bit / pixel style for general buttons
function stylePixelButton(btn) {
  btn.style('border', '3px solid #000');
  btn.style('border-radius', '0px');
  btn.style('background-color', '#f0f0f0');
  btn.style('font-family', 'monospace');
  btn.style('font-size', '12px');
  btn.style('padding', '4px 8px');
  btn.style('box-shadow', '3px 3px 0px #000');
  btn.style('cursor', 'pointer');
}

// 8-bit style for color buttons
function stylePixelColorButton(btn, colorValue) {
  stylePixelButton(btn);
  btn.style('background-color', colorValue);
  btn.html(''); // no text
}

// 8-bit style slider (browser-limited but close)
function stylePixelSlider(slider) {
  slider.style('border', '3px solid #000');
  slider.style('border-radius', '0px');
  slider.style('background', '#dddddd');
  slider.style('height', '14px');
  slider.style('cursor', 'pointer');
  slider.style('appearance', 'none');
}

// -------------------- AUDIO LOGIC --------------------

// Set up one synth + gain per colour
function setupAudioForColors() {
  if (typeof Tone === 'undefined') {
    // Tone.js not loaded – safe no-op
    colorStates = colors.map(c => ({
      name: c,
      pitch: pitchMap[c] || null,
      synth: null,
      gainNode: null,
      isActive: false,
      currentVolume: 0,
      targetVolume: 0
    }));
    return;
  }

  colorStates = colors.map(c => {
    const pitch = pitchMap[c] || null;

    if (!pitch) {
      // White or any silent colour
      return {
        name: c,
        pitch: null,
        synth: null,
        gainNode: null,
        isActive: false,
        currentVolume: 0,
        targetVolume: 0
      };
    }

    // One synth and gain per colour
    const synth = new Tone.Synth().toDestination();
    const gainNode = new Tone.Gain(0).toDestination();
    synth.connect(gainNode);

    return {
      name: c,
      pitch: pitch,
      synth: synth,
      gainNode: gainNode,
      isActive: false,
      currentVolume: 0,
      targetVolume: 0
    };
  });
}

// Release all notes and reset volumes
function stopAllColorNotes() {
  colorStates.forEach(state => {
    if (!state || !state.synth) return;
    if (state.isActive) {
      state.synth.triggerRelease();
      state.isActive = false;
    }
    state.targetVolume = 0;
    state.currentVolume = 0;
    if (state.gainNode) {
      state.gainNode.gain.value = 0;
    }
  });
}

// Analyse the current scanner column, compute bands, and update audio
function updateScannerAudio() {
  if (!colorStates || colorStates.length === 0) return;

  // If Tone is not available, skip audio work
  if (typeof Tone === 'undefined') return;

  // Count pixels per colour along the scanner column
  let pixelCounts = new Array(colors.length).fill(0);

  // Sample every pixel (you can change step to 2 or 4 to reduce cost)
  for (let y = boxY; y <= boxY + boxH; y++) {
    const col = drawingLayer.get(scannerX, y); // [r,g,b,a]
    const a = col[3];
    if (a < 10) continue; // mostly transparent → ignore

    const r = col[0];
    const g = col[1];
    const b = col[2];

    const idx = nearestPaletteIndex(r, g, b);
    if (idx === -1) continue;
    if (idx === whiteIndex) continue; // white is silent

    pixelCounts[idx]++;
  }

  // For each colour, compute target volume band and gate note
  for (let i = 0; i < colors.length; i++) {
    const state = colorStates[i];
    if (!state || !state.synth || !state.gainNode) continue; // skip white / silent colours

    const count = pixelCounts[i];

    if (count <= 0) {
      // No pixels → target volume zero, release if active
      state.targetVolume = 0;
      if (state.isActive) {
        state.synth.triggerRelease();
        state.isActive = false;
      }
    } else {
      // There are pixels → compute band and target volume
      const bandIndex = Math.min(maxBand, Math.floor(count / bandSize));
      const target = bandIndex / maxBand; // 0..1
      state.targetVolume = target;

      // If note not active, trigger attack
      if (!state.isActive) {
        state.synth.triggerAttack(state.pitch);
        state.isActive = true;
      }
    }
  }

  // Smooth currentVolume toward targetVolume and apply to gain
  colorStates.forEach(state => {
    if (!state || !state.gainNode || state.pitch === null) return;

    const tv = state.targetVolume;
    let cv = state.currentVolume;

    cv = cv + smoothing * (tv - cv);
    state.currentVolume = cv;

    // Map 0..1 directly to gain (you can replace with dB mapping if you want)
    state.gainNode.gain.value = cv;
  });
}

// Find the nearest palette colour index for a given RGB
function nearestPaletteIndex(r, g, b) {
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < paletteRGB.length; i++) {
    const p = paletteRGB[i];
    const dr = r - p.r;
    const dg = g - p.g;
    const db = b - p.b;
    const dist = dr * dr + dg * dg + db * db;

    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}
