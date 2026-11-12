// Mailing panel page for the BAROWO CRM. The link from the bot carries a personal
// token in the URL fragment (#t=…), so it never reaches server logs. All data comes
// from the CRM through POST /mailing/api.
export const MAILING_PANEL_HTML = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Mailing BAROWO</title>
<style>
:root{--bg:#06061a;--panel:#0d0d26;--line:rgba(232,235,250,.14);--ink:#e8ebfa;--dim:#9a9db8;--red:#e8000d;--ok:#3ccf8e}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
header{position:sticky;top:0;z-index:5;background:rgba(6,6,26,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bar{max-width:1180px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px}
.logo{font-weight:800;letter-spacing:.08em}.logo b{color:var(--red)}
.count{margin-left:auto;font-size:13px;color:var(--dim)}.count b{color:var(--ink);font-size:16px}
main{max-width:1180px;margin:0 auto;padding:16px;display:grid;gap:16px}
@media(min-width:980px){main{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}}
section{background:var(--panel);border:1px solid var(--line);padding:16px}
h2{margin:0 0 12px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-weight:600}
h2 span{color:var(--red)}
input[type=text],input[type=search],textarea,select{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--ink);font:inherit;font-size:16px;padding:11px 12px;border-radius:0;-webkit-appearance:none;appearance:none}
textarea{min-height:230px;resize:vertical;line-height:1.55}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--red)}
label.f{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:14px 0 6px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.chip{border:1px solid var(--line);background:transparent;color:var(--ink);padding:8px 12px;font:inherit;font-size:14px;cursor:pointer;min-height:38px}
.chip[aria-pressed=true]{background:var(--red);border-color:var(--red)}
.row2{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.btn{border:1px solid var(--line);background:transparent;color:var(--ink);padding:10px 14px;font:inherit;font-size:14px;cursor:pointer;min-height:42px}
.btn.primary{background:var(--red);border-color:var(--red);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.btn:disabled{opacity:.45;cursor:default}
.list{max-height:420px;overflow:auto;border:1px solid var(--line);margin-top:10px}
.item{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer}
.item:last-child{border-bottom:0}
.item input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--red);flex:none}
.item .n{font-weight:600}.item .m{font-size:13px;color:var(--dim);word-break:break-all}
.tag{display:inline-block;font-size:11px;padding:1px 6px;margin-left:6px;border:1px solid var(--line);color:var(--dim);vertical-align:1px}
.tag.ok{border-color:var(--ok);color:var(--ok)}
.item.off{opacity:.45;cursor:default}
.hint{font-size:13px;color:var(--dim);margin:6px 0 0}
.warn{font-size:13px;color:#ffb3b8;border-left:3px solid var(--red);padding:8px 10px;background:rgba(232,0,13,.08);margin-top:12px}
iframe{width:100%;height:760px;border:0;background:#f1f2f6;display:block}
.send{display:grid;gap:8px;margin-top:12px}
@media(min-width:560px){.send{grid-template-columns:1fr 1fr}}
.camp{font-size:13px;color:var(--dim);border-top:1px solid var(--line);padding:8px 0}
.camp b{color:var(--ink)}
#toast{position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;padding:14px 16px;background:#14143a;border:1px solid var(--line);border-left:4px solid var(--red);display:none;z-index:9}
#toast.show{display:block}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;padding:16px;z-index:8}
.modal.show{display:flex}
.modal div{background:var(--panel);border:1px solid var(--line);border-top:4px solid var(--red);padding:20px;max-width:440px;width:100%}
.modal h3{margin:0 0 8px;font-size:20px}
#gate{max-width:520px;margin:15vh auto;padding:24px;text-align:center}
</style>
</head>
<body>
<header><div class="bar"><div class="logo">BAR<b>O</b>WO · MAILING</div><div class="count">Wybrano <b id="selCount">0</b> z <span id="allCount">0</span></div></div></header>
<div id="gate"><p>Ładuję dane z CRM…</p></div>
<main id="app" hidden>
  <section>
    <h2><span>01</span> Odbiorcy</h2>
    <input type="search" id="q" placeholder="Szukaj: imię, e-mail, wydarzenie…" autocomplete="off">
    <div class="chips" id="typeChips">
      <button class="chip" data-type="wedding" aria-pressed="false">💍 Wesela</button>
      <button class="chip" data-type="birthday" aria-pressed="false">🎂 Urodziny</button>
      <button class="chip" data-type="company" aria-pressed="false">🏢 Firmowe</button>
      <button class="chip" data-type="other" aria-pressed="false">🎉 Inne</button>
    </div>
    <div class="chips" id="statusChips">
      <button class="chip" data-status="signed" aria-pressed="false">✅ Z umową</button>
      <button class="chip" data-status="open" aria-pressed="false">📨 Bez umowy</button>
      <button class="chip" data-status="past" aria-pressed="false">🕓 Wydarzenie minęło</button>
      <button class="chip" data-status="future" aria-pressed="false">📅 Wydarzenie przed nami</button>
      <button class="chip" data-status="recent" aria-pressed="false">🆕 Ostatnie 90 dni</button>
    </div>
    <p class="hint">Bez zaznaczonych filtrów widać wszystkich. Typy łączą się „lub”, pozostałe filtry zawężają listę.</p>
    <div class="row2">
      <button class="btn" id="selVisible">Zaznacz widocznych (<span id="visCount">0</span>)</button>
      <button class="btn" id="unselVisible">Odznacz widocznych</button>
      <button class="btn" id="unselAll">Wyczyść wybór</button>
    </div>
    <div class="list" id="list"></div>
  </section>
  <section>
    <h2><span>02</span> Wiadomość</h2>
    <label class="f" for="tpl">Szablon</label>
    <select id="tpl"></select>
    <label class="f" for="h1">Nagłówek — czerwona linia (gdy bez plakatu)</label>
    <input type="text" id="h1" maxlength="40" placeholder="np. Wolne terminy.">
    <label class="f" for="h2">Nagłówek — czarna linia (gdy bez plakatu)</label>
    <input type="text" id="h2" maxlength="40" placeholder="np. Sezon 2027.">
    <label class="f" for="img">Plakat na górze maila</label>
    <select id="img"><option value="season">Plakat: Soboty 2027 znikają</option><option value="company">Plakat: Wigilia z barem</option><option value="birthday">Plakat: 18-tka z barem</option><option value="thanks">Plakat: Dziękujemy</option><option value="">Bez plakatu — nagłówek z pól wyżej</option></select>
    <label class="f" for="subject">Temat maila (widać w skrzynce)</label>
    <input type="text" id="subject" maxlength="150">
    <label class="f" for="body">Treść</label>
    <textarea id="body" maxlength="4000"></textarea>
    <p class="hint"><b>{imie}</b> zamieni się na imię odbiorcy. Pusta linia = nowy akapit. Na dole maila zawsze jest link „Wypisz się”.</p>
    <label class="f" for="btnText">Przycisk w mailu (opcjonalnie)</label>
    <div class="row2" style="margin:0"><input type="text" id="btnText" placeholder="Tekst, np. Sprawdź wolny termin" maxlength="40" style="flex:1 1 180px">
    <input type="text" id="btnUrl" placeholder="https://barowo.com/#contact" style="flex:2 1 220px"></div>
  </section>
  <section>
    <h2><span>03</span> Podgląd</h2>
    <iframe id="preview" title="Podgląd maila" sandbox></iframe>
    <p class="hint" id="previewNote">Podgląd dla pierwszej wybranej osoby.</p>
  </section>
  <section>
    <h2><span>04</span> Wysyłka</h2>
    <p id="limits" class="hint"></p>
    <div class="warn">Reklamę mailem wysyłaj osobom, które się na nią zgodziły (Prawo komunikacji elektronicznej). Wypisani są pomijani automatycznie.</div>
    <div class="send">
      <button class="btn" id="test">📧 Test do mnie</button>
      <button class="btn primary" id="go">🚀 Wyślij</button>
    </div>
    <div id="camps" style="margin-top:14px"></div>
  </section>
</main>
<div class="modal" id="confirm"><div>
  <h3>Wysłać mailing?</h3>
  <p id="confirmText"></p>
  <div class="send"><button class="btn" id="cancelGo">Anuluj</button><button class="btn primary" id="reallyGo">Tak, wyślij</button></div>
</div></div>
<div id="toast"></div>
<script>
(function(){
  var token=(location.hash.match(/t=([a-f0-9]{48})/)||[])[1]||"";
  if(token) history.replaceState(null,"",location.pathname);
  var $=function(id){return document.getElementById(id)};
  var state={contacts:[],selected:{},types:{},statuses:{},templates:[],stats:null,testEmail:""};
  function toast(t){var el=$("toast");el.textContent=t;el.className="show";clearTimeout(toast.t);toast.t=setTimeout(function(){el.className=""},4500)}
  function api(op,payload){
    var body=new URLSearchParams({token:token,op:op,payload:JSON.stringify(payload||{})});
    return fetch("/mailing/api",{method:"POST",body:body}).then(function(r){return r.json()}).then(function(j){
      if(!j.ok){if(j.error==="expired"){gate("Link wygasł. Kliknij 📣 Mailing w bocie, żeby dostać nowy.")}throw new Error(j.error||"Błąd")}return j});
  }
  function gate(text){$("app").hidden=true;$("gate").style.display="block";$("gate").innerHTML="<p></p>";$("gate").firstChild.textContent=text}
  function esc(s){return String(s||"").replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  var TYPE={wedding:"Wesele",birthday:"Urodziny",company:"Firmowe",other:"Inne"};
  function visible(){
    var q=$("q").value.trim().toLowerCase(),types=Object.keys(state.types).filter(function(k){return state.types[k]}),st=state.statuses;
    return state.contacts.filter(function(c){
      if(q&&(c.name+" "+c.email+" "+c.event).toLowerCase().indexOf(q)<0)return false;
      if(types.length&&types.indexOf(c.type)<0)return false;
      if(st.signed&&!st.open&&!c.signed)return false;
      if(st.open&&!st.signed&&c.signed)return false;
      if(st.past&&!st.future&&!c.past)return false;
      if(st.future&&!st.past&&(c.past||!c.date))return false;
      if(st.recent&&c.createdDays>90)return false;
      return true;});
  }
  function selectedList(){return state.contacts.filter(function(c){return state.selected[c.uid]&&!c.unsubscribed})}
  function render(){
    var vis=visible(),html=[];
    vis.slice(0,600).forEach(function(c){
      html.push('<label class="item'+(c.unsubscribed?' off':'')+'"><input type="checkbox" data-uid="'+esc(c.uid)+'"'+(state.selected[c.uid]&&!c.unsubscribed?' checked':'')+(c.unsubscribed?' disabled':'')+'>'+
        '<span><span class="n">'+esc(c.name||c.email)+'</span>'+(c.signed?'<span class="tag ok">umowa</span>':'')+(c.unsubscribed?'<span class="tag">wypisany</span>':'')+
        '<br><span class="m">'+esc(c.email)+' · '+esc(c.event||TYPE[c.type])+(c.date?' · '+esc(c.date):'')+'</span></span></label>');
    });
    if(!vis.length)html.push('<p class="hint" style="padding:12px">Nikt nie pasuje do filtrów.</p>');
    if(vis.length>600)html.push('<p class="hint" style="padding:12px">Pokazuję 600 z '+vis.length+' — zawęź wyszukiwanie.</p>');
    $("list").innerHTML=html.join("");
    $("visCount").textContent=vis.filter(function(c){return!c.unsubscribed}).length;
    var n=selectedList().length;$("selCount").textContent=n;$("allCount").textContent=state.contacts.length;
    $("go").textContent="🚀 Wyślij do "+n+" "+(n===1?"osoby":"osób");$("go").disabled=!n;
    schedulePreview();
  }
  function values(){var t=$("btnText").value.trim(),u=$("btnUrl").value.trim();
    return{subject:$("subject").value.trim(),body:$("body").value,button:t||u?t+" | "+u:"",h1:$("h1").value.trim(),h2:$("h2").value.trim(),image:$("img").value}}
  var pt;function schedulePreview(){clearTimeout(pt);pt=setTimeout(preview,500)}
  function preview(){
    var first=selectedList()[0],name=first?first.name:"Anna";
    $("previewNote").textContent=first?"Podgląd dla: "+(first.name||first.email):"Podgląd z przykładowym imieniem „Anna”.";
    api("preview",{values:values(),name:name}).then(function(j){$("preview").srcdoc=j.html}).catch(function(e){
      $("preview").srcdoc='<p style="font:15px Arial;padding:20px;color:#a00">'+esc(e.message)+'</p>'});
  }
  function renderStats(){
    var s=state.stats;if(!s)return;
    $("limits").textContent="Dziś wysłano "+s.sentToday+" z limitu "+s.limit+" maili. Większa grupa wyśle się partiami w kolejne dni — automatycznie.";
    $("camps").innerHTML=s.campaigns.length?"<h2>Ostatnie kampanie</h2>"+s.campaigns.map(function(c){
      return'<div class="camp"><b>'+esc(c.subject)+'</b><br>'+esc(c.id)+' · wysłano '+c.sent+(c.waiting?' · w kolejce '+c.waiting:'')+(c.other?' · pominięte/błędy '+c.other:'')+(c.status==="done"?' · ✅ zakończona':'')+'</div>'}).join(""):"";
  }
  function applyTemplate(id){var t=state.templates.filter(function(x){return x.id===id})[0];if(!t)return;
    $("subject").value=t.subject;$("body").value=t.body;$("h1").value=t.h1||"";$("h2").value=t.h2||"";$("img").value=t.image||"";var parts=(t.button||"").split("|");
    $("btnText").value=(parts[0]||"").trim();$("btnUrl").value=(parts.slice(1).join("|")||"").trim();schedulePreview()}
  function chip(group,key){document.querySelectorAll("#"+group+" .chip").forEach(function(b){b.addEventListener("click",function(){
    var k=b.dataset[key],map=key==="type"?state.types:state.statuses;map[k]=!map[k];b.setAttribute("aria-pressed",String(!!map[k]));render()})})}
  chip("typeChips","type");chip("statusChips","status");
  $("q").addEventListener("input",render);
  $("list").addEventListener("change",function(e){var uid=e.target.dataset&&e.target.dataset.uid;if(!uid)return;state.selected[uid]=e.target.checked;
    var n=selectedList().length;$("selCount").textContent=n;$("go").textContent="🚀 Wyślij do "+n+" "+(n===1?"osoby":"osób");$("go").disabled=!n;schedulePreview()});
  $("selVisible").addEventListener("click",function(){visible().forEach(function(c){if(!c.unsubscribed)state.selected[c.uid]=true});render()});
  $("unselVisible").addEventListener("click",function(){visible().forEach(function(c){delete state.selected[c.uid]});render()});
  $("unselAll").addEventListener("click",function(){state.selected={};render()});
  ["subject","body","btnText","btnUrl","h1","h2","img"].forEach(function(id){$(id).addEventListener("input",schedulePreview);$(id).addEventListener("change",schedulePreview)});
  $("tpl").addEventListener("change",function(){applyTemplate(this.value)});
  $("test").addEventListener("click",function(){var b=this;b.disabled=true;
    api("test",{values:values()}).then(function(j){toast("📧 Test wysłany na "+j.sentTo+". Sprawdź skrzynkę.")}).catch(function(e){toast("❌ "+e.message)}).then(function(){b.disabled=false})});
  $("go").addEventListener("click",function(){var n=selectedList().length;if(!n)return;
    $("confirmText").textContent="Temat: „"+$("subject").value.trim()+"”. Odbiorców: "+n+". Dziś zostało w limicie: "+Math.max(0,state.stats.limit-state.stats.sentToday)+" — reszta pójdzie automatycznie w kolejnych dniach.";
    $("confirm").className="modal show"});
  $("cancelGo").addEventListener("click",function(){$("confirm").className="modal"});
  $("reallyGo").addEventListener("click",function(){var b=this;b.disabled=true;
    api("send",{values:values(),uids:selectedList().map(function(c){return c.uid})}).then(function(j){
      $("confirm").className="modal";state.selected={};state.stats=j.stats;renderStats();render();
      toast("🚀 Kampania "+j.id+" wystartowała: "+j.total+" odbiorców. Raport przyjdzie w bocie.")}).catch(function(e){$("confirm").className="modal";toast("❌ "+e.message)}).then(function(){b.disabled=false})});
  if(!token){gate("Otwórz panel z linku w bocie: 📣 Mailing.");return}
  api("data").then(function(j){
    state.contacts=j.contacts;state.templates=j.templates;state.stats=j.stats;state.testEmail=j.testEmail;
    $("test").textContent="📧 Test do mnie ("+j.testEmail+")";
    $("tpl").innerHTML=j.templates.map(function(t){return'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>'}).join("");
    applyTemplate(j.templates[0].id);
    $("gate").style.display="none";$("app").hidden=false;renderStats();render();
  }).catch(function(e){if(e.message!=="expired")gate("Nie udało się wczytać danych: "+e.message)});
})();
</script>
</body>
</html>`;
