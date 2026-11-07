/* ================= 戦績・統計（仕様12）・対戦履歴 ================= */
var STAB="overview";
var SVIEW={mode:"all",q:"",sort:"asked"};
SCREENS.stats=function(){
  var m=me();if(!m)return go("profiles");
  var tabs=[["overview","📊 概要"],["graphs","📈 グラフ"],["words","🔤 単語別"],["compare","🆚 比較"]];
  var html="<div class='tabs'>"+tabs.map(function(t){return "<button data-t='"+t[0]+"' class='"+(STAB===t[0]?"on":"")+"'>"+t[1]+"</button>";}).join("")+"</div>";
  app.innerHTML=html;
  $$("[data-t]",app).forEach(function(b){b.onclick=function(){STAB=b.getAttribute("data-t");SCREENS.stats();};});
  var holder=document.createElement("div");app.appendChild(holder);
  if(STAB==="overview")statsOverview(m,holder);
  else if(STAB==="graphs")statsGraphs(m,holder);
  else if(STAB==="words")statsWords(m,holder);
  else statsCompare(m,holder);
  var back=document.createElement("div");back.className="rowbtns mt";
  back.innerHTML="<button class='btn ghost block' id='stBack'>🏠 ホームへ戻る</button>";
  app.appendChild(back);
  $("#stBack",app).onclick=function(){go("home");};
};

function statsOverview(m,el){
  var st=battleStats(m);
  var bs=(m.battles||[]).slice().sort(function(a,b){return a.date<b.date?1:-1;});
  var html="<div class='card'><h2>📊 基本戦績</h2><div class='grid3'>"+
    "<div class='stat hi'><div class='v'>"+st.total+"<small> 回</small></div><div class='k'>総対戦回数</div></div>"+
    "<div class='stat'><div class='v' style='color:var(--ok)'>"+st.w+"<small> 勝</small></div><div class='k'>勝利</div></div>"+
    "<div class='stat'><div class='v' style='color:var(--ng)'>"+st.l+"<small> 負</small></div><div class='k'>敗北</div></div>"+
    "<div class='stat'><div class='v'>"+st.d+"<small> 分</small></div><div class='k'>引き分け</div></div>"+
    "<div class='stat hi'><div class='v'>"+pctf(st.winRate)+"</div><div class='k'>勝率</div></div>"+
    "<div class='stat hi'><div class='v'>"+st.points+"<small> pt</small></div><div class='k'>累計獲得ポイント</div></div>"+
    "<div class='stat'><div class='v'>"+pctf(st.avgAcc)+"</div><div class='k'>平均正答率</div></div>"+
    "<div class='stat'><div class='v'>"+secf(st.avgTime)+"</div><div class='k'>平均回答時間</div></div>"+
    "<div class='stat'><div class='v'>"+st.streakBest+"<small> 連勝</small></div><div class='k'>連勝記録（最高）</div></div>"+
    "<div class='stat'><div class='v'>🔥 "+st.streakCur+"<small> 連勝</small></div><div class='k'>現在の連勝数</div></div>"+
    "</div></div>";
  html+="<div class='card'><h2>🕘 直近の対戦</h2>";
  if(!bs.length)html+="<div class='empty'><span class='big'>⚔️</span>まだ対戦記録がありません</div>";
  else bs.slice(0,5).forEach(function(b){html+=historyItemHtml(b);});
  html+="</div>";
  el.innerHTML=html;
  wireHistoryItems(el);
}

/* ---------- グラフ（SVG自前実装） ---------- */
function chartLine(vals,labels,opts){
  opts=opts||{};var W=360,H=160,padL=40,padR=12,padT=14,padB=24;
  var n=vals.length;
  var max=opts.max!=null?opts.max:Math.max.apply(null,vals.concat([0]));
  var min=opts.min!=null?opts.min:0;
  if(max===min)max=min+1;
  var iw=W-padL-padR,ih=H-padT-padB;
  function X(i){return padL+(n<=1?iw/2:iw*i/Math.max(1,n-1));}
  function Y(v){return padT+ih*(1-(v-min)/(max-min));}
  var col=opts.color||"#6366f1";
  var s="<svg viewBox='0 0 "+W+" "+H+"' xmlns='http://www.w3.org/2000/svg'>";
  for(var g=0;g<=3;g++){var gy=padT+ih*g/3;var gv=max-(max-min)*g/3;
    s+="<line class='gline' x1='"+padL+"' y1='"+gy+"' x2='"+(W-padR)+"' y2='"+gy+"'/>";
    s+="<text class='axis' x='"+(padL-5)+"' y='"+(gy+3.5)+"' text-anchor='end'>"+Math.round(gv)+"</text>";}
  if(n>1)s+="<polyline class='poly' points='"+vals.map(function(v,i){return X(i)+","+Y(v);}).join(" ")+"' stroke='"+col+"'/>";
  vals.forEach(function(v,i){s+="<circle class='dot' cx='"+X(i)+"' cy='"+Y(v)+"' r='3.2' fill='"+col+"'/>";});
  var step=Math.max(1,Math.ceil(n/6));
  labels.forEach(function(l,i){if(i%step===0||i===n-1)s+="<text class='axis' x='"+X(i)+"' y='"+(H-7)+"' text-anchor='middle'>"+esc(l)+"</text>";});
  s+="</svg>";return s;
}
function chartBars(labels,vals,opts){
  opts=opts||{};var W=360,H=160,padL=40,padR=12,padT=14,padB=24;
  var n=vals.length;
  var max=Math.max.apply(null,vals.concat([1,opts.max||0]));
  var iw=W-padL-padR,ih=H-padT-padB;
  var bw=iw/n;
  var col=opts.color||"#ec4899";
  var s="<svg viewBox='0 0 "+W+" "+H+"' xmlns='http://www.w3.org/2000/svg'>";
  for(var g=0;g<=3;g++){var gy=padT+ih*g/3;var gv=max*(1-g/3);
    s+="<line class='gline' x1='"+padL+"' y1='"+gy+"' x2='"+(W-padR)+"' y2='"+gy+"'/>";
    s+="<text class='axis' x='"+(padL-5)+"' y='"+(gy+3.5)+"' text-anchor='end'>"+Math.round(gv)+"</text>";}
  vals.forEach(function(v,i){
    var bh=ih*(v/max);var x=padL+bw*i+bw*0.18;
    s+="<rect class='bar' x='"+x+"' y='"+(padT+ih-bh)+"' width='"+(bw*0.64)+"' height='"+Math.max(1,bh)+"' fill='"+col+"' opacity='"+(0.55+0.45*(v/max))+"'/>";
  });
  var step=Math.max(1,Math.ceil(n/8));
  labels.forEach(function(l,i){if(i%step===0||i===n-1)s+="<text class='axis' x='"+(padL+bw*i+bw/2)+"' y='"+(H-7)+"' text-anchor='middle'>"+esc(l)+"</text>";});
  s+="</svg>";return s;
}
function statsGraphs(m,el){
  var bs=(m.battles||[]).slice().sort(function(a,b){return a.date<b.date?-1:1;});
  var html="";
  if(!bs.length){html="<div class='card'><div class='empty'><span class='big'>📈</span>グラフを表示するには対戦記録が必要です。<br>まずは対戦してみましょう！</div></div>";el.innerHTML=html;return;}
  /* 日別の対戦回数（直近14日） */
  var days=[],dvals=[];
  for(var i=13;i>=0;i--){var d=new Date();d.setDate(d.getDate()-i);
    var key=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
    days.push((d.getMonth()+1)+"/"+d.getDate());
    dvals.push(bs.filter(function(b){return dstr(b.date)===key;}).length);}
  /* 勝率・正答率・平均回答時間の推移 */
  var w=0,wr=[],acc=[],tm=[],lb=[];
  bs.forEach(function(b,i){
    if(b.me.rank===1&&b.players.filter(function(p){return p.rank===1;}).length===1)w++;
    wr.push(Math.round(w/(i+1)*100));acc.push(Math.round(b.me.accuracy*100));tm.push(+(b.me.avgTimeMs/1000).toFixed(1));
    lb.push(dstr(b.date).slice(5));
  });
  /* 方向別比較 */
  var de={a:0,c:0,t:0},dj={a:0,c:0,t:0};
  bs.forEach(function(b){b.questions.forEach(function(q){
    var t=q.dir==="ej"?de:dj;t.a++;if(q.ok)t.c++;t.t+=q.timeMs;});});
  html+="<div class='card'><h2>📅 日別の対戦回数<small class='sub' style='font-weight:600'>（直近14日）</small></h2><div class='chartbox'>"+chartBars(days,dvals,{color:"#6366f1"})+"</div></div>";
  html+="<div class='card'><h2>🏆 勝率の推移<small class='sub' style='font-weight:600'>（累計・%）</small></h2><div class='chartbox'>"+chartLine(wr,lb,{color:"#f59e0b",max:100})+"</div></div>";
  html+="<div class='card'><h2>🎯 正答率の推移<small class='sub' style='font-weight:600'>（対戦ごと・%）</small></h2><div class='chartbox'>"+chartLine(acc,lb,{color:"#10b981",max:100})+"</div></div>";
  html+="<div class='card'><h2>⏱ 平均回答時間の推移<small class='sub' style='font-weight:600'>（対戦ごと・秒）</small></h2><div class='chartbox'>"+chartLine(tm,lb,{color:"#06b6d4"})+"</div></div>";
  html+="<div class='card'><h2>🔄 英語→日本語 vs 日本語→英語</h2>"+
    "<div class='grid2'>"+
    "<div class='stat'><div class='k'>英語→日本語 正答率</div><div class='v'>"+pctf(de.a?de.c/de.a:0)+"<small>　"+de.a+"問</small></div><div class='meter acc' style='margin-top:6px'><i style='width:"+(de.a?de.c/de.a*100:0)+"%'></i></div></div>"+
    "<div class='stat'><div class='k'>日本語→英語 正答率</div><div class='v'>"+pctf(dj.a?dj.c/dj.a:0)+"<small>　"+dj.a+"問</small></div><div class='meter acc' style='margin-top:6px'><i style='width:"+(dj.a?dj.c/dj.a*100:0)+"%'></i></div></div>"+
    "<div class='stat'><div class='k'>英語→日本語 平均時間</div><div class='v'>"+(de.a?secf(de.t/de.a):"−")+"</div></div>"+
    "<div class='stat'><div class='k'>日本語→英語 平均時間</div><div class='v'>"+(dj.a?secf(dj.t/dj.a):"−")+"</div></div></div>"+
    "<div class='sub' style='margin-top:8px'>"+(de.c>=dj.c?"英語→日本語の方が得意です":"日本語→英語の方が得意です")+"（"+"対戦成績ベース"+"）</div></div>";
  el.innerHTML=html;
}

/* ---------- 単語別統計 ---------- */
function aggFromHistory(st,mode){
  var a={wid:st.wid,asked:0,correct:0,wrong:0,sumTime:0,lastAt:"",dir:{ej:{a:0,c:0,t:0},je:{a:0,c:0,t:0}}};
  (st.history||[]).forEach(function(e){
    if(mode&&mode!=="all"&&e.mode!==mode)return;
    a.asked++;a.sumTime+=e.timeMs;
    if(e.ok)a.correct++;else a.wrong++;
    if(e.t>a.lastAt)a.lastAt=e.t;
    var d=a.dir[e.dir]||(a.dir[e.dir]={a:0,c:0,t:0});d.a++;d.t+=e.timeMs;if(e.ok)d.c++;
  });
  return a;
}
function statsWords(m,el){
  var html="<div class='card'><div class='grid2'>"+
    "<div><label class='f'>成績の種別</label><select id='wMode'>"+
    [["all","全体"],["battle","対戦のみ"]].map(function(x){return "<option value='"+x[0]+"' "+(SVIEW.mode===x[0]?"selected":"")+">"+x[1]+"</option>";}).join("")+"</select></div>"+
    "<div><label class='f'>並べ替え</label><select id='wSort2'>"+
    [["asked","出題回数（多い順）"],["wrong","誤答回数（多い順）"],["acc","正答率（低い順）"],["time","平均時間（長い順）"]].map(function(x){return "<option value='"+x[0]+"' "+(SVIEW.sort===x[0]?"selected":"")+">"+x[1]+"</option>";}).join("")+"</select></div></div>"+
    "<label class='f'>検索</label><input type='search' id='wq2' placeholder='英単語・日本語で検索' value='"+esc(SVIEW.q)+"'></div><div id='wtable'></div>";
  el.innerHTML=html;
  function draw(){
    var rows=[];
    Object.keys(m.wordStats||{}).forEach(function(wid){
      var agg=aggFromHistory(m.wordStats[wid],SVIEW.mode);
      if(!agg.asked)return;
      var wd=WORD_BY[wid];if(!wd)return;
      if(SVIEW.q){var q=SVIEW.q.toLowerCase();if(wd.e.toLowerCase().indexOf(q)<0&&wd.j.indexOf(SVIEW.q)<0)return;}
      rows.push({w:wd,agg:agg});
    });
    rows.sort(function(a,b){
      if(SVIEW.sort==="wrong")return b.agg.wrong-a.agg.wrong;
      if(SVIEW.sort==="acc")return (a.agg.correct/a.agg.asked)-(b.agg.correct/b.agg.asked);
      if(SVIEW.sort==="time")return (b.agg.sumTime/b.agg.asked)-(a.agg.sumTime/a.agg.asked);
      return b.agg.asked-a.agg.asked;
    });
    var t="<div class='card'><h2>🔤 単語別統計<small class='sub' style='font-weight:600'>（"+rows.length+"語）</small></h2>";
    if(!rows.length)t+="<div class='empty'>データがありません</div>";
    else{t+="<div class='tscroll'><table class='tbl'><tr><th>単語</th><th class='num'>出題</th><th class='num'>正解</th><th class='num'>誤答</th><th class='num'>正答率</th><th class='num'>平均</th><th class='num'>英→日</th><th class='num'>日→英</th><th>最終回答</th></tr>";
      rows.slice(0,80).forEach(function(r){
        var acc=r.agg.correct/r.agg.asked,avg=r.agg.sumTime/r.agg.asked;
        var de=r.agg.dir.ej,dj2=r.agg.dir.je;
        t+="<tr><td><b>"+esc(r.w.e)+"</b><small style='display:block;color:var(--sub)'>"+esc(r.w.j)+"</small></td>"+
          "<td class='num'>"+r.agg.asked+"</td><td class='num'>"+r.agg.correct+"</td><td class='num'>"+r.agg.wrong+"</td>"+
          "<td class='num'><span class='badge "+(acc>=0.8?"b-ok":acc>=0.5?"b-warn":"b-ng")+"'>"+pctf(acc)+"</span></td>"+
          "<td class='num'>"+secf(avg)+"</td>"+
          "<td class='num'>"+(de.a?pctf(de.c/de.a):"−")+"</td><td class='num'>"+(dj2.a?pctf(dj2.c/dj2.a):"−")+"</td>"+
          "<td style='white-space:nowrap;font-size:11.5px;color:var(--sub)'>"+(r.agg.lastAt?dstr(r.agg.lastAt):"−")+"</td></tr>";
      });
      t+="</table></div>";if(rows.length>80)t+="<div class='sub center mt'>上位80語を表示中（検索で絞り込めます）</div>";}
    t+="</div>";
    $("#wtable",el).innerHTML=t;
  }
  $("#wMode",el).onchange=function(){SVIEW.mode=this.value;draw();};
  $("#wSort2",el).onchange=function(){SVIEW.sort=this.value;draw();};
  $("#wq2",el).oninput=function(){SVIEW.q=this.value;draw();};
  draw();
}

/* ---------- プレイヤー比較 ---------- */
function compList(m){
  var map={};
  (m.battles||[]).forEach(function(b){
    b.players.forEach(function(p){
      if(p.pid===m.id)return;
      var key=p.pid||("cpu:"+p.name);
      if(!map[key])map[key]={key:key,name:p.name,isCpu:p.isCpu,matches:0,w:0,l:0,d:0,myAcc:0,opAcc:0,bids:[]};
      var e=map[key];e.matches++;e.bids.push(b.id);
      if(b.me.rank<p.rank)e.w++;else if(b.me.rank>p.rank)e.l++;else e.d++;
      e.myAcc+=b.me.accuracy;e.opAcc+=p.accuracy;
    });
  });
  return Object.keys(map).map(function(k){var e=map[k];
    return {key:e.key,name:e.name,isCpu:e.isCpu,matches:e.matches,w:e.w,l:e.l,d:e.d,
      winRate:e.matches?e.w/e.matches:0,myAvgAcc:e.myAcc/e.matches,opAvgAcc:e.opAcc/e.matches,bids:e.bids};})
    .sort(function(a,b){return b.matches-a.matches;});
}
function wordsVs(m,oppKey){
  var strong={},weak={};
  (m.battles||[]).forEach(function(b){
    var inB=b.players.some(function(p){return (p.pid||("cpu:"+p.name))===oppKey;});
    if(!inB)return;
    b.questions.forEach(function(q){
      var op=q.all.filter(function(a){return (a.pid||("cpu:"+a.name))===oppKey;})[0];
      if(!op)return;
      if(q.ok&&!op.ok)strong[q.wid]=(strong[q.wid]||0)+1;
      if(!q.ok&&op.ok)weak[q.wid]=(weak[q.wid]||0)+1;
    });
  });
  function top(o){return Object.keys(o).map(function(w){return {wid:w,n:o[w]};}).sort(function(a,b){return b.n-a.n;}).slice(0,8);}
  return {strong:top(strong),weak:top(weak)};
}
function statsCompare(m,el){
  var list=compList(m);
  var html="<div class='card'><h2>🆚 プレイヤー比較</h2><p class='sub'>同じルームで対戦した相手との通算成績です。</p>";
  if(!list.length)html+="<div class='empty'><span class='big'>🤝</span>まだ比較できる相手がいません。<br>対戦すると自動で追加されます。</div>";
  html+="</div>";
  list.forEach(function(o){
    var oppLabel=o.isCpu?"🤖 "+esc(o.name):esc(o.name);
    html+="<div class='card'><h2>"+oppLabel+" <span class='badge "+(o.winRate>=0.5?"b-ok":"b-ng")+"'>勝率 "+pctf(o.winRate)+"</span></h2>"+
      "<div class='grid3'>"+
      "<div class='stat'><div class='v'>"+o.matches+"<small> 回</small></div><div class='k'>通算対戦</div></div>"+
      "<div class='stat'><div class='v' style='color:var(--ok)'>"+o.w+"<small> 勝</small></div><div class='k'>勝ち</div></div>"+
      "<div class='stat'><div class='v' style='color:var(--ng)'>"+o.l+"<small> 負</small></div><div class='k'>負け</div></div>"+
      "<div class='stat'><div class='v'>"+o.d+"<small> 分</small></div><div class='k'>引き分け</div></div>"+
      "<div class='stat'><div class='k'>自分の平均正答率</div><div class='v'>"+pctf(o.myAvgAcc)+"</div><div class='meter acc' style='margin-top:5px'><i style='width:"+(o.myAvgAcc*100)+"%'></i></div></div>"+
      "<div class='stat'><div class='k'>相手の平均正答率</div><div class='v'>"+pctf(o.opAvgAcc)+"</div><div class='meter acc' style='margin-top:5px'><i style='width:"+(o.opAvgAcc*100)+"%'></i></div></div></div>"+
      "<div class='rowbtns mt'><button class='btn sm ghost' data-exp='"+esc(o.key)+"'>得意・苦手の比較を見る</button></div>"+
      "<div data-cmp='"+esc(o.key)+"' style='display:none'></div></div>";
  });
  el.innerHTML=html;
  $$("[data-exp]",el).forEach(function(b){
    b.onclick=function(){
      var key=b.getAttribute("data-exp");
      var box=el.querySelector("[data-cmp='"+key.replace(/"/g,'\\"')+"']");
      if(!box)return;
      if(box.style.display!=="none"){box.style.display="none";b.textContent="得意・苦手の比較を見る";return;}
      var v=wordsVs(m,key);
      function wl(items,cls){return items.length?items.map(function(x){var w=WORD_BY[x.wid];
        return "<span class='badge "+cls+"'>"+esc(w.e)+"（"+esc(w.j)+"）×"+x.n+"</span>";}).join(" "):"<span class='sub'>—</span>";}
      box.innerHTML="<div style='margin-top:10px'><h3>💪 自分の得意単語 <small>（自分○/相手✗）</small></h3><div class='klist'>"+wl(v.strong,"b-ok")+"</div>"+
        "<h3>😵 自分の苦手単語 <small>（自分✗/相手○）</small></h3><div class='klist'>"+wl(v.weak,"b-ng")+"</div></div>";
      box.style.display="block";b.textContent="閉じる";
    };
  });
}

/* ---------- 対戦履歴 ---------- */
function historyItemHtml(b){
  var resB=b.me.res==="w"?"b-ok":b.me.res==="d"?"b-warn":"b-ng";
  var resT=b.me.res==="w"?"勝利":b.me.res==="d"?"引き分け":"敗北";
  return "<button class='mi' data-bid='"+b.id+"'><span class='ic'>🌐</span>"+
    "<span class='tx'>"+dtf(b.date)+"<small>"+b.players.map(function(p){return esc(p.name);}).join(" ・ ")+"</small></span>"+
    "<span class='badge "+resB+"'>"+resT+" "+b.me.rank+"位</span><span class='arr'>▶</span></button>";
}
function wireHistoryItems(el){
  $$("[data-bid]",el).forEach(function(b){b.onclick=function(){go("battleDetail",{id:b.getAttribute("data-bid")});};});
}
SCREENS.history=function(){
  var m=me();if(!m)return go("profiles");
  var bs=(m.battles||[]).slice().sort(function(a,b){return a.date<b.date?1:-1;});
  var html="<div class='card'><h2>📜 対戦履歴<small class='sub' style='font-weight:600'>（"+bs.length+"件）</small></h2>";
  if(!bs.length)html+="<div class='empty'><span class='big'>📜</span>まだ対戦記録がありません</div>";
  bs.forEach(function(b){html+=historyItemHtml(b);});
  html+="</div><div class='rowbtns'><button class='btn ghost block' id='hBack'>ホームへ</button></div>";
  app.innerHTML=html;
  wireHistoryItems(app);
  $("#hBack",app).onclick=function(){go("home");};
};
SCREENS.battleDetail=function(params){
  var m=me();if(!m)return go("profiles");
  var b=null;(m.battles||[]).forEach(function(x){if(x.id===params.id)b=x;});
  if(!b)return go("history");
  var resB=b.me.res==="w"?"b-ok":b.me.res==="d"?"b-warn":"b-ng";
  var html="<div class='card'><h2>📜 対戦詳細</h2><div class='sub'>"+dtf(b.date)+" ・ ルーム対戦 ・ ルーム "+esc(String(b.roomId).replace("room-",""))+" ・ "+b.questions.length+"問</div>"+
    "<div class='grid3 mt'>"+
    "<div class='stat hi'><div class='v'><span class='badge "+resB+"' style='font-size:13px'>"+(b.me.res==="w"?"勝利":b.me.res==="d"?"引き分け":"敗北")+"</span></div><div class='k'>結果（"+b.me.rank+"位）</div></div>"+
    "<div class='stat'><div class='v'>"+b.me.points+"<small> pt</small></div><div class='k'>獲得ポイント</div></div>"+
    "<div class='stat'><div class='v'>"+pctf(b.me.accuracy)+"</div><div class='k'>正答率</div></div>"+
    "<div class='stat'><div class='v'>"+b.me.correct+"<small> 問</small></div><div class='k'>正解数</div></div>"+
    "<div class='stat'><div class='v'>"+b.me.wrong+"<small> 問</small></div><div class='k'>誤答数</div></div>"+
    "<div class='stat'><div class='v'>"+secf(b.me.avgTimeMs)+"</div><div class='k'>平均回答時間</div></div></div>"+
    "<h3>最終順位</h3>";
  b.players.slice().sort(function(a,c){return a.rank-c.rank||c.points-a.points;}).forEach(function(p){
    html+="<div class='rk "+(p.pid===m.id?"me":"")+"'>"+(p.isCpu?"<span class='no'>🤖</span>":avatarHtml(p.pid,p.name))+
      "<div class='nm'>"+esc(p.name)+"<small>"+p.rank+"位 ・ 正解 "+p.correct+"/"+b.questions.length+" ・ "+pctf(p.accuracy)+" ・ "+secf(p.avgTimeMs)+"</small></div>"+
      "<div class='pt'><b>"+p.points+"</b><small>pt</small></div></div>";
  });
  html+="</div><div class='card'><h2>📝 各問題の回答結果</h2><div class='tscroll'><table class='tbl'><tr><th>#</th><th>単語</th><th>方向</th><th>あなたの回答</th><th>正解</th><th class='c'>正誤</th><th class='num'>時間</th><th class='num'>pt</th><th>全員</th></tr>";
  b.questions.forEach(function(q,i){
    var w=WORD_BY[q.wid];
    var all=q.all.map(function(a){return (a.isCpu?"🤖":"")+(a.ok?"○":"✗");}).join(" ");
    html+="<tr><td>"+(i+1)+"</td><td><b>"+esc(q.dir==="ej"?w.e:w.j)+"</b><small style='display:block;color:var(--sub)'>"+esc(q.dir==="ej"?w.j:w.e)+"</small></td>"+
      "<td style='white-space:nowrap;font-size:11.5px'>"+dirName(q.dir)+"</td><td style='font-size:12px'>"+esc(q.ans)+"</td><td style='font-size:12px'>"+esc(q.correctText)+"</td>"+
      "<td class='c'><span class='badge "+(q.ok?"b-ok":"b-ng")+"'>"+(q.ok?"○":"✗")+"</span></td>"+
      "<td class='num'>"+secf(q.timeMs)+"</td><td class='num'>"+q.point+"</td><td style='white-space:nowrap;font-size:11.5px'>"+esc(all)+"</td></tr>";
  });
  html+="</table></div></div><div class='rowbtns'><button class='btn ghost' id='bdBack' style='flex:1'>履歴へ戻る</button></div>";
  app.innerHTML=html;
  $("#bdBack",app).onclick=function(){go("history");};
};
