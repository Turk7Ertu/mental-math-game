// ── Math Crane — core stacker game ───────────────────────────────────────

const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

// ── Block colours (cycling) ───────────────────────────────────────────────
const BLOCK_COLORS = [
  '#7c3aed','#a855f7','#3b82f6','#06b6d4',
  '#22c55e','#f59e0b','#f97316','#ef4444',
  '#ec4899','#8b5cf6','#14b8a6','#84cc16',
];

// ── Game state ────────────────────────────────────────────────────────────
let state = {};
let animId = null;
let best   = parseInt(localStorage.getItem('crane_best') || '0');

// ── Canvas sizing ─────────────────────────────────────────────────────────
function resize(){
  const hudH = document.getElementById('hud').offsetHeight;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight - hudH;
}
window.addEventListener('resize', () => { resize(); if(state.running) drawFrame(); });

// ── Init / Reset ──────────────────────────────────────────────────────────
function initGame(){
  resize();

  const W = canvas.width;
  const H = canvas.height;
  const blockH   = 28;
  const startW   = Math.round(W * 0.55);  // starting block width
  const groundY  = H - 40;                // y of the ground line

  // Stack holds all placed blocks: { x, y, w, color }
  const firstBlock = {
    x: Math.round((W - startW) / 2),
    y: groundY - blockH,
    w: startW,
    color: BLOCK_COLORS[0],
  };

  state = {
    running:   true,
    gameOver:  false,
    score:     0,
    blockH,
    groundY,
    stack:     [firstBlock],
    // Moving crane block
    crane: {
      x:    0,
      y:    groundY - blockH * 2,  // one block above the stack top
      w:    startW,
      dir:  1,                      // 1 = right, -1 = left
      speed: 3,
      color: BLOCK_COLORS[1],
    },
    colorIdx: 2,
    // Camera offset — scroll up as tower grows
    camY: 0,
    targetCamY: 0,
  };

  document.getElementById('hud-best').textContent  = best;
  document.getElementById('hud-score').textContent = 0;
  document.getElementById('drop-hint').style.opacity = '1';

  if(animId) cancelAnimationFrame(animId);
  loop();
}

// ── Main loop ─────────────────────────────────────────────────────────────
function loop(){
  if(!state.running) return;
  update();
  drawFrame();
  animId = requestAnimationFrame(loop);
}

function update(){
  const W = canvas.width;
  const crane = state.crane;

  // Move crane
  crane.x += crane.speed * crane.dir;

  // Bounce off walls
  if(crane.x + crane.w >= W){ crane.x = W - crane.w; crane.dir = -1; }
  if(crane.x <= 0)           { crane.x = 0;           crane.dir =  1; }

  // Smooth camera
  state.camY += (state.targetCamY - state.camY) * 0.08;
}

// ── Draw ──────────────────────────────────────────────────────────────────
function drawFrame(){
  const W = canvas.width;
  const H = canvas.height;
  const cam = Math.round(state.camY);

  ctx.clearRect(0, 0, W, H);

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,   '#0f0f1a');
  sky.addColorStop(1,   '#1e1e2e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Ground
  const gY = state.groundY + cam;
  ctx.fillStyle = '#374151';
  ctx.fillRect(0, gY + state.blockH, W, H - gY - state.blockH);
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(0, gY + state.blockH, W, 4);

  // Draw stacked blocks
  state.stack.forEach(b => {
    drawBlock(b.x, b.y + cam, b.w, state.blockH, b.color);
  });

  // Draw crane block
  if(!state.gameOver){
    const c = state.crane;
    drawBlock(c.x, c.y + cam, c.w, state.blockH, c.color);
    // Draw crane wire
    ctx.strokeStyle = 'rgba(148,163,184,.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5,5]);
    ctx.beginPath();
    ctx.moveTo(c.x + c.w / 2, 0);
    ctx.lineTo(c.x + c.w / 2, c.y + cam);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBlock(x, y, w, h, color){
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 3, w, h, 6);
  ctx.fill();

  // Main block
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();

  // Shine
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 3, w - 8, h / 3, 4);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.stroke();
}

// ── Drop ──────────────────────────────────────────────────────────────────
function drop(){
  if(!state.running || state.gameOver) return;

  const crane = state.crane;
  const top   = state.stack[state.stack.length - 1];

  // Calculate overlap
  const overlapLeft  = Math.max(crane.x, top.x);
  const overlapRight = Math.min(crane.x + crane.w, top.x + top.w);
  const overlapW     = overlapRight - overlapLeft;

  // Hide hint after first drop
  document.getElementById('drop-hint').style.opacity = '0';

  if(overlapW <= 0){
    // Missed completely — game over
    triggerGameOver();
    return;
  }

  // Place trimmed block on stack
  const newBlock = {
    x:     overlapLeft,
    y:     top.y - state.blockH,
    w:     overlapW,
    color: crane.color,
  };
  state.stack.push(newBlock);
  state.score++;

  // Update score display
  document.getElementById('hud-score').textContent = state.score;

  // Speed up crane slightly every 5 blocks (max speed 9)
  const newSpeed = Math.min(3 + Math.floor(state.score / 5) * 0.6, 9);
  crane.speed = newSpeed;

  // Next crane block — same width as what was just placed
  crane.w     = overlapW;
  crane.x     = crane.dir === 1 ? 0 : canvas.width - crane.w;
  crane.y     = newBlock.y - state.blockH;
  crane.color = BLOCK_COLORS[state.colorIdx % BLOCK_COLORS.length];
  state.colorIdx++;

  // Scroll camera up when tower is in upper half of screen
  const blockScreenY = newBlock.y + state.camY;
  if(blockScreenY < canvas.height * 0.5){
    state.targetCamY += state.blockH;
  }
}

// ── Game Over ─────────────────────────────────────────────────────────────
function triggerGameOver(){
  state.gameOver = true;
  state.running  = false;
  cancelAnimationFrame(animId);

  // Final draw with shake effect
  drawFrame();

  // Update best
  if(state.score > best){
    best = state.score;
    localStorage.setItem('crane_best', best);
  }

  setTimeout(() => {
    document.getElementById('final-score').textContent = state.score;
    document.getElementById('best-score').textContent  = best;
    document.getElementById('gameover-screen').classList.remove('hidden');
  }, 400);
}

// ── Input ─────────────────────────────────────────────────────────────────
canvas.addEventListener('click',      drop);
canvas.addEventListener('touchstart', e => { e.preventDefault(); drop(); }, { passive: false });
document.addEventListener('keydown',  e => { if(e.code === 'Space' || e.code === 'ArrowDown') drop(); });

// ── Buttons ───────────────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('game-ui').classList.remove('hidden');
  initGame();
});

document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('hud-best').textContent = best;
  initGame();
});
