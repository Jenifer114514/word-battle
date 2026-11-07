/* ================= ストレージ（記録はこの端末に保存） ================= */
var STORE_KEY="wordbattle.local.v3";
var storageOK=(function(){try{localStorage.setItem("__wb_t","1");localStorage.removeItem("__wb_t");return true;}catch(e){return false;}})();
var sessionOK=(function(){try{sessionStorage.setItem("__wb_t","1");sessionStorage.removeItem("__wb_t");return true;}catch(e){return false;}})();
var MEMS={};
var store=storageOK?localStorage:{getItem:function(k){return (k in MEMS)?MEMS[k]:null;},setItem:function(k,v){MEMS[k]=String(v);},removeItem:function(k){delete MEMS[k];}};
var sstore=sessionOK?sessionStorage:{getItem:function(k){return (k in MEMS)?MEMS["s"+k]:null;},setItem:function(k,v){MEMS["s"+k]=String(v);},removeItem:function(k){delete MEMS["s"+k];}};

var DB=loadDB();
function loadDB(){
  try{var raw=store.getItem(STORE_KEY);if(raw){var d=JSON.parse(raw);if(d&&d.profiles)return d;}}catch(e){}
  return {version:3,profiles:{},deviceAccount:null};
}
function saveDB(){try{store.setItem(STORE_KEY,JSON.stringify(DB));}catch(e){toast("保存に失敗しました（容量超過？）");}}

/* セッション（このタブでログイン中のプレイヤー） */
var SESSION=(function(){try{var s=sstore.getItem("wb_session3");return s?JSON.parse(s):null;}catch(e){return null;}})();
function saveSession(){try{sstore.setItem("wb_session3",JSON.stringify(SESSION));}catch(e){}}
function me(){return (SESSION&&DB.profiles[SESSION.pid])?DB.profiles[SESSION.pid]:null;}

/* ================= ユーティリティ ================= */
function $(s,el){return (el||document).querySelector(s);}
function $$(s,el){return Array.prototype.slice.call((el||document).querySelectorAll(s));}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function shuffle(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function pctf(x){if(!isFinite(x))return "0%";return Math.round(x*100)+"%";}
function secf(ms){return (ms/1000).toFixed(1)+"秒";}
function pad2(n){return (n<10?"0":"")+n;}
function dstr(iso){var d=new Date(iso);return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());}
function dtf(iso){var d=new Date(iso);return d.getFullYear()+"/"+pad2(d.getMonth()+1)+"/"+pad2(d.getDate())+" "+pad2(d.getHours())+":"+pad2(d.getMinutes());}
var COLORS=["#6366f1","#ec4899","#10b981","#f59e0b","#06b6d4","#8b5cf6","#ef4444","#14b8a6"];
function colorOf(pid){var p=DB.profiles[pid];if(p&&p.color)return p.color;var h=0;var s=String(pid||"?");for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return COLORS[h%COLORS.length];}
function avatarHtml(pid,name,cls){var n=(name||"?").trim();var ch=n?n[0].toUpperCase():"?";var cls2=cls||"";
  return "<span class='avatar "+cls2+"' style='background:"+colorOf(pid)+"'>"+esc(ch)+"</span>";}
function toast(msg){var t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);
  setTimeout(function(){t.style.opacity="0";t.style.transition="opacity .3s";setTimeout(function(){t.remove();},320);},1900);}
function dirName(dir){return dir==="ej"?"英→日":"日→英";}
function nameTaken(name){for(var k in DB.profiles)if(DB.profiles[k].name===name)return DB.profiles[k];return null;}
/* ゲスト（ユーザー名の登録なし・このタブ限り） */
function newGuest(){
  var pid=uid("g_");
  var prof={id:pid,name:"ゲスト"+Math.floor(Math.random()*90+10),
    color:COLORS[Math.floor(Math.random()*COLORS.length)],
    guest:true,createdAt:new Date().toISOString(),nameChangedAt:new Date().toISOString(),
    battles:[],wordStats:{}};
  DB.profiles[pid]=prof;saveDB();
  return prof;
}
function registerAccount(name){
  name=String(name||"").trim().slice(0,12);
  if(!name)return {error:"ユーザー名を入力してください"};
  if(name.length<2)return {error:"ユーザー名は2文字以上にしてください"};
  if(DB.deviceAccount){var ex=DB.profiles[DB.deviceAccount];
    return {error:"この端末には既にアカウントがあります"+(ex?"（"+ex.name+"）":"")};
  }
  if(nameTaken(name))return {error:"その名前は既に使われています"};
  var pid=uid("p_");
  var prof={id:pid,name:name,color:COLORS[Object.keys(DB.profiles).length%COLORS.length],
    createdAt:new Date().toISOString(),nameChangedAt:new Date().toISOString(),
    battles:[],wordStats:{}};
  DB.profiles[pid]=prof;DB.deviceAccount=pid;saveDB();
  return {profile:prof};
}
function NAME_CHANGE_MS(){return 7*86400000;}
function tryRename(prof,newName){
  newName=String(newName||"").trim().slice(0,12);
  if(!newName||newName===prof.name)return {ok:true};
  var elapsed=Date.now()-new Date(prof.nameChangedAt||prof.createdAt).getTime();
  if(elapsed<NAME_CHANGE_MS()){
    var days=Math.ceil((NAME_CHANGE_MS()-elapsed)/86400000);
    return {error:"名前の変更は前回から7日後です（あと"+days+"日）"};
  }
  if(nameTaken(newName))return {error:"その名前は既に使われています"};
  prof.name=newName;prof.nameChangedAt=new Date().toISOString();
  return {ok:true};
}

/* ================= 単語別の記録 ================= */
function ensureStat(prof,wid){
  if(!prof.wordStats)prof.wordStats={};
  if(!prof.wordStats[wid]){
    prof.wordStats[wid]={wid:wid,asked:0,correct:0,wrong:0,sumTime:0,lastAt:"",
      dir:{ej:{asked:0,correct:0,sumTime:0},je:{asked:0,correct:0,sumTime:0}},history:[]};
  }
  return prof.wordStats[wid];
}
function recordAnswer(prof,wid,dir,mode,ok,timeMs){
  var st=ensureStat(prof,wid);
  st.asked++;st.sumTime+=timeMs;st.lastAt=new Date().toISOString();
  var d=st.dir[dir]||(st.dir[dir]={asked:0,correct:0,sumTime:0});d.asked++;d.sumTime+=timeMs;
  if(ok){st.correct++;d.correct++;}else st.wrong++;
  st.history.push({t:st.lastAt,dir:dir,mode:mode,ok:ok?1:0,timeMs:Math.round(timeMs)});
  if(st.history.length>80)st.history=st.history.slice(-80);
}

/* ================= 戦績集計 ================= */
function battleStats(prof){
  var bs=(prof.battles||[]).slice().sort(function(a,b){return a.date<b.date?-1:1;});
  var total=bs.length,w=0,l=0,d=0,pts=0,accSum=0,tSum=0,tN=0;
  var streak=0,best=0;
  bs.forEach(function(b){
    pts+=b.me.points;accSum+=b.me.accuracy;tSum+=b.me.avgTimeMs;tN++;
    if(b.me.rank===1){var same=b.players.filter(function(p){return p.rank===1;}).length;
      if(same===1){w++;streak++;best=Math.max(best,streak);}else{d++;streak=0;}}
    else{l++;streak=0;}
  });
  return {total:total,w:w,l:l,d:d,winRate:total?w/total:0,points:pts,
    avgAcc:total?accSum/total:0,avgTime:tN?tSum/tN:0,streakBest:best,streakCur:streak};
}

/* ================= 画面フレームワーク ================= */
var SCREENS={};
var app=$("#app"),topbar=$("#topbar");
var route={name:"profiles",params:{}};
function go(name,params){
  clearTimers();
  closeModal();
  route={name:name,params:params||{}};
  renderHeader();
  app.innerHTML="";
  SCREENS[name](params||{});
  window.scrollTo(0,0);
}
function renderHeader(){
  var m=me();
  var right=m?"<div class='who'>"+avatarHtml(m.id,m.name)+"<span>"+esc(m.name)+"</span></div><button id='swbtn' title='ログアウト'>⏻</button>":"";
  topbar.innerHTML="<div class='topin'><span class='sig' id='netChip' style='display:none' aria-label='通信状況'></span><div class='ttl'>⚔️ 英単語バトル <small>WordBattle</small></div><div class='tspace'></div>"+right+"</div>";
  var lb=$("#swbtn");
  if(lb)lb.onclick=function(){confirmModal("ログアウト","プレイヤー選択画面にもどりますか？","ログアウト",function(){
    var mm=me();
    if(mm&&mm.guest){delete DB.profiles[mm.id];saveDB();}
    SESSION=null;saveSession();go("profiles");});};
  var gb=$("#gbar");gb.innerHTML="";
}
/* 通信状況（ヘッダー左上・シグナルバー） */
var NET_LABEL={c:["c","接続中…"],ok:["ok","P2P接続"],r:["r","再接続中…"],off:["off","切断"]};
function setNet(state){
  var el=$("#netChip");if(!el)return;
  if(!state||!NET_LABEL[state]){el.style.display="none";return;}
  var d=NET_LABEL[state];
  el.style.display="inline-flex";
  el.className="sig "+d[0];
  el.title=d[1];
  var lit=d[0]==="ok"?4:(d[0]==="c"||d[0]==="r")?2:0;
  var h="";
  for(var i=0;i<4;i++)h+="<i class='"+(i<lit?"on":"")+"'></i>";
  el.innerHTML=h;
}
function clearTimers(){if(typeof B!=="undefined"&&B&&B.timer){clearInterval(B.timer);B.timer=null;}
  if(typeof R!=="undefined"&&R&&R.timer){clearInterval(R.timer);R.timer=null;}
  if(typeof PEND!=="undefined"&&PEND){PEND.forEach(function(id){clearTimeout(id);});PEND=null;}
  if(typeof roomStop==="function")roomStop();}
var PEND=null;
function pend(fn,ms){if(!PEND)PEND=[];var id=setTimeout(fn,ms);PEND.push(id);return id;}

/* ================= モーダル・確認 ================= */
function openModal(html){
  closeModal();
  var r=$("#modalroot");
  r.innerHTML="<div class='modal'><div class='sheet'>"+html+"</div></div>";
  $(".modal",r).addEventListener("click",function(e){if(e.target===this)closeModal();});
  return $(".sheet",r);
}
function closeModal(){$("#modalroot").innerHTML="";}
function confirmModal(title,msg,okLabel,onOk,danger){
  var s=openModal("<h2>"+esc(title)+"</h2><p class='sub'>"+esc(msg)+"</p><div class='rowbtns mt'><button class='btn ghost' id='cmNo'>キャンセル</button><button class='btn "+(danger?"danger":"pri")+"' id='cmOk'>"+esc(okLabel||"OK")+"</button></div>");
  $("#cmNo",s).onclick=closeModal;
  $("#cmOk",s).onclick=function(){closeModal();onOk();};
}

/* ================= 出題ビルダー ================= */
function buildQuestion(w,dir){
  var correctText=dir==="ej"?w.j:w.e;
  var seen={};seen[correctText]=true;
  var same=shuffle(WORDS.filter(function(x){return x.id!==w.id&&x.lv===w.lv;}));
  var rest=shuffle(WORDS.filter(function(x){return x.id!==w.id&&x.lv!==w.lv;}));
  var pool=same.concat(rest),ds=[];
  for(var i=0;i<pool.length&&ds.length<3;i++){
    var v=pool[i][dir==="ej"?"j":"e"];
    if(!seen[v]){seen[v]=true;ds.push(v);}
  }
  var options=shuffle([correctText].concat(ds));
  return {wid:w.id,dir:dir,text:dir==="ej"?w.e:w.j,options:options,correct:options.indexOf(correctText)};
}

/* ================= プレイヤー選択画面 ================= */
SCREENS.profiles=function(){
  var acc=DB.deviceAccount?DB.profiles[DB.deviceAccount]:null;
  var html="<div class='card'><h2>⚔️ プレイヤー</h2></div>";
  if(acc){
    html+="<div class='card'>"+
      "<div class='check' style='cursor:default;margin-bottom:10px'>"+avatarHtml(acc.id,acc.name)+esc(acc.name)+"<span class='badge b-ok'>登録済み</span></div>"+
      "<button class='btn pri block' id='contBtn'>「"+esc(acc.name)+"」ではじめる</button>"+
      "<button class='btn ghost block' style='margin-top:9px' id='guestBtn2'>ゲストではじめる</button>"+
      "<div class='sub' style='margin-top:8px;font-size:12px'>ゲストの戦績は保存されません（ページを閉じると消えます）</div></div>";
  }else{
    html+="<div class='card'><h2>🆕 新規登録</h2>"+
      "<label class='f'>ユーザー名（2〜12文字）</label><input type='text' id='npName' maxlength='12' placeholder='例：ゆうた'>"+
      "<button class='btn pri block mt' id='npGo'>登録して開始</button></div>";
    html+="<div class='card'><button class='btn pk block' id='guestBtn'>ゲストではじめる</button>"+
      "<div class='sub' style='margin-top:8px;font-size:12px'>ゲストの戦績は保存されません（ページを閉じると消えます）</div></div>";
  }
  html+="<div class='foot'>英単語バトル ver 3.1<br><button id='aboutBtn'>このアプリについて</button></div>";
  app.innerHTML=html;
  var goIn=function(p){SESSION={pid:p.id};saveSession();go("home");};
  if(acc){
    $("#contBtn",app).onclick=function(){goIn(acc);};
    $("#guestBtn2",app).onclick=function(){goIn(newGuest());};
  }else{
    $("#npGo",app).onclick=function(){
      var r=registerAccount($("#npName",app).value);
      if(r.error)return toast(r.error);
      SESSION={pid:r.profile.id};saveSession();
      toast("「"+r.profile.name+"」を登録しました");go("home");
    };
    $("#guestBtn",app).onclick=function(){goIn(newGuest());};
  }
  $("#aboutBtn",app).onclick=aboutModal;
};

/* ================= ホーム ================= */
SCREENS.home=function(){
  var m=me();if(!m)return go("profiles");
  var st=battleStats(m);
  var html="";
  html+="<div class='card pop'><div style='display:flex;align-items:center;gap:12px'>"+avatarHtml(m.id,m.name,"big")+
    "<div><h2 style='margin-bottom:3px'>ようこそ、"+esc(m.name)+"！"+(m.guest?" <span class='badge b-info'>ゲスト</span>":"")+"</h2><div class='sub'>対戦 "+st.total+"回 ・ 勝率 "+pctf(st.winRate)+" ・ 累計 "+st.points+"pt"+(st.streakCur>0?" ・ 🔥"+st.streakCur+"連勝中":"")+"</div></div></div></div>";
  html+="<button class='mi' data-go='roomSetup'><span class='ic'>🌐</span><span class='tx'>ルームで対戦<small>4桁コードで別々の端末と同時対戦（P2P）</small></span><span class='arr'>▶</span></button>";
  html+="<button class='mi' data-go='stats'><span class='ic'>📊</span><span class='tx'>戦績・統計<small>グラフ・単語別の成績を可視化</small></span><span class='arr'>▶</span></button>";
  html+="<button class='mi' data-go='history'><span class='ic'>📜</span><span class='tx'>対戦履歴<small>各試合の詳細な記録</small></span><span class='arr'>▶</span></button>";
  html+="<button class='mi' data-go='account'><span class='ic'>👤</span><span class='tx'>プロフィール<small>名前・アイコンの変更 / ログアウト</small></span><span class='arr'>▶</span></button>";
  app.innerHTML=html;
  $$("[data-go]",app).forEach(function(b){b.onclick=function(){go(b.getAttribute("data-go"));};});
};
function aboutModal(){
  openModal("<h2>ℹ️ このアプリについて</h2><p class='sub'>英単語の4択クイズを、PeerJS（P2P）で別々の端末から同時対戦できるアプリです。</p>"+
  "<h3>収録語彙</h3><p class='sub'>鉄壁 改訂版の "+WORDS.length+"語を収録。収録順を3分割し、Part 1／Part 2／Part 3 として出題範囲を選べます。</p>"+
  "<h3>主な機能</h3><div class='klist'><span class='badge b-info'>ルーム対戦（P2P・同時）</span><span class='badge b-ok'>戦績・グラフ統計</span><span class='badge b-warn'>単語別統計</span><span class='badge b-info'>プレイヤー比較</span></div>"+
  "<div class='rowbtns mt'><button class='btn pri block' id='abOk'>閉じる</button></div>");
  $("#abOk").onclick=closeModal;
}

/* ================= 起動（boot呼び出しは 60_data.js の末尾） ================= */
function boot(){
  /* 前セッションのゲストプロフィールを掃除 */
  Object.keys(DB.profiles).forEach(function(pid){
    var p=DB.profiles[pid];
    if(p.guest&&(!SESSION||SESSION.pid!==pid)){delete DB.profiles[pid];}
  });
  if(SESSION&&!DB.profiles[SESSION.pid]){SESSION=null;saveSession();}
  if(SESSION)go("home");
  else go("profiles");
}
