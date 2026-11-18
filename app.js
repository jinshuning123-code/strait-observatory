const $=id=>document.getElementById(id);
const esc=v=>String(v??'报告未说明').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const D=window.DATA,colors={'单一来源已核对':'#147d81','多源比对完成':'#4975c4','存在未解决冲突':'#dc8737','自动提取待复核':'#8b6ca9'};
const located=e=>typeof e.latitude==='number'&&typeof e.longitude==='number'&&Math.abs(e.latitude)<=90&&Math.abs(e.longitude)<=180;
const ids=v=>String(v??'').split(/[;；,，\s]+/).filter(Boolean);
let map,group,visible=[],markers={},selectedId=null;
function field(k,v){return `<div class="field"><span>${esc(k)}</span><span>${esc(v)}</span></div>`}
function safeLink(url,label){return /^https?:\/\//.test(url||'')?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:`<span>${esc(label)} · 无链接</span>`}
function switchTab(name){
 ['events','detail','analysis','data'].forEach(n=>{$('tab-'+n).setAttribute('aria-selected',String(n===name));$('tab-'+n).tabIndex=n===name?0:-1;$(n+'-panel').hidden=n!==name;});
 const panel=$(name+'-panel');panel.classList.remove('fade-in');void panel.offsetWidth;panel.classList.add('fade-in');document.querySelector('.panel-scroll').scrollTop=0;
}
function markSelection(){
 document.querySelectorAll('.event').forEach(b=>b.classList.toggle('active',b.dataset.id===selectedId));
 Object.entries(markers).forEach(([id,m])=>m.getElement()?.classList.toggle('is-selected',id===selectedId));
}
function detail(e){
 selectedId=e.event_id;const records=D.records.filter(r=>ids(e.record_ids).includes(r.record_id)||r.event_id===e.event_id),audit=window.CASE_AUDIT?.cases.find(c=>c.event_id===e.event_id),brief=records.find(r=>r['中文转述']);
 const checks=D.checks.filter(c=>new RegExp('(^|[^A-Z0-9])'+e.event_id+'([^0-9]|$)').test(c['关联record_id或event_id']||''));
 const summaries={'EVT252':'多份报告都描述这艘船发生登轮事件，但日期存在差异。是否为同一次事件，仍需继续核对。','EVT251':'报告提到船员受伤并接受医疗处理，但两条来源对受伤经过的描述不同。','AUTO-d510315a29298584':'报告记载拖驳船航行时发生废金属失窃，未报告船员受伤。两份资料中的拖船名称不同，尚待核对。'};
 const summary=summaries[e.event_id]||brief?.['中文转述'];
 $('detail').hidden=false;$('empty-selection').hidden=true;$('selection-dot').hidden=false;
 $('detail').innerHTML=`<button class="back-button" id="back-events">‹ 返回事件列表</button><p class="overline">事件编号 ${esc(e.event_id)}</p><h2>${esc(e.ship_name)}</h2><span class="tag"><i style="background:${colors[e.verification_status]||'#7c8b99'}"></i>${esc(window.uiStatus?uiStatus(e.verification_status):e.verification_status)}</span>${summary?`<div class="event-brief"><p>${esc(summary)}</p><span class="brief-source">根据已保存的报告整理，具体说法见下方原文。</span></div>`:''}<div class="event-quick-actions"><a href="reconstruction-report.html?event_id=${encodeURIComponent(e.event_id)}">AI重建事件经过 →</a><a href="event-ai.html?event_id=${encodeURIComponent(e.event_id)}">让AI整理这件事 →</a>${e.event_id==='EVT252'?'<a href="case-taz.html">阅读完整调查 →</a>':''}${audit?`<a href="research.html?audit=${encodeURIComponent(e.event_id)}#audit-panel">对照不同报告 →</a>`:''}</div>${qualityCard(e.event_id)}${field('发生日期',e.date)}${field('报告中的时间',(e.time??'报告未说明')+' / '+(e.timezone??'时区未说明'))}${field('报告中的位置',e.location_text)}${field('坐标',located(e)?`${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}`:'还缺完整坐标，暂未在地图上标点')}<details class="record-extra"><summary>更多事件信息</summary>${field('事件类型',e.event_types)}${field('财物记录',e.loss)}${field('伤情记录',e.injury)}${field('位置精度',e.position_precision)}${field('坐标采用的标准',e.coordinate_crs)}<p class="report-intro">这些信息沿用原表，伤情和损失仍需与报告原文核对。</p></details><h3>报告里怎么记载？ <span class="muted">${records.length}条</span></h3><p class="report-intro">点开一份记录，查看经过、处置和原文。多份报告可能转引同一条消息。</p>${records.map((r,i)=>{
 const source=D.sources.find(s=>s.source_id===r.source_id),local=source?.local_material_id?'/api/material-file?id='+encodeURIComponent(source.local_material_id)+'#page='+(r['PDF页']||1):null;
 return `<details class="record"><summary>记录${i+1} · ${esc(source?.机构)}<small>${esc(source?.标题)}</small></summary><p>${esc(r['中文转述']||'这份记录尚未整理中文摘要，请查看原文。')}</p><h4>报告原文</h4><p lang="en">${esc(r['原文'])}</p>${field('原文中的财物情况',r['原文损失'])}${field('原文中的人员情况',r['原文伤害'])}${field('报告中的处置',r['原文处置'])}<p>${local?`<a href="${esc(local)}" target="_blank" rel="noopener">打开这份报告 ↗</a>`:safeLink(source?.URL,'打开这份报告')}</p><details class="record-extra"><summary>报告页码、日期与记录编号</summary>${field('PDF页码',r['PDF页'])}${field('报告条目',r.original_incident_no)}${field('发布日期',source?.['发布日'])}${field('访问日期',source?.['访问日'])}${field('上游消息来源',source?.['上游来源'])}${field('记录编号',r.record_id)}${field('证据编号',r.evidence_id)}${field('原始时间',r['原始时间（原文）'])}${field('原始坐标',r.coordinates_raw)}</details></details>`;}).join('')||'<p class="report-intro">还没有关联到报告原文。</p>'}${checks.length?`<details class="case-note"><summary>此前怎样核对过？（${checks.length}条记录）</summary>${checks.map(c=>`<details class="record"><summary>${esc(c['核验字段'])}</summary><p>${esc(c['各来源说法'])}</p><p>${esc(c['理由'])}</p>${field('还未解决',c['未解决问题'])}</details>`).join('')}</details>`:''}`;
 if(window.renderDossier)$('detail').insertAdjacentHTML('beforeend',`<details class="case-note"><summary>查看这件事的经过与其他解释</summary>${window.renderDossier(e)}</details>`);
 $('back-events').onclick=()=>switchTab('events');markSelection();switchTab('detail');
}
function select(e,zoom=true){
 detail(e);if(map&&located(e)&&zoom){const m=markers[e.event_id];if(m)group.zoomToShowLayer(m,()=>{map.panTo(m.getLatLng());markSelection();});}
}
function render(){
 const q=$('search').value.trim().toLowerCase();visible=D.events.filter(e=>($('excluded').checked||e.in_scope==='是')&&(!$('year').value||String(e.date).startsWith($('year').value))&&(!$('status').value||e.verification_status===$('status').value)&&(!q||[e.event_id,e.ship_name,e.location_text].join(' ').toLowerCase().includes(q))).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 $('count').textContent=visible.length;$('located').textContent=visible.filter(located).length;$('missing').textContent=visible.filter(e=>!located(e)).length;
 $('list-summary').textContent=`${visible.length} 条 · 日期倒序`;
 $('list').innerHTML=visible.map(e=>`<button class="event" data-id="${esc(e.event_id)}" aria-label="查看 ${esc(e.event_id)} ${esc(e.ship_name)}"><span class="dot" style="background:${colors[e.verification_status]||'#7c8b99'}"></span><span class="event-content"><strong>${esc(e.ship_name)}</strong><small>${esc(e.date)} · ${esc(e.event_id)}${located(e)?'':' · 坐标待补'}</small></span><span class="chevron" aria-hidden="true">›</span></button>`).join('')||'<p class="empty-result">没有匹配的事件。<br>请尝试其他关键词或重置筛选。</p>';
 $('list').querySelectorAll('button').forEach(b=>b.onclick=()=>select(visible.find(e=>e.event_id===b.dataset.id)));
 if(!map)return;group.clearLayers();markers={};visible.filter(located).forEach(e=>{
 const m=L.marker([e.latitude,e.longitude],{icon:L.divIcon({className:'pin',html:`<div style="background:${colors[e.verification_status]||'#7c8b99'}"></div>`,iconSize:[13,13],iconAnchor:[6,6]}),title:`${e.event_id} ${e.ship_name}`,alt:`查看 ${e.event_id} ${e.ship_name}`,keyboard:true}).bindTooltip(`<strong>${esc(e.ship_name)}</strong><br>${esc(e.date)} · ${esc(e.event_id)}`,{direction:'top',offset:[0,-8]});
 m.on('click',()=>detail(e));m.on('add',()=>{const el=m.getElement();if(el){el.setAttribute('role','button');el.setAttribute('aria-label',`地图事件 ${e.event_id} ${e.ship_name}`);el.classList.toggle('is-selected',e.event_id===selectedId);}});group.addLayer(m);markers[e.event_id]=m;
 });markSelection();
}
function viewPreset(name){document.querySelectorAll('.view-buttons button').forEach(b=>b.classList.toggle('selected',b.id===name));}
if(window.L&&L.markerClusterGroup){
 map=L.map('map',{zoomControl:false,attributionControl:true,minZoom:4,maxZoom:18}).fitBounds([[.65,98],[6.1,105.2]],{paddingTopLeft:[20,100],paddingBottomRight:[20,35],maxZoom:7});
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);let loaded=false;
 tiles.on('tileload',()=>{loaded=true;$('network').hidden=true});tiles.on('tileerror',()=>{if(!loaded)$('network').hidden=false});
 group=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:40,spiderfyOnMaxZoom:true,iconCreateFunction:c=>L.divIcon({className:'cluster',html:`<div>${c.getChildCount()}</div>`,iconSize:[36,36]})}).addTo(map);
 map.on('moveend zoomend',()=>{const p=map.getCenter();$('map-position').textContent=`${Math.abs(p.lat).toFixed(3)}° ${p.lat>=0?'N':'S'} · ${Math.abs(p.lng).toFixed(3)}° ${p.lng>=0?'E':'W'}`;$('zoom-label').textContent='Z'+String(map.getZoom()).padStart(2,'0');markSelection();});
 new ResizeObserver(()=>map.invalidateSize()).observe($('map'));
}else{$('network').hidden=false;$('network').textContent='地图组件未能加载，请使用右栏事件目录。'}
['events','detail','analysis','data'].forEach((name,i)=>{const b=$('tab-'+name);b.onclick=()=>switchTab(name);b.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const n=['events','detail','analysis','data'][(i+(e.key==='ArrowRight'?1:3))%4];switchTab(n);$('tab-'+n).focus();}})});
$('browse-events').onclick=()=>switchTab('events');
['search','year','status','excluded'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{render();}));
$('reset').onclick=()=>{$('search').value='';$('year').value='';$('status').value='';$('excluded').checked=false;selectedId=null;$('detail').hidden=true;$('empty-selection').hidden=false;$('selection-dot').hidden=true;render();switchTab('events');if(map)map.fitBounds([[.65,98],[6.1,105.2]],{paddingTopLeft:[20,100],paddingBottomRight:[20,35],maxZoom:7});viewPreset('overview')};
$('overview').onclick=()=>{if(map)map.fitBounds([[.65,98],[6.1,105.2]],{paddingTopLeft:[20,100],paddingBottomRight:[20,35],maxZoom:7});viewPreset('overview')};
$('focus').onclick=()=>{if(map)map.flyTo([1.15,103.8],10,{duration:.7});viewPreset('focus')};
$('fit').onclick=()=>{if(map&&group.getLayers().length)map.fitBounds(group.getBounds(),{padding:[50,60],maxZoom:12});viewPreset('fit')};
$('zoom-in').onclick=()=>{map?.zoomIn();viewPreset('')};$('zoom-out').onclick=()=>{map?.zoomOut();viewPreset('')};
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();switchTab('events');$('search').focus();}if(e.key==='Escape')switchTab('events');});
const dates=D.events.map(e=>String(e.date)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
$('data-summary').innerHTML=field('事件覆盖',dates[0]+' — '+dates.at(-1))+field('事件记录',D.events.length+' 条，含范围外记录')+field('原始记录',D.records.length+' 条')+field('核验条目',D.checks.length+' 条')+field('证据索引',D.evidence.length+' 条，附件尚待补齐');
$('source-count').textContent=D.sources.length+' 份';
$('sources').innerHTML=D.sources.map(s=>`<div class="source-item">${safeLink(s.URL,s['标题'])}<small>${esc(s.source_id)} · ${esc(s['机构'])}<br>发布日期 ${esc(s['发布日'])} · 访问 ${esc(s['访问日'])}</small></div>`).join('');
[...new Set(D.events.map(e=>e.date?.slice(0,4)).filter(Boolean))].sort().forEach(y=>{if(![...$('year').options].some(o=>o.value===y))$('year').add(new Option(y,y));});switchTab('events');render();
const linkedEvent=D.events.find(e=>e.event_id===new URLSearchParams(location.search).get('event_id'));if(linkedEvent){if(linkedEvent.in_scope!=='是'){$('excluded').checked=true;render();}select(linkedEvent);}
