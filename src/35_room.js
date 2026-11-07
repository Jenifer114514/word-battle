/* ================= ルーム対戦（PeerJS・P2Pで別々の端末と同時対戦） =================
   ホストが問題を管理。切断時はゲストが自動再接続（途中復帰つき）。
   ホストが消えた場合はゲストがルームを引き継ぐ（ホスト交代）。
   通信状況はヘッダー左上のシグナルバーに表示。 */
var R2={peer:null,code:"",isHost:false,myPid:"",conns:{},hostConn:null,
  players:{},order:[],settings:null,qs:[],qi:0,phase:"idle",qStart:0,
  REVEAL_MS:4500,t1:null,t2:null,tick:null,hb:null,wd:null,tEnd:null,
  view:null,answered:false,cur:null,saveDone:false,
  leaving:false,lastMsgAt:0,reconnecting:false,attempts:0,migrating:false,
  seen:{},lastResults:null,lastEnd:null,dropTo:{},DROP_MS:10000,WD_MS:2000,
  qlog:[],lastScores:[],chat:[],chatUnread:0,chatLastSent:0,chatRate:{},chatSeq:0};
var CHAT_OPEN=false;
var PEER_PREFIX="wbtl-v3-";
var PEER_CONFIG={config:{iceServers:[
  {urls:"stun:stun.l.google.com:19302"},
  {urls:"turn:openrelay.metered.ca:80",username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turn:openrelay.metered.ca:443",username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turn:openrelay.metered.ca:443?transport=tcp",username:"openrelayproject",credential:"openrelayproject"}]}};
var CODE_CHARS="23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function roomStop(){
  if(R2.t1){clearTimeout(R2.t1);R2.t1=null;}
  if(R2.t2){clearTimeout(R2.t2);R2.t2=null;}
  if(R2.tick){clearInterval(R2.tick);R2.tick=null;}
  /* wd（無通信監視）・hbは画面遷移でも止めない（teardownで停止） */
}
function startHostLiveness(){ /* hb全配信＋無通信監視（交代ホストでも共用） */
  if(R2.hb)clearInterval(R2.hb);
  R2.hb=setInterval(function(){hostBroadcast({t:"hb"});},5000);
  if(R2.wd)clearInterval(R2.wd);
  R2.wd=setInterval(function(){
    var now=Date.now();
    activePlayers().forEach(function(pid){
      if(pid===R2.myPid)return;
      var lim=R2.phase==="lobby"?25000:R2.DROP_MS; /* ゲーム中は10秒無通信でleft */
      if(R2.seen[pid]&&now-R2.seen[pid]>lim)guestLeft(pid);
    });
  },R2.WD_MS);
}
function roomTeardown(){
  R2.leaving=true;
  roomStop();
  if(R2.hb){clearInterval(R2.hb);R2.hb=null;}
  if(R2.tEnd){clearTimeout(R2.tEnd);R2.tEnd=null;}
  Object.keys(R2.dropTo).forEach(function(k){clearTimeout(R2.dropTo[k]);});
  R2.dropTo={};
  Object.keys(R2.conns).forEach(function(k){try{R2.conns[k].close();}catch(e){}});
  R2.conns={};
  if(R2.hostConn){try{R2.hostConn.close();}catch(e){}R2.hostConn=null;}
  if(R2.peer){try{R2.peer.destroy();}catch(e){}R2.peer=null;}
  R2.code="";R2.myPid="";R2.players={};R2.order=[];R2.qs=[];R2.qi=0;
  R2.phase="idle";R2.view=null;R2.cur=null;R2.saveDone=false;R2.isHost=false;R2.answered=false;
  R2.reconnecting=false;R2.attempts=0;R2.lastResults=null;R2.lastEnd=null;R2.lastMsgAt=0;
  R2.migrating=false;R2.qlog=[];R2.lastScores=[];
  R2.chat=[];R2.chatUnread=0;R2.chatRate={};CHAT_OPEN=false;
  var __cp=document.querySelector("#chatPanel");if(__cp&&__cp.remove)__cp.remove();
  setNet("hide");
}
function activePlayers(){
  return R2.order.filter(function(pid){return R2.players[pid]&&!R2.players[pid].left;});
}
function answeredCount(){return activePlayers().filter(function(pid){return R2.players[pid].answers[R2.qi];}).length;}
function sendThenClose(conn,msg){
  try{conn.send(msg);}catch(e){}
  setTimeout(function(){try{conn.close();}catch(e){}},800);
}
function hostBroadcast(msg){Object.keys(R2.conns).forEach(function(pid){try{if(R2.conns[pid].open)R2.conns[pid].send(msg);}catch(e){}});}
function scoreSnapshot(){
  return R2.order.map(function(pid){var p=R2.players[pid];
    return {id:pid,name:p.name,color:p.color,points:p.points,left:!!p.left};})
    .sort(function(a,b){return b.points-a.points;});
}

/* ---------- ホスト: ルーム作成 ---------- */
function roomCreate(){
  var attempt=0;
  function tryCreate(){
    var code="";for(var i=0;i<4;i++)code+=CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];
    return roomCreateAt(code).then(function(r){
      if(r&&r.taken&&attempt<5){attempt++;return tryCreate();}
      if(r&&r.taken)return {error:"ルームを作成できませんでした。もう一度お試しください"};
      return r;
    });
  }
  return tryCreate();
}
function roomCreateAt(code){ /* 固定コードでルーム作成（テンプレ部屋用） */
  var m=me();
  return new Promise(function(resolve){
    var peer;
    try{peer=new Peer(PEER_PREFIX+code,PEER_CONFIG);}catch(e){return resolve({error:"PeerJSを初期化できません: "+e.message});}
    var settled=false;
    var to=setTimeout(function(){if(!settled){settled=true;try{peer.destroy();}catch(e){}resolve({error:"接続に時間がかかりすぎます。ネットワークを確認してください"});}},12000);
    peer.on("open",function(){
      if(settled){try{peer.destroy();}catch(e){}return;}
      settled=true;clearTimeout(to);
      R2.peer=peer;R2.code=code;R2.isHost=true;R2.myPid="h";
      R2.players={};R2.order=[];
      R2.players.h={id:"h",name:m.name,color:m.color,host:true,points:0,left:false,answers:{}};
      R2.order.push("h");
      R2.phase="lobby";
      peer.on("connection",function(conn){wireHostConn(conn);});
      peer.on("error",function(e){hostPeerError(e);});
      R2.leaving=false;
      startHostLiveness();
      setNet("ok");
      resolve({ok:true,code:code});
    });
    peer.on("error",function(e){
      if(settled)return;
      settled=true;clearTimeout(to);
      try{peer.destroy();}catch(e2){}
      if(e&&e.type==="unavailable-id")return resolve({taken:true});
      resolve({error:peerErrMsg(e)});
    });
  });
}
function peerErrMsg(e){
  var t=e&&e.type;
  if(t==="peer-unavailable")return "そのコードのルームが見つかりません";
  if(t==="unavailable-id")return "IDが使用中です";
  if(t==="network"||t==="socket-error"||t==="server-error"||t==="socket-closed")return "PeerJSシグナリングサーバーに接続できません。インターネット接続を確認してください";
  return "接続エラー"+(t?"（"+t+"）":"")+"が発生しました";
}
function wireHostConn(conn){
  var pidRef={pid:null};
  conn.on("data",function(msg){
    if(!msg)return;
    if(pidRef.pid){
      R2.seen[pidRef.pid]=Date.now();
      if(R2.dropTo[pidRef.pid]){clearTimeout(R2.dropTo[pidRef.pid]);delete R2.dropTo[pidRef.pid];} /* 通信が続いているので猶予解除 */
      var pp=R2.players[pidRef.pid];
      if(pp&&pp.left&&R2.phase!=="lobby"&&R2.phase!=="end"){ /* 戻ってきたら復帰 */
        pp.left=false;
        hostBroadcast({t:"wait",qi:R2.qi,answered:answeredCount(),totalP:activePlayers().length,scores:scoreSnapshot()});
      }
    }
    if(msg.t==="hb"){try{conn.send({t:"hb"});}catch(e){}return;}
    if(msg.t==="count"){ /* 公開ルームの人数調査 */
      var cn=R2.phase==="end"?0:activePlayers().length;
      try{conn.send({t:"count",n:cn,phase:R2.phase});}catch(e){}
      setTimeout(function(){try{conn.close();}catch(e){}},300);
      return;
    }
    if(msg.t==="hello"){
      var name=String(msg.name||"").trim().slice(0,12)||"Guest";
      if(R2.phase==="end"){
        if(R2.lastEnd&&msg.rejoin&&msg.prevPid&&R2.players[msg.prevPid]){sendThenClose(conn,R2.lastEnd);return;}
        else{sendThenClose(conn,{t:"rejected",reason:"このルームは終了しました"});return;}
        return;
      }
      if(R2.phase!=="lobby"&&!(msg.rejoin&&R2.players[msg.prevPid])){sendThenClose(conn,{t:"rejected",reason:"このルームはすでに始まっています"});return;}
      if(R2.phase==="lobby"&&msg.rejoin&&msg.prevPid&&R2.players[msg.prevPid]){
        var lp2=R2.players[msg.prevPid];
        if(R2.dropTo[lp2.id]){clearTimeout(R2.dropTo[lp2.id]);delete R2.dropTo[lp2.id];}
        lp2.left=false;
        pidRef.pid=lp2.id;
        R2.conns[lp2.id]=conn;R2.seen[lp2.id]=Date.now();
        try{conn.send({t:"welcome",pid:lp2.id,code:R2.code,settings:R2.settings,players:lobbyPlayers()});}catch(e){}
        hostBroadcast({t:"lobby",players:lobbyPlayers(),settings:R2.settings,code:R2.code});
        if(route.name==="roomLobby")renderLobby();
        conn.on("close",function(){hostConnDropped(lp2.id);});
        conn.on("error",function(){hostConnDropped(lp2.id);});
        return;
      }
      if(msg.rejoin&&msg.prevPid&&R2.players[msg.prevPid]&&R2.phase!=="lobby"){
        var rp=R2.players[msg.prevPid];
        if(R2.dropTo[rp.id]){clearTimeout(R2.dropTo[rp.id]);delete R2.dropTo[rp.id];} /* 猶予中の復帰 */
        rp.left=false;
        pidRef.pid=rp.id;
        R2.conns[rp.id]=conn;R2.seen[rp.id]=Date.now();
        hostResume(rp,conn);
        if(route.name==="roomBattle"&&R2.view&&R2.view.type==="q"){var w={t:"wait",qi:R2.qi,answered:answeredCount(),totalP:activePlayers().length,scores:scoreSnapshot()};try{conn.send(w);}catch(e){}}
        conn.on("close",function(){hostConnDropped(rp.id);});
        conn.on("error",function(){hostConnDropped(rp.id);});
        return;
      }
      var dup=R2.order.some(function(pid){return R2.players[pid].name===name&&!R2.players[pid].left;});
      if(dup){sendThenClose(conn,{t:"rejected",reason:"その名前は既に参加しています"});return;}
      if(activePlayers().length>=8){sendThenClose(conn,{t:"rejected",reason:"ルームが満員です"});return;}
      var pid="g"+uid("");
      pidRef.pid=pid;
      R2.players[pid]={id:pid,name:name,color:msg.color||"#ec4899",host:false,points:0,left:false,answers:{}};
      R2.order.push(pid);R2.conns[pid]=conn;R2.seen[pid]=Date.now();
      try{conn.send({t:"welcome",pid:pid,code:R2.code,settings:R2.settings,players:lobbyPlayers()});}catch(e){}
      hostBroadcast({t:"lobby",players:lobbyPlayers(),settings:R2.settings,code:R2.code});
      if(route.name==="roomLobby")renderLobby();
      conn.on("close",function(){hostConnDropped(pid);});
      conn.on("error",function(){hostConnDropped(pid);});
      return;
    }
    if(msg.t==="answer"&&pidRef.pid){
      if(R2.phase==="question"&&+msg.qi===R2.qi)applyAnswer(pidRef.pid,+msg.choice);
    }
    if(msg.t==="chat"&&pidRef.pid){
      var cp=R2.players[pidRef.pid];
      if(cp)hostChatMsg(pidRef.pid,cp.name,String(msg.text||""));
    }
  });
}
function hostResume(p,conn){
  var base={t:"resume",pid:p.id,code:R2.code,settings:R2.settings,total:R2.qs.length,players:lobbyPlayers()};
  if(R2.phase==="question"){
    var q=R2.qs[R2.qi];
    base.phase="q";
    base.q={dir:q.dir,text:q.text,options:q.options};
    base.qi=R2.qi;
    base.remainMs=Math.max(1000,R2.settings.limit*1000-(Date.now()-R2.qStart));
    base.meAnswered=!!p.answers[R2.qi];
  }else if(R2.phase==="reveal"){
    base.phase="reveal";
    var q2=R2.qs[R2.qi];
    base.qi=R2.qi;
    base.q={dir:q2.dir,text:q2.text,options:q2.options};
    base.correct=q2.correct;
    base.results=lastRevealResults();
    base.nextMs=Math.max(500,R2.revealUntil-Date.now());
  }else{
    base.phase="lobby";
  }
  try{conn.send(base);}catch(e){}
}
function lastRevealResults(){
  if(R2.lastResults)return R2.lastResults;
  return scoreSnapshot().map(function(s){
    var a=R2.players[s.id].answers[R2.qi]||{};
    return {id:s.id,name:s.name,ok:!!a.ok,timeMs:a.timeMs||null,point:a.point||0,total:s.points};
  });
}
function hostConnDropped(pid){ /* 切断検知: ロビーは即除外、ゲーム中はDROP_MS(10秒)猶予 */
  if(R2.phase==="lobby"){guestLeft(pid);return;}
  startDropTimer(pid);
}
function startDropTimer(pid){ /* 10秒戻らなければ無回答扱い（left）にして先へ進む */
  if(R2.dropTo[pid])return;
  R2.dropTo[pid]=setTimeout(function(){
    delete R2.dropTo[pid];
    var p=R2.players[pid];
    if(!p||p.left||R2.phase==="end"||R2.leaving)return;
    guestLeft(pid);
  },R2.DROP_MS);
}
function guestLeft(pid){
  var p=R2.players[pid];if(!p||p.left)return;
  if(R2.dropTo[pid]){clearTimeout(R2.dropTo[pid]);delete R2.dropTo[pid];}
  delete R2.conns[pid];
  if(R2.phase==="lobby"){delete R2.players[pid];R2.order=R2.order.filter(function(x){return x!==pid;});
    hostBroadcast({t:"lobby",players:lobbyPlayers(),settings:R2.settings,code:R2.code});
    if(route.name==="roomLobby")renderLobby();
  }else{
    p.left=true;
    hostBroadcast({t:"wait",qi:R2.qi,answered:answeredCount(),totalP:activePlayers().length,scores:scoreSnapshot()});
    if(R2.phase==="question"){ /* 残ったメンバーが全員回答済みなら即解答表示へ */
      var ans=answeredCount(),tot=activePlayers().length;
      if(ans>0&&ans>=tot){if(R2.t1)clearTimeout(R2.t1);R2.t1=setTimeout(revealNow,350);}
    }
  }
}
function lobbyPlayers(){
  return R2.order.map(function(pid){var p=R2.players[pid];
    return {id:pid,name:p.name,color:p.color,host:!!p.host,left:!!p.left};});
}
function hostPeerError(e){
  if(R2.phase==="lobby"){toast(peerErrMsg(e));roomTeardown();go("roomSetup");}
  else setNet("off");
}

/* ---------- ホスト: 開始・出題 ---------- */
function roomStartGame(){
  var pool=R2.settings.lv==="mix"?WORDS:WORDS.filter(function(w){return String(w.lv)===String(R2.settings.lv);});
  var picked=shuffle(pool).slice(0,Math.min(R2.settings.count,pool.length));
  R2.qs=picked.map(function(w,i){
    var dir=R2.settings.dir==="mix"?(Math.random()<.5?"ej":"je"):R2.settings.dir;
    var q=buildQuestion(w,dir);q.qi=i;q.wid=w.id;return q;
  });
  R2.qi=0;R2.phase="question";
  hostBroadcast({t:"start",settings:R2.settings,total:R2.qs.length,players:lobbyPlayers()});
  sendQuestion();
}
function sendQuestion(){
  var q=R2.qs[R2.qi];
  var payload={t:"q",qi:R2.qi,total:R2.qs.length,q:{dir:q.dir,text:q.text,options:q.options},remainMs:R2.settings.limit*1000};
  hostBroadcast(payload);
  R2.view={type:"q",qi:R2.qi,total:R2.qs.length,q:payload.q,remainMs:payload.remainMs,recvAt:Date.now()};
  R2.cur=payload;R2.answered=false;
  go("roomBattle");
  R2.qStart=Date.now();
  R2.t1=setTimeout(function(){revealNow();},R2.settings.limit*1000+400);
}
function hostAnswered(pid){
  var wait={t:"wait",qi:R2.qi,answered:answeredCount(),totalP:activePlayers().length,scores:scoreSnapshot()};
  hostBroadcast(wait);
  R2.cur=wait;
  if(route.name==="roomBattle"&&R2.view&&R2.view.type==="q")updateWaitBox(wait);
  if(wait.answered>0&&wait.answered>=wait.totalP){if(R2.t1)clearTimeout(R2.t1);R2.t1=setTimeout(function(){revealNow();},350);}
}
function applyAnswer(pid,choice){
  var p=R2.players[pid];
  if(!p||R2.phase!=="question"||p.answers[R2.qi])return;
  var q=R2.qs[R2.qi];
  var limitMs=R2.settings.limit*1000;
  var elapsed=clamp(Date.now()-R2.qStart,0,limitMs);
  var ok=choice===q.correct;
  var point=ok?10+Math.round(5*(1-elapsed/limitMs)):0;
  p.answers[R2.qi]={choice:choice,ok:ok,timeMs:Math.round(elapsed),point:point,ans:choice>=0&&choice<q.options.length?q.options[choice]:"（時間切れ）"};
  p.points+=point;
  hostAnswered(pid);
}
function hostAdvance(){
  R2.qi++;
  R2.lastResults=null;
  if(R2.qi>=R2.qs.length)endGame();
  else{R2.phase="question";sendQuestion();}
}
function roomForceNext(){ /* ホスト:全員回答済みならrevealを飛ばして次へ */
  if(!R2.isHost||R2.phase!=="reveal"||!R2.view||!R2.view.canSkip)return;
  if(R2.t2){clearTimeout(R2.t2);R2.t2=null;}
  hostAdvance();
}
function revealNow(){
  if(R2.phase!=="question")return;
  if(R2.t1){clearTimeout(R2.t1);R2.t1=null;}
  var allAns=answeredCount()>=activePlayers().length;
  R2.phase="reveal";
  var q=R2.qs[R2.qi];
  R2.lastResults=scoreSnapshot().map(function(s){
    var a=R2.players[s.id].answers[R2.qi];
    return {id:s.id,name:s.name,ok:!!a&&!!a.ok,nas:!a,timeMs:a?a.timeMs||null:null,point:a?a.point||0:0,total:s.points};
  });
  R2.revealUntil=Date.now()+R2.REVEAL_MS;
  var msg={t:"reveal",qi:R2.qi,correct:q.correct,results:R2.lastResults};
  hostBroadcast(msg);
  R2.view={type:"reveal",qi:R2.qi,total:R2.qs.length,q:{dir:q.dir,text:q.text,options:q.options},correct:q.correct,results:R2.lastResults,nextMs:R2.REVEAL_MS,recvAt:Date.now(),canSkip:R2.isHost&&allAns};
  go("roomBattle");
  R2.t2=setTimeout(hostAdvance,R2.REVEAL_MS);
}
function endGame(){
  R2.phase="end";
  var ranked=R2.order.map(function(pid){return R2.players[pid];}).sort(function(a,b){return b.points-a.points;});
  var rank=0,prev=null;
  ranked.forEach(function(p,i){if(p.points!==prev){rank=i+1;prev=p.points;}p.rank=rank;});
  var n=R2.qs.length||1;
  var playersEnd=ranked.map(function(p){
    var correct=0,sumT=0;
    R2.qs.forEach(function(q){var a=p.answers[q.qi];if(a&&a.ok)correct++;sumT+=a?a.timeMs:R2.settings.limit*1000;});
    return {id:p.id,name:p.name,color:p.color,points:p.points,rank:p.rank,left:!!p.left,
      correct:correct,wrong:n-correct,accuracy:correct/n,avgTimeMs:Math.round(sumT/n)};
  });
  var msg={t:"end",code:R2.code,date:new Date().toISOString(),total:n,settings:R2.settings,players:playersEnd,
    questions:R2.qs.map(function(q){
      var answers={};
      R2.order.forEach(function(pid){var p=R2.players[pid];var a=p.answers[q.qi];
        answers[pid]=a?{choice:a.choice,ok:a.ok,timeMs:a.timeMs,point:a.point,ans:a.ans}
          :{choice:-1,ok:false,timeMs:R2.settings.limit*1000,point:0,ans:"（未回答）"};});
      return {wid:q.wid,dir:q.dir,text:q.text,options:q.options,correct:q.correct,answers:answers};
    })};
  hostBroadcast(msg);
  R2.lastEnd=msg;
  saveRoomRecord(msg);
  R2.tEnd=setTimeout(function(){roomTeardown();},60000); /* 再接続用に1分だけ待機 */
}

/* ---------- ゲスト ---------- */
function roomJoin(code,rejoin){
  return new Promise(function(resolve){
    if(!/^[A-Z0-9]{4,5}$/.test(code))return resolve({error:"4〜5桁のルームコードを入力してください"});
    var m=me();var peer;
    try{peer=new Peer(PEER_CONFIG);}catch(e){return resolve({error:"PeerJSを初期化できません: "+e.message});}
    var settled=false;
    var to=setTimeout(function(){if(!settled){settled=true;try{peer.destroy();}catch(e){}resolve({error:"接続に時間がかかりすぎます。ネットワークを確認してください"});}},15000);
    peer.on("error",function(e){
      if(settled)return;
      settled=true;clearTimeout(to);
      try{peer.destroy();}catch(e2){}
      resolve({error:peerErrMsg(e),errType:e&&e.type});
    });
    peer.on("open",function(){
      var conn=peer.connect(PEER_PREFIX+code,{reliable:true});
      var opened=false;
      conn.on("open",function(){
        opened=true;clearTimeout(to);settled=true;
        R2.peer=peer;R2.hostConn=conn;R2.code=code;R2.isHost=false;
        R2.leaving=false;
        wireGuestConn(conn);
        var hello={t:"hello",name:m.name,color:m.color};
        if(rejoin&&rejoin.prevPid){hello.rejoin=true;hello.prevPid=rejoin.prevPid;}
        try{conn.send(hello);}catch(e){}
        resolve({ok:true});
      });
      conn.on("error",function(){
        if(!opened&&!settled){settled=true;clearTimeout(to);try{peer.destroy();}catch(e2){}
          resolve({error:"ルームに接続できませんでした"});}
      });
    });
  });
}
function wireGuestConn(conn){
  conn.on("data",function(msg){
    if(!msg)return;
    R2.lastMsgAt=Date.now();
    if(R2.reconnecting){R2.reconnecting=false;R2.attempts=0;setNet("ok");}
    switch(msg.t){
      case "hb":
        try{conn.send({t:"hb"});}catch(e){}
        break;
      case "welcome":
        R2.myPid=msg.pid;R2.settings=msg.settings;R2.players={};
        (msg.players||[]).forEach(function(p){R2.players[p.id]=p;});
        R2.order=(msg.players||[]).map(function(p){return p.id;});
        R2.qlog=[];R2.lastScores=[];
        R2.phase="lobby";
        setNet("ok");
        startGuestWatchdog();
        if(route.name!=="roomLobby")go("roomLobby");else renderLobby();
        break;
      case "lobby":
        R2.players={};(msg.players||[]).forEach(function(p){R2.players[p.id]=p;});
        R2.order=(msg.players||[]).map(function(p){return p.id;});
        if(R2.settings&&msg.settings)R2.settings=msg.settings;
        if(route.name==="roomLobby")renderLobby();
        break;
      case "start":
        R2.saveDone=false;
        if(R2.tEnd){clearTimeout(R2.tEnd);R2.tEnd=null;}
        R2.settings=msg.settings;R2.total=msg.total;R2.qi=-1;R2.phase="waiting-q";
        R2.qlog=[];R2.lastScores=(R2.order||[]).map(function(pid){var p=R2.players[pid];return {id:pid,points:p?p.points:0};});
        go("roomBattle");
        break;
      case "q":
        R2.phase="question";R2.answered=!!msg.meAnswered;R2.qi=msg.qi;
        R2.cur=msg;R2.view={type:"q",qi:msg.qi,total:msg.total,q:msg.q,remainMs:msg.remainMs,recvAt:Date.now()};
        R2.qlog[msg.qi]={dir:msg.q.dir,text:msg.q.text,options:msg.q.options,correct:null,results:null};
        go("roomBattle");
        break;
      case "wait":
        R2.cur=msg;
        if(msg.scores)R2.lastScores=msg.scores;
        if(route.name==="roomBattle"&&R2.view&&R2.view.type==="q")updateWaitBox(msg);
        break;
      case "reveal":
        R2.phase="reveal";
        R2.view={type:"reveal",qi:msg.qi,total:R2.total||0,results:msg.results,correct:msg.correct,q:R2.view&&R2.view.type==="q"?R2.view.q:null,recvAt:Date.now(),nextMs:R2.REVEAL_MS+500};
        if(R2.qlog[msg.qi]){R2.qlog[msg.qi].correct=msg.correct;R2.qlog[msg.qi].results=msg.results;}
        if(msg.results)R2.lastScores=msg.results.map(function(r){return {id:r.id,points:r.total};});
        go("roomBattle");
        break;
      case "resume":
        handleResume(msg);
        break;
      case "chat":
        if(msg.pid===R2.myPid)break; /* 自分はローカル表示済み */
        chatPush({pid:msg.pid,name:msg.name,text:msg.text,mine:false});
        if(!CHAT_OPEN)toast("💬 "+msg.name+"："+msg.text);
        break;
      case "rejected":
        toast(msg.reason||"参加できませんでした");roomTeardown();go("roomSetup");
        break;
      case "end":
        if(!R2.saveDone){R2.saveDone=true;saveRoomRecord(msg);}
        R2.lastEnd=msg;
        if(R2.tEnd)clearTimeout(R2.tEnd);
        R2.tEnd=setTimeout(function(){roomTeardown();},60000); /* 再戦を1分だけ待機 */
        break;
    }
  });
  conn.on("close",function(){
    if(R2.leaving||!R2.peer)return;
    if(R2.phase==="end"){roomTeardown();return;} /* 終了後の切断は静かに退出 */
    setNet("r");
    guestReconnect();
  });
  conn.on("error",function(){
    if(R2.leaving||!R2.peer)return;
    if(R2.phase==="end"){roomTeardown();return;}
    setNet("r");
    guestReconnect();
  });
}
function handleResume(msg){
  R2.myPid=msg.pid;
  if(msg.settings)R2.settings=msg.settings;
  if(msg.players){R2.players={};(msg.players||[]).forEach(function(p){R2.players[p.id]=p;});R2.order=(msg.players||[]).map(function(p){return p.id;});}
  startGuestWatchdog();
  if(msg.phase==="lobby"){R2.phase="lobby";go("roomLobby");return;}
  R2.total=msg.total;
  if(msg.phase==="q"){
    R2.phase="question";R2.answered=!!msg.meAnswered;R2.qi=msg.qi;
    R2.cur=msg;R2.view={type:"q",qi:msg.qi,total:msg.total,q:msg.q,remainMs:msg.remainMs,recvAt:Date.now()};
    R2.qlog[msg.qi]={dir:msg.q.dir,text:msg.q.text,options:msg.q.options,correct:null,results:null};
    go("roomBattle");
  }else if(msg.phase==="reveal"){
    R2.phase="reveal";
    R2.view={type:"reveal",qi:msg.qi,total:msg.total,q:msg.q,correct:msg.correct,results:msg.results,recvAt:Date.now(),nextMs:msg.nextMs};
    var ql=R2.qlog[msg.qi]||(R2.qlog[msg.qi]={dir:null,text:null,options:null,correct:null,results:null});
    if(msg.q){ql.dir=msg.q.dir;ql.text=msg.q.text;ql.options=msg.q.options;}
    ql.correct=msg.correct;ql.results=msg.results;
    if(msg.results)R2.lastScores=msg.results.map(function(r){return {id:r.id,points:r.total};});
    go("roomBattle");
  }
}
function startGuestWatchdog(){
  if(R2.wd)clearInterval(R2.wd);
  R2.wd=setInterval(function(){
    if(R2.leaving||R2.reconnecting||!R2.peer)return;
    if(R2.phase!=="lobby"&&R2.phase!=="waiting-q"&&R2.phase!=="question"&&R2.phase!=="reveal")return;
    if(R2.lastMsgAt&&Date.now()-R2.lastMsgAt>20000){
      setNet("r");
      try{R2.hostConn.close();}catch(e){}
      guestReconnect();
    }
  },5000);
}
function guestReconnect(){
  if(R2.reconnecting||R2.leaving||!R2.code)return;
  R2.reconnecting=true;
  R2.attempts++;
  if(R2.attempts>5){
    R2.reconnecting=false;
    setNet("off");
    toast("ホストに再接続できませんでした");
    var keepCode=R2.code;
    roomTeardown();
    go("roomSetup");
    try{$("#rsCode",app).value=keepCode;}catch(e){}
    return;
  }
  var delay=Math.min(800*R2.attempts,4000);
  var prevPid=R2.myPid;
  if(R2.peer){try{R2.peer.destroy();}catch(e){}R2.peer=null;R2.hostConn=null;}
  setTimeout(function(){
    if(R2.leaving)return;
    roomJoin(R2.code,{rejoin:true,prevPid:prevPid}).then(function(r){
      if(R2.leaving)return;
      if(r.error){
        if(r.errType==="peer-unavailable"&&canMigrate()){R2.reconnecting=false;hostMigration();return;}
        if(R2.attempts<=5){R2.reconnecting=false;guestReconnect();}
        return;
      }
      /* 接続成功: welcome/resume を待つ。失敗なら close ハンドラが再試行 */
    });
  },delay);
}

/* ---------- ホスト交代（ホストが消えたらメンバーがルームを引き継ぐ） ---------- */
function canMigrate(){
  return !!R2.code&&R2.order.length>1&&!!R2.players[R2.myPid]&&!R2.players[R2.myPid].left
    &&(R2.phase==="lobby"||R2.phase==="waiting-q"||R2.phase==="question"||R2.phase==="reveal");
}
function hostMigration(){ /* ホストのPeerが消えていたら自分が引き継ぎを試みる */
  if(R2.migrating||R2.leaving)return;
  if(!canMigrate()){
    if(R2.phase!=="end"&&!R2.saveDone)giveUpRoom();
    return;
  }
  R2.migrating=true;setNet("r");
  setTimeout(function(){tryClaimHost(0);},200+Math.floor(Math.random()*600));
}
function giveUpRoom(){
  R2.migrating=false;
  if(R2.phase==="end"||R2.saveDone)return;
  toast("ホストが見つからないためルームを退出しました");
  var keepCode=R2.code;
  roomTeardown();
  go("roomSetup");
  try{$("#rsCode",app).value=keepCode;}catch(e){}
}
function tryClaimHost(n){
  if(R2.leaving)return;
  if(n>=3)return giveUpRoom();
  var peer;
  try{peer=new Peer(PEER_PREFIX+R2.code,PEER_CONFIG);}catch(e){return giveUpRoom();}
  var settled=false;
  var to=setTimeout(function(){if(!settled){settled=true;try{peer.destroy();}catch(e){}tryClaimHost(n+1);}},9000);
  peer.on("error",function(e){
    if(settled)return;settled=true;clearTimeout(to);
    try{peer.destroy();}catch(e2){}
    if(e&&e.type==="unavailable-id"){ /* 他のメンバーが先に引き継いだ → そのホストへ参加し直す */
      R2.migrating=false;R2.attempts=0;R2.reconnecting=false;
      guestReconnect();return;
    }
    setTimeout(function(){if(!R2.leaving)tryClaimHost(n+1);},1200);
  });
  peer.on("open",function(){
    if(settled){try{peer.destroy();}catch(e){}return;}
    settled=true;clearTimeout(to);
    becomeHost(peer);
  });
}
function rebuildQuestion(e2,i){ /* 問題文から単語を引き当てて正解を復元 */
  var w=null;
  for(var k=0;k<WORDS.length;k++){
    if((e2.dir==="ej"?WORDS[k].e:WORDS[k].j)===e2.text){w=WORDS[k];break;}
  }
  var correct=e2.correct;
  if(correct==null&&w)correct=e2.options.indexOf(e2.dir==="ej"?w.j:w.e);
  if(correct==null||correct<0)correct=0;
  return {wid:w?w.id:null,dir:e2.dir,text:e2.text,options:e2.options,correct:correct,qi:i};
}
function genRoomQuestion(used){ /* 残りの問題を新しく生成 */
  var pool=R2.settings.lv==="mix"?WORDS:WORDS.filter(function(w){return String(w.lv)===String(R2.settings.lv);});
  var fresh=pool.filter(function(w){return !used[w.e]&&!used[w.j];});
  if(!fresh.length)fresh=pool;
  var w=fresh[Math.floor(Math.random()*fresh.length)];
  var dir=R2.settings.dir==="mix"?(Math.random()<.5?"ej":"je"):R2.settings.dir;
  var q=buildQuestion(w,dir);q.wid=w.id;
  return q;
}
function becomeHost(peer){
  R2.order.forEach(function(pid){var p=R2.players[pid];if(p)p.host=false;});
  var oldHost=R2.order[0];
  if(oldHost&&oldHost!==R2.myPid&&R2.players[oldHost])R2.players[oldHost].left=true;
  var meP=R2.players[R2.myPid];
  if(meP){meP.host=true;meP.left=false;}
  (R2.lastScores||[]).forEach(function(s){var p=R2.players[s.id];if(p&&s.points!=null)p.points=s.points;});
  R2.conns={};R2.seen={};R2.isHost=true;R2.leaving=false;R2.migrating=false;R2.reconnecting=false;
  R2.answered=false;R2.lastResults=null;R2.attempts=0;R2.hostConn=null;
  peer.on("connection",function(conn){wireHostConn(conn);});
  peer.on("error",function(){});
  R2.peer=peer;
  /* 過去問と全員の回答を履歴から復元 */
  R2.qlog.forEach(function(e2,i){
    if(!e2)return;
    var q=rebuildQuestion(e2,i);
    if(q)R2.qs[i]=q;
    (e2.results||[]).forEach(function(r){
      var p=R2.players[r.id];if(!p||!R2.qs[i])return;
      if(!p.answers)p.answers={};
      p.answers[i]={choice:-1,ok:!!r.ok,timeMs:r.timeMs||0,point:r.point||0,
        ans:r.ok?R2.qs[i].options[R2.qs[i].correct]:"（不明）"};
      if(r.total!=null)p.points=r.total;
    });
  });
  /* 今後の問題を生成 */
  var used={};R2.qs.forEach(function(q){if(q)used[q.text]=true;});
  for(var i=0;i<(R2.total||0);i++){
    if(R2.qs[i])continue;
    var gq=genRoomQuestion(used);gq.qi=i;R2.qs[i]=gq;used[gq.text]=true;
  }
  startHostLiveness();
  setNet("ok");
  toast("「"+meP.name+"」がホストを引き継ぎました");
  if(R2.phase==="lobby"){
    hostBroadcast({t:"lobby",players:lobbyPlayers(),settings:R2.settings,code:R2.code});
    go("roomLobby");
    return;
  }
  if(R2.qi<0)R2.qi=0;
  var cur=R2.qs[R2.qi];
  var res=cur&&R2.qlog[R2.qi]&&R2.qlog[R2.qi].results;
  if(R2.phase==="reveal"&&res){ /* 解答表示の途中だった → 表示して続きへ */
    R2.lastResults=res;
    R2.revealUntil=Date.now()+2500;
    hostBroadcast({t:"reveal",qi:R2.qi,correct:cur.correct,results:res});
    R2.view={type:"reveal",qi:R2.qi,total:R2.qs.length,q:{dir:cur.dir,text:cur.text,options:cur.options},correct:cur.correct,results:res,nextMs:2500,recvAt:Date.now(),canSkip:false};
    go("roomBattle");
    if(R2.t2)clearTimeout(R2.t2);
    R2.t2=setTimeout(hostAdvance,2500);
  }else{ /* 出題中だった → 同じ問題を全員に再送 */
    R2.phase="question";
    sendQuestion();
  }
}

/* ---------- 再戦（ホスト: 同じメンバーでもう一度） ---------- */
function hostRematch(){
  if(!R2.isHost||R2.phase!=="end"||!R2.peer)return;
  if(R2.tEnd){clearTimeout(R2.tEnd);R2.tEnd=null;}
  R2.order=R2.order.filter(function(pid){var p=R2.players[pid];return p&&!p.left;});
  R2.order.forEach(function(pid){var p=R2.players[pid];p.points=0;p.answers={};p.left=false;p.rank=0;});
  R2.saveDone=false;R2.lastEnd=null;R2.lastResults=null;R2.answered=false;R2.qlog=[];
  R2.qi=0;
  roomStartGame();
}

/* ---------- チャット（定型文・自由入力） ---------- */
var CHAT_TAUNTS=["おそっ！亀？","それ勉強した?","余裕ww","ざんね〜ん","追いつける?","かんたんすぎ✌","集中〜！","まだ回答してないの？"];
var CHAT_NICE=["よろしく！","ナイス！","いいね！","あと1問！"];
function chatPush(m){
  R2.chat.push(m);
  if(R2.chat.length>50)R2.chat.shift();
  if(!CHAT_OPEN)R2.chatUnread++;
  refreshChatLog();renderChatFab();
}
function chatBubble(m){
  return "<div class='cmsg"+(m.mine?" mine":"")+"'>"+
    (m.mine?"":"<small>"+esc(m.name)+"</small>")+
    "<div class='ctext'>"+esc(m.text)+"</div></div>";
}
function refreshChatLog(){
  var lg=document.querySelector("#chatLog");
  if(lg)lg.innerHTML=R2.chat.map(chatBubble).join("");
}
function canChat(){
  return !!R2.peer&&(R2.phase==="lobby"||R2.phase==="waiting-q"||R2.phase==="question"||R2.phase==="reveal"||R2.phase==="end");
}
function sendChat(text){
  if(!canChat())return;
  var t=String(text||"").trim().slice(0,80);if(!t)return;
  var now=Date.now();
  if(now-R2.chatLastSent<1200){toast("送信が早すぎます。少し待ってください");return;}
  R2.chatLastSent=now;
  if(R2.isHost)hostChatMsg(R2.myPid,me().name,t);
  else if(R2.hostConn){try{R2.hostConn.send({t:"chat",text:t});}catch(e){}}
}
function hostChatMsg(pid,name,text){
  if(!R2.isHost)return;
  var t=String(text||"").trim().slice(0,80);if(!t)return;
  var now=Date.now();
  if(now-(R2.chatRate[pid]||0)<800)return; /* 1人0.8秒以下の連投は無視 */
  R2.chatRate[pid]=now;
  R2.chatSeq++;
  hostBroadcast({t:"chat",id:R2.chatSeq,pid:pid,name:name,text:t});
  chatPush({pid:pid,name:name,text:t,mine:pid===R2.myPid});
}
function renderChatFab(){
  var el=document.querySelector("#chatFab");
  if(!canChat()){if(el)el.style.display="none";return;}
  if(!el){
    el=document.createElement("button");el.id="chatFab";el.title="チャット";
    el.onclick=function(){CHAT_OPEN?closeChatPanel():openChatPanel();};
    document.body.appendChild(el);
  }
  el.style.display="grid";
  el.innerHTML="💬"+(R2.chatUnread>0?"<span class='cbadge'>"+(R2.chatUnread>9?"9+":R2.chatUnread)+"</span>":"");
}
function openChatPanel(){
  closeChatPanel();
  CHAT_OPEN=true;R2.chatUnread=0;
  var wrap=document.createElement("div");wrap.id="chatPanel";
  wrap.innerHTML="<div class='sheet'>"+
    "<div class='chead'><b>💬 チャット</b><button id='chatClose'>✕</button></div>"+
    "<div id='chatLog'>"+R2.chat.map(chatBubble).join("")+"</div>"+
    "<div class='chips'><span class='clbl'>煽り</span>"+
    CHAT_TAUNTS.map(function(t){return "<button class='chip hot'>"+t+"</button>";}).join("")+
    "<span class='clbl'>あいさつ</span>"+
    CHAT_NICE.map(function(t){return "<button class='chip'>"+t+"</button>";}).join("")+
    "</div>"+
    "<div class='crow'><input type='text' id='chatInput' maxlength='80' placeholder='自由入力（80文字まで）'><button class='btn pri' id='chatSend'>送信</button></div>"+
    "</div>";
  document.body.appendChild(wrap);
  refreshChatLog();
  var inp=wrap.querySelector("#chatInput");
  var send=function(){var v=inp.value;inp.value="";sendChat(v);};
  wrap.querySelector("#chatClose").onclick=closeChatPanel;
  wrap.querySelector("#chatSend").onclick=send;
  if(inp&&inp.addEventListener)inp.addEventListener("keydown",function(ev){if(ev.key==="Enter")send();});
  Array.prototype.forEach.call(wrap.querySelectorAll(".chip"),function(c){
    c.onclick=function(){sendChat(c.textContent);};
  });
  renderChatFab();
}
function closeChatPanel(){
  CHAT_OPEN=false;
  var p=document.querySelector("#chatPanel");
  if(p&&p.remove)p.remove();
  renderChatFab();
}

/* ---------- 公開ルーム（テンプレ部屋 HAFY1〜5） ---------- */
var TPL_ROOMS=["HAFY1","HAFY2","HAFY3","HAFY4","HAFY5"];
var __tplStatus={};
var probePeer=null,probeSeq=0;
function tplMark(code,m){ /* 表示を更新（_tplStatus はテスト用ミラー） */
  var s=$("#tpls-"+code);
  var t=(typeof m==="string")?m:null;
  if(t){__tplStatus[code]=t;if(s)s.textContent=t;return;}
  if(!m||m.n<=0||m.phase==="end"){__tplStatus[code]="空き";if(s)s.textContent="空き";return;}
  __tplStatus[code]=m.n+"人"+(m.phase==="lobby"?"（待機中）":"（対戦中）");
  if(s)s.textContent=__tplStatus[code];
}
function probeTemplateRooms(){ /* 公開ルームの人数をまとめて調査 */
  var seq=++probeSeq;
  if(probePeer){try{probePeer.destroy();}catch(e){}probePeer=null;}
  TPL_ROOMS.forEach(function(c){__tplStatus[c]="調査中…";var el=$("#tpls-"+c);if(el)el.textContent="調査中…";});
  if(typeof Peer==="undefined")return;
  var p;
  try{p=new Peer(PEER_CONFIG);}catch(e){return;}
  probePeer=p;
  p.on("open",function(){
    if(seq!==probeSeq){try{p.destroy();}catch(e){}return;}
    TPL_ROOMS.forEach(function(code){
      var conn;
      try{conn=p.connect(PEER_PREFIX+code,{reliable:true});}catch(e){return;}
      var to=setTimeout(function(){tplMark(code,"空き");try{conn.close();}catch(e){}},4500);
      conn.on("open",function(){try{conn.send({t:"count"});}catch(e){}});
      conn.on("data",function(m){if(m&&m.t==="count"){clearTimeout(to);tplMark(code,m);try{conn.close();}catch(e){}}});
      conn.on("error",function(){});
    });
  });
  p.on("error",function(e){
    if(e&&e.type==="peer-unavailable"){
      var mm=(e&&e.message)||"";
      TPL_ROOMS.forEach(function(code){if(!mm||mm.indexOf(code)>=0)tplMark(code,"空き");});
    }
  });
  setTimeout(function(){if(probePeer===p){try{p.destroy();}catch(e){}}},6000);
}
function templateEnter(code){ /* 空いていればホストになる、埋まっていれば参加 */
  var btn=$("#tpl-"+code);if(btn)btn.disabled=true;
  R2.settings={count:RSET.count,dir:RSET.dir,lv:RSET.lv,limit:RSET.limit};
  roomCreateAt(code).then(function(r){
    if(r&&r.ok){go("roomLobby");return;}
    roomJoin(code,null).then(function(j){
      var btn2=$("#tpl-"+code);
      if(j.error){if(btn2)btn2.disabled=false;return toast(j.error);}
      go("roomLobby");
    });
  });
}

/* ---------- 回答送信 ---------- */
function roomAnswer(choice){
  if(R2.answered)return;
  R2.answered=true;
  $$("#rch .choice",app).forEach(function(x){x.disabled=true;x.style.opacity=.5;});
  if(R2.isHost)applyAnswer(R2.myPid,choice);
  else if(R2.hostConn){try{R2.hostConn.send({t:"answer",qi:R2.cur&&R2.cur.qi!=null?R2.cur.qi:0,choice:choice});}catch(e){}}
  updateWaitBox(R2.cur||{answered:R2.isHost?answeredCount():1,totalP:R2.isHost?activePlayers().length:(R2.order?R2.order.length:1),scores:R2.isHost?scoreSnapshot():[]});
}
function endRecordId(end){
  var s=end.code+"|"+end.date+"|"+R2.myPid;var h=0;
  for(var i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;
  return "b_"+(h>>>0).toString(36);
}
function saveRoomRecord(end){
  var m=me();if(!m)return;
  var mine=null;
  end.players.forEach(function(p){if(p.id===R2.myPid)mine=p;});
  if(!mine)return;
  var sameTop=end.players.filter(function(p){return p.rank===mine.rank;}).length;
  var res=mine.rank===1?(sameTop===1?"w":"d"):"l";
  var rid=endRecordId(end);
  var record={id:rid,roomId:"p2p-"+end.code,date:end.date,mode:"room",
    players:end.players.map(function(p){
      return {pid:p.id===R2.myPid?m.id:("p2p:"+p.name),name:p.name,isCpu:false,
        points:p.points,rank:p.rank,correct:p.correct,wrong:p.wrong,accuracy:p.accuracy,avgTimeMs:p.avgTimeMs};}),
    me:{points:mine.points,rank:mine.rank,res:res,correct:mine.correct,wrong:mine.wrong,accuracy:mine.accuracy,avgTimeMs:mine.avgTimeMs,count:end.total},
    questions:end.questions.map(function(q){
      var a=q.answers[R2.myPid]||{choice:-1,ok:false,timeMs:(R2.settings?R2.settings.limit:15)*1000,point:0,ans:"（未回答）"};
      return {wid:q.wid,dir:q.dir,ok:a.ok,timeMs:a.timeMs,point:a.point,ans:a.ans,
        correctText:q.options[q.correct],
        all:Object.keys(q.answers).map(function(pid){
          var pl=end.players.filter(function(x){return x.id===pid;})[0]||{name:"?"};
          return {pid:pid===R2.myPid?m.id:("p2p:"+pl.name),name:pl.name,isCpu:false,ok:q.answers[pid].ok,timeMs:q.answers[pid].timeMs};})};
    })};
  var dup=m.battles.some(function(b){return b.id===rid;});
  if(!dup){
    m.battles.push(record);
    m.lastAt=new Date().toISOString();
    record.questions.forEach(function(qd){recordAnswer(m,qd.wid,qd.dir,"battle",qd.ok,qd.timeMs);});
    saveDB();
  }
  if(!R2.isHost)roomTeardown(); /* ホストは再接続用にendを60秒保持 */
  go("battleResult",{bid:rid});
}

/* ---------- 画面: セットアップ ---------- */
var RSET={count:10,dir:"mix",lv:"mix",limit:15};
SCREENS.roomSetup=function(){
  var m=me();if(!m)return go("profiles");
  roomTeardown();
  if(typeof Peer==="undefined"){
    app.innerHTML="<div class='card'><h2>🌐 ルームで対戦</h2><div class='notice'>PeerJSを読み込めませんでした。インターネット接続を確認してページを再読み込みしてください。</div></div><div class='rowbtns'><button class='btn ghost block' id='rsBack'>ホームへ</button></div>";
    $("#rsBack",app).onclick=function(){go("home");};return;
  }
  var preCode="";try{var u=new URLSearchParams(location.search);preCode=(u.get("room")||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5);}catch(e){}
  var html="<div class='card'><h2>🌐 ルームで対戦</h2>"+
    "<div class='check' style='cursor:default'>"+avatarHtml(m.id,m.name)+esc(m.name)+"<span class='badge b-ok'>あなた</span></div></div>";
  html+="<div class='card'><h2>🏠 ルームを作る（ホスト）</h2>"+
    "<label class='f'>問題数</label><div class='seg' id='rsCount'>"+[5,10,15,20].map(function(n){return "<button data-v='"+n+"' class='"+(RSET.count===n?"on":"")+"'>"+n+"問</button>";}).join("")+"</div>"+
    "<label class='f'>出題方向</label><div class='seg' id='rsDir'>"+
    [["ej","英語→日本語"],["je","日本語→英語"],["mix","ミックス"]].map(function(x){return "<button data-v='"+x[0]+"' class='"+(RSET.dir===x[0]?"on":"")+"'>"+x[1]+"</button>";}).join("")+"</div>"+
    "<label class='f'>出題範囲</label><div class='seg' id='rsLv'>"+
    [["1",LV_NAME[1]],["2",LV_NAME[2]],["3",LV_NAME[3]],["mix","ミックス"]].map(function(x){return "<button data-v='"+x[0]+"' class='"+(RSET.lv===x[0]?"on":"")+"'>"+x[1]+"</button>";}).join("")+"</div>"+
    "<label class='f'>制限時間</label><div class='seg' id='rsLimit'>"+[5,10,15,20].map(function(n){return "<button data-v='"+n+"' class='"+(RSET.limit===n?"on":"")+"'>"+n+"秒</button>";}).join("")+"</div>"+
    "<button class='btn pri block mt' id='rsCreate'>ルームを作成する</button></div>";
  html+="<div class='card'><h2>📢 公開ルーム</h2><div id='tplList'>"+
    TPL_ROOMS.map(function(c){
      return "<button class='rk' id='tpl-"+c+"' data-code='"+c+"'>"+
        avatarHtml("srv:"+c,c)+
        "<div class='nm'><b>"+c+"</b><small id='tpls-"+c+"'>調査中…</small></div>"+
        "<div class='pt'><span class='badge b-info'>入る</span></div></button>";
    }).join("")+"</div>"+
    "<button class='btn ghost block mt' id='tplRefresh'>🔄 更新</button></div>";
  html+="<div class='card'><h2>🔑 ルームに参加</h2>"+
    "<label class='f'>ルームコード（4〜5桁）</label><input type='text' id='rsCode' maxlength='5' placeholder='例：7K2M' autocapitalize='characters' value='"+esc(preCode)+"'>"+
    "<button class='btn pk block mt' id='rsJoin'>参加する</button></div>"+
    "<div class='rowbtns'><button class='btn ghost block' id='rsBack'>ホームへ</button></div>";
  app.innerHTML=html;
  function seg(id,key,cast){var el=$("#"+id,app);$$("button",el).forEach(function(b){
    b.onclick=function(){RSET[key]=cast?cast(b.getAttribute("data-v")):b.getAttribute("data-v");SCREENS.roomSetup();};});}
  seg("rsCount","count",Number);seg("rsDir","dir");seg("rsLv","lv");seg("rsLimit","limit",Number);
  $("#rsBack",app).onclick=function(){go("home");};
  $$("#tplList .rk",app).forEach(function(b){
    b.onclick=function(){templateEnter(b.getAttribute("data-code"));};
  });
  $("#tplRefresh",app).onclick=function(){probeTemplateRooms();};
  probeTemplateRooms();
  $("#rsCreate",app).onclick=function(){
    var btn=$("#rsCreate",app);btn.disabled=true;btn.textContent="接続中…";
    R2.settings={count:RSET.count,dir:RSET.dir,lv:RSET.lv,limit:RSET.limit};
    roomCreate().then(function(r){
      if(r.error){btn.disabled=false;btn.textContent="ルームを作成する";return toast(r.error);}
      go("roomLobby");
    });
  };
  $("#rsJoin",app).onclick=function(){
    var code=$("#rsCode",app).value.toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(!/^[A-Z0-9]{4,5}$/.test(code))return toast("4〜5桁のルームコードを入力してください");
    var btn=$("#rsJoin",app);btn.disabled=true;btn.textContent="接続中…";
    roomJoin(code,null).then(function(r){
      if(r.error){btn.disabled=false;btn.textContent="参加する";return toast(r.error);}
      go("roomLobby");
    });
  };
};

/* ---------- 画面: ロビー ---------- */
SCREENS.roomLobby=function(){
  var m=me();if(!m)return go("profiles");
  if(!R2.peer||!R2.code)return go("roomSetup");
  app.innerHTML="<div class='card'><h2>🏠 ロビー</h2><p class='sub'>読み込み中…</p></div>";
  if(R2.isHost)renderLobby();
};
function renderLobby(){
  if(route.name!=="roomLobby"||!R2.code)return;
  var isHost=R2.isHost;
  var set=R2.settings;
  var ps=R2.order.map(function(pid){return R2.players[pid];}).filter(function(p){return p&&!p.left;});
  var html="<div class='card pop center'><h2 style='justify-content:center'>🏠 ルーム <span style='color:var(--indigo)'>"+esc(R2.code)+"</span></h2>"+
    "<div class='sub'>このコードを友達に伝えてください</div>"+
    "<div style='font-size:40px;font-weight:800;letter-spacing:.18em;margin:10px 0'>"+esc(R2.code)+"</div></div>";
  html+="<div class='card'><h2>👥 参加プレイヤー <span class='badge b-info'>"+ps.length+"人</span></h2>"+
    ps.map(function(p){
      return "<div class='rk'>"+avatarHtml("p2p:"+p.name,p.name)+
        "<div class='nm'>"+esc(p.name)+(p.host?" <span class='badge b-gold'>👑 ホスト</span>":"")+(p.id===R2.myPid?" <span class='badge b-info'>あなた</span>":"")+"</div></div>";
    }).join("")+
    "<div class='sub' style='margin-top:6px'>"+(isHost?"":"ホストの開始を待っています…")+"</div>";
  if(isHost&&set){
    html+="<label class='f'>設定</label><div class='sub'>"+set.count+"問 ・ "+(set.dir==="mix"?"ミックス":dirName(set.dir))+" ・ "+(set.lv==="mix"?"全パート":LV_NAME[set.lv])+" ・ "+set.limit+"秒</div>"+
      "<div class='rowbtns mt'><button class='btn ghost' id='rlEdit'>設定を変える</button></div>";
    html+="<button class='btn pri block mt' id='rlStart'>対戦開始！</button>";
  }
  html+="</div><div class='rowbtns'><button class='btn danger sm' id='rlLeave'>退室する</button></div>";
  app.innerHTML=html;
  if(isHost){
    if($("#rlStart",app))$("#rlStart",app).onclick=function(){
      R2.settings={count:RSET.count,dir:RSET.dir,lv:RSET.lv,limit:RSET.limit};
      roomStartGame();
    };
    if($("#rlEdit",app))$("#rlEdit",app).onclick=function(){go("roomSetup");};
  }
  $("#rlLeave",app).onclick=function(){
    roomTeardown();go("home");
  };
}

/* ---------- 画面: 対戦 ---------- */
SCREENS.roomBattle=function(){
  var m=me();if(!m)return go("profiles");
  if(!R2.peer)return go("roomSetup");
  if(R2.phase==="lobby"){go("roomLobby");return;}
  if(R2.view)renderRoomView();
  else app.innerHTML="<div class='card'><h2>⚔️ ルーム対戦</h2><p class='sub'>ホストの開始を待っています…</p></div>";
};
function renderRoomView(){
  if(R2.view.type==="q")renderRoomQuestion();
  else renderRoomReveal();
}
function renderRoomQuestion(){
  var v=R2.view;
  var html="<div class='card pop'><div class='qcount'>第 "+(v.qi+1)+" / "+v.total+" 問 ・ 全員で同時回答！</div>"+
    "<div class='qdir'>"+dirName(v.q.dir)+"</div><div class='qword'>"+esc(v.q.text)+"</div>"+
    "<div class='timer'><i id='tbar' style='width:100%'></i></div><div class='tnum' id='tnum'></div>"+
    "<div class='choices' id='rch'>";
  v.q.options.forEach(function(o,i){
    html+="<button class='choice' data-i='"+i+"' "+(R2.answered?"disabled style='opacity:.5'":"")+">"+String.fromCharCode(65+i)+". "+esc(o)+"</button>";
  });
  html+="</div><div class='sub center mt' id='waitTxt'></div></div>"+
    "<div class='card'><h2>🏆 現在のスコア</h2><div id='rscores'></div></div>";
  app.innerHTML=html;
  $$("#rch .choice",app).forEach(function(b){
    b.onclick=function(){roomAnswer(+b.getAttribute("data-i"));};
  });
  updateWaitBox(R2.cur||{answered:0,totalP:0,scores:R2.isHost?scoreSnapshot():[]});
  if(R2.tick)clearInterval(R2.tick);
  R2.tick=setInterval(function(){
    var bar=$("#tbar",app),num=$("#tnum",app);
    if(!bar||!R2.view||R2.view.type!=="q"){if(R2.tick){clearInterval(R2.tick);R2.tick=null;}return;}
    var remain=Math.max(0,v.remainMs-(Date.now()-v.recvAt));
    bar.style.width=(remain/v.remainMs*100)+"%";
    if(remain<3000)bar.className="hot";
    num.textContent=(remain/1000).toFixed(1)+" 秒";
  },100);
}
function updateWaitBox(wait){
  var el=$("#waitTxt",app);if(!el)return;
  var ans=wait&&wait.answered!=null?wait.answered:(R2.answered?1:0);
  var tot=wait&&wait.totalP!=null?wait.totalP:(R2.isHost?activePlayers().length:(R2.order?R2.order.length:0));
  if(R2.answered)el.innerHTML="⏳ 回答送信済み — 他のプレイヤーを待っています（"+ans+" / "+tot+"）";
  else el.innerHTML=ans>0?"他のプレイヤーが回答中…（"+ans+" / "+tot+"済み）":"";
  var sc=$("#rscores",app);
  if(sc){
    var list=wait&&wait.scores&&wait.scores.length?wait.scores:(R2.isHost?scoreSnapshot():[]);
    sc.innerHTML=list.map(function(p,i){
      return "<div class='rk'>"+avatarHtml("p2p:"+p.name,p.name)+
        "<div class='nm'>"+(i+1)+"位 "+esc(p.name)+(p.id===R2.myPid?" <span class='badge b-info'>あなた</span>":"")+(p.left?" <span class='badge b-mut'>切断</span>":"")+"</div>"+
        "<div class='pt'><b>"+p.points+"</b><small>pt</small></div></div>";
    }).join("")||"<div class='empty'>読み込み中…</div>";
  }
}
function renderRoomReveal(){
  var v=R2.view;
  var remainS=Math.max(0,Math.round((v.nextMs-(Date.now()-v.recvAt))/1000));
  var html="<div class='card pop'><div class='qcount'>第 "+(v.qi+1)+(v.total?" / "+v.total:"")+" 問 ・ 解答</div>";
  if(v.q){html+="<div class='qdir'>"+dirName(v.q.dir)+"</div><div class='qword' style='font-size:24px'>"+esc(v.q.text)+"</div>";}
  html+="<div class='center' style='font-size:17px;font-weight:800;margin-bottom:12px'>正解： <span style='color:var(--ok)'>"+esc(v.correctText||(v.q?v.q.options[v.correct]:""))+"</span></div>"+
    "<div>"+(v.results||[]).map(function(r){
      return "<div class='rk'>"+avatarHtml("p2p:"+r.name,r.name)+
        "<div class='nm'>"+esc(r.name)+(r.id===R2.myPid?" <span class='badge b-info'>あなた</span>":"")+
        "<small><span class='badge "+(r.nas?"b-mut":(r.ok?"b-ok":"b-ng"))+"'>"+(r.nas?"無回答":(r.ok?"正解":"誤答"))+(r.ok&&r.timeMs?" "+secf(r.timeMs):"")+" +"+r.point+"pt</span></small></div>"+
        "<div class='pt'><b>"+r.total+"</b><small>pt</small></div></div>";
    }).join("")+"</div>";
  if(R2.isHost&&v.canSkip){
    var last=v.total&&(v.qi+1)>=v.total;
    html+="<button class='btn pri block mt' id='skipBtn'>"+(last?"結果へすすむ ▶":"次の問題へ ▶")+"</button>";
  }else{
    html+="<div class='sub center mt'>次の問題へ… <b>"+remainS+"</b>秒</div>";
  }
  html+="</div>";
  app.innerHTML=html;
  var sb=$("#skipBtn",app);if(sb)sb.onclick=roomForceNext;
}
