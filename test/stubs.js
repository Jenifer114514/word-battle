/* ===== DOM スタブ（Node スモークテスト用） ===== */
function FakeEl(tag){this.tagName=tag||"div";this.children=[];this.style={};this.dataset={};this._html="";this.value="";this.checked=false;this._attrs={};}
Object.defineProperty(FakeEl.prototype,"innerHTML",{get:function(){return this._html;},set:function(v){this._html=v;this.children=[];}});
FakeEl.prototype.appendChild=function(c){this.children.push(c);c.parentNode=this;return c;};
FakeEl.prototype.remove=function(){};
FakeEl.prototype.addEventListener=function(){};
FakeEl.prototype.getAttribute=function(k){return this._attrs[k]||null;};
FakeEl.prototype.setAttribute=function(k,v){this._attrs[k]=v;};
FakeEl.prototype.focus=function(){};
FakeEl.prototype.select=function(){};
FakeEl.prototype.click=function(){};
FakeEl.prototype.querySelector=function(){return new FakeEl("auto");};
FakeEl.prototype.querySelectorAll=function(){return [];};
var __doc=new FakeEl("document");
__doc.body=new FakeEl("body");
__doc.createElement=function(t){return new FakeEl(t);};
__doc.querySelector=function(){return new FakeEl("auto");};
__doc.querySelectorAll=function(){return [];};
__doc.addEventListener=function(){};
global.document=__doc;
global.window={scrollTo:function(){},addEventListener:function(){}};
global.navigator={};

/* ===== PeerJS モック（ホスト/ゲストのメッセージ流をシミュレート） ===== */
var fakeTimers=[];
function FakePeer(id,opts){
  this.id=id||"peer_"+Math.random().toString(36).slice(2,8);
  this._cbs={};this.destroyed=false;
  if(id&&FakePeer.registry[id]&&!FakePeer.registry[id].destroyed){
    var dup=this; /* 実PeerJS同様: 既存IDなら unavailable-id */
    fakeTimers.push(setTimeout(function(){dup._emit("error",{type:"unavailable-id"});},5));
    return;
  }
  FakePeer.registry[this.id]=this;
  var self=this;
  fakeTimers.push(setTimeout(function(){if(!self.destroyed)self._emit("open",self.id);},5));
}
FakePeer.registry={};
FakePeer.reset=function(){FakePeer.registry={};};
FakePeer.prototype.on=function(ev,cb){(this._cbs[ev]=this._cbs[ev]||[]).push(cb);};
FakePeer.prototype._emit=function(ev,arg){(this._cbs[ev]||[]).slice().forEach(function(cb){cb(arg);});};
FakePeer.prototype.connect=function(target){
  var guest=this;
  var conn=new FakeConn("guest");
  var host=FakePeer.registry[target];
  fakeTimers.push(setTimeout(function(){
    if(!host||host.destroyed){guest._emit("error",{type:"peer-unavailable"});return;}
    var hostConn=new FakeConn("host");
    conn.link(hostConn);
    host._emit("connection",hostConn);
    fakeTimers.push(setTimeout(function(){
      conn.open=true;hostConn.open=true;
      conn._emit("open");hostConn._emit("open");
    },5));
  },8));
  return conn;
};
FakePeer.prototype.destroy=function(){this.destroyed=true;if(FakePeer.registry[this.id]===this)delete FakePeer.registry[this.id];};
function FakeConn(side){
  this._cbs={};this.open=false;this._peer=null;this.side=side;
}
FakeConn.prototype.link=function(other){this._peer=other;other._peer=this;};
FakeConn.prototype.on=function(ev,cb){(this._cbs[ev]=this._cbs[ev]||[]).push(cb);};
FakeConn.prototype._emit=function(ev,arg){(this._cbs[ev]||[]).slice().forEach(function(cb){cb(arg);});};
FakeConn.prototype.send=function(msg){
  var peer=this._peer;var data=JSON.parse(JSON.stringify(msg));
  fakeTimers.push(setTimeout(function(){if(peer&&peer.open)peer._emit("data",data);},5));
};
FakeConn.prototype.close=function(){
  var self=this,p=this._peer;
  this._peer=null;this.open=false;
  if(p){p.open=false;p._peer=null;fakeTimers.push(setTimeout(function(){p._emit("close");self._emit("close");},5));}
};
function flushFake(ms){return new Promise(function(resolve){setTimeout(resolve,ms||60);});}
global.Peer=FakePeer;
global.__flush=flushFake;
