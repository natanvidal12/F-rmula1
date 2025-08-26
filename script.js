const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * ratio);
  canvas.height = Math.floor(canvas.clientHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
const ro = new ResizeObserver(resize);
ro.observe(canvas);

// Game state
const state = {
  started: false,
  paused: false,
  width: 0,
  height: 0,
  trackOffset: 0,
  trackCurveT: 0,
  lap: 1,
  totalLaps: 3,
  time: 0,
  lastTs: 0,
  best: null,
  countdown: 0,
};

// Player car
const car = {
  x: 0.5, // 0..1 across the road
  y: 0.78, // 0..1 down the screen (camera)
  angle: 0,
  speed: 0, // px per second (scaled)
  maxSpeed: 420, // base
  accel: 420,
  brake: 620,
  friction: 380,
  steer: 2.8, // radians per second scaled by speed factor
  width: 44,
  height: 86,
  damage: 0,
};

// Opponents / traffic
const rivals = [];

// Utilities
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (a, b) => a + Math.random() * (b - a);

function fmtTime(ms) {
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  const cs = ms % 1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(3,'0')}`;
}

// Input
const keys = new Set();
window.addEventListener('keydown', e => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Space","p","P","r","R"].includes(e.key))
    e.preventDefault();
  keys.add(e.key);
  if (e.key === ' ' || e.key === 'Spacebar') startRace();
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === 'r' || e.key === 'R') resetRace();
}, { passive: false });

window.addEventListener('keyup', e => keys.delete(e.key));

// Mobile pads
const bindPad = (id, downKey) => {
  const el = document.getElementById(id);
  if(!el) return;
  let pressed = false;
  const on = (ev) => { ev.preventDefault(); pressed = true; keys.add(downKey); el.style.transform = 'scale(.96)'; };
  const off = (ev) => { ev.preventDefault(); pressed = false; keys.delete(downKey); el.style.transform = ''; };
  ['pointerdown','touchstart'].forEach(t => el.addEventListener(t, on));
  ['pointerup','pointerleave','touchend','touchcancel'].forEach(t => el.addEventListener(t, off));
};
bindPad('left','ArrowLeft');
bindPad('right','ArrowRight');
bindPad('accel','ArrowUp');
bindPad('brake','ArrowDown');

// Track params
const track = {
  roadW: 520,
  laneW: 2,
  kerbW: 10,
  length: 3200, // meters of a lap (virtual)
  pixelPerM: 2.2,
  checkpoints: [0.25, 0.5, 0.75, 0.98],
};

function resetRace() {
  state.started = false;
  state.paused = false;
  state.time = 0;
  state.lap = 1;
  state.trackOffset = 0;
  state.trackCurveT = 0;
  car.speed = 0;
  car.x = 0.5;
  car.angle = 0;
  rivals.length = 0;
  spawnRivalsInitial();
  setStatus('Pressione ESPAÇO para largar');
}

function startRace() {
  if(!state.started){
    state.started = true;
    state.lastTs = performance.now();
    setStatus('Boa corrida!');
  }
}

function togglePause() {
  state.paused = !state.paused;
  setStatus(state.paused ? 'Jogo pausado' : '');
}

function setStatus(t) {
  document.getElementById('status').textContent = t;
}

function spawnRivalsInitial() {
  for(let i = 0; i < 10; i++){
    rivals.push(makeRival(rand(.15,.85), rand(-2000, 1500), rand(220,340)));
  }
}

function makeRival(rx, sy, sp) {
  return {
    x: rx,
    s: sp,
    y: sy,
    w: 46,
    h: 88,
    color: `hsl(${Math.floor(rand(0,360))} 80% 60%)`,
    blink: 0
  };
}

function maybeSpawnRival() {
  if (rivals.length < 12 && Math.random() < 0.02)
    rivals.push(makeRival(rand(.12,.88), -600, rand(240, 360)));
}

function update(dt) {
  state.width = canvas.clientWidth;
  state.height = canvas.clientHeight;

  // Steering
  const accel = keys.has('ArrowUp');
  const brake = keys.has('ArrowDown');
  const left = keys.has('ArrowLeft');
  const right = keys.has('ArrowRight');

  // speed
  if (accel) car.speed += car.accel * dt; else car.speed -= car.friction * dt;
  if (brake) car.speed -= car.brake * dt;
  car.speed = clamp(car.speed, 0, car.maxSpeed);

  // steering feels stronger at lower speed
  const steerFactor = lerp(1.2, 0.35, car.speed / car.maxSpeed);
  if (left) car.angle -= car.steer * steerFactor * dt;
  if (right) car.angle += car.steer * steerFactor * dt;
  car.angle *= 0.92; // auto-straighten

  // move horizontally within the road (0..1)
  car.x = clamp(car.x + car.angle*0.6*dt, 0.06, 0.94);

  // advance track
  state.trackOffset += (car.speed * dt);
  state.trackCurveT += dt * (0.25 + (car.speed / car.maxSpeed) * 0.65);

  // lap handling
  const lapPixels = track.length * track.pixelPerM;
  if (state.trackOffset >= lapPixels){
    state.trackOffset -= lapPixels;
    if (state.started){
      if (state.time > 0){
        if (state.best === null || state.time < state.best) state.best = state.time;
      }
      state.time = 0;
      state.lap++;
      if (state.lap > state.totalLaps){
        state.started = false;
        car.speed = 0;
        setStatus('🏁 Corrida finalizada! Pressione R para reiniciar');
      }
    }
  } else if (state.started) {
    state.time += dt * 1000;
  }

  // rivals move towards player
  for (const r of rivals){
    r.y += (r.s - car.speed) * dt;
    r.blink = Math.max(0, r.blink - dt);
  }

  // remove gone rivals
  for (let i = rivals.length - 1; i >= 0; i--){
    if (rivals[i].y > state.height + 120) rivals.splice(i,1);
  }
  maybeSpawnRival();

  // collisions (AABB)
  const playerRect = {
    x: roadX(car.x) - car.width / 2,
    y: car.y * state.height - car.height / 2,
    w: car.width,
    h: car.height
  };

  for (const r of rivals){
    const rect = { x: roadX(r.x) - r.w/2, y: r.y, w: r.w, h: r.h };
    if (intersect(playerRect, rect)){
      car.speed *= 0.5;
      r.y -= 24;
      r.blink = 0.25;
      setStatus('Colisão!');
    }
  }

  // UI updates
  document.getElementById('speed').textContent = Math.round(car.speed*1.2)+' km/h';
  document.getElementById('lap').textContent = `${Math.min(state.lap, state.totalLaps)} / ${state.totalLaps}`;
  document.getElementById('time').textContent = fmtTime(Math.floor(state.time));
  document.getElementById('best').textContent = state.best==null ? '—' : fmtTime(Math.floor(state.best));
}

function roadX(norm){
  const w = canvas.clientWidth;
  const center = w/2 + Math.sin(state.trackCurveT*0.8)*w*0.18 + Math.sin(state.trackCurveT*1.9)*w*0.08;
  const roadHalf = (track.roadW/2);
  return center - roadHalf + norm*track.roadW;
}

function intersect(a,b){
  return (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
}

function draw(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  // background grass
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--grass');
  ctx.fillRect(0,0,w,h);

  // road path with subtle curves
  const centerX = (x)=>roadX(x);
  const topY = -200;
  const bottomY = h+200;

  // draw kerbs stripes
  const stripeH = 28;
  const kerbW = track.kerbW;
  for (let y = (-(state.trackOffset % (stripeH*2))); y < h + stripeH*2; y += stripeH){
    // left kerb
    ctx.fillStyle = (Math.floor((y + state.trackOffset)/stripeH)%2 === 0) ? getCss('--kerb-red') : getCss('--kerb-white');
    ctx.fillRect(centerX(0)-kerbW-2, y, kerbW, stripeH);
    // right kerb
    ctx.fillRect(centerX(1)+2, y, kerbW, stripeH);
  }

  // road
  ctx.fillStyle = getCss('--road');
  ctx.beginPath();
  ctx.moveTo(centerX(0), topY);
  ctx.lineTo(centerX(1), topY);
  ctx.lineTo(centerX(1), bottomY);
  ctx.lineTo(centerX(0), bottomY);
  ctx.closePath();
  ctx.fill();

  // center line dashed
  ctx.globalAlpha = .35;
  ctx.fillStyle = getCss('--ui');
  for (let y = (-(state.trackOffset % 64)); y < h+64; y += 64){
    const mid = centerX(.5);
    ctx.fillRect(mid-2, y, 4, 32);
  }
  ctx.globalAlpha = 1;

  // rivals
  for (const r of rivals){
    drawCar(roadX(r.x), r.y, r.w, r.h, r.color, r.blink > 0 ? 0.35 : 0);
  }

  // player car
drawCar(roadX(car.x), car.y*h, car.width, car.height, car.color || '#00e0ff');
  // start/finish banner
  const bannerY = (h - (state.trackOffset % (track.length*track.pixelPerM)));
  ctx.save();
  ctx.translate(0, bannerY);
  drawFinishLine(centerX(0), centerX(1), 18);
  ctx.restore();
}

function getCss(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawFinishLine(x0, x1, height){
  const w = x1 - x0;
  const cell = 18;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(height / cell);
  for(let cy = 0; cy < rows; cy++){
    for(let cx = 0; cx < cols; cx++){
      const x = x0 + cx*cell;
      const y = -height + cy*cell;
      ctx.fillStyle = ((cx+cy)%2===0) ? '#eee' : '#111';
      ctx.fillRect(x,y,cell,cell);
    }
  }
  // pole
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.fillRect(x0-10, -height, 6, height+80);
}

function drawCar(x, y, w, h, color, blinkAlpha=0){
  const r = 10;
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;

  // body
  ctx.fillStyle = color;
  roundRect(-w/2, -h/2, w, h, r);
  ctx.fill();

  // cockpit
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  roundRect(-w*0.22, -h*0.06, w*0.44, h*0.26, 6);
  ctx.fill();

  // front/rear wings
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  roundRect(-w*0.6, -h*0.48, w*1.2, h*0.06, 6);
  ctx.fill();
  roundRect(-w*0.6, h*0.42, w*1.2, h*0.06, 6);
  ctx.fill();

  // wheels
  ctx.fillStyle = '#111';
  roundRect(-w*0.55, -h*0.25, w*0.16, h*0.2, 4); ctx.fill();
  roundRect(w*0.39, -h*0.25, w*0.16, h*0.2, 4); ctx.fill();
  roundRect(-w*0.55, h*0.05, w*0.16, h*0.2, 4); ctx.fill();
  roundRect(w*0.39, h*0.05, w*0.16, h*0.2, 4); ctx.fill();

  // blink (collision feedback)
  if (blinkAlpha > 0){
    ctx.globalAlpha = blinkAlpha;
    ctx.fillStyle = '#fff';
    roundRect(-w/2, -h/2, w, h, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function roundRect(x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

// Buttons
document.getElementById('btnPause').addEventListener('click', () => togglePause());
document.getElementById('btnReset').addEventListener('click', () => resetRace());

// Main loop
function loop(ts){
  if (!state.lastTs) state.lastTs = ts;
  const dt = Math.min(0.033, (ts - state.lastTs)/1000);
  state.lastTs = ts;
  resize();
  if (!state.paused){
    update(dt);
    draw();
  }
  requestAnimationFrame(loop);
}
document.querySelectorAll('.color').forEach(el => {
  el.addEventListener('click', ()=>{
    const selectedColor = el.dataset.color;
    car.color = selectedColor; // adiciona a propriedade 'color' no seu objeto car
    setStatus(`Cor do carro alterada!`);
  });
});


// init
resetRace();
spawnRivalsInitial();
requestAnimationFrame(loop);
