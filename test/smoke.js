/* ===== クライアントスモークテスト（アカウント・集計・P2Pルームフロー） ===== */
var failures=0;
function ok(cond,msg){if(cond)console.log("  ✔ "+msg);else{failures++;console.log("  ✘ FAIL: "+msg);}}
function section(t){console.log("◆ "+t);}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function balance(name,html){
  var tags=["div","span","button","table","tr","td","th","select","textarea","svg","label","h2","h3","small","b","i","p"];
  var bad=[];
  tags.forEach(function(t){
    var open=(html.match(new RegExp("<"+t+"(\\s|>)","g"))||[]).length;
    var close=(html.match(new RegExp("</"+t+">","g"))||[]).length;
    if(open!==close)bad.push(t+":"+open+"/"+close);
  });
  ok(bad.length===0,bad.length?("タグ整合 "+name+" → "+bad.join(", ")):"タグ整合 "+name);
}

(async function(){
try{
  R2.WD_MS=60000; /* モックはhbを返さないため監視は専用セクションで検証 */
  R2.DROP_MS=10000;
  section("アカウント（端末内・1端末1アカウント・7日ルール）");
  var r1=registerAccount("テスト太郎");
  ok(!r1.error&&r1.profile,"ユーザー名で登録");
  ok(!!registerAccount("別の人").error,"1端末2つ目の登録は拒否");
  ok(!!registerAccount("テスト太郎").error,"名前重複は拒否");
  ok(!!registerAccount("あ").error,"1文字名は拒否");
  SESSION={pid:r1.profile.id};saveSession();
  var m1=me();
  ok(m1&&m1.name==="テスト太郎","セッション復元");
  ok(!!tryRename(m1,"新しい名前").error,"7日以内の名前変更は拒否");
  ok(!tryRename(m1,"テスト太郎").error,"同一名は変更なしとしてOK");

  section("戦績集計");
  m1.battles.push({id:"b1",roomId:"p2p-TEST",date:new Date().toISOString(),mode:"room",
    players:[{pid:m1.id,name:"テスト太郎",points:30,rank:1,correct:2,wrong:1,accuracy:2/3,avgTimeMs:2000},
             {pid:"p2p:花子",name:"花子",points:20,rank:2,correct:1,wrong:2,accuracy:1/3,avgTimeMs:3000}],
    me:{points:30,rank:1,res:"w",correct:2,wrong:1,accuracy:2/3,avgTimeMs:2000,count:3},
    questions:[{wid:"w001",dir:"ej",ok:true,timeMs:1200,point:12,ans:"a",correctText:"c",all:[]},
               {wid:"w002",dir:"je",ok:true,timeMs:2000,point:12,ans:"a",correctText:"c",all:[]},
               {wid:"w003",dir:"ej",ok:false,timeMs:3000,point:0,ans:"a",correctText:"c",all:[]}]});
  var bs=battleStats(m1);
  ok(bs.total===1&&bs.w===1,"基本戦績 1戦1勝");
  ok(bs.points===30,"累計ポイント");

  section("P2P ホストフロー（モックゲストが参加・回答）");
  FakePeer.reset();
  R2.settings={count:2,dir:"mix",lv:"mix",limit:3};
  R2.REVEAL_MS=60;
  var hc=await roomCreate();
  ok(hc.ok&&/^[A-Z0-9]{4}$/.test(hc.code),"ルーム作成 code="+hc.code);
  var hostPeer=R2.peer;
  var hostData=[];
  /* モックゲスト接続（ホストからの送信はゲスト側endに届く） */
  var gConn=new FakeConn("g"),hConn=new FakeConn("h");
  gConn.link(hConn);
  gConn.on("data",function(msg){hostData.push(msg);});
  hostPeer._emit("connection",hConn);
  gConn.open=true;hConn.open=true;
  gConn._emit("open");hConn._emit("open");
  hConn._emit("data",{t:"hello",name:"花子",color:"#f00"});
  await sleep(30);
  ok(R2.order.length===2,"ゲストが参加（2人）");
  ok(hostData.some(function(x){return x.t==="welcome";})&&hostData.some(function(x){return x.t==="lobby";;}),"welcome+lobby送信");
  roomStartGame();
  ok(R2.qs.length===2&&R2.phase==="question","開始→第1問");
  await sleep(30);
  ok(hostData.some(function(x){return x.t==="start";}),"?start送信");
  ok(hostData.filter(function(x){return x.t==="q";}).length===1,"問題送信（正解を含まない）");
  ok(!("correct" in hostData.filter(function(x){return x.t==="q";})[0].q),"問題に正解indexなし");
  await sleep(30);
  ok(route.name==="roomBattle"&&R2.view.type==="q","ホスト画面が問題表示");
  /* ホストが回答 → 全員回答ではない(ゲスト未回答)のでrevealはまだ */
  roomAnswer(0);
  ok(R2.answered,"ホスト回答受付");
  await sleep(30);
  ok(R2.phase==="question","ゲスト未回答の間は継続");
  /* ゲストが回答 → 全員回答で早期reveal */
  hConn._emit("data",{t:"answer",qi:0,choice:1});
  await sleep(600);
  ok(hostData.filter(function(x){return x.t==="reveal";}).length===1,"全員回答でreveal送信");
  ok(R2.phase==="question"&&R2.qi===1,"第2問へ");
  roomAnswer(1);
  await sleep(30);
  hConn._emit("data",{t:"answer",qi:1,choice:2});
  await sleep(900);
  ok(R2.phase==="end"&&!!R2.lastEnd,"対戦終了（end保持・ホストは再join待機）");
  ok(me().battles.length===2,"ホストの対戦記録保存");
  ok(Object.keys(me().wordStats).length===2,"単語別統計が更新（今回の2問分）: "+Object.keys(me().wordStats).length+"語");
  ok(route.name==="battleResult","結果画面へ遷移");
  balance("battleResult",app.innerHTML);

  section("P2P ゲストフロー（モックホストが進行）");
  FakePeer.reset();
  var fakeHost=new FakePeer("wbtl-v3-T3S9");
  var guestGotConn=null;
  fakeHost.on("connection",function(c){guestGotConn=c;});
  var jr=await roomJoin("T3S9");
  ok(jr.ok,"ゲスト: 接続開始");
  await sleep(80);
  ok(!!guestGotConn&&R2.hostConn,"ゲスト側接続確立");
  var H=guestGotConn;
  function hostSays(msg){H.send(msg);}
  hostSays({t:"welcome",pid:"g1",code:"T3S9",settings:{count:2,dir:"mix",lv:"mix",limit:10},players:[{id:"h",name:"ホスト",color:"#123",host:true},{id:"g1",name:"テスト太郎",color:"#456",host:false}]});
  await sleep(30);
  ok(R2.myPid==="g1"&&route.name==="roomLobby","welcome→ロビー表示");
  balance("roomLobby",app.innerHTML);
  hostSays({t:"start",settings:{count:2,dir:"mix",lv:"mix",limit:10},total:2,players:[]});
  await sleep(30);
  hostSays({t:"q",qi:0,total:2,q:{dir:"ej",text:"vital",options:["重要な","退屈な","小さい","速い"]},remainMs:10000});
  await sleep(30);
  ok(route.name==="roomBattle"&&R2.view.type==="q","ゲスト画面が問題表示");
  balance("roomQuestion",app.innerHTML);
  var sent=null;
  R2.hostConn.send=function(m){sent=m;};
  roomAnswer(0);
  ok(sent&&sent.t==="answer"&&sent.qi===0&&sent.choice===0,"回答がホストへ送信");
  ok(sent.ok===undefined,"回答に正誤は含まれない");
  hostSays({t:"reveal",qi:0,correct:0,results:[{id:"h",name:"ホスト",ok:true,timeMs:800,point:14,total:14},{id:"g1",name:"テスト太郎",ok:true,timeMs:900,point:14,total:14}]});
  await sleep(30);
  ok(R2.view.type==="reveal","解答表示");
  balance("roomReveal",app.innerHTML);
  hostSays({t:"q",qi:1,total:2,q:{dir:"je",text:"重要な",options:["vital","tiny","slow","trivial"]},remainMs:10000});
  await sleep(30);
  hostSays({t:"reveal",qi:1,correct:0,results:[{id:"h",name:"ホスト",ok:false,timeMs:null,point:0,total:14},{id:"g1",name:"テスト太郎",ok:true,timeMs:1200,point:13,total:27}]});
  await sleep(30);
  var beforeBattles=me().battles.length;
  hostSays({t:"end",code:"T3S9",date:new Date().toISOString(),total:2,settings:{limit:10},
    players:[{id:"h",name:"ホスト",color:"#123",points:14,rank:2,correct:0,wrong:2,accuracy:0,avgTimeMs:10000},
             {id:"g1",name:"テスト太郎",color:"#456",points:27,rank:1,correct:2,wrong:0,accuracy:1,avgTimeMs:1050}],
    questions:[
      {wid:"w001",dir:"ej",text:"vital",options:["重要な","退屈な","小さい","速い"],correct:0,
       answers:{h:{choice:1,ok:false,timeMs:800,point:0,ans:"退屈な"},g1:{choice:0,ok:true,timeMs:900,point:14,ans:"重要な"}}},
      {wid:"w001",dir:"je",text:"重要な",options:["vital","tiny","slow","trivial"],correct:0,
       answers:{h:{choice:-1,ok:false,timeMs:10000,point:0,ans:"（未回答）"},g1:{choice:0,ok:true,timeMs:1200,point:13,ans:"vital"}}}]});
  await sleep(100);
  ok(me().battles.length===beforeBattles+1,"ゲストの対戦記録保存");
  var rec=me().battles[me().battles.length-1];
  ok(rec.me.rank===1&&rec.me.res==="w"&&rec.me.points===27,"自分の成績が正しく紐づく");
  ok(rec.questions[0].correctText==="重要な","問題データ保存");
  ok(R2.peer===null&&R2.phase==="idle","終了後に接続解放");
  ok(route.name==="battleResult","結果画面へ");

  section("全画面生成");
  go("home");balance("home",app.innerHTML);
  go("roomSetup");balance("roomSetup",app.innerHTML);
  go("history");balance("history",app.innerHTML);
  go("account");balance("account",app.innerHTML);
  ["overview","graphs","words","compare"].forEach(function(t){STAB=t;SCREENS.stats();balance("stats:"+t,app.innerHTML);});
  SCREENS.stats();
  ok(!!$("#stBack",app),"戦績画面にホームへ戻るボタン");
  confirmModal("t","m","ok",function(){});balance("modal:confirm",document.querySelector(".modal .sheet").innerHTML);closeModal();
  ok(typeof SCREENS.battleSetup==="undefined","CPU対戦は廃止済み");
  ok(typeof SCREENS.data==="undefined","データ管理画面は廃止済み");

  section("ゲスト参加");
  var gcount=Object.keys(DB.profiles).length;
  var gp=newGuest();
  ok(gp.guest===true&&/^ゲスト/.test(gp.name),"ゲストプロフィール生成: "+gp.name);
  SESSION={pid:gp.id};saveSession();
  ok(me()&&me().guest,"ゲストセッションで利用中");
  go("home");balance("home(guest)",app.innerHTML);
  ok(app.innerHTML.indexOf("ゲスト</span>")>0,"ホームにゲストバッジ");
  // boot掃除: 別ゲストが消えること
  var gp2=newGuest();
  boot();
  ok(!DB.profiles[gp2.id],"前セッションのゲストはbootで掃除");
  ok(!!DB.profiles[gp.id],"現セッションのゲストは維持");

  section("再接続: ホスト側resume・終了後のend再送");
  FakePeer.reset();
  R2.settings={count:1,dir:"mix",lv:"mix",limit:3};
  R2.REVEAL_MS=50;
  R2.DROP_MS=150;
  var hc2=await roomCreate();
  ok(hc2.ok,"ルーム作成");
  var g2=new FakeConn("g2"),h2=new FakeConn("h2");
  g2.link(h2);g2.open=true;h2.open=true;
  R2.peer._emit("connection",h2);
  await sleep(20);
  h2._emit("data",{t:"hello",name:"花子",color:"#f00"});
  await sleep(20);
  var gpid=R2.order.find(function(x){return x!=="h";});
  ok(!!gpid,"ゲスト参加");
  roomStartGame();
  await sleep(20);
  ok(R2.phase==="question","出題中");
  // ゲスト切断（途中退出）→ 10秒（テストでは短縮）猶予
  h2.close();
  await sleep(30);
  ok(R2.players[gpid].left===false,"切断直後は猶予中（leftにならない）");
  await sleep(R2.DROP_MS+120);
  ok(R2.players[gpid].left===true,"猶予経過でleft扱い（無回答）");
  // 再接続（rejoin hello）
  var g3=new FakeConn("g3"),h3=new FakeConn("h3");
  g3.link(h3);g3.open=true;h3.open=true;
  R2.peer._emit("connection",h3);
  await sleep(20);
  var resumeMsg=null;
  g3.on("data",function(m){if(m.t==="resume")resumeMsg=m;});
  h3._emit("data",{t:"hello",name:"花子",rejoin:true,prevPid:gpid});
  await sleep(20);
  ok(R2.players[gpid].left===false,"再参加で復帰");
  ok(!!resumeMsg&&resumeMsg.phase==="q","resume(q)を送信");
  ok(resumeMsg.remainMs>0&&resumeMsg.meAnswered===false,"残り時間つきresume");
  // 終了まで進める
  roomAnswer(0);
  await sleep(20);
  h3._emit("data",{t:"answer",qi:0,choice:1});
  await sleep(1200);
  ok(R2.phase==="end","対戦終了（end保持）");
  // 終了後にrejoin → endを再送
  var g4=new FakeConn("g4"),h4=new FakeConn("h4");
  g4.link(h4);g4.open=true;h4.open=true;
  R2.peer._emit("connection",h4);
  await sleep(20);
  var endMsg=null;
  g4.on("data",function(m){if(m.t==="end")endMsg=m;});
  h4._emit("data",{t:"hello",name:"花子",rejoin:true,prevPid:gpid});
  await sleep(20);
  ok(!!endMsg,"終了後のrejoinにendを再送");
  ok(typeof endRecordId(endMsg)==="string","記録IDが決定的（重複保存防止）");
  roomTeardown();

  section("シグナルバー（通信状況・ヘッダー左上）");
  renderHeader();
  ok(topbar.innerHTML.indexOf("class='sig' id='netChip'")>=0,"ヘッダーにシグナルバー表示");
  ok(topbar.innerHTML.indexOf("class='sig' id='netChip'")<topbar.innerHTML.indexOf("class='ttl'"),"ヘッダー左上（タイトルの左）");
  ok(topbar.innerHTML.indexOf("netchip")<0,"旧テキストチップは廃止");
  var netFake=new FakeEl("span");
  var __oqs=document.querySelector;
  document.querySelector=function(s){return s==="#netChip"?netFake:__oqs.call(document,s);};
  setNet("ok");
  ok((netFake.innerHTML.match(/class='on'/g)||[]).length===4&&netFake.title==="P2P接続","P2P接続=4本点灯");
  setNet("r");
  ok((netFake.innerHTML.match(/class='on'/g)||[]).length===2&&netFake.className==="sig r","再接続中=2本点滅");
  setNet("off");
  ok((netFake.innerHTML.match(/class='on'/g)||[]).length===0,"切断=消灯");
  setNet("c");
  ok(netFake.className==="sig c","接続中アニメ");
  setNet(null);
  ok(netFake.style.display==="none","非表示指定で消える");
  document.querySelector=__oqs;

  section("ホストのスキップボタン（全員回答で即次へ）");
  FakePeer.reset();
  R2.settings={count:2,dir:"mix",lv:"mix",limit:1};
  R2.REVEAL_MS=5000; /* スキップ検証中はrevealを自動進行させない */
  var hcS=await roomCreate();
  ok(hcS.ok,"ルーム作成");
  var hDataS=[];
  var gS=new FakeConn("gS"),hS=new FakeConn("hS");
  gS.link(hS);
  gS.on("data",function(m){hDataS.push(m);});
  R2.peer._emit("connection",hS);
  gS.open=true;hS.open=true;gS._emit("open");hS._emit("open");
  await sleep(20);
  hS._emit("data",{t:"hello",name:"次郎",color:"#0f0"});
  await sleep(30);
  ok(R2.order.length===2,"ゲスト参加");
  roomStartGame();
  await sleep(30);
  ok(R2.phase==="question"&&R2.qi===0,"第1問開始");
  roomAnswer(0);
  hS._emit("data",{t:"answer",qi:0,choice:1});
  await sleep(600); /* 早期reveal(350ms)+余裕 */
  ok(R2.phase==="reveal"&&R2.view.canSkip===true,"全員回答→reveal");
  ok(app.innerHTML.indexOf("id='skipBtn'")>=0&&app.innerHTML.indexOf("次の問題へ ▶")>=0,"ホストにスキップボタン表示");
  ok(app.innerHTML.indexOf("id='skipBtn'")<0||hDataS.some(function(x){return x.t==="reveal";}),"ゲストにもreveal送信済み");
  var qn0=hDataS.filter(function(x){return x.t==="q";}).length;
  roomForceNext();
  await sleep(30);
  ok(R2.phase==="question"&&R2.qi===1,"スキップで即次問へ");
  ok(hDataS.filter(function(x){return x.t==="q";}).length===qn0+1,"ゲストへ次の問題を即送信");
  roomAnswer(1);
  hS._emit("data",{t:"answer",qi:1,choice:2});
  await sleep(600);
  ok(R2.phase==="reveal"&&app.innerHTML.indexOf("結果へすすむ ▶")>=0,"最終問は「結果へすすむ」表示");
  roomForceNext();
  await sleep(30);
  ok(R2.phase==="end","スキップで即結果へ");
  ok(hDataS.some(function(x){return x.t==="end";}),"ゲストにもend送信");
  roomForceNext();
  ok(R2.phase==="end","終了後のスキップは無効");
  roomTeardown();

  /* タイムアウトreveal（未回答者がいる）ではボタンを出さない */
  FakePeer.reset();
  R2.settings={count:1,dir:"mix",lv:"mix",limit:1};
  R2.REVEAL_MS=3000; /* タイムアウトrevealの検証中は自動進行させない */
  var hcT=await roomCreate();
  ok(hcT.ok,"ルーム作成（タイムアウト検証）");
  var gT=new FakeConn("gT"),hT=new FakeConn("hT");
  gT.link(hT);
  R2.peer._emit("connection",hT);
  gT.open=true;hT.open=true;gT._emit("open");hT._emit("open");
  await sleep(20);
  hT._emit("data",{t:"hello",name:"三郎",color:"#00f"});
  await sleep(30);
  roomStartGame();
  await sleep(30);
  roomAnswer(0); /* ゲストは回答しない */
  await sleep(1700); /* limit1s+400ms → タイムアウトreveal */
  ok(R2.phase==="reveal"&&R2.view.canSkip===false,"未回答者あり→canSkip=false");
  ok(app.innerHTML.indexOf("id='skipBtn'")<0,"未回答者がいるとボタン非表示");
  roomForceNext();
  ok(R2.phase==="reveal"&&R2.qi===0,"タイムアウトrevealでは強制進行しない");
  await sleep(3300); /* REVEAL_MS経過で自動進行 */
  ok(R2.phase==="end","時間切れで自動的に結果へ");
  roomTeardown();

  section("切断の10秒ルール（無回答で次へ・戻ってきたら復帰）");
  FakePeer.reset();
  R2.DROP_MS=150;R2.WD_MS=60000;R2.REVEAL_MS=900;
  R2.settings={count:2,dir:"mix",lv:"mix",limit:1};
  var hcD=await roomCreate();
  ok(hcD.ok,"ルーム作成");
  var gA=new FakeConn("gA"),hA=new FakeConn("hA");
  gA.link(hA);R2.peer._emit("connection",hA);
  gA.open=true;hA.open=true;gA._emit("open");hA._emit("open");
  await sleep(20);
  hA._emit("data",{t:"hello",name:"A子",color:"#f00"});
  await sleep(20);
  var gB=new FakeConn("gB"),hB=new FakeConn("hB");
  gB.link(hB);R2.peer._emit("connection",hB);
  gB.open=true;hB.open=true;gB._emit("open");hB._emit("open");
  await sleep(20);
  hB._emit("data",{t:"hello",name:"B男",color:"#00f"});
  await sleep(20);
  var pidA=R2.order.find(function(x){return R2.players[x].name==="A子";});
  var pidB=R2.order.find(function(x){return R2.players[x].name==="B男";});
  ok(!!pidA&&!!pidB,"ゲスト2人参加");
  var hbKeep=setInterval(function(){hA._emit("data",{t:"hb"});},30); /* A子は通信維持 */
  roomStartGame();
  await sleep(30);
  ok(R2.phase==="question"&&R2.qi===0,"第1問");
  roomAnswer(0);
  hA._emit("data",{t:"answer",qi:0,choice:0});
  await sleep(20);
  ok(answeredCount()===2&&activePlayers().length===3,"2/3回答（B男が未回答）");
  var waitsA=[];
  gA.on("data",function(m){if(m.t==="wait")waitsA.push(m);});
  hB.close(); /* B男が途中切断 */
  await sleep(40);
  ok(R2.players[pidB].left===false,"切断直後は10秒猶予（leftにならない）");
  await sleep(R2.DROP_MS+150);
  ok(R2.players[pidB].left===true,"10秒経過でB男は無回答扱い");
  ok(waitsA.some(function(m){return m.totalP===2;}),"全員に待機状況を再送");
  await sleep(500);
  ok(R2.phase==="reveal"&&R2.qi===0,"残り全員が回答済み→即解答表示");
  var bRes=(R2.lastResults||[]).find(function(r){return r.id===pidB;});
  ok(!!bRes&&bRes.nas===true&&bRes.ok===false,"B男は「無回答」として記録");
  ok(app.innerHTML.indexOf("無回答")>=0,"解答表示に無回答バッジ");
  await sleep(1100); /* REVEAL_MS経過 → 第2問 */
  ok(R2.phase==="question"&&R2.qi===1,"第2問へ（戻ってこないB男を待たない）");
  roomAnswer(1);
  hA._emit("data",{t:"answer",qi:1,choice:1});
  await sleep(500);
  ok(R2.phase==="reveal"&&R2.qi===1,"B男を除く全員で即解答表示");
  var gC=new FakeConn("gC"),hC=new FakeConn("hC");
  gC.link(hC);gC.open=true;hC.open=true;
  R2.peer._emit("connection",hC);
  await sleep(20);
  var resumeMsg=null;
  gC.on("data",function(m){if(m.t==="resume")resumeMsg=m;});
  hC._emit("data",{t:"hello",name:"B男",rejoin:true,prevPid:pidB});
  await sleep(30);
  ok(R2.players[pidB].left===false,"B男が戻ったら復帰");
  ok(!!resumeMsg&&resumeMsg.phase==="reveal","復帰時にreveal状態を再送");
  clearInterval(hbKeep);
  roomTeardown();

  section("切断の10秒ルール（猶予内の復帰・監視によるleft）");
  FakePeer.reset();
  R2.DROP_MS=150;R2.WD_MS=60000;
  R2.settings={count:1,dir:"mix",lv:"mix",limit:3};
  var hcE=await roomCreate();
  ok(hcE.ok,"ルーム作成（猶予内復帰）");
  var gD=new FakeConn("gD"),hD=new FakeConn("hD");
  gD.link(hD);R2.peer._emit("connection",hD);
  gD.open=true;hD.open=true;gD._emit("open");hD._emit("open");
  await sleep(20);
  hD._emit("data",{t:"hello",name:"C枝",color:"#0ff"});
  await sleep(20);
  var pidC=R2.order.find(function(x){return x!=="h";});
  roomStartGame();
  await sleep(20);
  hD.close();
  await sleep(30);
  var gE=new FakeConn("gE"),hE=new FakeConn("hE");
  gE.link(hE);gE.open=true;hE.open=true;
  R2.peer._emit("connection",hE);
  await sleep(20);
  hE._emit("data",{t:"hello",name:"C枝",rejoin:true,prevPid:pidC});
  await sleep(30);
  ok(R2.players[pidC].left===false,"猶予中に復帰→leftにならない");
  await sleep(R2.DROP_MS+150);
  ok(R2.players[pidC].left===false,"復帰済みなので時間経過してもleftにならない");
  roomTeardown();

  FakePeer.reset();
  R2.DROP_MS=150;R2.WD_MS=60;
  R2.settings={count:1,dir:"mix",lv:"mix",limit:3};
  var hcF=await roomCreate();
  ok(hcF.ok,"ルーム作成（無通信監視）");
  var gF=new FakeConn("gF"),hF=new FakeConn("hF");
  gF.link(hF);R2.peer._emit("connection",hF);
  gF.open=true;hF.open=true;gF._emit("open");hF._emit("open");
  await sleep(20);
  hF._emit("data",{t:"hello",name:"D郎",color:"#ff0"});
  await sleep(20);
  var pidD=R2.order.find(function(x){return x!=="h";});
  roomStartGame();
  await sleep(20);
  var hbF=setInterval(function(){hF._emit("data",{t:"hb"});},30);
  await sleep(R2.DROP_MS+300);
  ok(R2.players[pidD].left===false,"通信が続いていればleftにしない");
  clearInterval(hbF);
  await sleep(R2.DROP_MS+300);
  ok(R2.players[pidD].left===true,"10秒無通信（テストでは短縮）で監視がleft扱いに");
  roomTeardown();

  section("ホスト交代（ゲーム中にホストが消滅）");
  FakePeer.reset();
  R2.DROP_MS=150;R2.WD_MS=60000;R2.REVEAL_MS=60;
  var wm0=WORDS[0],wm1=WORDS[5];
  var ms={count:2,dir:"ej",lv:"mix",limit:10};
  var mh=new FakePeer("wbtl-v3-M1G2");
  var mhc=null;
  mh.on("connection",function(c){mhc=c;});
  var jrM=await roomJoin("M1G2");
  ok(jrM.ok,"モックホストのルームに参加");
  await sleep(90);
  ok(!!mhc&&R2.hostConn,"接続確立");
  mhc.send({t:"welcome",pid:"gME",code:"M1G2",settings:ms,players:[
    {id:"hOld",name:"旧ホスト",color:"#111",host:true,left:false,points:0},
    {id:"gME",name:"自分",color:"#f00",host:false,left:false,points:0},
    {id:"gB",name:"仲間",color:"#00f",host:false,left:false,points:0}]});
  await sleep(20);
  mhc.send({t:"start",settings:ms,total:2,players:[]});
  await sleep(20);
  mhc.send({t:"q",qi:0,total:2,q:{dir:"ej",text:wm0.e,options:[wm0.j,"ダミーA","ダミーB"]},remainMs:10000});
  await sleep(20);
  ok(R2.phase==="question"&&R2.qi===0,"第1問を受信");
  mhc.send({t:"reveal",qi:0,correct:0,results:[
    {id:"hOld",name:"旧ホスト",ok:true,timeMs:900,point:13,total:13},
    {id:"gME",name:"自分",ok:true,timeMs:800,point:14,total:14},
    {id:"gB",name:"仲間",ok:false,timeMs:1200,point:0,total:0}]});
  await sleep(20);
  mhc.send({t:"q",qi:1,total:2,q:{dir:"ej",text:wm1.e,options:[wm1.j,"ダミーC","ダミーD"]},remainMs:10000});
  await sleep(20);
  ok(R2.phase==="question"&&R2.qi===1,"第2問が出題中にホストが消滅");
  mh.destroy();
  mhc.close();
  await sleep(3000);
  ok(R2.isHost===true,"自分が新しいホストに交代");
  ok(R2.code==="M1G2","ルームコードを維持");
  ok(R2.phase==="question"&&R2.qi===1&&R2.view&&R2.view.q&&R2.view.q.text===wm1.e,"同じ問題を再送して続きから再開");
  ok(R2.players.hOld&&R2.players.hOld.left===true,"消えた旧ホストはleft扱い");
  ok(R2.players.gME&&R2.players.gME.host===true,"自分のプレイヤーがホスト表示");
  ok(R2.players.gME.points===14&&R2.players.gB.points===0&&R2.players.hOld.points===13,"スコアを復元");
  ok(R2.qs.length===2&&R2.qs[0].text===wm0.e&&R2.qs[0].correct===0,"過去問を復元");
  ok(R2.players.gME.answers[0]&&R2.players.gME.answers[0].ok===true&&R2.players.gME.answers[0].point===14,"過去の全員の回答を復元");
  /* 仲間が新しいホストに再参加 */
  var gB2=new FakeConn("gB2"),hB2=new FakeConn("hB2");
  gB2.link(hB2);gB2.open=true;hB2.open=true;
  R2.peer._emit("connection",hB2);
  await sleep(20);
  var gB2msgs=[];
  gB2.on("data",function(m){gB2msgs.push(m);});
  hB2._emit("data",{t:"hello",name:"仲間",rejoin:true,prevPid:"gB"});
  await sleep(30);
  var resM=gB2msgs.filter(function(m){return m.t==="resume";})[0];
  ok(R2.players.gB.left===false,"仲間が復帰");
  ok(!!resM&&resM.phase==="q"&&resM.qi===1&&resM.meAnswered===false,"復帰時に現在の問題を再送");
  roomAnswer(0);
  hB2._emit("data",{t:"answer",qi:1,choice:0});
  await sleep(800);
  ok(R2.phase==="end","新ホスト主導で対戦終了まで進行");
  var endM=gB2msgs.filter(function(m){return m.t==="end";})[0];
  ok(!!endM&&endM.questions.length===2&&endM.players.length===3,"仲間にも最終結果を送信");
  var recM=me().battles[me().battles.length-1];
  ok(!!recM&&recM.me.count===2&&recM.players.length===3,"新ホストにも対戦記録が保存");
  roomTeardown();

  section("ホスト交代（ロビーでホストが消滅）");
  FakePeer.reset();
  R2.DROP_MS=150;R2.WD_MS=60000;R2.REVEAL_MS=60;
  var mh2=new FakePeer("wbtl-v3-R7TK");
  var mh2c=null;
  mh2.on("connection",function(c){mh2c=c;});
  var jrL=await roomJoin("R7TK");
  ok(jrL.ok,"ロビーのルームに参加");
  await sleep(90);
  var ls={count:5,dir:"ej",lv:"2",limit:10};
  mh2c.send({t:"welcome",pid:"gX",code:"R7TK",settings:ls,players:[
    {id:"hOld",name:"旧ホスト",color:"#111",host:true,left:false,points:0},
    {id:"gX",name:"自分",color:"#f00",host:false,left:false,points:0}]});
  await sleep(20);
  ok(route.name==="roomLobby"&&R2.phase==="lobby","ロビーで待機中");
  mh2.destroy();
  mh2c.close();
  await sleep(3000);
  ok(R2.isHost===true&&R2.phase==="lobby","ロビーのままホストを引き継ぎ");
  ok(route.name==="roomLobby","ロビー画面を表示");
  ok(R2.settings&&R2.settings.count===5,"設定を維持");
  var gN=new FakeConn("gN"),hN=new FakeConn("hN");
  gN.link(hN);gN.open=true;hN.open=true;
  R2.peer._emit("connection",hN);
  await sleep(20);
  var gNmsgs=[];
  gN.on("data",function(m){gNmsgs.push(m.t);});
  hN._emit("data",{t:"hello",name:"新入",color:"#0f0"});
  await sleep(30);
  ok(gNmsgs.indexOf("welcome")>=0&&gNmsgs.indexOf("lobby")>=0&&R2.order.length===3,"新しい参加者を受け入れ");
  roomStartGame();
  await sleep(30);
  ok(R2.phase==="question"&&R2.qi===0&&R2.qs.length===5,"新ホストが開始できる");
  roomTeardown();

  section("ホスト交代（他のメンバーが先に引き継いだ場合）");
  FakePeer.reset();
  R2.DROP_MS=150;R2.WD_MS=60000;
  var mh3=new FakePeer("wbtl-v3-Q9XZ");
  var mh3c=null;
  mh3.on("connection",function(c){mh3c=c;});
  var jrC=await roomJoin("Q9XZ");
  ok(jrC.ok,"ルームに参加");
  await sleep(90);
  var cs={count:5,dir:"mix",lv:"mix",limit:10};
  var wc=WORDS[2];
  mh3c.send({t:"welcome",pid:"gY",code:"Q9XZ",settings:cs,players:[
    {id:"hOld",name:"旧ホスト",color:"#111",host:true,left:false,points:0},
    {id:"gY",name:"自分",color:"#f00",host:false,left:false,points:0}]});
  mh3c.send({t:"start",settings:cs,total:2,players:[]});
  mh3c.send({t:"q",qi:0,total:2,q:{dir:"ej",text:wc.e,options:[wc.j,"x","y"]},remainMs:10000});
  await sleep(30);
  mh3.destroy();
  mh3c.close();
  for(var t0=0;t0<200&&!R2.migrating;t0++)await sleep(10);
  ok(R2.migrating===true,"ホスト消失を検知して引き継ぎを開始");
  var bConn=null,bHello=null;
  var blocker=new FakePeer("wbtl-v3-Q9XZ"); /* 先に誰かが引き継いだ状態 */
  blocker.on("connection",function(c){bConn=c;c.on("data",function(m){bHello=m;});});
  await sleep(2600);
  ok(R2.isHost===false,"自分はホストになっていない（負けた）");
  ok(!!R2.hostConn&&R2.hostConn.open===true,"新しいホストに参加し直している");
  ok(!!bHello&&bHello.t==="hello"&&bHello.rejoin===true&&bHello.prevPid==="gY","rejoin要求を送信");
  roomTeardown();

  section("再戦（同じメンバーでもう一度）");
  FakePeer.reset();
  R2.WD_MS=60000;R2.DROP_MS=10000;R2.REVEAL_MS=80;
  R2.settings={count:1,dir:"mix",lv:"mix",limit:3};
  var hcR=await roomCreate();
  ok(hcR.ok,"ルーム作成");
  var gR=new FakeConn("gR"),hR=new FakeConn("hR");
  gR.link(hR);
  var gRmsg=[];
  gR.on("data",function(m){gRmsg.push(m.t);});
  R2.peer._emit("connection",hR);
  gR.open=true;hR.open=true;gR._emit("open");hR._emit("open");
  await sleep(20);
  hR._emit("data",{t:"hello",name:"再戦子",color:"#f0f"});
  await sleep(20);
  var gpR=R2.order.find(function(x){return x!=="h";});
  roomStartGame();
  await sleep(20);
  roomAnswer(0);
  hR._emit("data",{t:"answer",qi:0,choice:1});
  await sleep(600);
  ok(R2.phase==="end","1回目終了");
  ok(app.innerHTML.indexOf("id='rematchBtn'")>=0,"結果画面に再戦ボタン（ホストのみ）");
  var b0=me().battles.length;
  var starts1=gRmsg.filter(function(t){return t==="start";}).length;
  hostRematch();
  await sleep(30);
  ok(R2.phase==="question"&&R2.qi===0,"再戦で即第1問");
  ok(R2.players[gpR].points===0&&R2.players.h.points===0,"スコアリセット");
  ok(R2.saveDone===false,"記録フラグリセット（再戦の結果も保存される）");
  ok(gRmsg.filter(function(t){return t==="start";}).length===starts1+1,"全員にstart再送");
  roomAnswer(1);
  hR._emit("data",{t:"answer",qi:0,choice:0});
  await sleep(700);
  ok(R2.phase==="end","再戦終了");
  ok(me().battles.length===b0+1,"再戦の記録も保存");
  ok(gRmsg.filter(function(t){return t==="end";}).length===2,"全員にend再送");
  var ends=gRmsg.filter(function(t){return t==="end";}).length;
  roomTeardown();

  section("公開ルーム（テンプレ部屋 HAFY1〜5）");
  ok(TPL_ROOMS.join()==="HAFY1,HAFY2,HAFY3,HAFY4,HAFY5","テンプレコード定義");
  SCREENS.roomSetup();
  ok([1,2,3,4,5].every(function(n){return app.innerHTML.indexOf("HAFY"+n)>=0;}),"セットアップ画面に5部屋表示");
  ok(app.innerHTML.indexOf("4〜5桁")>=0&&app.innerHTML.indexOf("maxlength='5'")>=0,"コード入力は4〜5桁");
  var er3=await roomJoin("ABC");
  ok(!!er3.error&&er3.error.indexOf("4〜5桁")>=0,"3桁はエラー");
  /* HAFY2 をホストが開店 → プローブで人数表示 */
  R2.settings={count:5,dir:"mix",lv:"mix",limit:10};
  var hcT=await roomCreateAt("HAFY2");
  ok(hcT.ok,"HAFY2を開店（固定コードでルーム作成）");
  ok(R2.code==="HAFY2","コードがHAFY2");
  var gT2=new FakeConn("gT2"),hT2=new FakeConn("hT2");
  gT2.link(hT2);gT2.open=true;hT2.open=true;
  R2.peer._emit("connection",hT2);
  await sleep(20);
  hT2._emit("data",{t:"hello",name:"客",color:"#00f"});
  await sleep(20);
  ok(R2.order.length===2,"客が入店");
  /* count プローブ応答 */
  var pC=new FakeConn("pC"),hC2=new FakeConn("hC2");
  pC.link(hC2);pC.open=true;hC2.open=true;
  R2.peer._emit("connection",hC2);
  await sleep(20);
  var cnt=null;
  pC.on("data",function(m){if(m.t==="count")cnt=m;});
  hC2._emit("data",{t:"count"});
  await sleep(20);
  ok(!!cnt&&cnt.n===2&&cnt.phase==="lobby","人数調査に2人・待機中で応答");
  /* プローブ一括調査: HAFY2=1人表示, 他は空き */
  FakePeer.reset(); /* HAFY2ホストをregistryから消すと接続切れるので別の方法で */
  roomTeardown();
  FakePeer.reset();
  var hcT2=await roomCreateAt("HAFY2");
  ok(hcT2.ok,"HAFY2を再開店");
  probeTemplateRooms();
  await sleep(300);
  ok(__tplStatus.HAFY2==="1人（待機中）","プローブ: HAFY2=1人（待機中）: "+__tplStatus.HAFY2);
  ok(__tplStatus.HAFY1==="空き"&&__tplStatus.HAFY3==="空き","プローブ: 空室は「空き」");
  /* 既存ホストがあるコードは taken → 参加に切り替わる */
  var taken=null;
  R2.settings=null;
  var mhT=new FakePeer("wbtl-v3-HAFY4"); /* 他人がHAFY4を先に開店 */
  var tEnterDone=false;
  var hcT4=await roomCreateAt("HAFY4");
  ok(hcT4.taken===true,"既存ルームあり→taken");
  roomTeardown();

  section("チャット（定型文・自由入力）");
  ok(CHAT_TAUNTS.indexOf("こんなの簡単だよ～")>=0&&CHAT_TAUNTS.indexOf("うお(笑)")>=0&&CHAT_TAUNTS.indexOf("どいつもこいつもバカにしやがって💢💢")>=0,"煽り定型文を用意（新テンプレ3種含む）");
  ok(CHAT_NICE.indexOf("よろしく！")>=0,"あいさつ定型文を用意");
  FakePeer.reset();
  R2.WD_MS=60000;R2.DROP_MS=10000;R2.REVEAL_MS=80;
  R2.settings={count:1,dir:"mix",lv:"mix",limit:3};
  var hcCh=await roomCreate();
  ok(hcCh.ok,"ルーム作成");
  var gC1=new FakeConn("gC1"),hC1=new FakeConn("hC1");
  gC1.link(hC1);R2.peer._emit("connection",hC1);
  gC1.open=true;hC1.open=true;gC1._emit("open");hC1._emit("open");
  await sleep(20);
  hC1._emit("data",{t:"hello",name:"猫",color:"#f00"});
  var gC2=new FakeConn("gC2"),hC2=new FakeConn("hC2");
  gC2.link(hC2);R2.peer._emit("connection",hC2);
  gC2.open=true;hC2.open=true;gC2._emit("open");hC2._emit("open");
  await sleep(20);
  hC2._emit("data",{t:"hello",name:"犬",color:"#00f"});
  await sleep(20);
  var c1msgs=[],c2msgs=[];
  gC1.on("data",function(m){if(m.t==="chat")c1msgs.push(m);});
  gC2.on("data",function(m){if(m.t==="chat")c2msgs.push(m);});
  sendChat("よろしく！");
  await sleep(20);
  ok(R2.chat.length===1&&R2.chat[0].text==="よろしく！","ホストの発言を記録");
  ok(c1msgs.length===1&&c2msgs.length===1,"全員に配信");
  hC1._emit("data",{t:"chat",text:"余裕ww"});
  await sleep(20);
  ok(R2.chat.length===2&&R2.chat[1].name==="猫","ゲストの発言をプレイヤー名付きで記録");
  ok(c2msgs.length===2&&c2msgs[1].pid&&c2msgs[1].text==="余裕ww","他ゲストにも中継");
  hC1._emit("data",{t:"chat",text:"   "});
  await sleep(20);
  ok(R2.chat.length===2,"空発言は無視");
  await sleep(850); /* 連投制限（0.8秒）が解けるまで待つ */
  hC1._emit("data",{t:"chat",text:new Array(100).join("x")});
  await sleep(20);
  ok(R2.chat.length===3&&R2.chat[2].text.length===80,"長文は80字に切断して受理");
  /* ゲスト側の受信処理（モックホスト → 自分がゲスト） */
  roomTeardown();
  FakePeer.reset();
  var mhC=new FakePeer("wbtl-v3-CHT1"),mhCc=null;
  mhC.on("connection",function(c){mhCc=c;});
  await roomJoin("CHT1");
  await sleep(90);
  mhCc.send({t:"welcome",pid:"gZ",code:"CHT1",settings:{count:5,dir:"mix",lv:"mix",limit:10},players:[
    {id:"hOld",name:"旧ホスト",color:"#111",host:true,left:false,points:0},
    {id:"gZ",name:"自分",color:"#f00",host:false,left:false,points:0}]});
  await sleep(20);
  mhCc.send({t:"chat",id:1,pid:"hOld",name:"旧ホスト",text:"準備はいい?"});
  await sleep(20);
  ok(R2.chat.length===1&&R2.chat[0].text==="準備はいい?"&&R2.chat[0].mine===false,"ゲストが他プレイヤーの発言を受信");
  ok(R2.chatUnread===1,"未読バッジが増える");
  mhCc.send({t:"chat",id:2,pid:"gZ",name:"自分",text:"自分の発言のエコー"});
  await sleep(20);
  ok(R2.chat.length===1,"自分の発言エコーは無視（重複しない）");
  /* パネルUI */
  openChatPanel();
  var bodyKids=document.body.children;
  var panel=bodyKids[bodyKids.length-1];
  ok(panel.innerHTML.indexOf("うお(笑)")>=0&&panel.innerHTML.indexOf("煽り")>=0,"定型文チップを表示");
  ok(panel.innerHTML.indexOf("自由入力")>=0&&panel.innerHTML.indexOf("maxlength='80'")>=0,"自由入力欄");
  closeChatPanel();
  ok(R2.chatUnread===0,"開いたら未読リセット");
  roomTeardown();
  ok(R2.chat.length===0,"ルーム終了でチャット消去");

  console.log(failures===0?"===== CLIENT SMOKE OK =====":"===== "+failures+" FAILURES =====");
  process.exit(failures===0?0:1);
}catch(e){
  console.log("✘ EXCEPTION: "+(e&&e.stack||e));
  process.exit(1);
}
})();
