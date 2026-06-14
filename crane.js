// ── Math Crane — Solo + Multiplayer ──────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, off, remove, onDisconnect }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyABC8fBUEIj_jpMgWzJO8k0t-pffhyvTJs",
  authDomain: "mental-math-game-960db.firebaseapp.com",
  databaseURL: "https://mental-math-game-960db-default-rtdb.firebaseio.com",
  projectId: "mental-math-game-960db",
  storageBucket: "mental-math-game-960db.firebasestorage.app",
  messagingSenderId: "250468174968",
  appId: "1:250468174968:web:932d9893d23129dab1f18d"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Constants ─────────────────────────────────────────────────────────────────
const BLOCK_COLORS = [
  '#7c3aed','#a855f7','#3b82f6','#06b6d4',
  '#22c55e','#f59e0b','#f97316','#ef4444',
  '#ec4899','#8b5cf6','#14b8a6','#84cc16',
];

// ── Mode detection ────────────────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const gameMode  = urlParams.get('mode') || 'solo'; // 'solo' | 'multi'

// ── Profile ───────────────────────────────────────────────────────────────────
function getProfile(){
  try {
    const p = JSON.parse(localStorage.getItem('mmg_profile') || '{}');
    return { name: p.name || 'Player', avatar: p.avatar || '🐸' };
  } catch { return { name: 'Player', avatar: '🐸' }; }
}

// ── Player ID (per browser session) ──────────────────────────────────────────
let playerId = sessionStorage.getItem('crane_pid');
if(!playerId){
  playerId = 'p_' + Math.random().toString(36).substr(2, 9);
  sessionStorage.setItem('crane_pid', playerId);
}

// ── Canvas & State ────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

let state           = {};
let animId          = null;
let best            = parseInt(localStorage.getItem('crane_best') || '0');
let topic           = 'equations';
let eqSolved        = 0;
let pendingQuestion = false;
let currentEq       = null;
let countdownVal    = 3;
let countdownTimer  = null;
let speedPenalties  = 0;
let gamePaused      = false;

// Multiplayer state
let roomCode        = null;
let isHost          = false;
let roomListener    = null;
let playersListener = null;
let isMulti         = false;
let equationList    = [];
let isEliminated    = false;

// ── Mode banner ───────────────────────────────────────────────────────────────
if(gameMode === 'multi'){
  document.getElementById('mode-banner').textContent = '⚔️ Multiplayer';
  document.getElementById('mode-banner').className   = 'mode-banner multi-banner';
}

// ── Resize ────────────────────────────────────────────────────────────────────
function resize(){
  const hudH  = document.getElementById('hud').offsetHeight;
  const miniH = document.getElementById('mini-leaderboard').offsetHeight;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight - hudH - miniH;
}
window.addEventListener('resize', () => { resize(); if(state.running) drawFrame(); });

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(id){ document.getElementById(id).classList.remove('hidden'); }
function hide(id){ document.getElementById(id).classList.add('hidden'); }

// ══════════════════════════════════════════════════════════════════════════════
//  TOPIC SELECTION
// ══════════════════════════════════════════════════════════════════════════════
window.selectTopic = function(t){
  topic = t;
  hide('topic-screen');
  if(gameMode === 'multi'){
    document.getElementById('multi-topic-label').textContent = '1 & 2 Step Equations';
    show('multi-mode-screen');
  } else {
    show('howto-overlay');
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  MULTIPLAYER LOBBY
// ══════════════════════════════════════════════════════════════════════════════
function makeRoomCode(){
  return String(Math.floor(1000 + Math.random() * 9000));
}

document.getElementById('create-room-btn').addEventListener('click', async () => {
  const profile = getProfile();
  roomCode = makeRoomCode();
  isHost   = true;
  isMulti  = true;
  const seed = Math.floor(Math.random() * 999983) + 1;

  await set(ref(db, `crane_rooms/${roomCode}`), { topic, seed, status: 'lobby', hostId: playerId });
  await set(ref(db, `crane_rooms/${roomCode}/players/${playerId}`), {
    name: profile.name, avatar: profile.avatar, height: 0, solved: 0, alive: true,
  });
  onDisconnect(ref(db, `crane_rooms/${roomCode}/players/${playerId}`)).remove();

  hide('multi-mode-screen');
  showLobby();
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  hide('multi-mode-screen');
  show('join-screen');
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error').classList.add('hidden');
  setTimeout(() => document.getElementById('join-code-input').focus(), 200);
});

document.getElementById('join-submit-btn').addEventListener('click', joinRoom);
document.getElementById('join-code-input').addEventListener('keydown', e => { if(e.key==='Enter') joinRoom(); });

async function joinRoom(){
  const code = document.getElementById('join-code-input').value.trim();
  if(code.length !== 4){ showJoinError('Enter a 4-digit code!'); return; }

  const snap = await get(ref(db, `crane_rooms/${code}`));
  if(!snap.exists()){ showJoinError('Room not found. Check the code!'); return; }

  const room = snap.val();
  if(room.status !== 'lobby'){ showJoinError('This game already started!'); return; }

  const players = room.players || {};
  if(Object.keys(players).length >= 5){ showJoinError('Room is full (max 5 players)!'); return; }

  const profile = getProfile();
  roomCode = code; isHost = false; isMulti = true; topic = room.topic || 'equations';

  await set(ref(db, `crane_rooms/${roomCode}/players/${playerId}`), {
    name: profile.name, avatar: profile.avatar, height: 0, solved: 0, alive: true,
  });
  onDisconnect(ref(db, `crane_rooms/${roomCode}/players/${playerId}`)).remove();

  hide('join-screen');
  showLobby();
}

function showJoinError(msg){
  const el = document.getElementById('join-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showLobby(){
  document.getElementById('lobby-code-display').textContent = roomCode;
  const startBtn = document.getElementById('lobby-start-btn');
  startBtn.style.display = isHost ? 'block' : 'none';
  show('lobby-screen');
  listenToLobby();
}

function listenToLobby(){
  if(roomListener){ off(ref(db, `crane_rooms/${roomCode}`), 'value', roomListener); roomListener = null; }

  roomListener = onValue(ref(db, `crane_rooms/${roomCode}`), snap => {
    if(!snap.exists()) return;
    const room    = snap.val();
    const players = room.players || {};

    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    Object.entries(players).forEach(([pid, p]) => {
      const row = document.createElement('div');
      row.className = 'lobby-player-row';
      row.innerHTML = `<span class="lp-avatar">${p.avatar}</span><span class="lp-name">${p.name}${pid===room.hostId?' 👑':''}</span>`;
      list.appendChild(row);
    });

    const count = Object.keys(players).length;
    document.getElementById('lobby-waiting-msg').textContent =
      count >= 2 ? `${count} players ready!` : 'Waiting for at least 1 more player…';

    if(isHost){
      const btn = document.getElementById('lobby-start-btn');
      btn.disabled      = count < 2;
      btn.style.opacity = count < 2 ? '0.4' : '1';
    }

    if(room.status === 'countdown'){
      off(ref(db, `crane_rooms/${roomCode}`), 'value', roomListener);
      roomListener = null;
      hide('lobby-screen');
      startCountdown(room.seed);
    }
  });
}

document.getElementById('lobby-start-btn').addEventListener('click', async () => {
  await update(ref(db, `crane_rooms/${roomCode}`), { status: 'countdown' });
});

document.getElementById('lobby-leave-btn').addEventListener('click', leaveRoom);

async function leaveRoom(){
  if(roomListener){ off(ref(db, `crane_rooms/${roomCode}`), 'value', roomListener); roomListener = null; }
  if(roomCode) await remove(ref(db, `crane_rooms/${roomCode}/players/${playerId}`));
  if(isHost)   await remove(ref(db, `crane_rooms/${roomCode}`));
  roomCode = null; isHost = false; isMulti = false;
  hide('lobby-screen');
  show('topic-screen');
}

// ══════════════════════════════════════════════════════════════════════════════
//  COUNTDOWN → GAME START
// ══════════════════════════════════════════════════════════════════════════════
function startCountdown(seed){
  equationList = buildEquationList(seed);
  show('countdown-overlay');
  const numEl = document.getElementById('countdown-num');
  let n = 3;
  numEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if(n > 0){
      numEl.textContent = n;
    } else {
      clearInterval(iv);
      numEl.textContent = 'GO!';
      setTimeout(() => { hide('countdown-overlay'); startMultiGame(); }, 600);
    }
  }, 900);
}

// ══════════════════════════════════════════════════════════════════════════════
//  HOW TO PLAY → SOLO START
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('play-btn').addEventListener('click', () => {
  hide('howto-overlay');
  show('game-ui');
  document.getElementById('hud-best-item').style.display = '';
  hide('mini-leaderboard');
  startSoloGame();
});

// ══════════════════════════════════════════════════════════════════════════════
//  GAME ENGINE
// ══════════════════════════════════════════════════════════════════════════════
function initGameState(){
  const W = canvas.width, H = canvas.height;
  const blockH = 28, startW = Math.round(W * 0.55), groundY = H - 40;
  const firstBlock = { x: Math.round((W-startW)/2), y: groundY-blockH, w: startW, color: BLOCK_COLORS[0] };
  state = {
    running: true, gameOver: false, score: 0, blockH, groundY,
    stack: [firstBlock],
    crane: { x: 0, y: groundY-blockH*2, w: startW, dir: 1, speed: 1.6, color: BLOCK_COLORS[1] },
    colorIdx: 2, camY: 0, targetCamY: 0,
  };
}

function startSoloGame(){
  isMulti=false; isEliminated=false; eqSolved=0; pendingQuestion=false; gamePaused=false; equationList=[];
  resize();
  document.getElementById('hud-solved').textContent = '0';
  document.getElementById('hud-best').textContent   = best;
  document.getElementById('drop-hint').style.opacity = '1';
  initGameState(); updateNextQHint();
  if(animId) cancelAnimationFrame(animId);
  loop();
}

function startMultiGame(){
  isMulti=true; isEliminated=false; eqSolved=0; pendingQuestion=false; gamePaused=false;
  document.getElementById('hud-best-item').style.display = 'none';
  show('mini-leaderboard');
  show('game-ui');
  resize();
  document.getElementById('hud-solved').textContent = '0';
  document.getElementById('drop-hint').style.opacity = '1';
  initGameState(); updateNextQHint();
  if(animId) cancelAnimationFrame(animId);
  loop();
  syncToFirebase();
  listenToPlayers();
}

function loop(){
  if(!state.running) return;
  update(); drawFrame();
  animId = requestAnimationFrame(loop);
}

function update(){
  const W = canvas.width, c = state.crane;
  c.x += c.speed * c.dir;
  if(c.x + c.w >= W){ c.x = W-c.w; c.dir=-1; }
  if(c.x <= 0)       { c.x = 0;     c.dir= 1; }
  state.camY += (state.targetCamY - state.camY) * 0.08;
}

function drawFrame(){
  const W=canvas.width, H=canvas.height, cam=Math.round(state.camY);
  ctx.clearRect(0,0,W,H);
  const sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#0f0f1a'); sky.addColorStop(1,'#1e1e2e');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);
  const gY=state.groundY+cam;
  ctx.fillStyle='#374151'; ctx.fillRect(0,gY+state.blockH,W,H);
  ctx.fillStyle='#4b5563'; ctx.fillRect(0,gY+state.blockH,W,4);
  state.stack.forEach(b => drawBlock(b.x, b.y+cam, b.w, state.blockH, b.color));
  if(!state.gameOver){
    const c=state.crane;
    ctx.strokeStyle='rgba(148,163,184,.3)'; ctx.lineWidth=2;
    ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(c.x+c.w/2,0); ctx.lineTo(c.x+c.w/2,c.y+cam); ctx.stroke();
    ctx.setLineDash([]);
    drawBlock(c.x,c.y+cam,c.w,state.blockH,c.color);
  }
}

function drawBlock(x,y,w,h,color){
  ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.roundRect(x+3,y+3,w,h,6); ctx.fill();
  ctx.fillStyle=color;            ctx.beginPath(); ctx.roundRect(x,y,w,h,6);     ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.17)'; ctx.beginPath(); ctx.roundRect(x+4,y+3,w-8,h/3,4); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.1)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.roundRect(x,y,w,h,6); ctx.stroke();
}

// ── Drop ──────────────────────────────────────────────────────────────────────
function drop(){
  if(!state.running || state.gameOver || pendingQuestion) return;
  const crane=state.crane, top=state.stack[state.stack.length-1];
  const overlapLeft=Math.max(crane.x,top.x), overlapRight=Math.min(crane.x+crane.w,top.x+top.w);
  const overlapW=overlapRight-overlapLeft;
  document.getElementById('drop-hint').style.opacity='0';
  if(overlapW<=0){ triggerGameOver(); return; }

  const newBlock={x:overlapLeft, y:top.y-state.blockH, w:overlapW, color:crane.color};
  state.stack.push(newBlock);
  state.score++;
  document.getElementById('hud-score').textContent=state.score;

  crane.w=overlapW;
  crane.x=crane.dir===1 ? 0 : canvas.width-crane.w;
  crane.y=newBlock.y-state.blockH;
  crane.color=BLOCK_COLORS[state.colorIdx%BLOCK_COLORS.length];
  state.colorIdx++;

  if(newBlock.y+state.camY < canvas.height*0.5) state.targetCamY+=state.blockH;

  if(isMulti) syncToFirebase();

  if(state.score>0 && state.score%4===0){ setTimeout(()=>showQuestion(),200); return; }
  updateNextQHint();
}

// ── Question ──────────────────────────────────────────────────────────────────
function showQuestion(){
  state.running=false; pendingQuestion=true;
  cancelAnimationFrame(animId); drawFrame();

  if(isMulti && equationList.length>0){
    const idx=Math.floor(state.score/4)-1;
    currentEq=equationList[Math.min(idx, equationList.length-1)];
  } else {
    currentEq=generateEquation(state.score);
  }

  speedPenalties=0; countdownVal=3;
  document.getElementById('eq-display').textContent=currentEq.q;
  document.getElementById('eq-input').value='';
  document.getElementById('eq-feedback').classList.add('hidden');
  show('question-overlay'); updateSpeedUI();
  setTimeout(()=>document.getElementById('eq-input').focus(),150);

  countdownTimer=setInterval(()=>{
    countdownVal--;
    document.getElementById('countdown').textContent=countdownVal;
    if(countdownVal<=0){
      speedPenalties++;
      state.crane.speed=Math.min(state.crane.speed+0.55,11);
      updateSpeedUI(); countdownVal=3;
      document.getElementById('countdown').textContent=countdownVal;
    }
  },1000);
}

function updateSpeedUI(){
  const proportion=(state.crane.speed-1.6)/(11-1.6);
  const activeDots=Math.round(proportion*6);
  document.querySelectorAll('.dot').forEach((d,i)=>{
    d.classList.remove('active-slow','active-medium','active-fast');
    if(i<activeDots){
      if(i<2) d.classList.add('active-slow');
      else if(i<4) d.classList.add('active-medium');
      else d.classList.add('active-fast');
    }
  });
  document.getElementById('speed-emoji').textContent=proportion<0.33?'🐢':proportion<0.66?'🏃':'🚀';
}

function submitAnswer(){
  const raw=document.getElementById('eq-input').value.trim();
  if(raw==='') return;
  if(parseInt(raw)===currentEq.ans){
    clearInterval(countdownTimer); hide('question-overlay');
    pendingQuestion=false; eqSolved++;
    document.getElementById('hud-solved').textContent=eqSolved;
    if(speedPenalties===0) state.crane.speed=Math.max(state.crane.speed-0.2,1.6);
    state.running=true; updateNextQHint();
    if(isMulti) syncToFirebase();
    loop();
  } else {
    const fb=document.getElementById('eq-feedback');
    fb.classList.remove('hidden'); fb.textContent='❌ Not quite — try again!';
    document.getElementById('eq-input').value='';
    document.getElementById('eq-input').focus();
  }
}

function updateNextQHint(){
  const hint=document.getElementById('next-q-hint');
  if(!hint) return;
  const n=4-(state.score%4);
  hint.textContent=n===4?'':`📐 Question in ${n} block${n===1?'':'s'}`;
}

// ── Game Over ─────────────────────────────────────────────────────────────────
function triggerGameOver(){
  clearInterval(countdownTimer);
  state.gameOver=true; state.running=false; pendingQuestion=false;
  cancelAnimationFrame(animId); drawFrame();

  if(isMulti){
    multiEliminate();
  } else {
    if(state.score>best){ best=state.score; localStorage.setItem('crane_best',best); }
    setTimeout(()=>{
      document.getElementById('final-score').textContent=state.score;
      document.getElementById('best-score').textContent=best;
      document.getElementById('eq-solved-count').textContent=eqSolved;
      show('gameover-screen');
    },350);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MULTIPLAYER SYNC & LEADERBOARD
// ══════════════════════════════════════════════════════════════════════════════
function syncToFirebase(){
  if(!roomCode) return;
  update(ref(db,`crane_rooms/${roomCode}/players/${playerId}`),{
    height:state.score, solved:eqSolved, alive:true,
  });
}

function multiEliminate(){
  isEliminated=true;
  if(!roomCode) return;
  update(ref(db,`crane_rooms/${roomCode}/players/${playerId}`),{
    height:state.score, solved:eqSolved, alive:false,
  });
  hide('game-ui');
  show('spectator-overlay');

  if(playersListener){ off(ref(db,`crane_rooms/${roomCode}/players`),'value',playersListener); }
  playersListener=onValue(ref(db,`crane_rooms/${roomCode}/players`), snap=>{
    if(!snap.exists()) return;
    const players=snap.val();
    renderSpectatorLeaderboard(players);
    if(Object.values(players).filter(p=>p.alive).length===0){
      off(ref(db,`crane_rooms/${roomCode}/players`),'value',playersListener);
      playersListener=null;
      setTimeout(()=>showFinalResults(players),800);
    }
  });
}

function listenToPlayers(){
  if(playersListener){ off(ref(db,`crane_rooms/${roomCode}/players`),'value',playersListener); }
  playersListener=onValue(ref(db,`crane_rooms/${roomCode}/players`), snap=>{
    if(!snap.exists()||isEliminated) return;
    const players=snap.val();
    renderMiniLeaderboard(players);
    if(Object.values(players).filter(p=>p.alive).length===0 && !state.gameOver){
      off(ref(db,`crane_rooms/${roomCode}/players`),'value',playersListener);
      playersListener=null;
      setTimeout(()=>showFinalResults(players),800);
    }
  });
}

function sortPlayers(players){
  return Object.entries(players).map(([id,p])=>({id,...p})).sort((a,b)=>b.height-a.height);
}

function renderMiniLeaderboard(players){
  const ml=document.getElementById('mini-leaderboard');
  ml.innerHTML=sortPlayers(players).map((p,i)=>
    `<span class="ml-row${p.alive?'':' ml-dead'}">${i+1}.${p.avatar}${p.name}:${p.height}${p.alive?'':'💀'}</span>`
  ).join('');
  resize();
}

function renderSpectatorLeaderboard(players){
  document.getElementById('spectator-leaderboard').innerHTML=sortPlayers(players).map((p,i)=>{
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
    return `<div class="lb-row${p.alive?' lb-alive':' lb-dead'}">
      <span class="lb-rank">${medal}</span><span class="lb-avatar">${p.avatar}</span>
      <span class="lb-name">${p.name}</span><span class="lb-score">${p.height} blocks</span>
      <span class="lb-status">${p.alive?'🟢':'💀'}</span></div>`;
  }).join('');
  document.getElementById('spectator-waiting').textContent=
    sortPlayers(players).filter(p=>p.alive).length>0?'Game in progress…':'Game over!';
}

function showFinalResults(players){
  hide('spectator-overlay'); hide('game-ui');
  const sorted=sortPlayers(players);
  document.getElementById('final-rankings').innerHTML=sorted.map((p,i)=>{
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
    const isMe=p.id===playerId;
    return `<div class="fr-row${isMe?' fr-me':''}">
      <span class="fr-medal">${medal}</span><span class="fr-avatar">${p.avatar}</span>
      <span class="fr-name">${p.name}${isMe?' (You)':''}</span>
      <span class="fr-score">${p.height} blocks</span></div>`;
  }).join('');
  show('final-results-screen');
}

document.getElementById('rematch-btn').addEventListener('click', async ()=>{
  hide('final-results-screen');
  const snap=await get(ref(db,`crane_rooms/${roomCode}/players`));
  if(!snap.exists()) return;
  const updates={};
  Object.keys(snap.val()).forEach(pid=>{
    updates[`players/${pid}/height`]=0;
    updates[`players/${pid}/solved`]=0;
    updates[`players/${pid}/alive`]=true;
  });
  updates['status']='lobby';
  updates['seed']=Math.floor(Math.random()*999983)+1;
  await update(ref(db,`crane_rooms/${roomCode}`),updates);
  isEliminated=false; equationList=[];
  showLobby();
});

document.getElementById('results-home-btn').addEventListener('click', async ()=>{
  if(playersListener){ off(ref(db,`crane_rooms/${roomCode}/players`),'value',playersListener); playersListener=null; }
  if(roomCode) await remove(ref(db,`crane_rooms/${roomCode}/players/${playerId}`));
  window.location.href='index.html';
});

// ══════════════════════════════════════════════════════════════════════════════
//  EQUATION GENERATION
// ══════════════════════════════════════════════════════════════════════════════
function seededRand(seed){
  let s=(seed+1)*1664525;
  return ()=>{ s=(s*1664525+1013904223)&0xffffffff; return (s>>>0)/0xffffffff; };
}

function buildEquationList(seed){
  const rng=seededRand(seed), list=[];
  for(let i=0;i<60;i++){
    list.push(generateEquationSeeded((i+1)*4, rng));
  }
  return list;
}

function generateEquationSeeded(blockCount,rng){
  const ri=(a,b)=>Math.floor(rng()*(b-a+1))+a;
  if(blockCount<=8) return genOne(ri);
  if(blockCount<=16) return rng()<0.5?genOne(ri):genTwo(ri);
  return genTwo(ri);
}
function genOne(ri){
  const t=ri(0,2);
  if(t===0){const x=ri(1,15),a=ri(1,15);return{q:`x + ${a} = ${x+a}`,ans:x};}
  if(t===1){const x=ri(3,18),a=ri(1,x-1);return{q:`x − ${a} = ${x-a}`,ans:x};}
  const a=ri(2,9),x=ri(1,10);return{q:`${a}x = ${a*x}`,ans:x};
}
function genTwo(ri){
  const t=ri(0,1);
  if(t===0){const a=ri(2,5),x=ri(1,10),b=ri(1,12);return{q:`${a}x + ${b} = ${a*x+b}`,ans:x};}
  const a=ri(2,5),x=ri(2,10),b=ri(1,Math.max(1,a*x-1));return{q:`${a}x − ${b} = ${a*x-b}`,ans:x};
}

// Solo (uses Math.random)
function ri(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function generateEquation(blockCount){
  if(blockCount<=8)return generateOneStep();
  if(blockCount<=16)return Math.random()<0.5?generateOneStep():generateTwoStep();
  return generateTwoStep();
}
function generateOneStep(){
  const t=ri(0,2);
  if(t===0){const x=ri(1,15),a=ri(1,15);return{q:`x + ${a} = ${x+a}`,ans:x};}
  if(t===1){const x=ri(3,18),a=ri(1,x-1);return{q:`x − ${a} = ${x-a}`,ans:x};}
  const a=ri(2,9),x=ri(1,10);return{q:`${a}x = ${a*x}`,ans:x};
}
function generateTwoStep(){
  const t=ri(0,1);
  if(t===0){const a=ri(2,5),x=ri(1,10),b=ri(1,12);return{q:`${a}x + ${b} = ${a*x+b}`,ans:x};}
  const a=ri(2,5),x=ri(2,10),b=ri(1,Math.max(1,a*x-1));return{q:`${a}x − ${b} = ${a*x-b}`,ans:x};
}

// ══════════════════════════════════════════════════════════════════════════════
//  INPUT / PAUSE / QUIT
// ══════════════════════════════════════════════════════════════════════════════
canvas.addEventListener('click', drop);
canvas.addEventListener('touchstart', e=>{e.preventDefault();drop();},{passive:false});
document.addEventListener('keydown', e=>{
  if(pendingQuestion){if(e.key==='Enter')submitAnswer();return;}
  if(e.code==='KeyP'||e.code==='Escape'){gamePaused?resumeGame():pauseGame();return;}
  if(e.code==='Space'||e.code==='ArrowDown')drop();
});
document.getElementById('eq-submit').addEventListener('click',submitAnswer);
document.getElementById('eq-input').addEventListener('keydown',e=>{if(e.key==='Enter')submitAnswer();});

function pauseGame(){
  if(state.gameOver||pendingQuestion||isMulti) return;
  gamePaused=true; state.running=false;
  cancelAnimationFrame(animId); drawFrame(); show('pause-overlay');
}
function resumeGame(){
  gamePaused=false; state.running=true; hide('pause-overlay'); loop();
}
document.getElementById('hud-pause-btn').addEventListener('click',()=>{if(!isMulti)pauseGame();});
document.getElementById('resume-btn').addEventListener('click',resumeGame);

function showQuitConfirm(){
  if(!gamePaused&&!pendingQuestion){
    state.running=false; cancelAnimationFrame(animId); drawFrame();
  }
  hide('pause-overlay'); show('crane-quit-overlay');
}
function cancelQuit(){
  hide('crane-quit-overlay');
  if(gamePaused){show('pause-overlay');return;}
  if(pendingQuestion){show('question-overlay');return;}
  resumeGame();
}
async function confirmQuit(){
  clearInterval(countdownTimer); cancelAnimationFrame(animId);
  state.gameOver=true; state.running=false; gamePaused=false; pendingQuestion=false;
  hide('crane-quit-overlay'); hide('pause-overlay'); hide('question-overlay'); hide('game-ui');
  if(isMulti&&roomCode){
    await update(ref(db,`crane_rooms/${roomCode}/players/${playerId}`),{alive:false,height:state.score,solved:eqSolved});
    if(playersListener){off(ref(db,`crane_rooms/${roomCode}/players`),'value',playersListener);playersListener=null;}
    isMulti=false;
  }
  show('topic-screen');
}
document.getElementById('hud-quit-btn').addEventListener('click',showQuitConfirm);
document.getElementById('pause-quit-btn').addEventListener('click',showQuitConfirm);
document.getElementById('quit-no-btn').addEventListener('click',cancelQuit);
document.getElementById('quit-yes-btn').addEventListener('click',confirmQuit);

document.getElementById('retry-btn').addEventListener('click',()=>{
  hide('gameover-screen'); show('game-ui'); gamePaused=false; startSoloGame();
});
document.getElementById('change-topic-btn').addEventListener('click',()=>{
  hide('gameover-screen'); hide('game-ui'); show('topic-screen');
});

document.getElementById('multi-back-btn').addEventListener('click',()=>{ hide('multi-mode-screen'); show('topic-screen'); });
document.getElementById('join-back-btn').addEventListener('click',()=>{ hide('join-screen'); show('multi-mode-screen'); });

// ── Next question hint ────────────────────────────────────────────────────────
const nextHint=document.createElement('div');
nextHint.id='next-q-hint';
document.body.appendChild(nextHint);
