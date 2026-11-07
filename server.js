"use strict";
/* ================= 英単語バトル 静的配信サーバー =================
   アプリ本体はP2P（PeerJS）なので、サーバーはHTML配信のみ行う。 */
const http=require("http"),fs=require("fs"),path=require("path");
const PORT=process.env.PORT||3000;
const HTML=path.join(__dirname,"word-battle.html");

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,"http://x");
  if(u.pathname==="/"||u.pathname==="/index.html"||u.pathname==="/word-battle.html"){
    try{
      const html=fs.readFileSync(HTML);
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
      res.end(html);
    }catch(e){
      res.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"});
      res.end("word-battle.html の読み込みに失敗しました。bash build.sh を実行してください。");
    }
    return;
  }
  res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
  res.end("not found");
});
server.listen(PORT,"0.0.0.0",()=>{
  console.log("英単語バトル（P2P）配信開始: http://0.0.0.0:"+PORT);
});
