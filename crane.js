// ── Math Crane ────────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

const BLOCK_COLORS = [
  '#7c3aed','#a855f7','#3b82f6','#06b6d4',
  '#22c55e','#f59e0b','#f97316','#ef4444',
  '#ec4899','#8b5cf6','#14b8a6','#84cc16',
];

// ── State ─────────────────────────────────────────────────────────────────
let state       = {};
let animId      = null;
let best        = parseInt(localStorage.getItem('crane_best') || '0');
let topic       = 'equations';
let eqSolved    = 0;          // equations solved this game
let pendingQuestion = false;  // waiting for answer
let currentEq   = null;       // { q, ans }
let countdownVal    = 3;      // seconds until next speed penalty
let countdownTimer  = null;   // setInterval for penalty countdown
let speedPenalties  = 0;      // how many penalties this question

// ── Resize ────────────────────────────────────────────────────────────────
function resize(){
  const hudH = document.getElementById('hud').offsetHeight;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight - hudH;
}
window.addEventListener('resize', () => { resize(); if(state.running) drawFrame(); });

// ── Topic selection ───────────────────────────────────────────────────────
window.selectTopic = function(t){
  topic = t;
  document.getElementById('topic-screen').classList.add('hidden');
  document.getElementById('howto-overlay').classList.remove('hidden');
};

document.getElementById('play-btn').addEventListener('click', () => {
  document.getElementById('howto-overlay').classList.add('hidden');
  document.getElementById('game-ui').classList.remove('hidden');
  startGame();
});

// ── Init game ─────────────────────────────────────────────────────────────
function startGame(){
  resize();
  eqSolved = 0;
  document.getElementById('hud-solved').textContent = '0';
  document.getElementById('hud-best').textContent   = best;

  const W = canvas.width;
  const H = canvas.height;
  const blockH = 28;
  const startW = Math.round(W * 0.55);
  const groundY = H - 40;

  const firstBlock = { x: Math.round((W - startW) / 2), y: groundY - blockH, w: startW, color: BLOCK_COLORS[0] };

  state = {
    running:    true,
    gameOver:   false,
    score:      0,
    blockH,
    groundY,
    stack:      [firstBlock],
    crane: {
      x:     0,
      y:     groundY - blockH * 2,
      w:     startW,
      dir:   1,
      speed: 1.6,   // start VERY slow
      color: BLOCK_COLORS[1],
    },
    colorIdx:   2,
    camY:       0,
    targetCamY: 0,
  };

  document.getElementById('drop-hint').style.opacity = '1';
  updateNextQHint();

  if(animId) cancelAnimationFrame(animId);
  loop();
}

// ── Game loop ─────────────────────────────────────────────────────────────
function loop(){
  if(!state.running) return;
  update();
  drawFrame();
  animId = requestAnimationFrame(loop);
}

function update(){
  const W = canvas.width;
  const c = state.crane;
  c.x += c.speed * c.dir;
  if(c.x + c.w >= W){ c.x = W - c.w; c.dir = -1; }
  if(c.x <= 0)       { c.x = 0;       c.dir =  1; }
  state.camY += (state.targetCamY - state.camY) * 0.08;
}

// ── Draw ──────────────────────────────────────────────────────────────────
function drawFrame(){
  const W = canvas.width;
  const H = canvas.height;
  const cam = Math.round(state.camY);

  ctx.clearRect(0, 0, W, H);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0f0f1a');
  sky.addColorStop(1, '#1e1e2e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Ground
  const gY = state.groundY + cam;
  ctx.fillStyle = '#374151';
  ctx.fillRect(0, gY + state.blockH, W, H);
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(0, gY + state.blockH, W, 4);

  // Stacked blocks
  state.stack.forEach(b => drawBlock(b.x, b.y + cam, b.w, state.blockH, b.color));

  // Crane block + wire
  if(!state.gameOver){
    const c = state.crane;
    ctx.strokeStyle = 'rgba(148,163,184,.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, 0);
    ctx.lineTo(c.x + c.w / 2, c.y + cam);
    ctx.stroke();
    ctx.setLineDash([]);
    drawBlock(c.x, c.y + cam, c.w, state.blockH, c.color);
  }
}

function drawBlock(x, y, w, h, color){
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.roundRect(x+3, y+3, w, h, 6); ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,.17)';
  ctx.beginPath(); ctx.roundRect(x+4, y+3, w-8, h/3, 4); ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,.1)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.stroke();
}

// ── Drop ──────────────────────────────────────────────────────────────────
function drop(){
  if(!state.running || state.gameOver || pendingQuestion) return;

  const crane = state.crane;
  const top   = state.stack[state.stack.length - 1];

  const overlapLeft  = Math.max(crane.x, top.x);
  const overlapRight = Math.min(crane.x + crane.w, top.x + top.w);
  const overlapW     = overlapRight - overlapLeft;

  document.getElementById('drop-hint').style.opacity = '0';

  if(overlapW <= 0){ triggerGameOver(); return; }

  // Place block
  const newBlock = {
    x:     overlapLeft,
    y:     top.y - state.blockH,
    w:     overlapW,
    color: crane.color,
  };
  state.stack.push(newBlock);
  state.score++;
  document.getElementById('hud-score').textContent = state.score;

  // Prepare next crane block
  crane.w     = overlapW;
  crane.x     = crane.dir === 1 ? 0 : canvas.width - crane.w;
  crane.y     = newBlock.y - state.blockH;
  crane.color = BLOCK_COLORS[state.colorIdx % BLOCK_COLORS.length];
  state.colorIdx++;

  // Camera scroll
  const blockScreenY = newBlock.y + state.camY;
  if(blockScreenY < canvas.height * 0.5) state.targetCamY += state.blockH;

  // Every 4 blocks → show equation
  if(state.score > 0 && state.score % 4 === 0){
    setTimeout(() => showQuestion(), 200);
    return;
  }

  updateNextQHint();
}

// ── Question system ───────────────────────────────────────────────────────
function showQuestion(){
  state.running  = false;  // pause game
  pendingQuestion = true;
  cancelAnimationFrame(animId);
  drawFrame(); // freeze the canvas

  currentEq      = generateEquation(state.score);
  speedPenalties = 0;
  countdownVal   = 3;

  document.getElementById('eq-display').textContent   = currentEq.q;
  document.getElementById('eq-input').value            = '';
  document.getElementById('eq-feedback').classList.add('hidden');
  document.getElementById('question-overlay').classList.remove('hidden');

  updateSpeedUI();

  // Focus input after a short delay (mobile keyboard)
  setTimeout(() => document.getElementById('eq-input').focus(), 150);

  // Countdown: every second, update display; every 3 seconds, penalise speed
  countdownTimer = setInterval(() => {
    countdownVal--;
    document.getElementById('countdown').textContent = countdownVal;

    if(countdownVal <= 0){
      // Speed penalty
      speedPenalties++;
      state.crane.speed = Math.min(state.crane.speed + 0.55, 11);
      updateSpeedUI();
      countdownVal = 3; // reset countdown for next penalty
      document.getElementById('countdown').textContent = countdownVal;
    }
  }, 1000);
}

function updateSpeedUI(){
  const speed = state.crane.speed;
  // Speed goes roughly 1.6 → 11, map to 6 dots
  const maxSpeed   = 11;
  const minSpeed   = 1.6;
  const proportion = (speed - minSpeed) / (maxSpeed - minSpeed);
  const activeDots = Math.round(proportion * 6);

  const dots = document.querySelectorAll('.dot');
  dots.forEach((d, i) => {
    d.classList.remove('active-slow','active-medium','active-fast');
    if(i < activeDots){
      if(i < 2)      d.classList.add('active-slow');
      else if(i < 4) d.classList.add('active-medium');
      else           d.classList.add('active-fast');
    }
  });

  const emoji = document.getElementById('speed-emoji');
  if(proportion < 0.33)      emoji.textContent = '🐢';
  else if(proportion < 0.66) emoji.textContent = '🏃';
  else                       emoji.textContent = '🚀';
}

function submitAnswer(){
  const raw = document.getElementById('eq-input').value.trim();
  if(raw === '') return;
  const guess = parseInt(raw);

  if(guess === currentEq.ans){
    // Correct!
    clearInterval(countdownTimer);
    document.getElementById('question-overlay').classList.add('hidden');
    pendingQuestion = false;
    eqSolved++;
    document.getElementById('hud-solved').textContent = eqSolved;

    // Small speed reward for answering correctly (faster than all penalties = slight slow)
    if(speedPenalties === 0) state.crane.speed = Math.max(state.crane.speed - 0.2, 1.6);

    // Resume game
    state.running = true;
    updateNextQHint();
    loop();
  } else {
    // Wrong — shake and try again
    const fb = document.getElementById('eq-feedback');
    fb.classList.remove('hidden');
    fb.textContent = '❌ Not quite — try again!';
    const inp = document.getElementById('eq-input');
    inp.value = '';
    inp.focus();
  }
}

function updateNextQHint(){
  const hint = document.getElementById('next-q-hint');
  if(!hint) return;
  const blocksUntilQ = 4 - (state.score % 4);
  if(blocksUntilQ === 4) hint.textContent = '';
  else hint.textContent = `📐 Question in ${blocksUntilQ} block${blocksUntilQ===1?'':'s'}`;
}

// ── Equation generation ───────────────────────────────────────────────────
function ri(a, b){ return Math.floor(Math.random() * (b - a + 1)) + a; }

function generateEquation(blockCount){
  // First 8 blocks = one-step only; 9-16 = mixed; 17+ = two-step only
  if(blockCount <= 8)  return generateOneStep();
  if(blockCount <= 16) return Math.random() < 0.5 ? generateOneStep() : generateTwoStep();
  return generateTwoStep();
}

function generateOneStep(){
  const type = ri(0, 2);
  if(type === 0){ // x + a = b
    const x = ri(1, 15), a = ri(1, 15);
    return { q: `x + ${a} = ${x + a}`, ans: x };
  }
  if(type === 1){ // x − a = b
    const x = ri(3, 18), a = ri(1, x - 1);
    return { q: `x − ${a} = ${x - a}`, ans: x };
  }
  // ax = b
  const a = ri(2, 9), x = ri(1, 10);
  return { q: `${a}x = ${a * x}`, ans: x };
}

function generateTwoStep(){
  const type = ri(0, 1);
  if(type === 0){ // ax + b = c
    const a = ri(2, 5), x = ri(1, 10), b = ri(1, 12);
    return { q: `${a}x + ${b} = ${a * x + b}`, ans: x };
  }
  // ax − b = c
  const a = ri(2, 5), x = ri(2, 10), b = ri(1, Math.max(1, a * x - 1));
  return { q: `${a}x − ${b} = ${a * x - b}`, ans: x };
}

// ── Game Over ─────────────────────────────────────────────────────────────
function triggerGameOver(){
  clearInterval(countdownTimer);
  state.gameOver = true;
  state.running  = false;
  pendingQuestion = false;
  cancelAnimationFrame(animId);
  drawFrame();

  if(state.score > best){
    best = state.score;
    localStorage.setItem('crane_best', best);
  }

  setTimeout(() => {
    document.getElementById('final-score').textContent    = state.score;
    document.getElementById('best-score').textContent     = best;
    document.getElementById('eq-solved-count').textContent = eqSolved;
    document.getElementById('gameover-screen').classList.remove('hidden');
  }, 350);
}

// ── Input handling ────────────────────────────────────────────────────────
canvas.addEventListener('click',      drop);
canvas.addEventListener('touchstart', e => { e.preventDefault(); drop(); }, { passive: false });
document.addEventListener('keydown', e => {
  if(pendingQuestion){
    if(e.key === 'Enter') submitAnswer();
    return;
  }
  if(e.code === 'Space' || e.code === 'ArrowDown') drop();
});

document.getElementById('eq-submit').addEventListener('click', submitAnswer);
document.getElementById('eq-input').addEventListener('keydown', e => {
  if(e.key === 'Enter') submitAnswer();
});

// ── Retry / Change Topic ──────────────────────────────────────────────────
document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('gameover-screen').classList.add('hidden');
  startGame();
});

document.getElementById('change-topic-btn').addEventListener('click', () => {
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('game-ui').classList.add('hidden');
  document.getElementById('topic-screen').classList.remove('hidden');
});

// ── Next question hint element (add to page) ──────────────────────────────
const nextHint = document.createElement('div');
nextHint.id = 'next-q-hint';
document.body.appendChild(nextHint);
