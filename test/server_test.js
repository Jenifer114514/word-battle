/* 静的配信サーバーのテスト */
const {spawn}=require("child_process");
const PORT=3996;
let failures=0;
function ok(c,m){if(c)console.log("  ✔ "+m);else{failures++;console.log("  ✘ FAIL: "+m);}}
(async()=>{
  const srv=spawn("node",["server.js"],{env:{...process.env,PORT:String(PORT)},stdio:"ignore"});
  let up=false;
  for(let i=0;i<40&&!up;i++){
    await new Promise(r=>setTimeout(r,250));
    try{const r=await fetch("http://127.0.0.1:"+PORT+"/");if(r.ok)up=true;}catch(e){}
  }
  if(!up){console.log("✘ サーバー起動失敗");srv.kill();process.exit(1);}
  try{
    const html=await fetch("http://127.0.0.1:"+PORT+"/").then(r=>r.text());
    ok(html.includes("英単語バトル"),"アプリHTML配信");
    ok(html.includes("Peer")||html.includes("peerjs"),"PeerJS同梱");
    ok(html.includes("wbtl-v3-"),"P2PルームID生成コードあり");
    const nf=await fetch("http://127.0.0.1:"+PORT+"/api/ping");
    ok(nf.status===404,"APIは廃止（404）");
    console.log(failures===0?"===== STATIC SERVER TESTS PASSED =====":"===== "+failures+" FAILURES =====");
  }catch(e){console.log("✘ EXCEPTION: "+e.message);failures++;}
  srv.kill();
  process.exit(failures===0?0:1);
})();
