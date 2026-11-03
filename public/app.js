(function(){
'use strict';
var $=function(s){return document.querySelector(s)}, $$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var TN={T1:'绝对化用语',T2:'医疗功效宣称',T3:'夸大功效',T4:'功效或安全保证',T5:'数据或背书无依据',T6:'贬低竞品',T7:'广告未标识',T8:'特殊品类违规'};
var KB={laws:[],cases:[],sup:[],full:[]}, CASE={};
/* 去掉模型输出里的内部类型代码，如"（T1）"或单独的 T5 */
function clean(s){return String(s||'').replace(/[（(]\s*T[1-8](\s*[/、,，]\s*T[1-8])*\s*[)）]/g,'').replace(/\bT([1-8])\b/g,function(m,n){return TN['T'+n]})}
function fmt(t){var d=new Date(t);if(isNaN(d))return '';var n=new Date();var hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');return (d.toDateString()===n.toDateString()?'今天 ':(d.getMonth()+1)+'月'+d.getDate()+'日 ')+hm}
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 本地存储（只在访客自己的浏览器） ---------- */
var LS_REC='acr.records.v1', LS_DEC='acr.decisions.v1';
function load(k,def){try{var v=JSON.parse(localStorage.getItem(k)||'null');return v&&typeof v==='object'?v:def}catch(e){return def}}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){note('浏览器存储已满或被禁用，记录可能没有保存。');return false}}
var results={}, mine=load(LS_REC,{}), decisions=load(LS_DEC,{});
var view='review', cur=null, curFresh=false, qSel=null, status={ready:false,limited:false,used:0,perDay:10};

/* ---------- 转人工规则（与评测一致） ---------- */
var SIG=/个人(体验|感受|感觉)|因人而异|国妆特字|最新|首款|本店|本品牌|注明|数据来源|据.{0,8}(调研|报告|检测)|蓝帽|保健食品|批准|备案/;
var SHOP=/链接|下单|立减|购买|入手|优惠|券|橱窗|小黄车/;
function routeFlags(text,kind,ai){
  var f=[];
  if(!ai||ai.incomplete)f.push('AI 输出不完整');
  if(kind==='图片')f.push('图片素材，识图可能有误');
  if(kind==='视频')f.push('视频素材，只审了截取的画面和口播');
  if(ai&&ai.is_violation&&(ai.risk==='中'||ai.risk==='低'))f.push('AI 判定风险等级为'+ai.risk);
  var laws=(ai&&ai.violations||[]).map(function(v){return v.law}).join(' ')+' '+(ai&&ai.summary||'');
  if(/参照|类推|待人工|未检索|无法确认/.test(laws))f.push('法条依据存疑');
  if(SIG.test(text||''))f.push('含边界表述（个人体验、注册证、时间顺序、数据来源等）');
  if(SHOP.test(text||'')&&!/广告/.test(text||''))f.push('有带货引导但未标"广告"');
  return f;
}
function routed(id){var r=results[id],d=decisions[id]||{};return !!((r&&r.flags&&r.flags.length)||d.routed)}
function decided(id){var d=decisions[id];return !!d&&(d.decision==='pass'||d.decision==='fail')}
function stateOf(id){return decided(id)?'done':(routed(id)?'wait':'auto')}
function overturned(id){var r=results[id],d=decisions[id];return decided(id)&&!!r&&((d.decision==='fail')!==!!r.ai.is_violation)}
function isMine(r){return r.src==='我提交的'}
function srcLabel(r){return isMine(r)?'我呈上的':r.src+' '+r.id}
function sorted(){return Object.keys(results).sort(function(a,b){var A=results[a],B=results[b];
  if(isMine(A)!==isMine(B))return isMine(A)?-1:1; if(isMine(A))return String(B.at||'').localeCompare(String(A.at||''));return (A.order||0)-(B.order||0)})}
function note(t){$('#global-note').hidden=!t;$('#global-note').textContent=t||''}

/* ---------- 进入界面与墨晕转场 ---------- */
function openApp(){$('#gate').hidden=true;$('#app').classList.add('on');try{sessionStorage.setItem('acr.entered','1')}catch(e){}moveStroke()}
function enter(){
  if(reduce){openApp();return}
  var r=$('#enter').getBoundingClientRect(),w=$('#wash');
  w.style.setProperty('--x',(r.left+r.width/2)+'px');w.style.setProperty('--y',(r.top+r.height/2)+'px');
  w.classList.remove('go');void w.offsetWidth;w.classList.add('go');setTimeout(openApp,520);
}
$('#enter').addEventListener('click',enter);$('#skip').addEventListener('click',openApp);
try{if(sessionStorage.getItem('acr.entered')==='1')openApp()}catch(e){}

/* ---------- 标签切换 ---------- */
function moveStroke(){var t=$('.tab[aria-selected="true"]'),s=$('#stroke');if(!t||!t.offsetWidth)return;s.style.width=(t.offsetWidth-16)+'px';s.style.transform='translateX('+(t.offsetLeft+8)+'px)'}
function show(v){view=v;$$('.tab').forEach(function(t){t.setAttribute('aria-selected',t.dataset.view===v)});moveStroke();
  $$('.view').forEach(function(s){s.classList.toggle('show',s.id==='v-'+v)});
  if(v==='queue')renderQueue();if(v==='records')renderRecords();window.scrollTo(0,0)}
$$('.tab').forEach(function(t){t.addEventListener('click',function(){show(t.dataset.view)})});
window.addEventListener('resize',moveStroke);
document.addEventListener('click',function(e){var g=e.target.closest('[data-go]');if(g)show(g.dataset.go)});

/* ---------- 依据查询：法条原文、要点、罚则、相关案例 ---------- */
var CN='零一二三四五六七八九';
function cnNum(n){n=+n;if(n<10)return CN[n];var t=Math.floor(n/10),o=n%10;return (t>1?CN[t]:'')+'十'+(o?CN[o]:'')}
var NAMES=[['互联网广告管理办法','互联网广告管理办法'],['广告绝对化用语执法指南','绝对化用语执法指南'],['化妆品监督管理条例','化妆品监督管理条例'],['化妆品功效宣称评价规范','功效宣称评价规范'],['反不正当竞争法','反不正当竞争法'],['食品安全法','食品安全法'],['广告法','广告法']];
function lawName(s){for(var i=0;i<NAMES.length;i++)if(s.indexOf(NAMES[i][0])>=0||s.indexOf(NAMES[i][1])>=0)return NAMES[i][0];return ''}
function parseRefs(text){
  var out=[];String(text||'').split(/[；;]/).forEach(function(seg){
    var name=lawName(seg);if(!name)return;
    (seg.match(/第\s*(\d+)\s*条/g)||[]).forEach(function(m){var n=+m.replace(/\D/g,'');if(n&&!out.some(function(o){return o.name===name&&o.n===n}))out.push({name:name,n:n})});
    if(!/第\s*\d+\s*条/.test(seg)&&!out.some(function(o){return o.name===name&&!o.n}))out.push({name:name,n:0});
  });return out;
}
function fullArticle(n){
  var key='第'+cnNum(n)+'条';
  return KB.full.filter(function(c){return c.split('\n').some(function(l){return l.indexOf(key+' ')===0||l.indexOf(key+'（续')===0})})
    .map(function(c){return c.split('\n').slice(1).filter(function(l){return l.indexOf(key+'（续')!==0}).join('\n')}).join('\n');
}
function casesFor(name,n){
  var short=name==='广告法'?'广告法':name;
  return KB.cases.filter(function(c){return String(c.art).split(/[;；]/).some(function(p){if(p.indexOf(short)<0)return false;if(short==='广告法'&&/互联网/.test(p))return false;var nums=(p.replace(/^[^第]*/,'').match(/\d+/g)||[]).map(Number);return !n||nums.indexOf(n)>=0})}).slice(0,4);
}
function caseLine(c){return '<div><b>'+esc(c.party)+'</b> · '+esc(c.product)+'<br>违规表述：'+esc(c.words)+'<br>'+esc(c.penalty)+' · <button class="law" data-case="'+esc(c.id)+'">查看详情 ›</button></div>'}
function openDrawer(title,html){$('#d-title').textContent=title;$('#d-body').innerHTML=html;$('#drawer').classList.add('on');$('#drawer').setAttribute('aria-hidden','false');$('#scrim').classList.add('on');$('#d-close').focus()}
function closeDrawer(){$('#drawer').classList.remove('on');$('#drawer').setAttribute('aria-hidden','true');$('#scrim').classList.remove('on')}
function openLaw(text){
  var refs=parseRefs(text),parts=[],found=false;
  refs.forEach(function(r){
    var label='《'+r.name+'》'+(r.n?'第'+r.n+'条':'');
    var points=KB.laws.filter(function(l){return lawName(l.law)===r.name&&(!r.n||(l.art.match(/\d+/g)||[]).map(Number).indexOf(r.n)>=0)});
    var orig=r.name==='广告法'&&r.n?fullArticle(r.n):'';
    var pen=r.name==='广告法'&&r.n?KB.sup.filter(function(s){return s.indexOf('罚则对照')===0&&new RegExp('第'+r.n+'条').test(s.split('\n')[0])}):[];
    var cs=casesFor(r.name,r.n);
    if(!orig&&!points.length)return;
    found=true;
    parts.push('<div style="display:grid;gap:14px"><h3>'+esc(label)+'</h3>'+
      (orig?'<div><p class="sec">条文原文</p><div class="orig">'+esc(orig)+'</div></div>':'')+
      points.map(function(l){return '<div><p class="sec">'+(orig?'要点':'条款要点（概括，原文以官方文本为准）')+'</p><p style="font-size:14px">'+esc(l.point)+'</p>'+(l.words?'<div class="words" style="margin-top:8px">'+String(l.words).split(/[、,，]/).filter(Boolean).slice(0,8).map(function(w){return '<span class="chip bad">'+esc(w.replace(/[“”"]/g,''))+'</span>'}).join('')+'</div>':'')+'</div>'}).join('')+
      (pen.length?'<div><p class="sec">罚则</p><p style="font-size:13.5px">'+esc(pen[0].split('\n').slice(1).join(' '))+'</p></div>':'')+
      (cs.length?'<div><p class="sec">相关处罚案例</p><div class="dcases">'+cs.map(caseLine).join('')+'</div></div>':'')+'</div>');
  });
  if(!found)parts.push('<p class="notice warn">知识库里没有找到这条依据的原文，可能是 AI 引用了知识库以外的规定，建议人工核对。</p><p style="font-size:13.5px">AI 给出的依据：'+esc(text)+'</p>');
  openDrawer('依据详情',parts.join('<hr style="border:0;border-top:1px dashed var(--line);margin:4px 0">')+'<p class="src">来源：《中华人民共和国广告法》（2021 修正，国家市场监督管理总局官网）及本项目整理的法规要点。仅供参考，以官方文本为准。</p>');
}
function openCase(id){
  var c=CASE[id];if(!c)return;
  openDrawer('处罚案例',
    '<div><p class="sec">当事人</p><h3>'+esc(c.party)+'</h3><p class="muted" style="font-size:13.5px">'+esc(c.ind)+' · '+esc(c.product)+'</p></div>'+
    '<div><p class="sec">违规表述原文</p><div class="orig">'+esc(c.words)+'</div></div>'+
    '<div><p class="sec">违规类型</p><div class="words">'+String(c.type).split(/[;；]/).filter(Boolean).map(function(t){return '<span class="chip bad">'+esc(t)+'</span>'}).join('')+'</div></div>'+
    '<div><p class="sec">处罚结果</p><p>'+esc(c.penalty)+' · '+esc(c.org)+'</p></div>'+
    '<div><p class="sec">推定条款（官方通报未列条款号，需核对）</p><p><button class="law" data-law="'+esc(c.art)+'">'+esc(c.art)+' ›</button></p></div>'+
    '<p class="src">来源：<a href="'+esc(c.link)+'" target="_blank" rel="noopener">'+esc(c.source)+'</a></p>');
}
document.addEventListener('click',function(e){
  var l=e.target.closest('[data-law]');if(l){e.preventDefault();openLaw(l.dataset.law);return}
  var c=e.target.closest('[data-case]');if(c){e.preventDefault();openCase(c.dataset.case)}
});
$('#d-close').addEventListener('click',closeDrawer);$('#scrim').addEventListener('click',closeDrawer);
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer()});

/* ---------- 审核结果 ---------- */
function highlight(text,vios){
  var t=esc(text||'');
  var parts=(vios||[]).map(function(v){return esc(v.text||'').trim()}).filter(function(s){return s.length>=2&&t.indexOf(s)>=0}).sort(function(a,b){return b.length-a.length});
  var done={};parts.forEach(function(p){if(done[p])return;done[p]=1;t=t.split(p).join('\u0001'+p+'\u0002')});
  return t.replace(/\u0001/g,'<em>').replace(/\u0002/g,'</em>').replace(/<em>([^<]*)<em>/g,'<em>$1').replace(/<\/em>([^<]*)<\/em>/g,'$1</em>');
}
function mediaHtml(r){
  if(r.frames&&r.frames.length)return '<span class="frames">'+r.frames.map(function(f){return '<img src="'+f+'" alt="视频画面">'}).join('')+'</span>';
  var img=r.imgData||r.img;return img?'<img src="'+esc(img)+'" alt="呈上的图片">':'';
}
function resultHtml(id,opts){
  var r=results[id];if(!r)return '';var ai=r.ai,isR=routed(id),d=decisions[id]||{};opts=opts||{};
  var flags=(r.flags||[]).concat(d.routed?['审核人手动转入']:[]);
  var route=isR?'<div class="route-box hand"><b>已转人工复核</b><div style="display:flex;gap:6px;flex-wrap:wrap">'+flags.map(function(f){return '<span class="chip dai">'+esc(f)+'</span>'}).join('')+'</div></div>'
    :'<div class="route-box auto">'+(ai.is_violation?'AI 判定违规，已自动拦下，需修改后再呈上。':'AI 判定合规，已自动放行。')+'如有疑问，可以转人工复核。</div>';
  var vios=ai.violations.map(function(v,i){return '<div class="vio" style="animation-delay:'+(0.15+i*0.12)+'s"><div class="q">「'+esc(v.text)+'」 <span class="chip bad">'+esc(TN[v.type]||'待确认类型')+'</span></div><dl><dt>依据</dt><dd><button class="law" data-law="'+esc(v.law)+'">'+esc(v.law)+' ›</button></dd><dt>理由</dt><dd>'+esc(clean(v.reason))+'</dd><dt>改为</dt><dd class="fix">'+esc(clean(v.suggestion))+'</dd></dl></div>'}).join('');
  var cs=(ai.cases||[]).map(function(i){return CASE[i]}).filter(Boolean);
  var cases=cs.length?'<div class="cases"><h3>相似处罚案例</h3>'+cs.map(function(c){return '<div class="case"><b>'+esc(c.party)+'</b> · '+esc(c.product)+'<br>'+esc(c.penalty)+' · <button class="law" data-case="'+esc(c.id)+'">查看案例 ›</button></div>'}).join('')+'</div>':'';
  var dec;
  if(opts.decide){
    dec='<div class="decide"><h3>人工复核结论</h3><div class="acts"><button type="button" class="btn pass" data-act="pass" data-id="'+esc(id)+'" aria-pressed="'+(d.decision==='pass')+'">✓ 通过，可以发布</button><button type="button" class="btn fail" data-act="fail" data-id="'+esc(id)+'" aria-pressed="'+(d.decision==='fail')+'">✕ 不通过，需要修改</button></div>'+
      '<textarea id="note-'+esc(id)+'" data-note="'+esc(id)+'" rows="2" placeholder="复核意见（可选）：哪里有问题、应该怎么改">'+esc(d.note||'')+'</textarea>'+
      (decided(id)?'<p class="decided">'+(d.at?fmt(d.at)+' · ':'')+(overturned(id)?'<b class="over">推翻了 AI 结论</b>':'<b class="agree">与 AI 结论一致</b>')+'</p>':'')+'</div>';
  } else if(!isR&&!decided(id)){
    dec='<div class="acts"><button type="button" class="btn route" data-act="route" data-id="'+esc(id)+'">转人工复核</button></div>';
  } else if(isR&&!decided(id)){
    dec='<div class="acts"><button type="button" class="btn route" data-goq="'+esc(id)+'">去复核 ›</button></div>';
  } else {
    dec='<p class="decided">人工复核：<b>'+(d.decision==='pass'?'通过，可以发布':'不通过，需要修改')+'</b>'+(d.note?' · '+esc(d.note):'')+'</p>';
  }
  var body=r.text?highlight(r.text,ai.violations):'';
  if(r.desc)body+='<span class="sub">'+esc(r.desc)+'</span>';
  if(r.transcript)body+='<span class="sub">口播 / 字幕：'+highlight(r.transcript,ai.violations)+'</span>';
  if(ai.image_text)body+='<span class="sub">画面识别：'+esc(clean(ai.image_text))+'</span>';
  return '<div class="res'+(opts.anim&&!reduce?' anim':'')+'"><div class="verdict"><span class="vstamp'+(ai.is_violation?'':' ok')+'">'+(ai.is_violation?'违规':'合规')+'</span>'+
    (ai.is_violation?'<span class="chip '+(ai.risk==='高'?'bad':'warn')+'">风险'+esc(ai.risk)+' · '+ai.violations.length+' 处</span>':'')+
    '<span class="chip">'+esc(r.industry)+'</span><span class="chip">'+esc(r.kind)+'</span><span class="chip">'+esc(srcLabel(r))+'</span>'+(r.at?'<span class="chip mono">'+fmt(r.at)+'</span>':'')+'</div>'+
    (ai.summary?'<p>'+esc(clean(ai.summary))+'</p>':'')+route+
    '<div class="copy">'+mediaHtml(r)+(body||'<span class="muted">（无文字）</span>')+'</div>'+vios+cases+dec+'</div>';
}

/* ---------- 呈上素材 ---------- */
var ind='美妆', mode='text', imgSend='', imgThumb='', frames=[], busy=false;
function pick(group,fn){$$(group+' button').forEach(function(b){b.addEventListener('click',function(){$$(group+' button').forEach(function(x){x.setAttribute('aria-pressed',x===b)});fn(b.dataset.v)})})}
pick('#f-ind',function(v){ind=v;sIdx=-1;$('#f-text').placeholder=HINT[v];$('#f-sample').textContent='填入示例'});
pick('#f-mode',function(v){mode=v;$('#fld-img').hidden=v!=='image';$('#fld-video').hidden=v!=='video';$('#lbl-text').textContent=v==='text'?'种草文案':'配套文案（可选）'});
$('#f-text').addEventListener('input',function(){$('#f-count').textContent=$('#f-text').value.length});
var SAMPLES={
  美妆:['这款精华真的绝了！全网最好用，7天祛痘印，敏感肌也能放心用，无效退款！',
    '医学级修护面霜，专治烂脸，三天退红，皮肤科医生都在推荐',
    '国货之光美白精华，一抹白一度，彻底淡化斑点，比某大牌好用十倍',
    '天然植物配方零添加，孕妇儿童都能用，坚持用一个月头发再也不掉了',
    '这支口红上嘴很显白，质地顺滑不拔干，我连续涂了一个月没起皮（个人体验，仅供参考）'],
  食品:['宝妈们必囤的DHA藻油，孩子考试提分全靠它，点击链接下单立减10元',
    '这款酵素一天一杯，排毒刮油，一个月瘦十斤，比吃药还管用',
    '每天两颗益生菌软糖，肠道问题全解决，还能增强免疫力、预防感冒',
    '百年老字号祖传秘方阿胶糕，补气养血，降三高，中老年人的首选',
    '0蔗糖酸奶，配料表很干净，口感偏酸，早餐配燕麦很顶饱']};
var HINT={美妆:'粘贴要发布的标题和正文，例如：这款精华真的绝了！全网最好用，7天祛痘印……',食品:'粘贴要发布的标题和正文，例如：这款酵素一天一杯，排毒刮油，一个月瘦十斤……'},sIdx=-1;
$('#f-sample').addEventListener('click',function(){var a=SAMPLES[ind];sIdx=(sIdx+1)%a.length;$('#f-text').value=a[sIdx];$('#f-count').textContent=$('#f-text').value.length;this.textContent='换一条示例（'+(sIdx+1)+'/'+a.length+'）'});
$('#f-clear').addEventListener('click',function(){$('#f-text').value='';$('#f-count').textContent='0';$('#f-transcript').value='';setImg(null);setVideo(null)});
function canvasOf(src,max){var W=src.videoWidth||src.width,H=src.videoHeight||src.height,s=Math.min(1,max/Math.max(W,H)),c=document.createElement('canvas');c.width=Math.round(W*s);c.height=Math.round(H*s);c.getContext('2d').drawImage(src,0,0,c.width,c.height);return c}
var IMG_TXT='点击选择或拖入一张图片（JPG / PNG / WebP），AI 会读取图中文字和画面里的宣称元素',VID_TXT='点击选择或拖入一段视频（MP4 / MOV / WebM）。页面会在你的浏览器里截取 6 个关键画面，视频本身不会上传';
function setImg(file){
  imgSend='';imgThumb='';$('#f-prev').hidden=true;$('#f-imgtxt').textContent=IMG_TXT;if(!file){$('#f-img').value='';return}
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)){$('#f-imgtxt').textContent='请选择 JPG、PNG 或 WebP 图片';return}
  var url=URL.createObjectURL(file),im=new Image();
  im.onload=function(){imgSend=canvasOf(im,1280).toDataURL('image/jpeg',0.85);imgThumb=canvasOf(im,360).toDataURL('image/jpeg',0.72);$('#f-prev').src=imgThumb;$('#f-prev').hidden=false;URL.revokeObjectURL(url)};
  im.onerror=function(){$('#f-imgtxt').textContent='这张图片读不出来，请换一张'};im.src=url;$('#f-imgtxt').textContent=file.name;
}
function setVideo(file){
  frames=[];$('#f-frames').innerHTML='';$('#f-vidtxt').textContent=VID_TXT;if(!file){$('#f-video').value='';return}
  var url=URL.createObjectURL(file),v=document.createElement('video');v.muted=true;v.preload='auto';v.playsInline=true;
  $('#f-vidtxt').textContent='正在截取画面…';
  v.onloadedmetadata=function(){
    var dur=v.duration;if(!isFinite(dur)||dur<=0){$('#f-vidtxt').textContent='读不出视频时长，请换一个文件';return}
    var times=[0.05,0.2,0.35,0.5,0.7,0.9].map(function(p){return Math.min(dur-0.05,Math.max(0,dur*p))}),i=0,out=[];
    function next(){if(i>=times.length){frames=out;$('#f-frames').innerHTML=out.map(function(f){return '<img src="'+f+'" alt="视频画面">'}).join('');$('#f-vidtxt').textContent=file.name+' · 时长 '+Math.round(dur)+' 秒，已截取 '+out.length+' 个画面';URL.revokeObjectURL(url);return}v.currentTime=times[i++]}
    v.onseeked=function(){try{out.push(canvasOf(v,768).toDataURL('image/jpeg',0.75))}catch(e){}next()};next();
  };
  v.onerror=function(){$('#f-vidtxt').textContent='浏览器无法读取这个视频格式，建议转成 MP4 后再试'};v.src=url;
}
$('#f-img').addEventListener('change',function(e){setImg(e.target.files[0])});
$('#f-video').addEventListener('change',function(e){setVideo(e.target.files[0])});
[['#drop-img',setImg],['#drop-video',setVideo]].forEach(function(p){var el=$(p[0]);
  ['dragenter','dragover'].forEach(function(t){el.addEventListener(t,function(e){e.preventDefault();el.classList.add('over')})});
  ['dragleave','drop'].forEach(function(t){el.addEventListener(t,function(e){e.preventDefault();el.classList.remove('over')})});
  el.addEventListener('drop',function(e){var f=e.dataTransfer.files[0];if(f)p[1](f)})});

function api(path,body){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return {ok:false,message:'服务器没有返回结果（'+r.status+'）'}})})}
var STEPS=['研墨，读取素材','比对法规要点 27 条','检索处罚案例 33 例','逐句审读，标出风险','拟写修改建议'];
function waitHtml(steps){return '<div class="wait"><svg class="enso" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 12 C76 12 90 32 88 52 C86 76 66 90 46 88 C24 86 10 68 12 48 C14 30 28 16 44 13"/></svg><div class="step" aria-live="polite"><span>'+steps[0]+'</span></div><div class="dots"><i></i><i></i><i></i></div></div>'}
function cycle(el,steps){var i=0;return setInterval(function(){var s=el.querySelector('.step');if(!s)return;i=(i+1)%steps.length;s.innerHTML='<span>'+steps[i]+'</span>'},1400)}
$('#f-review').addEventListener('submit',function(e){
  e.preventDefault();if(busy)return;
  var text=$('#f-text').value.trim(),transcript=$('#f-transcript').value.trim(),body={industry:ind,text:text};
  if(mode==='image'){if(!imgSend){$('#r-panel').innerHTML='<p class="notice warn">请先选择一张图片。</p>';return}body.images=[imgSend]}
  if(mode==='video'){if(!frames.length&&!transcript){$('#r-panel').innerHTML='<p class="notice warn">请先选择视频，或填写口播文字。</p>';return}body.images=frames;body.video={transcript:transcript}}
  if(mode==='text'&&!text){$('#r-panel').innerHTML='<p class="notice warn">请先填写文案。</p>';return}
  busy=true;$('#f-submit').disabled=true;
  var steps=mode==='image'?['识读图中文字与画面'].concat(STEPS.slice(1)):mode==='video'?['逐帧查看视频画面'].concat(STEPS.slice(1)):STEPS;
  $('#r-panel').innerHTML=waitHtml(steps);var tm=cycle($('#r-panel'),steps);
  if(window.innerWidth<900)$('#r-panel').scrollIntoView({block:'start',behavior:reduce?'auto':'smooth'});
  var kind={text:'文案',image:'图片',video:'视频'}[mode],snapImg=imgThumb,snapFrames=frames.slice(),industry=ind,m=mode;
  api('/api/review',body).then(function(res){
    if(!res.ok){$('#r-panel').innerHTML='<p class="notice warn">'+esc(res.message||'审核没有完成，请稍后重试。')+'</p>';return}
    var ai=res.result,id='S'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    var fr=m==='video'?snapFrames:[];if(fr.length>3)fr=[fr[0],fr[2],fr[fr.length-1]];
    var rec={id:id,kind:kind,industry:industry,text:text,transcript:m==='video'?transcript:'',imgData:m==='image'?snapImg:'',frames:fr,ai:ai,flags:routeFlags(text+' '+transcript+' '+ai.image_text,kind,ai),src:'我提交的',at:new Date().toISOString()};
    mine[id]=rec;Object.keys(mine).sort(function(a,b){return String(mine[b].at).localeCompare(String(mine[a].at))}).slice(100).forEach(function(k){delete mine[k]});
    store(LS_REC,mine);results[id]=rec;cur=id;curFresh=true;status.used++;showQuota();refresh();curFresh=false;
  }).catch(function(){$('#r-panel').innerHTML='<p class="notice warn">网络出错了，请检查网络后重试。</p>'}).then(function(){clearInterval(tm);busy=false;$('#f-submit').disabled=!status.ready});
});
function renderPanel(){if(cur&&results[cur])$('#r-panel').innerHTML=resultHtml(cur,{anim:curFresh})}
function renderRecent(){
  var ids=sorted().filter(function(i){return isMine(results[i])}).slice(0,6);
  $('#recent').innerHTML=ids.length?ids.map(function(i){var r=results[i],st=stateOf(i);return '<button type="button" class="row-item" data-open="'+esc(i)+'"><span class="mini'+(r.ai.is_violation?'':' ok')+'">'+(r.ai.is_violation?'违规':'合规')+'</span><span class="t">'+esc(r.text||r.transcript||('（'+r.kind+'素材）'))+'</span><span class="chip'+(st==='wait'?' dai':'')+'">'+{wait:'待复核',done:'已复核',auto:'AI 已处理'}[st]+'</span></button>'}).join(''):'<p class="muted" style="font-size:13.5px">还没有呈上过素材。审核记录只保存在你自己的浏览器里。</p>';
}

/* ---------- 复核结论 ---------- */
var timers={};function saveDec(){store(LS_DEC,decisions)}
document.addEventListener('click',function(e){
  var o=e.target.closest('[data-open]');if(o){cur=o.dataset.open;if(view!=='review')show('review');renderPanel();$('#r-panel').scrollIntoView({block:'start'});return}
  var g=e.target.closest('[data-goq]');if(g){qSel=g.dataset.goq;show('queue');return}
  var b=e.target.closest('button[data-act]');if(!b)return;
  var id=b.dataset.id,act=b.dataset.act,c=Object.assign({},decisions[id]||{});
  if(act==='route')c.routed=true;else c.decision=c.decision===act?'':act;
  c.at=new Date().toISOString();decisions[id]=c;saveDec();
  if(view==='queue'&&act!=='route'&&c.decision){var nxt=queueIds().filter(function(x){return x!==id})[0];qSel=nxt||id}
  refresh();
});
document.addEventListener('input',function(e){var id=e.target.dataset&&e.target.dataset.note;if(!id)return;decisions[id]=Object.assign({},decisions[id]||{},{note:e.target.value});clearTimeout(timers[id]);timers[id]=setTimeout(saveDec,500)});

/* ---------- 人工复核 ---------- */
function srcMatch(r,v){return !v||(v==='mine'?isMine(r):!isMine(r))}
function queueIds(){
  var ind=$('#q-ind').value,src=$('#q-src').value,q=$('#q-q').value.trim().toLowerCase();
  return sorted().filter(function(i){var r=results[i];if(stateOf(i)!=='wait')return false;if(ind&&r.industry!==ind)return false;if(!srcMatch(r,src))return false;
    if(q){var h=(r.text+' '+(r.desc||'')+' '+r.ai.violations.map(function(v){return v.text}).join(' ')).toLowerCase();if(h.indexOf(q)<0)return false}return true});
}
var lastQ=null;
function renderQueue(){
  var ids=queueIds();if(!qSel||(ids.indexOf(qSel)<0&&!(results[qSel]&&decided(qSel))))qSel=ids[0]||null;
  $('#q-list').innerHTML=ids.length?ids.map(function(i){var r=results[i];return '<button type="button" class="qitem" role="listitem" data-q="'+esc(i)+'" aria-current="'+(i===qSel)+'"><span class="m"><span class="mini'+(r.ai.is_violation?'':' ok')+'">'+(r.ai.is_violation?'违规':'合规')+'</span><span class="chip">'+esc(r.industry)+'</span><span class="chip">'+esc(r.kind)+'</span>'+(isMine(r)?'<span class="chip mono">'+fmt(r.at)+'</span>':'<span class="chip">'+esc(srcLabel(r))+'</span>')+'</span><span class="t">'+esc(r.text||r.desc||r.transcript||'（'+r.kind+'素材）')+'</span><span class="m">'+(r.flags||[]).slice(0,2).map(function(f){return '<span class="chip dai">'+esc(f)+'</span>'}).join('')+'</span></button>'}).join(''):'<div class="card empty"><span class="mark">毕</span>没有待复核的素材。</div>';
  var ae=document.activeElement,fid=ae&&ae.id,caret=ae&&ae.tagName==='TEXTAREA'?[ae.selectionStart,ae.selectionEnd]:null;
  $('#q-detail').innerHTML=qSel&&results[qSel]?resultHtml(qSel,{decide:true,anim:qSel!==lastQ}):'<div class="empty"><span class="mark">毕</span>全部复核完了。</div>';lastQ=qSel;
  var fe=fid&&document.getElementById(fid);if(fe&&fe.closest('#q-detail')){fe.focus();if(caret)fe.setSelectionRange(caret[0],caret[1])}
}
$('#q-list').addEventListener('click',function(e){var b=e.target.closest('[data-q]');if(!b)return;qSel=b.dataset.q;renderQueue();if(window.innerWidth<900)$('#q-detail').scrollIntoView({block:'start'})});
['#q-ind','#q-src'].forEach(function(s){$(s).addEventListener('change',renderQueue)});$('#q-q').addEventListener('input',renderQueue);

/* ---------- 审核记录 ---------- */
function recIds(){
  var st=$('#r-st').value,ai=$('#r-ai').value,src=$('#r-src').value,q=$('#r-q').value.trim().toLowerCase();
  return sorted().filter(function(i){var r=results[i];if(st&&stateOf(i)!==st)return false;if(ai&&String(+!!r.ai.is_violation)!==ai)return false;if(!srcMatch(r,src))return false;
    if(q){var h=(r.text+' '+(r.desc||'')+' '+r.ai.violations.map(function(v){return v.text+' '+v.law}).join(' ')+' '+((decisions[i]||{}).note||'')).toLowerCase();if(h.indexOf(q)<0)return false}return true});
}
function counts(){var c={all:0,wait:0,done:0,auto:0,over:0};Object.keys(results).forEach(function(i){c.all++;c[stateOf(i)]++;if(overturned(i))c.over++});
  $('#n-queue').textContent=c.wait||'';$('#s-all').textContent=c.all;$('#s-wait').textContent=c.wait;$('#s-done').textContent=c.done;$('#s-over').textContent=c.over}
function renderRecords(){
  counts();var ids=recIds();$('#r-count').textContent='共 '+ids.length+' 条';
  $('#r-body').innerHTML=ids.length?ids.map(function(i){var r=results[i],d=decisions[i]||{},st=stateOf(i);
    return '<tr data-rec="'+esc(i)+'"><td class="mono" style="white-space:nowrap">'+(isMine(r)?fmt(r.at):'<span class="muted">'+esc(srcLabel(r))+'</span>')+'</td><td>'+esc(r.industry)+'</td><td class="txt">'+esc(r.text||r.desc||r.transcript||'（'+r.kind+'素材）')+'</td><td><span class="mini'+(r.ai.is_violation?'':' ok')+'">'+(r.ai.is_violation?'违规':'合规')+'</span></td><td><span class="chip'+(st==='wait'?' dai':'')+'">'+{wait:'待人工复核',done:'已人工复核',auto:'AI 自动处理'}[st]+'</span></td><td>'+(decided(i)?(d.decision==='pass'?'通过':'不通过')+(overturned(i)?' <span class="chip bad">推翻 AI</span>':''):'<span class="muted">—</span>')+'</td></tr>'}).join(''):'<tr><td colspan="6" class="empty">没有符合条件的记录。</td></tr>';
}
['#r-st','#r-ai','#r-src'].forEach(function(s){$(s).addEventListener('change',renderRecords)});$('#r-q').addEventListener('input',renderRecords);
$('#r-body').addEventListener('click',function(e){var tr=e.target.closest('[data-rec]');if(!tr)return;var id=tr.dataset.rec;if(stateOf(id)==='wait'){qSel=id;show('queue')}else{cur=id;show('review');renderPanel()}});
function csvCell(v){v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
$('#rec-export').addEventListener('click',function(){
  var rows=[['时间','来源','行业','素材类型','素材','AI结论','风险等级','违规类型','转人工原因','状态','人工结论','是否推翻AI','复核意见']];
  recIds().forEach(function(i){var r=results[i],d=decisions[i]||{};rows.push([r.at||'',srcLabel(r),r.industry,r.kind,r.text||r.desc||r.transcript,r.ai.is_violation?'违规':'合规',r.ai.risk,r.ai.violations.map(function(v){return TN[v.type]||''}).join('、'),(r.flags||[]).concat(d.routed?['手动转入']:[]).join('；'),{wait:'待人工复核',done:'已人工复核',auto:'AI自动处理'}[stateOf(i)],d.decision==='pass'?'通过':d.decision==='fail'?'不通过':'',decided(i)?(overturned(i)?'是':'否'):'',d.note||''])});
  var blob=new Blob(['﻿'+rows.map(function(r){return r.map(csvCell).join(',')}).join('\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='审核记录.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500);
});
$('#rec-reset').addEventListener('click',function(){
  var b=$('#rec-reset');if(b.dataset.confirm!=='1'){b.dataset.confirm='1';b.textContent='再点一次确认清除';setTimeout(function(){b.dataset.confirm='';b.textContent='清除我的记录'},4000);return}
  Object.keys(mine).forEach(function(k){delete results[k]});mine={};decisions={};store(LS_REC,mine);store(LS_DEC,decisions);b.dataset.confirm='';b.textContent='清除我的记录';cur=null;refresh();renderRecords();
  $('#r-panel').innerHTML='<div class="empty"><span class="mark">审</span>记录已清除。</div>';
});

/* ---------- 法务问答 ---------- */
var turns=[],asking=false;
function renderAnswer(text){
  var used=[],dropped=0;
  var t=esc(clean(text)).replace(/\[(C\d{3})\]/g,function(m,id){if(CASE[id]){if(used.indexOf(id)<0)used.push(id);return '<sup class="mono">['+(used.indexOf(id)+1)+']</sup>'}dropped++;return ''});
  t=t.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/^#{1,4}\s*/gm,'');
  var html=t.split(/\n{2,}/).map(function(p){var lines=p.split('\n');if(lines.every(function(l){return /^\s*([-*•]|\d+[.、])\s+/.test(l)||!l.trim()}))return '<ul>'+lines.filter(function(l){return l.trim()}).map(function(l){return '<li>'+l.replace(/^\s*([-*•]|\d+[.、])\s+/,'')+'</li>'}).join('')+'</ul>';return '<p>'+lines.join('<br>')+'</p>'}).join('');
  html+=used.map(function(id,i){var c=CASE[id];return '<div class="cite">['+(i+1)+'] '+esc(c.party)+' · '+esc(c.penalty)+' · <button class="law" data-case="'+esc(c.id)+'">查看案例 ›</button></div>'}).join('');
  if(dropped)html+='<div class="cite">已移除 '+dropped+' 处无法在案例库中核实的案例引用。</div>';
  return html;
}
function addMsg(who,html){var d=document.createElement('div');d.className='msg '+who;d.innerHTML=html;$('#qa-msgs').appendChild(d);scrollChat();return d}
function scrollChat(){var m=$('#qa-msgs');m.scrollTop=m.scrollHeight}
var QSTEPS=['查阅《广告法》条文','比对法规要点','检索处罚案例','组织回答'];
function ask(q){
  q=q.trim();if(!q||asking)return;
  addMsg('me',esc(q).replace(/\n/g,'<br>'));
  var bubble=addMsg('ai',waitHtml(QSTEPS)),tm=cycle(bubble,QSTEPS);
  asking=true;$('#qa-send').disabled=true;
  api('/api/qa',{question:q,history:turns.slice(-6)}).then(function(res){
    if(!res.ok){bubble.innerHTML='<p class="notice warn">'+esc(res.message||'回答没有完成，请稍后重试。')+'</p>';return}
    bubble.innerHTML=renderAnswer(res.answer);turns.push({role:'user',content:q});turns.push({role:'assistant',content:res.answer});status.used++;showQuota();
  }).catch(function(){bubble.innerHTML='<p class="notice warn">网络出错了，请检查网络后重试。</p>'}).then(function(){clearInterval(tm);asking=false;$('#qa-send').disabled=!status.ready;scrollChat()});
}
$('#qa-form').addEventListener('submit',function(e){e.preventDefault();var v=$('#qa-in').value;$('#qa-in').value='';ask(v)});
$('#qa-in').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#qa-form').requestSubmit()}});
$('#qa-suggest').addEventListener('click',function(e){var b=e.target.closest('button');if(b)ask(b.textContent)});

/* ---------- 启动 ---------- */
function showQuota(){if(!status.ready){$('#quota').textContent='';return}$('#quota').textContent=status.mock?'本地示例模式':(status.limited?'今天还可审核 / 提问 '+Math.max(0,status.perDay-status.used)+' 次':'')}
function refresh(){counts();renderRecent();if(view==='review')renderPanel();if(view==='queue')renderQueue();if(view==='records')renderRecords()}
renderRecent();
fetch('kb.json').then(function(r){return r.json()}).then(function(kb){
  KB=kb;KB.cases.forEach(function(c){CASE[c.id]=c});Object.keys(mine).forEach(function(k){results[k]=mine[k]});refresh();
}).catch(function(){note('法规数据加载失败，请刷新页面。')});
fetch('/api/status').then(function(r){return r.json()}).then(function(s){status=s;
  if(!s.ready){$('#ai-note').textContent='站点还没有配置模型，暂时不能审核新素材，请稍后再来。';$('#ai-note').className='notice warn';$('#f-submit').disabled=true;$('#qa-send').disabled=true}
  showQuota();
}).catch(function(){$('#ai-note').textContent='连不上审核服务，暂时不能审核新素材，请检查网络后刷新。';$('#ai-note').className='notice warn';$('#f-submit').disabled=true;$('#qa-send').disabled=true});
})();
