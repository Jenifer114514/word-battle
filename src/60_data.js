/* ================= プロフィール（名前変更は7日に1回・端末内保存） ================= */
SCREENS.account=function(){
  var m=me();if(!m)return go("profiles");
  var elapsed=Date.now()-new Date(m.nameChangedAt||m.createdAt).getTime();
  var canRename=elapsed>=NAME_CHANGE_MS();
  var nextDay=dstr(new Date(new Date(m.nameChangedAt||m.createdAt).getTime()+NAME_CHANGE_MS()).toISOString());
  var html="<div class='card'><h2>👤 プロフィール</h2>"+
    "<div class='center'>"+avatarHtml(m.id,m.name,"big")+"<b style='font-size:17px'>"+esc(m.name)+"</b>"+
    "<div class='sub'>登録: "+dstr(m.createdAt)+" ・ 対戦 "+(m.battles||[]).length+"回</div>"+
    "<div class='sub'>🔒 記録はこの端末に保存されています</div></div>"+
    "<label class='f'>ユーザー名"+(canRename?"（変更できます）":"（次の変更は "+nextDay+" 以降）")+"</label>"+
    "<input type='text' id='acName' maxlength='12' value='"+esc(m.name)+"'"+(canRename?"":" disabled")+">"+
    "<label class='f'>アイコン色</label><div class='seg' id='acColor'>"+COLORS.map(function(c){return "<button data-v='"+c+"' style='"+(m.color===c?"border-color:"+c+";background:"+c+"22":"")+"'><span style='display:inline-block;width:18px;height:18px;border-radius:50%;background:"+c+"'></span></button>";}).join("")+"</div>"+
    "<button class='btn pri block mt' id='acSave'>保存する</button>"+
    "<hr class='divh'><div class='rowbtns'><button class='btn danger' id='acReset' style='flex:1'>🗑 戦績・統計をリセット</button></div>"+
    "<div class='sub' style='margin-top:6px'>この端末に保存された対戦履歴・単語別統計を全消去します（元に戻せません）。</div>"+
    "<hr class='divh'><div class='rowbtns'><button class='btn danger' id='acDel' style='flex:1'>"+(m.guest?"⚠ ゲストセッションを終了":"⚠ この端末からアカウントを削除")+"</button></div>"+
    "</div><div class='rowbtns'><button class='btn ghost block' id='acBack'>ホームへ</button></div>";
  app.innerHTML=html;
  var newColor=m.color;
  $$("#acColor button",app).forEach(function(b){b.onclick=function(){newColor=b.getAttribute("data-v");$$("#acColor button",app).forEach(function(x){x.style.background=x===b?newColor+"22":"";x.style.borderColor=x===b?newColor:"";});};});
  $("#acBack",app).onclick=function(){go("home");};
  $("#acSave",app).onclick=function(){
    var newName=$("#acName",app).value.trim();
    var before=m.name;
    var r=tryRename(m,newName);
    if(r.error)return toast(r.error);
    m.color=newColor;saveDB();
    var renamed=m.name!==before;
    toast(renamed?"名前を「"+m.name+"」に変更しました（次の変更は7日後から）":"保存しました");go("account");
  };
  $("#acReset",app).onclick=function(){
    confirmModal("戦績・統計のリセット",""+esc(m.name)+"の対戦履歴・単語別統計を全て削除します。よろしいですか？","リセットする",function(){
      m.battles=[];m.wordStats={};saveDB();toast("リセットしました");go("account");
    },true);
  };
  $("#acDel",app).onclick=function(){
    confirmModal(m.guest?"ゲストセッションの終了":"アカウントの削除","この端末から「"+m.name+"」の記録を削除します。よろしいですか？","削除する",function(){
      if(m.guest)DB.deviceAccount=null;
      delete DB.profiles[m.id];
      DB.deviceAccount=null;saveDB();
      SESSION=null;saveSession();
      toast("削除しました");go("profiles");
    },true);
  };
};

/* ================= アプリ起動（全定義の読み込み後に実行） ================= */
boot();
