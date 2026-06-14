// ── Math Crane — Solo + Multiplayer ──────────────────────────────────────────

// ── Firebase (compat SDK — loaded via <script> tags in crane.html) ────────────
const firebaseConfig = {
  apiKey:            "AIzaSyABC8fBUEIj_jpMgWzJO8k0t-pffhyvTJs",
  authDomain:        "mental-math-game-960db.firebaseapp.com",
  databaseURL:       "https://mental-math-game-960db-default-rtdb.firebaseio.com",
  projectId:         "mental-math-game-960db",
  storageBucket:     "mental-math-game-960db.firebasestorage.app",
  messagingSenderId: "250468174968",
  appId:             "1:250468174968:web:932d9893d23129dab1f18d"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ── Constants ─────────────────────────────────────────────────────────────────
const BLOCK_COLORS = [
  '#7c3aed','#a855f7','#3b82f6','#06b6d4',
  '#22c55e','#f59e0b','#f97316','#ef4444',
  '#ec4899','#8b5cf6','#14b8a6','#84cc16',
];

// ── Mode detection ────────────────────────────────────────────────────────────
const urlParams  = new URLSearchParams(window.location.search);
const gameMode   = urlParams.get('mode') || 'solo';
const joinCode   = urlParams.get('code') || null;

// ── Profile ───────────────────────────────────────────────────────────────────
function getProfile(){
  try {
    const p = JSON.parse(localStorage.getItem('mmg_profile') || '{}');
    return { name: p.name || 'Player', avatar: p.avatar || '🐸' };
  } catch(e) { return { name: 'Player', avatar: '🐸' }; }
}

// ── Player ID ─────────────────────────────────────────────────────────────────
let playerId = sessionStorage.getItem('crane_pid');
if(!playerId){
  playerId = 'p_' + Math.random().toString(36).substr(2, 9);
  sessionStorage.setItem('crane_pid', playerId);
}

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ── State ─────────────────────────────────────────────────────────────────────
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
let roomRef         = null;
let roomListener    = null;
let playersRef      = null;
let playersListener = null;
let isMulti         = false;
let equationList    = [];
let isEliminated    = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function show(id){ document.getElementById(id).classList.remove('hidden'); }
function hide(id){ document.getElementById(id).classList.add('hidden'); }

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
window.addEventListener('resize', function(){ resize(); if(state.running) drawFrame(); });

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

document.getElementById('create-room-btn').addEventListener('click', function(){
  var btn = document.getElementById('create-room-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  var profile = getProfile();
  roomCode = makeRoomCode();
  isHost   = true;
  isMulti  = true;
  var seed = Math.floor(Math.random() * 999983) + 1;

  db.ref('rooms/' + roomCode).set({
    gameType: 'crane', topic: topic, seed: seed, status: 'lobby', hostId: playerId
  }).then(function(){
    var playerData = { name: profile.name, avatar: profile.avatar, height: 0, solved: 0, alive: true };
    return db.ref('rooms/' + roomCode + '/players/' + playerId).set(playerData);
  }).then(function(){
    db.ref('rooms/' + roomCode + '/players/' + playerId).onDisconnect().remove();
    btn.disabled = false; btn.textContent = '🏠 Create a Room';
    hide('multi-mode-screen');
    showLobby();
  }).catch(function(err){
    btn.disabled = false; btn.textContent = '🏠 Create a Room';
    alert('Could not create room: ' + err.message);
  });
});

document.getElementById('join-room-btn').addEventListener('click', function(){
  hide('multi-mode-screen');
  show('join-screen');
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error').classList.add('hidden');
  setTimeout(function(){ document.getElementById('join-code-input').focus(); }, 200);
});

document.getElementById('join-submit-btn').addEventListener('click', joinRoom);
document.getElementById('join-code-input').addEventListener('keydown', function(e){
  if(e.key === 'Enter') joinRoom();
});

function joinRoom(){
  var code = document.getElementById('join-code-input').value.trim();
  if(code.length !== 4){ showJoinError('Enter a 4-digit code!'); return; }

  db.ref('rooms/' + code).once('value').then(function(snap){
    if(!snap.exists()){ showJoinError('Room not found. Check the code!'); return; }
    var room = snap.val();
    if(room.status !== 'lobby'){ showJoinError('This game already started!'); return; }
    var players = room.players || {};
    if(Object.keys(players).length >= 5){ showJoinError('Room is full (max 5 players)!'); return; }

    var profile = getProfile();
    roomCode = code; isHost = false; isMulti = true; topic = room.topic || 'equations';

    var playerData = { name: profile.name, avatar: profile.avatar, height: 0, solved: 0, alive: true };
    db.ref('rooms/' + roomCode + '/players/' + playerId).set(playerData);
    db.ref('rooms/' + roomCode + '/players/' + playerId).onDisconnect().remove();

    hide('join-screen');
    showLobby();
  });
}

function showJoinError(msg){
  var el = document.getElementById('join-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showLobby(){
  document.getElementById('lobby-code-display').textContent = roomCode;
  var startBtn = document.getElementById('lobby-start-btn');
  startBtn.style.display = isHost ? 'block' : 'none';
  show('lobby-screen');
  listenToLobby();
}

function listenToLobby(){
  if(roomRef && roomListener){ roomRef.off('value', roomListener); }
  roomRef = db.ref('rooms/' + roomCode);

  roomListener = function(snap){
    if(!snap.exists()) return;
    var room    = snap.val();
    var players = room.players || {};

    var list = document.getElementById('lobby-players');
    list.innerHTML = '';
    Object.keys(players).forEach(function(pid){
      var p = players[pid];
      var row = document.createElement('div');
      row.className = 'lobby-player-row';
      row.innerHTML = '<span class="lp-avatar">' + p.avatar + '</span>' +
        '<span class="lp-name">' + p.name + (pid === room.hostId ? ' 👑' : '') + '</span>';
      list.appendChild(row);
    });

    var count = Object.keys(players).length;
    document.getElementById('lobby-waiting-msg').textContent =
      count >= 2 ? count + ' players ready!' : 'Waiting for at least 1 more player…';

    if(isHost){
      var btn = document.getElementById('lobby-start-btn');
      btn.disabled      = count < 2;
      btn.style.opacity = count < 2 ? '0.4' : '1';
    }

    if(room.status === 'countdown'){
      roomRef.off('value', roomListener);
      roomListener = null;
      hide('lobby-screen');
      startCountdown(room.seed);
    }
  };

  roomRef.on('value', roomListener);
}

document.getElementById('lobby-start-btn').addEventListener('click', function(){
  db.ref('rooms/' + roomCode).update({ status: 'countdown' });
});

document.getElementById('lobby-leave-btn').addEventListener('click', leaveRoom);

function leaveRoom(){
  if(roomRef && roomListener){ roomRef.off('value', roomListener); roomRef = null; roomListener = null; }
  if(roomCode) db.ref('rooms/' + roomCode + '/players/' + playerId).remove();
  if(isHost)   db.ref('rooms/' + roomCode).remove();
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
  var numEl = document.getElementById('countdown-num');
  var n = 3;
  numEl.textContent = n;
  var iv = setInterval(function(){
    n--;
    if(n > 0){
      numEl.textContent = n;
    } else {
      clearInterval(iv);
      numEl.textContent = 'GO!';
      setTimeout(function(){ hide('countdown-overlay'); startMultiGame(); }, 600);
    }
  }, 900);
}

// ══════════════════════════════════════════════════════════════════════════════
//  HOW TO PLAY → SOLO START
// ══════════════════════════════════════════════════════════════════════════════
document.getElementById('play-btn').addEventListener('click', function(){
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
  var W = canvas.width, H = canvas.height;
  var blockH = 28, startW = Math.round(W * 0.55), groundY = H - 40;
  var firstBlock = { x: Math.round((W-startW)/2), y: groundY-blockH, w: startW, color: BLOCK_COLORS[0] };
  state = {
    running: true, gameOver: false, score: 0, blockH: blockH, groundY: groundY,
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
  var W = canvas.width, c = state.crane;
  c.x += c.speed * c.dir;
  if(c.x + c.w >= W){ c.x = W-c.w; c.dir=-1; }
  if(c.x <= 0)       { c.x = 0;     c.dir= 1; }
  state.camY += (state.targetCamY - state.camY) * 0.08;
}

function drawFrame(){
  var W=canvas.width, H=canvas.height, cam=Math.round(state.camY);
  ctx.clearRect(0,0,W,H);
  var sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#0f0f1a'); sky.addColorStop(1,'#1e1e2e');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);
  var gY=state.groundY+cam;
  ctx.fillStyle='#374151'; ctx.fillRect(0,gY+state.blockH,W,H);
  ctx.fillStyle='#4b5563'; ctx.fillRect(0,gY+state.blockH,W,4);
  state.stack.forEach(function(b){ drawBlock(b.x, b.y+cam, b.w, state.blockH, b.color); });
  if(!state.gameOver){
    var c=state.crane;
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
  var crane=state.crane, top=state.stack[state.stack.length-1];
  var overlapLeft=Math.max(crane.x,top.x), overlapRight=Math.min(crane.x+crane.w,top.x+top.w);
  var overlapW=overlapRight-overlapLeft;
  document.getElementById('drop-hint').style.opacity='0';
  if(overlapW<=0){ triggerGameOver(); return; }

  var newBlock={x:overlapLeft, y:top.y-state.blockH, w:overlapW, color:crane.color};
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

  if(state.score>0 && state.score%4===0){ setTimeout(showQuestion,200); return; }
  updateNextQHint();
}

// ── Question ──────────────────────────────────────────────────────────────────
function showQuestion(){
  state.running=false; pendingQuestion=true;
  cancelAnimationFrame(animId); drawFrame();

  if(isMulti && equationList.length>0){
    var idx=Math.floor(state.score/4)-1;
    currentEq=equationList[Math.min(idx, equationList.length-1)];
  } else {
    currentEq=generateEquation(state.score);
  }

  speedPenalties=0; countdownVal=3;
  document.getElementById('eq-display').textContent=currentEq.q;
  document.getElementById('eq-input').value='';
  document.getElementById('eq-feedback').classList.add('hidden');
  show('question-overlay'); updateSpeedUI();
  setTimeout(function(){ document.getElementById('eq-input').focus(); },150);

  countdownTimer=setInterval(function(){
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
  var proportion=(state.crane.speed-1.6)/(11-1.6);
  var activeDots=Math.round(proportion*6);
  document.querySelectorAll('.dot').forEach(function(d,i){
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
  var raw=document.getElementById('eq-input').value.trim();
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
    var fb=document.getElementById('eq-feedback');
    fb.classList.remove('hidden'); fb.textContent='❌ Not quite — try again!';
    document.getElementById('eq-input').value='';
    document.getElementById('eq-input').focus();
  }
}

function updateNextQHint(){
  var hint=document.getElementById('next-q-hint');
  if(!hint) return;
  var n=4-(state.score%4);
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
    setTimeout(function(){
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
  db.ref('rooms/' + roomCode + '/players/' + playerId).update({
    height: state.score, solved: eqSolved, alive: true
  });
}

function multiEliminate(){
  isEliminated=true;
  if(!roomCode) return;
  db.ref('rooms/' + roomCode + '/players/' + playerId).update({
    height: state.score, solved: eqSolved, alive: false
  });
  hide('game-ui');
  show('spectator-overlay');

  if(playersRef && playersListener){ playersRef.off('value', playersListener); }
  playersRef = db.ref('rooms/' + roomCode + '/players');
  playersListener = function(snap){
    if(!snap.exists()) return;
    var players=snap.val();
    renderSpectatorLeaderboard(players);
    var alive=Object.values(players).filter(function(p){ return p.alive; }).length;
    if(alive===0){
      playersRef.off('value', playersListener); playersListener=null;
      setTimeout(function(){ showFinalResults(players); },800);
    }
  };
  playersRef.on('value', playersListener);
}

function listenToPlayers(){
  if(playersRef && playersListener){ playersRef.off('value', playersListener); }
  playersRef = db.ref('rooms/' + roomCode + '/players');
  playersListener = function(snap){
    if(!snap.exists()||isEliminated) return;
    var players=snap.val();
    renderMiniLeaderboard(players);
    var alive=Object.values(players).filter(function(p){ return p.alive; }).length;
    if(alive===0 && !state.gameOver){
      playersRef.off('value', playersListener); playersListener=null;
      setTimeout(function(){ showFinalResults(players); },800);
    }
  };
  playersRef.on('value', playersListener);
}

function sortPlayers(players){
  return Object.keys(players).map(function(id){ return Object.assign({id:id},players[id]); })
    .sort(function(a,b){ return b.height-a.height; });
}

function renderMiniLeaderboard(players){
  var ml=document.getElementById('mini-leaderboard');
  ml.innerHTML=sortPlayers(players).map(function(p,i){
    return '<span class="ml-row' + (p.alive?'':' ml-dead') + '">' +
      (i+1) + '.' + p.avatar + ' ' + p.name + ': ' + p.height + (p.alive?'':'💀') + '</span>';
  }).join('');
  resize();
}

function renderSpectatorLeaderboard(players){
  var medals=['🥇','🥈','🥉'];
  document.getElementById('spectator-leaderboard').innerHTML=sortPlayers(players).map(function(p,i){
    var medal=i<3?medals[i]:(i+1)+'.';
    return '<div class="lb-row' + (p.alive?' lb-alive':' lb-dead') + '">' +
      '<span class="lb-rank">' + medal + '</span>' +
      '<span class="lb-avatar">' + p.avatar + '</span>' +
      '<span class="lb-name">' + p.name + '</span>' +
      '<span class="lb-score">' + p.height + ' blocks</span>' +
      '<span class="lb-status">' + (p.alive?'🟢':'💀') + '</span></div>';
  }).join('');
  document.getElementById('spectator-waiting').textContent=
    sortPlayers(players).filter(function(p){return p.alive;}).length>0?'Game in progress…':'Game over!';
}

function showFinalResults(players){
  hide('spectator-overlay'); hide('game-ui');
  var sorted=sortPlayers(players);
  var medals=['🥇','🥈','🥉'];
  document.getElementById('final-rankings').innerHTML=sorted.map(function(p,i){
    var medal=i<3?medals[i]:(i+1)+'.';
    var isMe=p.id===playerId;
    return '<div class="fr-row' + (isMe?' fr-me':'') + '">' +
      '<span class="fr-medal">' + medal + '</span>' +
      '<span class="fr-avatar">' + p.avatar + '</span>' +
      '<span class="fr-name">' + p.name + (isMe?' (You)':'') + '</span>' +
      '<span class="fr-score">' + p.height + ' blocks</span></div>';
  }).join('');
  show('final-results-screen');
}

document.getElementById('rematch-btn').addEventListener('click', function(){
  hide('final-results-screen');
  db.ref('rooms/' + roomCode + '/players').once('value').then(function(snap){
    if(!snap.exists()) return;
    var updates={};
    Object.keys(snap.val()).forEach(function(pid){
      updates['players/'+pid+'/height']=0;
      updates['players/'+pid+'/solved']=0;
      updates['players/'+pid+'/alive']=true;
    });
    updates['status']='lobby';
    updates['seed']=Math.floor(Math.random()*999983)+1;
    db.ref('rooms/' + roomCode).update(updates);
    isEliminated=false; equationList=[];
    showLobby();
  });
});

document.getElementById('results-home-btn').addEventListener('click', function(){
  if(playersRef && playersListener){ playersRef.off('value', playersListener); playersListener=null; }
  if(roomCode) db.ref('rooms/' + roomCode + '/players/' + playerId).remove();
  window.location.href='index.html';
});

// ══════════════════════════════════════════════════════════════════════════════
//  EQUATION GENERATION
// ══════════════════════════════════════════════════════════════════════════════
function seededRand(seed){
  var s=(seed+1)*1664525;
  return function(){
    s=(s*1664525+1013904223)&0xffffffff;
    return (s>>>0)/0xffffffff;
  };
}

function buildEquationList(seed){
  var rng=seededRand(seed), list=[];
  for(var i=0;i<60;i++){ list.push(generateEquationSeeded((i+1)*4, rng)); }
  return list;
}

function generateEquationSeeded(blockCount,rng){
  var ri=function(a,b){ return Math.floor(rng()*(b-a+1))+a; };
  if(blockCount<=8) return genOne(ri);
  if(blockCount<=16) return rng()<0.5?genOne(ri):genTwo(ri);
  return genTwo(ri);
}
function genOne(ri){
  var t=ri(0,2);
  if(t===0){var x=ri(1,15),a=ri(1,15);return{q:'x + '+a+' = '+(x+a),ans:x};}
  if(t===1){var x=ri(3,18),a=ri(1,x-1);return{q:'x − '+a+' = '+(x-a),ans:x};}
  var a=ri(2,9),x=ri(1,10);return{q:a+'x = '+(a*x),ans:x};
}
function genTwo(ri){
  var t=ri(0,1);
  if(t===0){var a=ri(2,5),x=ri(1,10),b=ri(1,12);return{q:a+'x + '+b+' = '+(a*x+b),ans:x};}
  var a=ri(2,5),x=ri(2,10),b=ri(1,Math.max(1,a*x-1));return{q:a+'x − '+b+' = '+(a*x-b),ans:x};
}

// Solo (random)
function ri(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function generateEquation(blockCount){
  if(blockCount<=8) return generateOneStep();
  if(blockCount<=16) return Math.random()<0.5?generateOneStep():generateTwoStep();
  return generateTwoStep();
}
function generateOneStep(){
  var t=ri(0,2);
  if(t===0){var x=ri(1,15),a=ri(1,15);return{q:'x + '+a+' = '+(x+a),ans:x};}
  if(t===1){var x=ri(3,18),a=ri(1,x-1);return{q:'x − '+a+' = '+(x-a),ans:x};}
  var a=ri(2,9),x=ri(1,10);return{q:a+'x = '+(a*x),ans:x};
}
function generateTwoStep(){
  var t=ri(0,1);
  if(t===0){var a=ri(2,5),x=ri(1,10),b=ri(1,12);return{q:a+'x + '+b+' = '+(a*x+b),ans:x};}
  var a=ri(2,5),x=ri(2,10),b=ri(1,Math.max(1,a*x-1));return{q:a+'x − '+b+' = '+(a*x-b),ans:x};
}

// ══════════════════════════════════════════════════════════════════════════════
//  INPUT / PAUSE / QUIT
// ══════════════════════════════════════════════════════════════════════════════
canvas.addEventListener('click', drop);
canvas.addEventListener('touchstart', function(e){ e.preventDefault(); drop(); }, { passive: false });
document.addEventListener('keydown', function(e){
  if(pendingQuestion){ if(e.key==='Enter') submitAnswer(); return; }
  if(e.code==='KeyP'||e.code==='Escape'){ gamePaused?resumeGame():pauseGame(); return; }
  if(e.code==='Space'||e.code==='ArrowDown') drop();
});
document.getElementById('eq-submit').addEventListener('click', submitAnswer);
document.getElementById('eq-input').addEventListener('keydown', function(e){ if(e.key==='Enter') submitAnswer(); });

function pauseGame(){
  if(state.gameOver||pendingQuestion||isMulti) return;
  gamePaused=true; state.running=false;
  cancelAnimationFrame(animId); drawFrame(); show('pause-overlay');
}
function resumeGame(){
  gamePaused=false; state.running=true; hide('pause-overlay'); loop();
}
document.getElementById('hud-pause-btn').addEventListener('click', function(){ if(!isMulti) pauseGame(); });
document.getElementById('resume-btn').addEventListener('click', resumeGame);

function showQuitConfirm(){
  if(!gamePaused&&!pendingQuestion){
    state.running=false; cancelAnimationFrame(animId); drawFrame();
  }
  hide('pause-overlay'); show('crane-quit-overlay');
}
function cancelQuit(){
  hide('crane-quit-overlay');
  if(gamePaused){ show('pause-overlay'); return; }
  if(pendingQuestion){ show('question-overlay'); return; }
  resumeGame();
}
function confirmQuit(){
  clearInterval(countdownTimer); cancelAnimationFrame(animId);
  state.gameOver=true; state.running=false; gamePaused=false; pendingQuestion=false;
  hide('crane-quit-overlay'); hide('pause-overlay'); hide('question-overlay'); hide('game-ui');
  if(isMulti&&roomCode){
    db.ref('rooms/'+roomCode+'/players/'+playerId).update({alive:false,height:state.score,solved:eqSolved});
    if(playersRef&&playersListener){ playersRef.off('value',playersListener); playersListener=null; }
    isMulti=false;
  }
  show('topic-screen');
}
document.getElementById('hud-quit-btn').addEventListener('click', showQuitConfirm);
document.getElementById('pause-quit-btn').addEventListener('click', showQuitConfirm);
document.getElementById('quit-no-btn').addEventListener('click', cancelQuit);
document.getElementById('quit-yes-btn').addEventListener('click', confirmQuit);

document.getElementById('retry-btn').addEventListener('click', function(){
  hide('gameover-screen'); show('game-ui'); gamePaused=false; startSoloGame();
});
document.getElementById('change-topic-btn').addEventListener('click', function(){
  hide('gameover-screen'); hide('game-ui'); show('topic-screen');
});

document.getElementById('multi-back-btn').addEventListener('click', function(){ hide('multi-mode-screen'); show('topic-screen'); });
document.getElementById('join-back-btn').addEventListener('click', function(){ hide('join-screen'); show('multi-mode-screen'); });

// ── Auto-join if redirected from Mental Math join screen ──────────────────────
if(gameMode === 'join' && joinCode){
  // Skip topic screen, go straight to join flow
  hide('topic-screen');
  isMulti = true;
  document.getElementById('join-code-input').value = joinCode;
  document.getElementById('join-error').classList.add('hidden');
  show('join-screen');
  // Auto-trigger join after a short delay so Firebase is ready
  setTimeout(joinRoom, 400);
}

// ── Next question hint ────────────────────────────────────────────────────────
var nextHint=document.createElement('div');
nextHint.id='next-q-hint';
document.body.appendChild(nextHint);
