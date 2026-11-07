/* ================= 対戦結果画面（ルーム対戦の成績表示） ================= */

SCREENS.battleResult=function(params){
  var m=me();if(!m)return go("profiles");
  var rec=null;
  (m.battles||[]).forEach(function(b){if(b.id===params.bid)rec=b;});
  if(!rec)return go("home");
  var res=rec.me.res;
  var html="<div class='card pop center'><div style='font-size:38px'>"+(res==="w"?"🏆":res==="d"?"🤝":"💪")+"</div>"+
    "<h2 style='justify-content:center'>"+(res==="w"?"勝利！お見事！":res==="d"?"引き分け！":"敗北…次は頑張ろう！")+"</h2>"+
    "<div class='sub'>"+dtf(rec.date)+" ・ ルーム "+esc(String(rec.roomId).replace("room-",""))+" ・ "+rec.questions.length+"問</div></div>";
  var sorted=rec.players.slice().sort(function(a,b){return a.rank-b.rank||b.points-a.points;});
  html+="<div class='card'><h2>🏅 最終結果</h2>";
  sorted.forEach(function(p){
    var cls=p.rank===1?"r1":p.rank===2?"r2":p.rank===3?"r3":"";
    html+="<div class='rk "+cls+"'>"+avatarHtml(p.pid||("srv:"+p.name),p.name)+
      "<div class='nm'>"+esc(p.name)+(p.pid===m.id?" <span class='badge b-info'>あなた</span>":"")+" <span class='badge b-mut'>"+p.rank+"位</span><small>正解 "+p.correct+" / "+rec.questions.length+" ・ 正答率 "+pctf(p.accuracy)+" ・ 平均 "+secf(p.avgTimeMs)+"</small></div>"+
      "<div class='pt'><b>"+p.points+"</b><small>pt</small></div></div>";
  });
  html+="</div><div class='card'><h2>📝 問題の振り返り</h2><div class='tscroll'><table class='tbl'><tr><th>単語</th><th>方向</th><th>あなたの回答</th><th>正解</th><th>正誤</th><th class='num'>時間</th><th class='num'>pt</th></tr>";
  rec.questions.forEach(function(qd){
    var w=WORD_BY[qd.wid]||{e:"?",j:"?"};
    html+="<tr><td><b>"+esc(qd.dir==="ej"?w.e:w.j)+"</b><small style='display:block;color:var(--sub)'>"+esc(qd.dir==="ej"?w.j:w.e)+"</small></td>"+
      "<td style='white-space:nowrap;font-size:11.5px'>"+dirName(qd.dir)+"</td><td style='font-size:12px'>"+esc(qd.ans)+"</td><td style='font-size:12px'>"+esc(qd.correctText)+"</td>"+
      "<td class='c'><span class='badge "+(qd.ok?"b-ok":"b-ng")+"'>"+(qd.ok?"○":"✗")+"</span></td>"+
      "<td class='num'>"+secf(qd.timeMs)+"</td><td class='num'>"+qd.point+"</td></tr>";
  });
  html+="</table></div></div>"+
    "<div class='rowbtns'><button class='btn pri' id='again' style='flex:1'>🌐 新しいルームを作る</button><button class='btn ghost' id='home' style='flex:1'>ホームへ</button></div>";
  app.innerHTML=html;
  $("#again",app).onclick=function(){go("roomSetup");};
  $("#home",app).onclick=function(){go("home");};
};
