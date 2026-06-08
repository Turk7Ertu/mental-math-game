import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, remove }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey:            "AIzaSyABC8fBUEIj_jpMgWzJO8k0t-pffhyvTJs",
  authDomain:        "mental-math-game-960db.firebaseapp.com",
  databaseURL:       "https://mental-math-game-960db-default-rtdb.firebaseio.com",
  projectId:         "mental-math-game-960db",
  storageBucket:     "mental-math-game-960db.firebasestorage.app",
  messagingSenderId: "250468174968",
  appId:             "1:250468174968:web:932d9893d23129dab1f18d"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Profile ───────────────────────────────────────────────────────────────
const AVATARS = ['😀','😎','🤓','😈','👻','🤖','👾','🦊','🐯','🦁','🐸','🦄'];
let profile = { name:'Player', avatar:'😀' };

function loadProfile(){
  const saved = localStorage.getItem('mmg_profile');
  if(saved){
    profile = JSON.parse(saved);
    applyProfile();
    showScreen('home-screen');
  } else {
    buildAvatarGrid();
    showScreen('profile-screen');
  }
}

function applyProfile(){
  document.getElementById('home-avatar').textContent = profile.avatar;
  document.getElementById('home-name').textContent   = profile.name;
  updateStatsHomeCard();
}

function buildAvatarGrid(){
  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = '';
  AVATARS.forEach(a => {
    const div = document.createElement('div');
    div.className = 'avatar-opt';
    div.textContent = a;
    div.onclick = () => {
      grid.querySelectorAll('.avatar-opt').forEach(el=>el.classList.remove('picked'));
      div.classList.add('picked');
    };
    grid.appendChild(div);
  });
  // Select first by default
  grid.firstChild.classList.add('picked');
}

window.saveProfile = function(){
  const name = document.getElementById('profile-name-input').value.trim();
  const errEl = document.getElementById('profile-error');
  if(!name){ errEl.textContent='Please enter your name!'; return; }
  const picked = document.querySelector('.avatar-opt.picked');
  profile = { name, avatar: picked ? picked.textContent : '😀' };
  localStorage.setItem('mmg_profile', JSON.stringify(profile));
  applyProfile();
  showScreen('home-screen');
};

window.editProfile = function(){
  buildAvatarGrid();
  document.getElementById('profile-name-input').value = profile.name;
  // Pre-select current avatar
  document.querySelectorAll('.avatar-opt').forEach(el=>{
    if(el.textContent===profile.avatar) el.classList.add('picked');
  });
  showScreen('profile-screen');
};

const DIFFICULTIES = {
  Easy:   { a:[1,10],  b:[1,10]  },
  Medium: { a:[1,50],  b:[1,20]  },
  Hard:   { a:[1,100], b:[1,50]  },
};
const CIRCUMFERENCE = 213.6;

let state = {
  mode:'solo', roomCode:null, playerId:null, opponentId:null,
  playerName:'', opponentName:'', playerAvatar:'😀', opponentAvatar:'😀',
  op:'Addition', diff:'Easy', total:10, timeLimit:15,
  current:0, score:0, oppScore:0,
  results:[], question:'', answer:0, startTime:0,
  streak:0, powerupsUsed:0, allCorrect:true,
  isLastQuestion:false, isFrozen:false,
  gameFinished:false,   // true when I submitted my last answer
};
let timerInterval   = null;
let roomListener    = null;
let freezeTickTimer = null;
let lastSeenPowerupChoosingBy = '';
let lastSeenPowerupAction     = '';
let lastSeenStreakReset        = 0;
// Store opponent answer times keyed by question number
// e.g. oppAnswerTimes[3] = timestamp when opp answered Q3
const oppAnswerTimes = {};

// ── Helpers ───────────────────────────────────────────────────────────────
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function generateQuestions(op,rangeA,rangeB,total){
  const qs=[];
  for(let i=0;i<total;i++){
    let o=op==='Mixed'?['Addition','Subtraction','Multiplication','Division'][randInt(0,3)]:op;
    let a=randInt(...rangeA),b=randInt(...rangeB),q,ans;
    if(o==='Addition')         { q=`${a} + ${b}`;  ans=a+b; }
    else if(o==='Subtraction') { [a,b]=[Math.max(a,b),Math.min(a,b)]; q=`${a} − ${b}`; ans=a-b; }
    else if(o==='Multiplication'){ q=`${a} × ${b}`; ans=a*b; }
    else { b=randInt(1,Math.min(rangeB[1],12)); a=b*randInt(1,Math.max(1,Math.floor(rangeA[1]/b))); q=`${a} ÷ ${b}`; ans=a/b; }
    qs.push({q,ans});
  }
  return qs;
}
function makeRoomCode(){ return String(randInt(1000,9999)); }

// ── Screens ───────────────────────────────────────────────────────────────
window.showScreen = function(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
  // Always hide match overlays when navigating
  document.getElementById('match-result-overlay').classList.add('hidden');
  document.getElementById('match-ready-overlay').classList.add('hidden');
  // Math background symbols — home screen only
  document.getElementById('math-bg').classList.toggle('visible', id==='home-screen');
  // Update active tab
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  if(id==='stats-screen')     document.getElementById('tab-stats').classList.add('active');
  else if(id==='settings-screen') document.getElementById('tab-settings').classList.add('active');
  else document.getElementById('tab-home').classList.add('active');
  // Sidebar visibility
  const sHome = document.getElementById('sidebar-home');
  const sGame = document.getElementById('sidebar-game');
  if(window.innerWidth >= 900){
    sHome.style.display = (id==='home-screen'||id==='menu-screen'||id==='stats-screen'||id==='match-menu-screen') ? 'block' : 'none';
    sGame.style.display = id==='game-screen' ? 'block' : 'none';
  }
  // Stop all sounds when leaving game screens
  const gameScreens = ['game-screen','match-game-screen'];
  if(!gameScreens.includes(id) && audioCtx && audioCtx.state === 'running'){
    audioCtx.suspend();
  }
  if(gameScreens.includes(id) && audioCtx && audioCtx.state === 'suspended'){
    audioCtx.resume();
  }
};

window.switchTab = function(tab){
  if(tab==='home')     showScreen('home-screen');
  if(tab==='stats')  { buildStatsScreen(); showScreen('stats-screen'); }
  if(tab==='settings') showScreen('settings-screen');
};
window.goToMenu = function(mode){
  state.mode=mode;
  document.getElementById('menu-title').textContent=mode==='solo'?'Solo Practice':'Challenge a Friend';
  showScreen('menu-screen');
};
document.querySelectorAll('.pill-group').forEach(group=>{
  group.querySelectorAll('.pill').forEach(pill=>{
    pill.addEventListener('click',()=>{
      group.querySelectorAll('.pill').forEach(p=>p.classList.remove('selected'));
      pill.classList.add('selected');
    });
  });
});
function getSelected(id){ return document.querySelector(`#${id} .pill.selected`)?.dataset.val; }

// ── Menu start ────────────────────────────────────────────────────────────
window.handleMenuStart = function(){
  state.playerName   = profile.name;
  state.playerAvatar = profile.avatar;
  state.op=getSelected('op-group'); state.diff=getSelected('diff-group');
  state.total=parseInt(getSelected('q-group')); state.timeLimit=parseInt(getSelected('time-group'));
  state.mode==='solo'?startSoloGame():createRoom();
};

// ── Countdown ─────────────────────────────────────────────────────────────
function showCountdown(callback){
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-number');
  overlay.classList.remove('hidden');
  let count = 3;

  function tick(){
    if(count > 0){
      numEl.className = 'countdown-number';
      numEl.textContent = count;
      void numEl.offsetWidth;
      numEl.className = 'countdown-number';
      SFX.countdown(count);
      count--;
      setTimeout(tick, 900);
    } else {
      numEl.className = 'countdown-go';
      numEl.textContent = 'GO!';
      SFX.countdown(0);
      setTimeout(()=>{
        overlay.classList.add('hidden');
        callback();
      }, 700);
    }
  }
  tick();
}

// ── Solo ──────────────────────────────────────────────────────────────────
function startSoloGame(){
  const{a,b}=DIFFICULTIES[state.diff];
  state.questions=generateQuestions(state.op,a,b,state.total);
  state.current=0; state.score=0; state.results=[]; state.allCorrect=true; state.gameFinished=false;
  soloPaused=false; soloPausedRemaining=0;
  const spb=document.getElementById('solo-pause-btn'); if(spb) spb.textContent='⏸';
  document.getElementById('scoreboard').style.display='none';
  document.getElementById('powerup-badge').textContent='';
  showScreen('game-screen');
  showCountdown(()=>nextQuestion());
}

// ── Host ──────────────────────────────────────────────────────────────────
async function createRoom(){
  const code=makeRoomCode();
  state.roomCode=code; state.playerId='p1'; state.opponentId='p2';
  const{a,b}=DIFFICULTIES[state.diff];
  const questions=generateQuestions(state.op,a,b,state.total);
  await set(ref(db,`rooms/${code}`),{
    host:state.playerName, guest:'', status:'waiting',
    settings:{op:state.op,diff:state.diff,total:state.total,timeLimit:state.timeLimit},
    questions,
    p1:{name:state.playerName,avatar:profile.avatar,score:0,done:false,answerStatus:'',answerTime:0,powerupChoosing:false,powerupAction:'',powerupsUsed:0},
    p2:{name:'',avatar:'',              score:0,done:false,answerStatus:'',answerTime:0,powerupChoosing:false,powerupAction:'',powerupsUsed:0},
  });
  document.getElementById('lobby-code').textContent=code;
  showScreen('lobby-screen');
  listenToRoom(code);
}
window.startMultiGame=async function(){
  await update(ref(db,`rooms/${state.roomCode}`),{status:'playing'});
};
window.leaveRoom=async function(){
  if(state.roomCode){
    if(state.playerId==='p1'){ await remove(ref(db,`rooms/${state.roomCode}`)); }
    else{ await update(ref(db,`rooms/${state.roomCode}`),{guest:'',status:'waiting','p2/name':'','p2/score':0,'p2/done':false}); }
    state.roomCode=null;
  }
  if(roomListener){roomListener();roomListener=null;}
  showScreen('home-screen');
};

// ── Join ──────────────────────────────────────────────────────────────────
window.joinRoom=async function(){
  const code=document.getElementById('join-code-input').value.trim();
  const errEl=document.getElementById('join-error'); errEl.textContent='';
  if(code.length!==4){errEl.textContent='Enter a 4-digit code';return;}
  const snap=await get(ref(db,`rooms/${code}`));
  if(!snap.exists()){errEl.textContent='Room not found';return;}
  const room=snap.val();
  if(room.status!=='waiting'){errEl.textContent='Game already started';return;}
  if(room.guest){errEl.textContent='Room is full';return;}
  state.roomCode=code; state.playerId='p2'; state.opponentId='p1';
  state.playerName=profile.name; state.playerAvatar=profile.avatar;
  state.opponentName=room.host; state.mode='multi';
  const s=room.settings; state.op=s.op; state.diff=s.diff; state.total=s.total; state.timeLimit=s.timeLimit;
  await update(ref(db,`rooms/${code}`),{guest:profile.name,'p2/name':profile.name,'p2/avatar':profile.avatar});
  document.getElementById('lobby-code').textContent=code;
  showScreen('lobby-screen');
  listenToRoom(code);
};

// ── Room listener ─────────────────────────────────────────────────────────
function listenToRoom(code){
  if(roomListener)roomListener();
  roomListener=onValue(ref(db,`rooms/${code}`),snap=>{
    if(!snap.exists()){showScreen('home-screen');return;}
    const room=snap.val();

    if(document.getElementById('lobby-screen').classList.contains('active')) updateLobbyUI(room);

    // Start game
    if(room.status==='playing'&&document.getElementById('lobby-screen').classList.contains('active')){
      state.questions=room.questions; state.current=0; state.score=0; state.oppScore=0;
      state.results=[]; state.streak=0; state.powerupsUsed=0; state.allCorrect=true;
      state.gameFinished=false;
      Object.keys(oppAnswerTimes).forEach(k=>delete oppAnswerTimes[k]);
      lastSeenPowerupChoosingBy=''; lastSeenPowerupAction=''; lastSeenStreakReset=0;
      state.opponentName  = state.playerId==='p1' ? room.guest : room.host;
      state.opponentAvatar= state.playerId==='p1' ? (room.p2?.avatar||'😀') : (room.p1?.avatar||'😀');
      document.getElementById('sc-me-name').textContent    = state.playerName;
      document.getElementById('sc-me-avatar').textContent  = profile.avatar;
      document.getElementById('sc-them-name').textContent  = state.opponentName;
      document.getElementById('sc-them-avatar').textContent= state.opponentAvatar;
      document.getElementById('scoreboard').style.display='flex';
      document.getElementById('powerup-badge').textContent='';
      showScreen('game-screen');
      showCountdown(()=>nextQuestion());
    }

    if(room.status==='playing'){
      const oppData=room[state.opponentId];
      const meData =room[state.playerId];
      if(oppData?.name) state.opponentName=oppData.name;

      const onGameScreen=document.getElementById('game-screen').classList.contains('active');

      // ── Opponent choosing power-up → pause my game ──
      if(oppData?.powerupChoosing && oppData.powerupChoosing!==lastSeenPowerupChoosingBy){
        lastSeenPowerupChoosingBy=oppData.powerupChoosing;
        if(onGameScreen && !state.gameFinished){
          pauseForOpponentChoosing();
        }
      }
      // Opponent finished choosing → resume my game
      if(!oppData?.powerupChoosing && lastSeenPowerupChoosingBy){
        lastSeenPowerupChoosingBy='';
        resumeAfterOpponentChose();
      }

      // ── Opponent used a power-up on me ──
      const oppAction=oppData?.powerupAction||'';
      if(oppAction && oppAction!==lastSeenPowerupAction){
        lastSeenPowerupAction=oppAction;
        if(onGameScreen && !state.gameFinished){
          if(oppAction==='freeze') applyFreeze();
          else if(oppAction==='blast') applyBlast();
        }
        // Clear after 1.5s
        setTimeout(()=>{ lastSeenPowerupAction=''; },1500);
      }

      // ── Streak reset (when a power-up was used by either player) ──
      const roomStreakReset = room.streakResetAt || 0;
      if(roomStreakReset && roomStreakReset !== lastSeenStreakReset){
        lastSeenStreakReset = roomStreakReset;
        state.streak = 0;
        updatePowerupBadge();
      }

      // ── Live scores & answer status ──
      if(oppData && onGameScreen){
        state.oppScore=oppData.score||0;
        updateScoreboardUI(oppData.answerStatus||'');
        // Store opp answer time keyed by question number
        if(oppData.answeredQuestion && oppData.answerTime){
          oppAnswerTimes[oppData.answeredQuestion] = oppData.answerTime;
        }
      }

      // ── Both done ──
      if(meData?.done && oppData?.done && !document.getElementById('result-screen').classList.contains('active')){
        state.oppScore=oppData.score||0;
        state.opponentName=oppData.name||state.opponentName||'Opponent';
        showMultiResults(room);
      }
    }
  });
}

function updateLobbyUI(room){
  const list=document.getElementById('players-list'); list.innerHTML='';
  [['p1',room.host||''],['p2',room.guest||'']].forEach(([id,name])=>{
    if(!name)return;
    const row=document.createElement('div'); row.className='player-row';
    const isMe=id===state.playerId;
    row.innerHTML=`<span class="dot"></span><span>${name}${isMe?' <span style="color:var(--sub);font-size:.8rem">(you)</span>':''}</span>`;
    list.appendChild(row);
  });
  const hasGuest=!!room.guest;
  document.getElementById('waiting-msg').style.display=hasGuest?'none':'block';
  document.getElementById('start-match-btn').style.display=(state.playerId==='p1'&&hasGuest)?'block':'none';
}

// ── Game logic ────────────────────────────────────────────────────────────
async function nextQuestion(){
  clearInterval(timerInterval);
  state.current++;
  state.isLastQuestion=(state.current===state.total);

  // Double points notification
  if(state.isLastQuestion&&state.allCorrect&&state.mode!=='solo'&&state.current>1){
    await showDoubleNotification();
  }

  const{q,ans}=state.questions[state.current-1];
  state.question=q; state.answer=ans; state.startTime=Date.now();
  // Don't reset lastOppAnswerTime here — instead we compare against startTime

  document.getElementById('q-counter').textContent=`Question ${state.current} / ${state.total}`;
  document.getElementById('score-display').textContent=`Score: ${state.score}`;
  document.getElementById('question-text').textContent=q;
  document.getElementById('answer-input').value='';
  document.getElementById('answer-input').disabled=false;
  document.getElementById('answer-input').focus();
  document.getElementById('feedback').textContent='';
  document.getElementById('feedback').className='';
  document.getElementById('empty-answer-warning').classList.add('hidden');
  updateProgress(state.current-1);
  updatePowerupBadge();
  startTimer();
}

function showDoubleNotification(){
  return new Promise(resolve=>{
    const ov=document.getElementById('double-overlay');
    ov.classList.remove('hidden');
    setTimeout(()=>{ov.classList.add('hidden');resolve();},2500);
  });
}

function updateProgress(done){
  document.getElementById('progress-bar').style.width=(done/state.total*100)+'%';
}

function updatePowerupBadge(){
  if(state.mode==='solo')return;
  const badge=document.getElementById('powerup-badge');
  if(state.gameFinished||state.powerupsUsed>=2){badge.textContent='';return;}
  if(state.streak===0){badge.textContent='';return;}
  badge.textContent=`⚡ ${state.streak}/3 faster streak`;
}

function updateScoreboardUI(oppStatus){
  document.getElementById('sc-me-pts').textContent  =state.score;
  document.getElementById('sc-them-pts').textContent=state.oppScore;
  document.getElementById('sc-me').classList.toggle('leading',  state.score>state.oppScore);
  document.getElementById('sc-them').classList.toggle('leading',state.oppScore>state.score);
  if(oppStatus==='correct'){
    const el=document.getElementById('sc-them-status');
    el.textContent='✓ Answered'; el.className='status status-correct';
  } else if(oppStatus==='wrong'){
    const el=document.getElementById('sc-them-status');
    el.textContent='✗ Missed'; el.className='status status-wrong';
  }
}
function setMyStatus(ok){
  const el=document.getElementById('sc-me-status');
  if(ok){el.textContent='✓ Answered';el.className='status status-correct';}
  else  {el.textContent='✗ Missed';  el.className='status status-wrong';}
}

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer(){
  const fg=document.getElementById('timer-fg'),txt=document.getElementById('timer-text');
  const tl=state.timeLimit;
  if(!tl){fg.style.strokeDashoffset=CIRCUMFERENCE;txt.textContent='∞';fg.style.stroke='var(--sub)';return;}
  let remaining=tl;
  renderTimer(remaining,tl,fg,txt);
  timerInterval=setInterval(()=>{
    remaining--;
    renderTimer(remaining,tl,fg,txt);
    if(remaining<=0){clearInterval(timerInterval);timeout();}
  },1000);
}
function renderTimer(remaining,total,fg,txt){
  SFX.tick(remaining);
  const frac=remaining/total;
  fg.style.strokeDashoffset=CIRCUMFERENCE*(1-frac);
  txt.textContent=remaining;
  const color=frac>.5?'var(--green)':frac>.25?'var(--yellow)':'var(--red)';
  fg.style.stroke=color;
  document.getElementById('timer-text').style.fill=frac>.5?'var(--text)':color;
}

// ── Pause / resume for opponent's power-up choosing ───────────────────────
let pausedRemainingTime = 0;
function pauseForOpponentChoosing(){
  clearInterval(timerInterval);
  // Calculate how much time is left
  const elapsed=Math.floor((Date.now()-state.startTime)/1000);
  pausedRemainingTime=Math.max(0,(state.timeLimit||30)-elapsed);
  document.getElementById('answer-input').disabled=true;
  document.getElementById('opp-choosing-overlay').classList.remove('hidden');
}
function resumeAfterOpponentChose(){
  document.getElementById('opp-choosing-overlay').classList.add('hidden');
  if(state.isFrozen||state.gameFinished)return;
  const input=document.getElementById('answer-input');
  input.disabled=false; input.focus();
  // Resume timer from where it paused
  if(state.timeLimit&&pausedRemainingTime>0){
    const fg=document.getElementById('timer-fg'),txt=document.getElementById('timer-text');
    let remaining=pausedRemainingTime;
    renderTimer(remaining,state.timeLimit,fg,txt);
    timerInterval=setInterval(()=>{
      remaining--;
      renderTimer(remaining,state.timeLimit,fg,txt);
      if(remaining<=0){clearInterval(timerInterval);timeout();}
    },1000);
  }
}

// ── Solo Pause ────────────────────────────────────────────────────────────
let soloPaused = false;
let soloPausedRemaining = 0;

window.toggleSoloPause = function(){
  if(state.gameFinished) return;
  if(!soloPaused){
    // Pause
    clearInterval(timerInterval);
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    soloPausedRemaining = Math.max(0, (state.timeLimit || 0) - elapsed);
    soloPaused = true;
    document.getElementById('solo-pause-btn').textContent = '▶';
    document.getElementById('answer-input').disabled = true;
    document.getElementById('pause-overlay').classList.remove('hidden');
    document.getElementById('pause-resume-btn').onclick = resumeGame;
  } else {
    resumeGame();
  }
};

window.resumeGame = function(){
  document.getElementById('pause-overlay').classList.add('hidden');
  // Solo resume
  if(soloPaused){
    soloPaused = false;
    document.getElementById('solo-pause-btn').textContent = '⏸';
    document.getElementById('answer-input').disabled = false;
    document.getElementById('answer-input').focus();
    if(state.timeLimit && soloPausedRemaining > 0){
      const fg = document.getElementById('timer-fg'), txt = document.getElementById('timer-text');
      let remaining = soloPausedRemaining;
      renderTimer(remaining, state.timeLimit, fg, txt);
      timerInterval = setInterval(()=>{
        remaining--;
        renderTimer(remaining, state.timeLimit, fg, txt);
        if(remaining <= 0){ clearInterval(timerInterval); timeout(); }
      }, 1000);
    }
  }
  // Match resume
  if(matchPaused){
    matchPaused = false;
    document.getElementById('match-pause-btn').textContent = '⏸';
    matchState.locked = false;
    clearInterval(matchState.timerInterval);
    matchState.timerInterval = setInterval(()=>{
      if(matchPaused) return;
      if(matchState.timeLimit > 0){
        matchState.timer--;
        updateMatchHeader();
        if(matchState.timer <= 0){
          clearInterval(matchState.timerInterval);
          setTimeout(showMatchTimeUp, 300);
        }
      } else {
        matchState.timer++;
        updateMatchHeader();
      }
    }, 1000);
  }
};

// ── Match Pause ───────────────────────────────────────────────────────────
let matchPaused = false;

window.toggleMatchPause = function(){
  if(!matchPaused){
    // Cancel startup timeout if still pending
    clearTimeout(matchState._startTimeout);
    clearInterval(matchState.timerInterval);
    matchState.timerInterval = null;
    matchPaused = true;
    matchState.locked = true;
    document.getElementById('match-pause-btn').textContent = '▶';
    document.getElementById('pause-overlay').classList.remove('hidden');
    document.getElementById('pause-resume-btn').onclick = resumeGame;
  } else {
    resumeGame();
  }
};

// ── Submit ────────────────────────────────────────────────────────────────
window.submitAnswer=function(){
  const input=document.getElementById('answer-input');
  if(input.disabled)return;
  const raw=input.value.trim();
  if(!raw){
    // Show shake warning, timer keeps running
    const w=document.getElementById('empty-answer-warning');
    w.classList.remove('hidden');
    // Restart shake animation
    w.style.animation='none';
    void w.offsetWidth;
    w.style.animation='';
    clearTimeout(input._warnTimeout);
    input._warnTimeout=setTimeout(()=>w.classList.add('hidden'), 1800);
    return;
  }
  clearInterval(timerInterval);
  const elapsed=((Date.now()-state.startTime)/1000).toFixed(1);
  const userAns=parseInt(raw);
  if(isNaN(userAns))return;
  input.disabled=true;

  const myAnswerTime=Date.now();
  const fb=document.getElementById('feedback');
  const isCorrect=(userAns===state.answer);

  // Double pts on last question if all correct
  let multiplier=1;
  if(state.isLastQuestion&&state.allCorrect&&isCorrect&&state.current>1) multiplier=2;

  if(isCorrect){
    const bonus=state.timeLimit?Math.max(0,state.timeLimit-parseFloat(elapsed)):0;
    const pts=Math.round((10+Math.floor(bonus))*multiplier);
    state.score+=pts;
    fb.textContent=multiplier===2?`✓ Correct! 🌟 2× = +${pts} pts (${elapsed}s)`:`✓ Correct!  +${pts} pts  (${elapsed}s)`;
    fb.className='fb-correct';
    SFX.correct();
    state.results.push({q:state.question,ans:state.answer,given:userAns,ok:true});
    if(state.mode!=='solo') setMyStatus(true);
  } else {
    fb.textContent=`✗  Wrong.  Answer was ${state.answer}`;
    fb.className='fb-wrong';
    SFX.wrong();
    state.results.push({q:state.question,ans:state.answer,given:userAns,ok:false});
    state.allCorrect=false;
    if(state.mode!=='solo') setMyStatus(false);
  }

  if(state.mode!=='solo'){
    syncScore(isCorrect?'correct':'wrong', myAnswerTime);
    // Check streak ONLY if game not finished and under powerup limit
    if(!state.gameFinished && state.powerupsUsed<2){
      checkPowerupStreak(isCorrect, myAnswerTime);
    }
  }

  setTimeout(advance,900);
};

function timeout(){
  const input=document.getElementById('answer-input'); input.disabled=true;
  const fb=document.getElementById('feedback');
  fb.textContent=`⏰  Time's up!  Answer: ${state.answer}`; fb.className='fb-timeout';
  SFX.timeout();
  state.results.push({q:state.question,ans:state.answer,given:'timeout',ok:false});
  state.allCorrect=false;
  if(state.mode!=='solo'){
    setMyStatus(false);
    syncScore('wrong',Date.now());
    if(!state.gameFinished && state.powerupsUsed<2) checkPowerupStreak(false, Date.now());
  }
  setTimeout(advance,1200);
}

async function syncScore(answerStatus, answerTime){
  if(!state.roomCode)return;
  await update(ref(db,`rooms/${state.roomCode}/${state.playerId}`),{
    score:state.score, answerStatus, answerTime,
    answeredQuestion: state.current,
  });
}

// ── Streak logic ──────────────────────────────────────────────────────────
function checkPowerupStreak(isCorrect, myAnswerTime){
  if(!isCorrect){
    state.streak=0;
    updatePowerupBadge();
    return;
  }
  // Use question-number keyed opp answer times — no timing ambiguity
  const oppTimeForThisQ = oppAnswerTimes[state.current];
  // If opponent hasn't answered this question yet → I was first → faster
  // If opponent answered → compare actual timestamps
  const iFaster = !oppTimeForThisQ || (myAnswerTime < oppTimeForThisQ);

  if(iFaster){
    state.streak++;
    if(state.streak>=3){
      state.streak=0;
      SFX.powerupReady();
      setTimeout(()=>showPowerupPopup(),950);
    }
  } else {
    state.streak=0;
  }
  updatePowerupBadge();
}

async function showPowerupPopup(){
  if(state.gameFinished||state.powerupsUsed>=2)return;
  clearInterval(timerInterval);
  document.getElementById('answer-input').disabled=true;
  // Tell Firebase I'm choosing (pauses opponent)
  await update(ref(db,`rooms/${state.roomCode}/${state.playerId}`),{
    powerupChoosing: state.playerId
  });
  document.getElementById('powerup-popup').classList.remove('hidden');
}

window.usePowerUp=async function(type){
  document.getElementById('powerup-popup').classList.add('hidden');
  state.powerupsUsed++;

  // Write chosen power-up action to Firebase (opponent sees it)
  // Also write streakResetAt to reset BOTH players' streaks
  await update(ref(db,`rooms/${state.roomCode}/${state.playerId}`),{
    powerupAction: type,
    powerupChoosing: false,
    powerupsUsed: state.powerupsUsed,
  });
  await update(ref(db,`rooms/${state.roomCode}`),{
    streakResetAt: Date.now(),
  });
  // Reset my own streak too
  state.streak=0;
  updatePowerupBadge();

  // Clear action after 2s so it doesn't retrigger
  setTimeout(async()=>{
    await update(ref(db,`rooms/${state.roomCode}/${state.playerId}`),{powerupAction:''});
  },2000);

  // Resume my game
  document.getElementById('answer-input').disabled=false;
  document.getElementById('answer-input').focus();
  startTimer();
  updatePowerupBadge();
};

// ── Power-up effects ──────────────────────────────────────────────────────
function applyFreeze(){
  if(state.isFrozen)return;
  state.isFrozen=true;
  SFX.freeze();
  clearInterval(timerInterval);
  clearInterval(freezeTickTimer);
  document.getElementById('answer-input').disabled=true;

  const overlay=document.getElementById('freeze-overlay');
  const countEl=document.getElementById('freeze-count');
  overlay.classList.remove('hidden');

  const fg=document.getElementById('timer-fg'),txt=document.getElementById('timer-text');
  const tl=state.timeLimit||30;
  let elapsed=Math.floor((Date.now()-state.startTime)/1000);
  let remaining=Math.max(0,tl-elapsed);
  let count=3;
  countEl.textContent=count;

  freezeTickTimer=setInterval(()=>{
    remaining=Math.max(0,remaining-1);
    if(tl) renderTimer(remaining,tl,fg,txt);
    count--;
    countEl.textContent=Math.max(0,count);
    if(count<=0){
      clearInterval(freezeTickTimer);
      overlay.classList.add('hidden');
      state.isFrozen=false;
      if(remaining>0){
        document.getElementById('answer-input').disabled=false;
        document.getElementById('answer-input').focus();
        timerInterval=setInterval(()=>{
          remaining--;
          renderTimer(remaining,tl,fg,txt);
          if(remaining<=0){clearInterval(timerInterval);timeout();}
        },1000);
      } else {
        timeout();
      }
    }
  },1000);
}

function applyBlast(){
  SFX.blast();
  state.score=Math.max(0,state.score-10);
  document.getElementById('score-display').textContent=`Score: ${state.score}`;
  document.getElementById('sc-me-pts').textContent=state.score;
  const card=document.getElementById('sc-me');
  card.style.borderColor='var(--red)';
  const fb=document.getElementById('feedback');
  fb.textContent='💥 Opponent used Blast! -10 pts'; fb.className='fb-wrong';
  setTimeout(()=>{card.style.borderColor='var(--accent)';},1500);
}

// ── Advance ───────────────────────────────────────────────────────────────
function advance(){
  updateProgress(state.current);
  if(state.current>=state.total){
    state.gameFinished=true; // I'm done — no more power-ups
    state.mode==='solo'?showSoloResults():markDone();
  } else {
    nextQuestion();
  }
}

async function markDone(){
  await update(ref(db,`rooms/${state.roomCode}/${state.playerId}`),{score:state.score,done:true,powerupChoosing:false});
  document.getElementById('question-text').textContent='⏳';
  document.getElementById('answer-input').disabled=true;
  document.getElementById('feedback').textContent='Waiting for opponent to finish...';
  document.getElementById('feedback').className='';
  document.getElementById('powerup-badge').textContent='';
}

// ── Activity logging ──────────────────────────────────────────────────────
async function logActivity(mode, extraData={}){
  try {
    const now  = new Date();
    const date = now.toLocaleDateString('en-GB');  // e.g. 02/06/2026
    const time = now.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}); // e.g. 14:35
    const logRef = ref(db, 'activity_log');
    const entry = {
      date, time,
      name:   profile.name,
      avatar: profile.avatar,
      mode,
      score:     state.score,
      correct:   state.results.filter(r=>r.ok).length,
      total:     state.total,
      operation: state.op,
      difficulty:state.diff,
      ...extraData,
    };
    await set(ref(db, `activity_log/${Date.now()}_${Math.random().toString(36).slice(2,7)}`), entry);
  } catch(e){ /* silent fail — don't break the game */ }
}

// ── Results ───────────────────────────────────────────────────────────────
function showSoloResults(){
  showScreen('result-screen');
  document.getElementById('solo-result').style.display='block';
  document.getElementById('multi-result').style.display='none';
  const correct=state.results.filter(r=>r.ok).length;
  document.getElementById('final-score').textContent=`${state.score} pts`;
  document.getElementById('final-acc').textContent=`${correct} / ${state.total} correct  (${Math.round(correct/state.total*100)}%)`;

  // Rating update
  const delta = calcRatingDelta(correct, state.total, state.diff, state.timeLimit);
  const {oldRating, newRating} = addRatingEntry(delta, correct, state.total, state.op, state.diff, state.timeLimit);
  const tier = getTier(newRating);
  const banner = document.getElementById('rating-change-banner');
  const changeText = document.getElementById('rating-change-text');
  const tierText   = document.getElementById('rating-tier-text');
  banner.style.display='block';
  const sign = delta>=0?'+':'';
  changeText.textContent=`${oldRating} → ${newRating}  (${sign}${delta})`;
  changeText.style.color = delta>=0?'var(--green)':'var(--red)';
  tierText.textContent=`${tier.icon} ${tier.name}`;
  updateStatsHomeCard();

  buildReviewList();
  logActivity('Solo');
  if(correct===state.total) SFX.win(); else SFX.lose();
}

function showMultiResults(room){
  if(!document.getElementById('result-screen').classList.contains('active')) showScreen('result-screen');
  document.getElementById('solo-result').style.display='none';
  document.getElementById('multi-result').style.display='block';
  const myScore=room[state.playerId].score, oppScore=room[state.opponentId].score;
  const myName=state.playerName, oppName=state.opponentName;
  let winnerName,trophy;
  if(myScore>oppScore)     {winnerName=myName; trophy='🏆';}
  else if(oppScore>myScore){winnerName=oppName;trophy='🏆';}
  else                     {winnerName='Tie!'; trophy='🤝';}
  document.getElementById('result-trophy').textContent=trophy;
  document.getElementById('result-winner-name').textContent=winnerName;
  document.getElementById('result-winner-label').textContent=winnerName==='Tie!'?"It's a tie!":'wins!';
  document.getElementById('fsc-me-name').textContent=myName;
  document.getElementById('fsc-me-pts').textContent=myScore;
  document.getElementById('fsc-them-name').textContent=oppName;
  document.getElementById('fsc-them-pts').textContent=oppScore;
  document.getElementById('fsc-me').classList.toggle('winner',myScore>oppScore);
  document.getElementById('fsc-them').classList.toggle('winner',oppScore>myScore);
  buildReviewList();
  logActivity('Multiplayer', {
    opponent: oppName,
    result: myScore>oppScore ? 'Win' : oppScore>myScore ? 'Loss' : 'Tie',
  });
  if(myScore>oppScore) SFX.win();
  else if(oppScore>myScore) SFX.lose();
  else SFX.tie();
  // Show rematch button for multiplayer
  document.getElementById('rematch-section').style.display='block';
  document.getElementById('rematch-btn').disabled=false;
  document.getElementById('rematch-btn').textContent='🔄  Rematch';
  document.getElementById('rematch-status').textContent='';
  // Keep listener alive for rematch
  listenForRematch(state.roomCode);
}

function buildReviewList(){
  const list=document.getElementById('review-list'); list.innerHTML='';
  state.results.forEach(({q,ans,given,ok})=>{
    const div=document.createElement('div'); div.className=`review-item ${ok?'ok':'bad'}`;
    const note=ok?`= ${ans}`:given==='timeout'?`= ${ans}  (timeout)`:`= ${ans}  (you: ${given})`;
    div.innerHTML=`<span style="font-size:1rem">${ok?'✓':'✗'}</span><div><div style="font-weight:700">${q}</div><div class="note">${note}</div></div>`;
    list.appendChild(div);
  });
}

// ── Rematch ───────────────────────────────────────────────────────────────
window.requestRematch = async function(){
  const btn = document.getElementById('rematch-btn');
  btn.disabled = true;
  btn.textContent = '⏳  Waiting for opponent...';
  document.getElementById('rematch-status').textContent = 'Waiting for opponent to accept rematch...';

  await update(ref(db,`rooms/${state.roomCode}/${state.playerId}`),{ rematch: true });
};

function listenForRematch(code){
  if(roomListener){ roomListener(); roomListener=null; }
  roomListener = onValue(ref(db,`rooms/${code}`), async snap=>{
    if(!snap.exists()) return;
    const room = snap.val();
    const p1 = room.p1, p2 = room.p2;

    // Update rematch status label
    const oppData = room[state.opponentId];
    if(oppData?.rematch && !room[state.playerId]?.rematch){
      document.getElementById('rematch-status').textContent = 'Opponent wants a rematch!';
    }

    // Both accepted → host resets the room and starts new game
    if(p1?.rematch && p2?.rematch){
      if(roomListener){ roomListener(); roomListener=null; }

      if(state.playerId==='p1'){
        // Host: generate new questions and reset room
        const{a,b}=DIFFICULTIES[state.diff];
        const questions=generateQuestions(state.op,a,b,state.total);
        await update(ref(db,`rooms/${code}`),{
          status:'playing',
          questions,
          streakResetAt:0,
          'p1/score':0,'p1/done':false,'p1/answerStatus':'','p1/answerTime':0,
          'p1/powerupChoosing':false,'p1/powerupAction':'','p1/powerupsUsed':0,
          'p1/answeredQuestion':0,'p1/rematch':false,
          'p2/score':0,'p2/done':false,'p2/answerStatus':'','p2/answerTime':0,
          'p2/powerupChoosing':false,'p2/powerupAction':'','p2/powerupsUsed':0,
          'p2/answeredQuestion':0,'p2/rematch':false,
        });
      }
      // Both players: reset local state and start
      startRematchGame(room);
    }
  });
}

function startRematchGame(room){
  // Reset all local state for new game
  state.current=0; state.score=0; state.oppScore=0;
  state.results=[]; state.streak=0; state.powerupsUsed=0;
  state.allCorrect=true; state.gameFinished=false;
  Object.keys(oppAnswerTimes).forEach(k=>delete oppAnswerTimes[k]);
  lastSeenPowerupChoosingBy=''; lastSeenPowerupAction=''; lastSeenStreakReset=0;

  document.getElementById('rematch-section').style.display='none';
  document.getElementById('sc-me-pts').textContent='0';
  document.getElementById('sc-them-pts').textContent='0';
  document.getElementById('sc-me-status').textContent='';
  document.getElementById('sc-them-status').textContent='';
  document.getElementById('scoreboard').style.display='flex';
  document.getElementById('powerup-badge').textContent='';

  showScreen('game-screen');

  // Re-attach live listener
  listenToRoom(state.roomCode);

  // Load questions from Firebase (host already wrote them)
  get(ref(db,`rooms/${state.roomCode}/questions`)).then(snap=>{
    state.questions = snap.val();
    showCountdown(()=>nextQuestion());
  });
}

window.playAgain=function(){ showScreen('home-screen'); };

// ── Sound Engine ──────────────────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let isMuted = localStorage.getItem('mmg_muted') === 'true';

window.toggleMute = function(){
  isMuted = !isMuted;
  localStorage.setItem('mmg_muted', isMuted);
  applyMuteBtn();
};
function applyMuteBtn(){
  const btn = document.getElementById('mute-btn');
  if(!btn) return;
  btn.textContent  = isMuted ? '🔇 Off' : '🔊 On';
  btn.classList.toggle('muted', isMuted);
}

function getAudioCtx(){
  if(!audioCtx) audioCtx = new AudioCtx();
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function stopAllSounds(){
  if(audioCtx && audioCtx.state === 'running') audioCtx.suspend();
}

function playTone(freq, type='sine', duration=0.15, volume=0.3, startDelay=0){
  if(isMuted) return;
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
    gain.gain.setValueAtTime(volume, ctx.currentTime + startDelay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
    osc.start(ctx.currentTime + startDelay);
    osc.stop(ctx.currentTime + startDelay + duration + 0.05);
  } catch(e){}
}

function playNoise(duration=0.1, volume=0.2, startDelay=0){
  if(isMuted) return;
  try {
    const ctx        = getAudioCtx();
    const bufferSize = ctx.sampleRate * duration;
    const buffer     = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data       = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime + startDelay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime + startDelay);
  } catch(e){}
}

// Individual sounds
const SFX = {
  correct() {
    playTone(523, 'sine', 0.1, 0.3);
    playTone(659, 'sine', 0.1, 0.3, 0.1);
    playTone(784, 'sine', 0.2, 0.3, 0.2);
  },
  wrong() {
    playTone(220, 'sawtooth', 0.15, 0.3);
    playTone(180, 'sawtooth', 0.15, 0.3, 0.15);
  },
  timeout() {
    playTone(300, 'square', 0.1, 0.25);
    playTone(250, 'square', 0.1, 0.25, 0.1);
    playTone(200, 'square', 0.15, 0.25, 0.2);
  },
  tick(remaining) {
    // Normal tick
    if(remaining > 5){
      playTone(880, 'sine', 0.05, 0.15);
    } else {
      // Last 5 seconds — faster, higher pitch, louder
      const freq = 880 + (5 - remaining) * 80;
      playTone(freq, 'square', 0.08, 0.25 + (5-remaining)*0.04);
    }
  },
  freeze() {
    // Icy descending shimmer
    for(let i=0;i<6;i++){
      playTone(1200 - i*120, 'sine', 0.12, 0.2, i*0.07);
    }
  },
  blast() {
    playNoise(0.08, 0.4);
    playTone(120, 'sawtooth', 0.2, 0.35, 0.05);
    playNoise(0.06, 0.3, 0.15);
  },
  powerupReady() {
    // Ascending fanfare
    [523,659,784,1047].forEach((f,i)=>playTone(f,'sine',0.1,0.3,i*0.08));
  },
  countdown(n) {
    if(n > 0) playTone(440, 'sine', 0.12, 0.4);
    else      { // GO!
      playTone(523,'sine',0.08,0.4);
      playTone(659,'sine',0.08,0.4,0.08);
      playTone(784,'sine',0.08,0.4,0.16);
      playTone(1047,'sine',0.2,0.5,0.24);
    }
  },
  win() {
    const melody = [523,659,784,659,784,1047];
    melody.forEach((f,i)=>playTone(f,'sine',0.15,0.35,i*0.12));
  },
  lose() {
    [440,415,392,349].forEach((f,i)=>playTone(f,'sine',0.18,0.3,i*0.13));
  },
  tie() {
    [523,523,659].forEach((f,i)=>playTone(f,'sine',0.15,0.3,i*0.12));
  },
};

// ── Rating / Stats System ─────────────────────────────────────────────────
const TIERS = [
  { name:'Legend',     min:1500, icon:'👑', color:'#f59e0b' },
  { name:'Master',     min:1400, icon:'⭐', color:'#a78bfa' },
  { name:'Expert',     min:1300, icon:'💎', color:'#3b82f6' },
  { name:'Skilled',    min:1200, icon:'🔥', color:'#22c55e' },
  { name:'Apprentice', min:1100, icon:'📈', color:'#94a3b8' },
  { name:'Beginner',   min:0,    icon:'🎯', color:'#64748b' },
];
function getTier(rating){ return TIERS.find(t=>rating>=t.min)||TIERS[TIERS.length-1]; }

function getRatingHistory(){
  try{ return JSON.parse(localStorage.getItem('mmg_rating_history')||'[]'); }catch{ return []; }
}
function saveRatingHistory(hist){
  localStorage.setItem('mmg_rating_history', JSON.stringify(hist.slice(-30)));
}
function getCurrentRating(){
  const h=getRatingHistory(); return h.length>0?h[h.length-1].rating:1000;
}

function calcRatingDelta(correct, total, diff, timeLimit){
  const accuracy = correct/total;
  const base = (accuracy - 0.5)*60;            // -30 to +30
  const diffMult  = {Easy:0.8,Medium:1.0,Hard:1.2}[diff]||1.0;
  const timeMult  = timeLimit===0?0.7:timeLimit===30?0.9:timeLimit===10?1.1:1.0;
  const qMult     = total===5?0.8:total===20?1.1:1.0;
  return Math.round(base*diffMult*timeMult*qMult);
}

function addRatingEntry(delta, correct, total, op, diff, timeLimit){
  const hist = getRatingHistory();
  const oldRating = hist.length>0?hist[hist.length-1].rating:1000;
  const newRating  = Math.max(0, oldRating+delta);
  hist.push({
    rating: newRating, delta,
    accuracy: Math.round(correct/total*100),
    op, diff, timeLimit: timeLimit||0,
    date: new Date().toLocaleDateString('en-GB'),
  });
  saveRatingHistory(hist);
  return { oldRating, newRating, delta };
}

function updateStatsHomeCard(){
  const hist = getRatingHistory();
  const preview = document.getElementById('stats-home-preview');
  if(!preview) return;
  if(hist.length===0){ preview.textContent='Play solo games to build your rating!'; return; }
  const rating = hist[hist.length-1].rating;
  const tier   = getTier(rating);
  preview.textContent=`${tier.icon} ${tier.name}  ·  ${rating} rating  ·  ${hist.length} game${hist.length!==1?'s':''}`;
}

window.openStatsScreen = function(){
  buildStatsScreen();
  showScreen('stats-screen');
};

function buildStatsScreen(){
  const hist   = getRatingHistory();
  const rating = hist.length>0?hist[hist.length-1].rating:1000;
  const tier   = getTier(rating);

  document.getElementById('stats-tier-icon').textContent  = tier.icon;
  document.getElementById('stats-tier-name').textContent  = tier.name;
  document.getElementById('stats-tier-name').style.color  = tier.color;
  document.getElementById('stats-rating-num').textContent = rating;
  document.getElementById('stats-games-count').textContent= `${hist.length} game${hist.length!==1?'s':''} played`;

  buildRatingGraph(hist);
  buildRecentGames(hist);
}

function buildRatingGraph(hist){
  const svg    = document.getElementById('rating-graph');
  const empty  = document.getElementById('rating-graph-empty');
  svg.innerHTML='';
  if(hist.length<2){ svg.style.display='none'; empty.style.display='block'; return; }
  svg.style.display=''; empty.style.display='none';

  const W=400, H=150, PL=36, PR=10, PT=10, PB=24;
  const IW=W-PL-PR, IH=H-PT-PB;

  const ratings=hist.map(h=>h.rating);
  const minR=Math.min(...ratings), maxR=Math.max(...ratings);
  const span=Math.max(maxR-minR, 50);
  const lo=minR-span*0.1, hi=maxR+span*0.1;

  const toX=i=>PL+i/(hist.length-1)*IW;
  const toY=r=>PT+IH-(r-lo)/(hi-lo)*IH;

  function mkEl(tag,attrs,text){
    const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));
    if(text!==undefined) e.textContent=text;
    return e;
  }

  // Horizontal grid lines
  [0,0.5,1].forEach(f=>{
    const r=lo+f*(hi-lo), y=toY(r);
    svg.appendChild(mkEl('line',{x1:PL,y1:y,x2:W-PR,y2:y,stroke:'#2a2a3e','stroke-width':'1'}));
    svg.appendChild(mkEl('text',{x:PL-4,y:y+4,'font-size':'10',fill:'#94a3b8','text-anchor':'end'},String(Math.round(r))));
  });

  // Filled area under the line
  const pts=hist.map((h,i)=>`${toX(i)},${toY(h.rating)}`).join(' ');
  svg.appendChild(mkEl('polygon',{
    points:`${toX(0)},${toY(lo)} ${pts} ${toX(hist.length-1)},${toY(lo)}`,
    fill:'rgba(124,58,237,0.18)',stroke:'none'
  }));

  // Line
  svg.appendChild(mkEl('polyline',{
    points:pts,fill:'none',stroke:'#7c3aed','stroke-width':'2.5',
    'stroke-linejoin':'round','stroke-linecap':'round'
  }));

  // Dots — green if went up, red if went down
  hist.forEach((h,i)=>{
    svg.appendChild(mkEl('circle',{
      cx:toX(i),cy:toY(h.rating),r:'4.5',
      fill:h.delta>=0?'#22c55e':'#ef4444',
      stroke:'#1e1e2e','stroke-width':'1.5'
    }));
  });

  // X labels: first and last date
  if(hist[0].date) svg.appendChild(mkEl('text',{x:toX(0),y:H-4,'font-size':'10',fill:'#94a3b8','text-anchor':'middle'},hist[0].date));
  if(hist.length>1&&hist[hist.length-1].date)
    svg.appendChild(mkEl('text',{x:toX(hist.length-1),y:H-4,'font-size':'10',fill:'#94a3b8','text-anchor':'middle'},hist[hist.length-1].date));
}

function buildRecentGames(hist){
  const list  = document.getElementById('recent-games-list');
  const empty = document.getElementById('recent-games-empty');
  list.innerHTML='';
  if(hist.length===0){ empty.style.display='block'; return; }
  empty.style.display='none';
  [...hist].reverse().slice(0,10).forEach(h=>{
    const deltaColor = h.delta>=0?'var(--green)':'var(--red)';
    const deltaText  = h.delta>=0?`+${h.delta}`:String(h.delta);
    const tlLabel    = h.timeLimit===0?'No limit':h.timeLimit+'s';
    const div=document.createElement('div');
    div.style.cssText='background:var(--card);border-radius:10px;padding:10px 14px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;';
    div.innerHTML=`
      <div>
        <div style="font-weight:700;font-size:.9rem">${h.op||'Mixed'} · ${h.diff||'Easy'} · ${tlLabel}</div>
        <div style="color:var(--sub);font-size:.78rem">${h.accuracy}% correct · ${h.date||''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:12px">
        <div style="font-weight:800;color:${deltaColor};font-size:1.1rem">${deltaText}</div>
        <div style="color:var(--sub);font-size:.78rem">${h.rating} rating</div>
      </div>`;
    list.appendChild(div);
  });
}

window.clearStatsConfirm = function(){
  if(confirm('Reset all rating history? This cannot be undone.')){
    localStorage.removeItem('mmg_rating_history');
    buildStatsScreen();
    updateStatsHomeCard();
  }
};

// ── Match & Find ──────────────────────────────────────────────────────────
let matchState = {
  cards: [], flipped: [], matched: 0, mistakes: 0,
  timer: 0, timerInterval: null, locked: false,
  op: 'Mixed', diff: 'Easy', total: 12, timeLimit: 120,
};

// Wire pill groups for match menu
document.querySelectorAll('#match-op-group .pill, #match-diff-group .pill, #match-time-group .pill').forEach(pill=>{
  pill.addEventListener('click',()=>{
    pill.closest('.pill-group').querySelectorAll('.pill').forEach(p=>p.classList.remove('selected'));
    pill.classList.add('selected');
  });
});

function generateMatchQuestion(op, diff){
  let o = op==='Mixed' ? ['Addition','Subtraction','Multiplication','Division'][randInt(0,3)] : op;

  if(diff==='Easy'){
    if(o==='Addition')       { const a=randInt(1,9),  b=randInt(1,15); return {q:`${a} + ${b}`,  a:a+b}; }
    if(o==='Subtraction')    { const a=randInt(10,20), b=randInt(1,9); return {q:`${a} − ${b}`,  a:a-b}; }
    if(o==='Multiplication') { const a=randInt(2,9),  b=randInt(2,9);  return {q:`${a} × ${b}`,  a:a*b}; }
    if(o==='Division')       { const b=randInt(2,9),  a=b*randInt(2,9); return {q:`${a} ÷ ${b}`, a:a/b}; }
  }
  if(diff==='Medium'){
    if(o==='Addition')       { const a=randInt(10,99),  b=randInt(10,99); return {q:`${a} + ${b}`, a:a+b}; }
    if(o==='Subtraction')    { const a=randInt(20,99),  b=randInt(10,Math.max(10,a-1)); return {q:`${a} − ${b}`, a:a-b}; }
    if(o==='Multiplication') { const a=randInt(10,99),  b=randInt(2,9);  return {q:`${a} × ${b}`, a:a*b}; }
    if(o==='Division')       { const b=randInt(2,9),    a=b*randInt(3,12); return {q:`${a} ÷ ${b}`, a:a/b}; }
  }
  if(diff==='Hard'){
    if(o==='Addition')       { const a=randInt(100,999), b=randInt(10,99);  return {q:`${a} + ${b}`, a:a+b}; }
    if(o==='Subtraction')    { const a=randInt(100,999), b=randInt(10,99);  return {q:`${a} − ${b}`, a:a-b}; }
    if(o==='Multiplication') { const a=randInt(10,99),   b=randInt(10,99);  return {q:`${a} × ${b}`, a:a*b}; }
    if(o==='Division')       { const b=randInt(10,20),   a=b*randInt(2,9);  return {q:`${a} ÷ ${b}`, a:a/b}; }
  }
  // fallback
  const a=randInt(1,9), b=randInt(1,9); return {q:`${a} + ${b}`, a:a+b};
}

function generateMatchPairs(op, diff, count=12){
  const pairs=[], usedAnswers=new Set(), usedQ=new Set();
  let attempts=0;
  while(pairs.length<count && attempts<500){
    attempts++;
    const pair = generateMatchQuestion(op, diff);
    const key = pair.q;
    if(usedQ.has(key)||usedAnswers.has(pair.a)) continue;
    usedQ.add(key); usedAnswers.add(pair.a);
    pairs.push({...pair, id:pairs.length});
  }
  return pairs;
}

window.startMatchGame = function(){
  const op        = document.querySelector('#match-op-group .pill.selected')?.dataset.val   || 'Mixed';
  const diff      = document.querySelector('#match-diff-group .pill.selected')?.dataset.val || 'Easy';
  const timeLimit = parseInt(document.querySelector('#match-time-group .pill.selected')?.dataset.val ?? '120');
  matchState.op=op; matchState.diff=diff; matchState.timeLimit=timeLimit;
  matchState.matched=0; matchState.mistakes=0;
  matchState.flipped=[]; matchState.locked=false;
  matchPaused=false;
  const mpb=document.getElementById('match-pause-btn'); if(mpb) mpb.textContent='⏸';
  clearInterval(matchState.timerInterval);

  // Grid size: Easy 2×3=3 pairs, Medium 3×4=6 pairs, Hard 4×4=8 pairs
  const pairCount = diff==='Easy'?3 : diff==='Medium'?6 : 8;
  matchState.total = pairCount;
  // Timer counts down from timeLimit (0 = no limit, counts up)
  matchState.timer = timeLimit > 0 ? timeLimit : 0;

  const pairs = generateMatchPairs(op, diff, pairCount);

  // Build cards: one question + one answer per pair
  const cards=[];
  pairs.forEach(p=>{
    cards.push({type:'q', text:p.q, pairId:p.id, matched:false, el:null});
    cards.push({type:'a', text:String(p.a), pairId:p.id, matched:false, el:null});
  });
  // Shuffle
  for(let i=cards.length-1;i>0;i--){
    const j=randInt(0,i); [cards[i],cards[j]]=[cards[j],cards[i]];
  }
  matchState.cards=cards;

  buildMatchGrid();
  showScreen('match-game-screen');
  document.getElementById('match-result-overlay').classList.add('hidden');
  document.getElementById('match-ready-overlay').classList.add('hidden');
  updateMatchHeader();

  // Preview phase: show each card one at a time (open → bounce → close), then show Ready overlay
  matchState.locked = true;
  const indices = matchState.cards.map((_,i)=>i);
  // Shuffle reveal order
  for(let i=indices.length-1;i>0;i--){
    const j=randInt(0,i);[indices[i],indices[j]]=[indices[j],indices[i]];
  }
  const SHOW_MS  = 900;  // how long card stays open
  const STEP_MS  = 1200; // total time per card (open + close gap)
  indices.forEach((cardIdx, step) => {
    const openAt  = step * STEP_MS;
    const closeAt = openAt + SHOW_MS;
    // Open with bounce
    setTimeout(() => {
      const el = matchState.cards[cardIdx].el;
      el.classList.add('flipped');
      el.classList.remove('pop-reveal');
      void el.offsetWidth;
      el.classList.add('pop-reveal');
    }, openAt);
    // Close again
    setTimeout(() => {
      const el = matchState.cards[cardIdx].el;
      el.classList.remove('flipped','pop-reveal');
    }, closeAt);
  });
  // After all cards done, show Ready overlay
  const totalTime = indices.length * STEP_MS + 400;
  setTimeout(()=>{
    document.getElementById('match-ready-overlay').classList.remove('hidden');
  }, totalTime);
};

window.beginMatchGame = function(){
  document.getElementById('match-ready-overlay').classList.add('hidden');
  // Flip all cards back face-down
  matchState.cards.forEach(card => {
    card.el.classList.remove('flipped','pop-reveal');
  });
  matchState.locked = false;
  matchPaused = false;

  function startMatchTimer(){
    clearInterval(matchState.timerInterval);
    matchState.timerInterval = setInterval(()=>{
      if(matchPaused) return; // safety guard
      if(matchState.timeLimit > 0){
        matchState.timer--;
        updateMatchHeader();
        if(matchState.timer <= 0){
          clearInterval(matchState.timerInterval);
          setTimeout(showMatchTimeUp, 300);
        }
      } else {
        matchState.timer++;
        updateMatchHeader();
      }
    }, 1000);
    updateMatchHeader();
  }

  // Short delay so flip-back animation plays, then start timer
  matchState._startTimeout = setTimeout(startMatchTimer, 600);
};

function buildMatchGrid(){
  const grid=document.getElementById('match-grid');
  grid.innerHTML='';
  // Set columns based on difficulty: Easy=2, Medium=3, Hard=4
  const cols = matchState.diff==='Easy'?2 : matchState.diff==='Medium'?3 : 4;
  grid.style.gridTemplateColumns=`repeat(${cols}, 1fr)`;
  matchState.cards.forEach((card,idx)=>{
    const div=document.createElement('div');
    div.className='match-card'+(card.type==='a'?' is-answer':'');
    div.innerHTML=`<div class="match-front">🧩</div><div class="match-back">${card.text}</div>`;
    div.onclick=()=>flipMatchCard(idx);
    card.el=div;
    grid.appendChild(div);
  });
}

function flipMatchCard(idx){
  const card=matchState.cards[idx];
  if(matchState.locked||card.matched||matchState.flipped.includes(idx)) return;

  card.el.classList.add('flipped');
  matchState.flipped.push(idx);

  if(matchState.flipped.length===2){
    matchState.locked=true;
    checkMatchPair();
  }
}

function checkMatchPair(){
  const [i,j]=matchState.flipped;
  const c1=matchState.cards[i], c2=matchState.cards[j];

  if(c1.pairId===c2.pairId){
    // Correct match!
    c1.matched=true; c2.matched=true;
    c1.el.classList.add('matched'); c2.el.classList.add('matched');
    matchState.matched++;
    matchState.flipped=[]; matchState.locked=false;
    updateMatchHeader();
    SFX.correct();
    // Fly-off animation: direction based on card position on screen
    [c1, c2].forEach(c => {
      const rect = c.el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const goRight = centerX > window.innerWidth / 2;
      const flyX = goRight ? '280px' : '-280px';
      const flyRot = goRight ? '35deg' : '-35deg';
      c.el.style.setProperty('--fly-x', flyX);
      c.el.style.setProperty('--fly-rot', flyRot);
      c.el.classList.add('fly-off');
    });
    if(matchState.matched===matchState.total){
      clearInterval(matchState.timerInterval);
      setTimeout(showMatchResult, 900);
    }
  } else {
    // Wrong
    matchState.mistakes++;
    updateMatchHeader();
    SFX.wrong();
    c1.el.classList.add('wrong-flash'); c2.el.classList.add('wrong-flash');
    setTimeout(()=>{
      c1.el.classList.remove('flipped','wrong-flash');
      c2.el.classList.remove('flipped','wrong-flash');
      matchState.flipped=[]; matchState.locked=false;
    },900);
  }
}

function updateMatchHeader(){
  const t = matchState.timer;
  const m = Math.floor(Math.abs(t)/60), s = Math.abs(t)%60;
  const timeStr = `${m}:${String(s).padStart(2,'0')}`;
  document.getElementById('match-pairs-label').textContent=`${matchState.matched} / ${matchState.total} ✅`;
  const timerEl = document.getElementById('match-timer-label');
  timerEl.textContent = matchState.timeLimit>0 ? `⏱ ${timeStr}` : timeStr;
  timerEl.style.color = (matchState.timeLimit>0 && t<=30) ? 'var(--red)' : '';
  timerEl.style.fontWeight = (matchState.timeLimit>0 && t<=30) ? '900' : '';
  document.getElementById('match-mistakes-label').textContent=`${matchState.mistakes} ❌`;
}

function showMatchResult(){
  // Win — board cleared
  document.getElementById('mr-emoji').textContent='🎉';
  document.getElementById('mr-title').textContent='Board Cleared!';
  document.getElementById('mr-subtitle').textContent='Awesome work!';
  document.getElementById('mr-pairs').textContent=`${matchState.matched}/${matchState.total}`;
  document.getElementById('mr-mistakes').textContent=matchState.mistakes;
  document.getElementById('mr-diff').textContent=matchState.diff;
  document.getElementById('match-result-overlay').classList.remove('hidden');
  SFX.win();
}

function showMatchTimeUp(){
  // Time's up — didn't finish
  clearInterval(matchState.timerInterval);
  matchState.locked=true;
  document.getElementById('mr-emoji').textContent='⏰';
  document.getElementById('mr-title').textContent="Time's Up!";
  document.getElementById('mr-subtitle').textContent=`You matched ${matchState.matched} out of ${matchState.total} pairs!`;
  document.getElementById('mr-pairs').textContent=`${matchState.matched}/${matchState.total}`;
  document.getElementById('mr-mistakes').textContent=matchState.mistakes;
  document.getElementById('mr-diff').textContent=matchState.diff;
  document.getElementById('match-result-overlay').classList.remove('hidden');
  SFX.lose();
}

window.hideMatchResult=function(){
  document.getElementById('match-result-overlay').classList.add('hidden');
};

window.quitMatchGame=function(){
  clearInterval(matchState.timerInterval);
  document.getElementById('match-result-overlay').classList.add('hidden');
  showScreen('home-screen');
};

// ── Start (must be last — needs showScreen to be defined) ─────────────────
loadProfile();
// Apply saved mute state to button
applyMuteBtn();
