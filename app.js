const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const me = '徐小明';
const storageKey = 'df-export-prototype-v1';
const activeStates = ['排队中','处理中','取消中'];
const dateNow = () => new Date().toLocaleString('sv-SE', {timeZone:'Asia/Shanghai'});
const number = value => Number(value).toLocaleString('en-US');
const seed = [
  ['双11预热订单明细','处理中',12860,72,'11-02 15:30:12',me],
  ['华东店群待发货订单','成功',8420,100,'11-02 14:52:41',me],
  ['泰国旗舰店履约数据','排队中',3520,0,'11-02 14:45:08',me],
  ['10月订单经营复盘','失败',23106,0,'11-02 11:45:36',me],
  ['马来西亚站订单核对','成功',1506,100,'11-01 18:06:03',me],
  ['异常订单排查','已取消',618,0,'11-01 16:22:19',me],
  ['10月月末订单明细','成功',17922,100,'10-31 17:50:21',me],
  ['历史订单归档','已过期',26350,100,'10-24 10:12:44',me],
  ['国庆活动订单导出','已清理',6500,100,'10-29 09:20:15',me],
  ['空结果核验','成功',0,100,'11-01 09:13:15',me],
  ['东南亚店群发货明细','成功',12540,100,'11-02 13:20:08','陈小雨'],
  ['泰国订单核查','处理中',23600,45,'11-02 12:50:06','林嘉怡'],
  ['店铺周报订单','成功',9850,100,'11-01 11:10:19','陈小雨']
].map((r,i) => {
  const time = `2026-${r[4]}`;
  const expiry = new Date(time.replace(' ','T')+'+08:00'); expiry.setUTCDate(expiry.getUTCDate()+7);
  const logs=[{text:'任务已创建，等待处理',time}];
  if(['成功','已过期','已清理'].includes(r[1]))logs.push({text:'全部文件生成完成',time});
  if(r[1]==='失败')logs.push({text:'订单服务超时，自动重试已耗尽',time});
  if(r[1]==='已取消')logs.push({text:'任务已取消，临时文件已清理',time});
  if(r[1]==='已过期')logs.push({text:'文件已过期',time:expiry.toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})});
  if(r[1]==='已清理')logs.push({text:'管理员已清理文件',time:'2026-11-01 10:00:00'});
  return {id:`EXP20261102${String(130-i).padStart(4,'0')}`,name:r[0],status:r[1],count:r[2],progress:r[3],time,creator:r[5],type:'订单',template:'订单标准模板',scope:i%2?'Shopee 马来西亚一店':'全部授权店铺',condition:'2026-10-01 至 2026-11-02 · 全部状态',range:'当前筛选结果',expiry:expiry.toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}),rows:r[2]*2,files:r[2]>20000?2:1,reason:r[1]==='失败'?'订单服务响应超时，已达到自动重试次数。请重新导出，或缩小时间范围。':'',logs,started:['处理中','成功','已过期','已清理'].includes(r[1])?time:null,finished:['成功','已过期','已清理'].includes(r[1])?time:null};
});
let tasks = seed, role = 'admin', scope = 'mine', statusTab = '全部', currentPage = 1, applied = {}, detailId = null, retrySource = null, pendingConfirm = null;
let canExport = true, canReadOriginal = true, orderSelection = new Set(), orderQuery = {}, toastTimer;
const notices = [];
try { const saved=JSON.parse(localStorage.getItem(storageKey)); if(Array.isArray(saved)&&saved.every(t=>t.id&&t.name&&typeof t.count==='number'&&Array.isArray(t.logs))) tasks=saved; } catch {}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(tasks));}catch{}}
function icons(){if(window.lucide) lucide.createIcons();}
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className=`toast show${error?' error-toast':''}`;toastTimer=setTimeout(()=>$('toast').className='toast',3800);}
function open(id){if(!$(id).open)$(id).showModal();icons();}
function visibleTasks(){return tasks.filter(t=>scope==='manage'&&role==='admin'||t.creator===me);}
function maySee(t){return t&&(t.creator===me||role==='admin');}
function mayDownload(t){return t.creator===me&&canExport&&canReadOriginal&&t.status==='成功';}
function mayManage(t){return t.creator===me||role==='admin';}
function statusClass(status){return {成功:'success',处理中:'running',排队中:'queued',取消中:'queued',失败:'failed'}[status]||'muted';}
function statusHtml(t){return `<span class="status ${statusClass(t.status)}">${esc(t.status)}</span>`;}
function filtered(){return visibleTasks().filter(t=>{
  const tabPass=statusTab==='全部'||(statusTab==='进行中'?activeStates.includes(t.status):statusTab==='需处理'?['失败','已过期','已清理'].includes(t.status):t.status===statusTab);
  return tabPass&&(!applied.keyword||`${t.name} ${t.id}`.toLowerCase().includes(applied.keyword.toLowerCase()))&&(!applied.type||t.type===applied.type)&&(!applied.status||t.status===applied.status)&&(!applied.creator||t.creator===applied.creator)&&(!applied.start||t.time.slice(0,10)>=applied.start)&&(!applied.end||t.time.slice(0,10)<=applied.end);
}).sort((a,b)=>b.time.localeCompare(a.time)||b.id.localeCompare(a.id));}
function actionButton(action,t,text,extra=''){return `<button class="text-button ${extra}" data-action="${action}" data-id="${esc(t.id)}">${text}</button>`;}
function actions(t){let result='';
  if(t.status==='成功') result=mayDownload(t)?actionButton('download',t,'下载'):`<span class="download-disabled" title="${t.creator!==me?'不可下载他人文件':!canExport?'订单导出权限已撤销':'原任务数据或字段权限已变更'}">下载</span>`;
  else if(['处理中','排队中'].includes(t.status)&&mayManage(t)) result=actionButton('cancel',t,'取消');
  else if(!activeStates.includes(t.status)&&t.creator===me&&canExport) result=actionButton('retry',t,'重新导出');
  return result;}
function render(){
  const visible=visibleTasks(), counts={'全部':visible.length,'进行中':visible.filter(t=>activeStates.includes(t.status)).length,'成功':visible.filter(t=>t.status==='成功').length,'需处理':visible.filter(t=>['失败','已过期','已清理'].includes(t.status)).length};
  $('statusTabs').innerHTML=Object.entries(counts).map(([key,value])=>`<button role="tab" aria-selected="${key===statusTab}" class="${key===statusTab?'selected':''}" data-status-tab="${key}">${key==='成功'?'已成功':key}<small>${value}</small></button>`).join('');
  const rows=filtered(), size=Number($('pageSize').value), pages=Math.max(1,Math.ceil(rows.length/size));currentPage=Math.min(currentPage,pages);
  $('taskRows').innerHTML=rows.slice((currentPage-1)*size,currentPage*size).map(t=>`<tr><td><div class="task-name"><span class="file-icon"><i data-lucide="file-spreadsheet"></i></span><div class="task-label"><strong title="${esc(t.name)}">${esc(t.name)}</strong><small>${esc(t.id)}</small></div></div></td><td><span class="type-label">${esc(t.type)}</span></td><td>${statusHtml(t)}</td><td>${t.status==='处理中'?`<div class="progress"><span style="width:${Math.max(0,Math.min(100,t.progress))}%"></span></div><span class="progress-text">${number(Math.floor(t.count*t.progress/100))} / ${number(t.count)}</span>`:t.status==='排队中'?'<span class="subtle">等待处理</span>':t.status==='取消中'?'<span class="subtle">正在停止</span>':['成功','已过期','已清理'].includes(t.status)?'<span class="subtle">100%</span>':'<span class="subtle">—</span>'}</td><td class="count">${number(t.count)}<span class="cell-secondary">${activeStates.includes(t.status)?'预计单据数':'单'}</span></td><td data-col="creator">${esc(t.creator)}</td><td class="date-cell" data-col="time">${esc(t.time.slice(0,10))}<span class="cell-secondary">${esc(t.time.slice(11))}</span></td><td><div class="row-actions">${actions(t)}</div></td></tr>`).join('');
  $('empty').hidden=rows.length>0;$('resultCount').textContent=`共 ${rows.length} 条任务`;$('pageNumbers').innerHTML=Array.from({length:pages},(_,i)=>`<button class="page-number ${i+1===currentPage?'active':''}" data-page="${i+1}">${i+1}</button>`).join('');$('prevPage').disabled=currentPage===1;$('nextPage').disabled=currentPage===pages;$('pageJump').value=currentPage;$('pageJump').max=pages;
  $('managementTab').hidden=role!=='admin';$('creatorFilter').hidden=scope!=='manage';
  document.querySelectorAll('[data-scope]').forEach(b=>{b.classList.toggle('selected',b.dataset.scope===scope);b.setAttribute('aria-selected',b.dataset.scope===scope);});
  icons();
}
function setScope(value){scope=value==='manage'&&role==='admin'?'manage':'mine';statusTab='全部';applied={};HTMLFormElement.prototype.reset.call($('filters'));currentPage=1;render();}
function resetFilters(){ HTMLFormElement.prototype.reset.call($('filters'));applied={};statusTab='全部';currentPage=1;render(); }
function addLog(t,text){t.logs.push({text,time:dateNow()});}
function detail(t){if(!maySee(t))return toast('无权查看该任务',true);detailId=t.id;renderDetail();open('detailDialog');}
function renderDetail(){const t=tasks.find(x=>x.id===detailId);if(!maySee(t)){if($('detailDialog').open)$('detailDialog').close();return;}
  $('detailId').textContent=t.id;
  const why=t.status==='失败'?t.reason:t.status==='已过期'?'文件已过期，请重新导出。':t.status==='已清理'?'文件已被管理员清理，可重新导出。':t.status==='取消中'?'正在停止后台处理并清理临时文件。':t.status==='已取消'?'任务已停止，未生成可下载文件。':t.status==='排队中'?'正在等待后台处理。':t.status==='处理中'?'后台正在分批读取订单并生成文件。':t.count===0?'当前条件下无可导出数据，文件仅包含表头。':'全部文件已生成，可下载。';
  const fields=[['任务名称',t.name],['创建人',t.creator],['单据类型',t.type],['创建时间',t.time],['完成时间',t.finished||'—'],['导出范围',t.range],['店铺范围',t.scope],['筛选条件',t.condition],['导出模板',`${t.template} · V1.0`],['单据数',`${number(t.count)} 单`],['文件数据行数',t.status==='成功'?`${number(t.rows)} 行`:'—'],['原任务',t.source||'—']];
  $('detailBody').innerHTML=`<div class="detail-status"><i data-lucide="${t.status==='失败'?'circle-alert':t.status==='成功'?'circle-check':'clock-3'}"></i><div>${statusHtml(t)}<p>${esc(why)}</p></div></div><dl class="detail-grid">${fields.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><h3>数据口径</h3><div class="form-note">提交时固定订单集合，字段内容按后台读取时的数据生成。<br>读取时间：${esc(t.started||'尚未开始')}${t.finished?' 至 '+esc(t.finished):''}</div><h3>导出字段</h3><div class="field-tags">${templateFields(t.template).map(s=>`<span>${s}</span>`).join('')}</div><h3>导出文件</h3>${t.status==='成功'?`<div class="file-row"><i data-lucide="${t.files>1?'file-archive':'file-spreadsheet'}"></i><div><strong>${esc(t.name)}_${esc(t.id)}.${t.files>1?'zip':'xlsx'}</strong><small>${t.files>1?t.files+' 个分片 · 含导出清单':'1 个文件'} · ${number(t.rows)} 行</small></div>${mayDownload(t)?actionButton('download',t,'下载'):'<span class="subtle">无下载权限</span>'}</div>`:'<div class="subtle">'+(activeStates.includes(t.status)?'文件尚未生成':t.status==='已过期'?'文件已过期':t.status==='已清理'?'文件已清理':'无可下载文件')+'</div>'}<h3>处理记录</h3><div class="log">${t.logs.map(l=>`<div class="log-item">${esc(l.text)}<small>${esc(l.time)}</small></div>`).join('')}</div>`;
  $('detailFooter').innerHTML=`<button class="button" data-close>关闭</button>${['排队中','处理中'].includes(t.status)&&mayManage(t)?`<button class="button" data-action="cancel" data-id="${esc(t.id)}">取消任务</button>`:''}${t.status==='成功'&&mayDownload(t)?`<button class="button primary" data-action="download" data-id="${esc(t.id)}"><i data-lucide="download"></i>下载文件</button>`:''}${!activeStates.includes(t.status)&&t.creator===me&&canExport?`<button class="button" data-action="retry" data-id="${esc(t.id)}">重新导出</button>`:''}${t.status==='成功'&&role==='admin'?`<button class="button" data-action="clean" data-id="${esc(t.id)}">清理文件</button>`:''}`;icons();
}
function confirmAction(title,body,callback,danger=false){$('confirmTitle').textContent=title;$('confirmBody').textContent=body;$('confirmAction').className=`button ${danger?'danger':'primary'}`;$('confirmAction').textContent=title;pendingConfirm=callback;open('confirmDialog');}
function download(t){if(!mayDownload(t))return toast('下载权限已变更或文件不可用，请重新导出。',true);const a=document.createElement('a');a.href=t.count===0?'assets/empty-orders.xlsx':t.files>1?'assets/order-export-sample.zip':'assets/order-export-sample.xlsx';a.download=`${t.name}_${t.id}_示例.${t.files>1?'zip':'xlsx'}`;a.click();addLog(t,'本人发起文件下载');persist();toast('已下载示例文件');if($('detailDialog').open)renderDetail();}
function action(name,t){if(!maySee(t))return toast('无权操作该任务',true);
  if(name==='detail')detail(t);
  if(name==='download')download(t);
  if(name==='retry'){if(t.creator!==me||!canExport||activeStates.includes(t.status))return toast('当前任务不可重新导出',true);retrySource=t;prepareCreate(t);}
  if(name==='cancel'&&mayManage(t)&&['排队中','处理中'].includes(t.status))confirmAction('取消任务',`确认取消“${t.name}”？未完成的文件将被清理。`,()=>{if(!['排队中','处理中'].includes(t.status))return toast('任务已完成，无需取消');t.status='取消中';t.cancelAt=Date.now();addLog(t,`${role==='admin'&&t.creator!==me?'管理员':'本人'}已申请取消`);persist();render();if($('detailDialog').open)renderDetail();toast('取消申请已受理');},true);
  if(name==='clean'&&role==='admin'&&t.status==='成功')confirmAction('清理文件',`确认清理“${t.name}”的导出文件？清理后无法恢复，任务记录仍会保留。`,()=>{t.status='已清理';addLog(t,'管理员已清理文件');persist();render();renderDetail();toast('文件已清理');},true);
}
function templateFields(template){return template==='订单履约模板'?['订单号','商品SKU','数量','物流渠道','运单号','收件信息（脱敏）']:['订单号','店铺','商品明细','订单金额','订单状态','收件信息（脱敏）'];}
function prepareCreate(source=null){if(!canExport)return toast('无订单导出权限，请联系管理员',true);retrySource=source;$('createForm').reset();$('createError').textContent='';$('taskName').value=source?`${source.name}_重新导出`:`订单导出_${dateNow().replace(/[-: ]/g,'')}`;const selected=$('createForm').querySelector('[value=selected]');selected.disabled=!!source||orderSelection.size===0;$('checkedAmount').textContent=source?'（未勾选）':`（${orderSelection.size} 单）`;$('filteredAmount').textContent='（12,860 单）';if(!source&&orderSelection.size)selected.checked=true;if(source)$('exportTemplate').value=source.template;updateCreate();open('createDialog');}
function updateCreate(){const range=new FormData($('createForm')).get('range'), shop=retrySource?.scope||orderQuery.shop||'全部授权店铺',condition=retrySource?.condition||`${orderQuery.from||'2026-10-01'} 至 ${orderQuery.to||'2026-11-02'} · ${orderQuery.orderStatus||'全部状态'}`;
  $('estimate').value=range==='selected'?`${number(orderSelection.size)} 单`:'12,860 单';$('conditionSummary').innerHTML=`<strong>店铺：</strong>${esc(shop)}<br><strong>条件：</strong>${esc(condition)}`;$('exportFields').innerHTML=templateFields($('exportTemplate').value).map(s=>`<span>${s}</span>`).join('');}
function createTask(){if(!canExport)return toast('订单导出权限已撤销',true);const f=$('createForm');if(!f.reportValidity())return;const data=new FormData(f), name=data.get('taskName').trim();if(!name){$('createError').textContent='请输入任务名称';return;}if(tasks.filter(t=>t.creator===me&&activeStates.includes(t.status)).length>=3){$('createError').textContent='当前已有3个未完成任务，请完成或取消后再试。';return;}
  const range=data.get('range');if(range==='selected'&&!orderSelection.size){$('createError').textContent='请先在订单列表勾选订单。';return;}
  const t={id:'EXP'+dateNow().replace(/[-: ]/g,'')+Math.random().toString(36).slice(2,5).toUpperCase(),name,type:'订单',status:'排队中',count:range==='selected'?orderSelection.size:12860,progress:0,creator:me,time:dateNow(),template:data.get('template'),scope:retrySource?.scope||orderQuery.shop||'全部授权店铺',condition:retrySource?.condition||`${orderQuery.from||'2026-10-01'} 至 ${orderQuery.to||'2026-11-02'} · ${orderQuery.orderStatus||'全部状态'}`,range:range==='selected'?'已勾选订单':'当前筛选结果',expiry:'',rows:(range==='selected'?orderSelection.size:12860)*2,files:1,source:retrySource?.id||'',logs:[],readyAt:Date.now()+4500};
  const duplicate=tasks.find(x=>x.creator===me&&activeStates.includes(x.status)&&x.range===t.range&&x.scope===t.scope&&x.condition===t.condition&&x.template===t.template&&x.count===t.count);
  if(duplicate){$('createError').textContent=`存在相同范围的未完成任务 ${duplicate.id}，请在任务中心查看或等待完成。`;return;}
  $('submitTask').disabled=true;addLog(t,'任务已创建，权限校验通过');tasks.unshift(t);persist();$('createDialog').close();if($('detailDialog').open)$('detailDialog').close();$('submitTask').disabled=false;route('tasks');setScope('mine');resetFilters();toast('导出任务已创建，可在此查看进度');}

const productAssets=['assets/green-jacket.jpg','assets/black-trousers.jpg','assets/apricot-shirt.jpg'];
const orders=Array.from({length:10},(_,i)=>({id:`DF2026110200${String(i+1).padStart(3,'0')}`,product:['轻户外立领夹克','直筒休闲长裤','短袖休闲衬衫'][i%3],sku:['JK-093-GN-M','PT-026-BK-L','SH-108-AP-M'][i%3],shop:i%2?'Shopee 泰国旗舰店':'Shopee 马来西亚一店',state:i%3?'待发货':'已发货',amount:[129,89,109][i%3],image:productAssets[i%3]}));
function shownOrders(){return orders.filter(o=>(!orderQuery.shop||orderQuery.shop==='全部授权店铺'||o.shop===orderQuery.shop)&&(!orderQuery.orderStatus||orderQuery.orderStatus==='全部状态'||o.state===orderQuery.orderStatus)&&(!orderQuery.from||orderQuery.from<='2026-11-02')&&(!orderQuery.to||orderQuery.to>='2026-11-02'));}
function renderOrders(){const shown=shownOrders();$('orderRows').innerHTML=shown.map(o=>`<tr><td><input type="checkbox" data-order="${o.id}" aria-label="选择订单 ${o.id}" ${orderSelection.has(o.id)?'checked':''}></td><td>${o.id}<span class="cell-secondary">平台订单 · Shopee</span></td><td><div class="product"><img src="${o.image}" alt="${o.product}"><span>${o.product}<small>${o.sku} · 1 件</small></span></div></td><td>${o.shop}</td><td><span class="status ${o.state==='待发货'?'queued':'success'}">${o.state}</span></td><td>¥ ${o.amount.toFixed(2)}</td><td>2026-11-02 09:${String(12+orders.indexOf(o)).padStart(2,'0')}:18</td></tr>`).join('')||'<tr><td colspan="7" class="empty">暂无符合条件的订单</td></tr>';$('selectedCount').textContent=`已选择 ${orderSelection.size} 条订单`;$('selectAll').checked=shown.length>0&&shown.every(o=>orderSelection.has(o.id));$('selectAll').indeterminate=shown.some(o=>orderSelection.has(o.id))&&!$('selectAll').checked;$('orderTotal').textContent=`共 ${shown.length?number(12860):0} 条 · 当前第 1 页`;$('exportOrders').disabled=!canExport;}
function route(page){const order=page==='orders';$('tasksPage').hidden=order;$('ordersPage').hidden=!order;$('crumbTitle').textContent=order?'订单列表':'导出任务中心';document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===(order?'orders':'tasks')));if(order)renderOrders();else render();if(location.hash!==`#${page}`)history.replaceState(null,'',`#${page}`);}
function simulate(){if(document.hidden)return;let changed=false;for(const t of tasks){
  if(t.status==='取消中'&&Date.now()-(t.cancelAt||0)>1500){t.status='已取消';t.finished=dateNow();addLog(t,'任务已停止，临时文件已清理');changed=true;continue;}
  if(!['排队中','处理中'].includes(t.status))continue;
  if(t.creator===me&&(!canExport||!canReadOriginal)){t.status='失败';t.reason='导出权限或数据范围已变更，请重新创建任务。';t.finished=dateNow();addLog(t,t.reason);changed=true;continue;}
  if(t.status==='排队中'&&(!t.readyAt||Date.now()>=t.readyAt)){t.status='处理中';t.started=dateNow();addLog(t,'开始读取订单，生成文件');changed=true;}
  else if(t.status==='处理中'){t.progress=Math.min(100,t.progress+7);changed=true;if(t.progress===100){t.status='成功';t.finished=dateNow();const expiry=new Date();expiry.setDate(expiry.getDate()+7);t.expiry=expiry.toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'});addLog(t,'全部文件生成完成');if(t.creator===me){notices.unshift(t.id);toast(`导出完成：${t.name}`);}}}
}if(changed){persist();render();if($('detailDialog').open)renderDetail();}}

document.addEventListener('click',e=>{
  const close=e.target.closest('[data-close]');if(close){close.closest('dialog').close();return;}
  const a=e.target.closest('[data-action]');if(a){action(a.dataset.action,tasks.find(t=>t.id===a.dataset.id));return;}
  const scopeButton=e.target.closest('[data-scope]');if(scopeButton)setScope(scopeButton.dataset.scope);
  const stat=e.target.closest('[data-stat]');const tab=e.target.closest('[data-status-tab]');if(stat||tab){statusTab=stat?stat.dataset.stat:tab.dataset.statusTab;currentPage=1;render();}
  const page=e.target.closest('[data-page]');if(page){currentPage=Number(page.dataset.page);render();}
  const nav=e.target.closest('[data-route]');if(nav){e.preventDefault();route(nav.dataset.route);}
});
document.querySelectorAll('.topbar nav a:not([data-route])').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();toast('当前未接入该业务模块');}));
$('filters').addEventListener('submit',e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(values.start&&values.end&&values.start>values.end)return toast('开始日期不能晚于结束日期',true);applied=values;applied.keyword=values.keyword.trim();currentPage=1;render();});
$('reset').onclick=resetFilters;$('emptyReset').onclick=resetFilters;
 $('refresh').onclick=()=>{render();if($('detailDialog').open)renderDetail();toast('列表已刷新');};
$('pageSize').onchange=()=>{currentPage=1;render();};$('prevPage').onclick=()=>{currentPage=Math.max(1,currentPage-1);render();};$('nextPage').onclick=()=>{currentPage++;render();};$('pageJump').onchange=()=>{const max=Number($('pageJump').max),value=Number($('pageJump').value);if(!Number.isInteger(value)||value<1||value>max){$('pageJump').value=currentPage;return toast('请输入有效页码',true);}currentPage=value;render();};
$('goOrders').onclick=()=>route('orders');$('backTasks').onclick=()=>route('tasks');$('exportOrders').onclick=()=>{if(!shownOrders().length)return toast('当前筛选结果为空，请调整条件',true);prepareCreate();};
$('orderRows').onchange=e=>{if(e.target.dataset.order){if(e.target.checked)orderSelection.add(e.target.dataset.order);else orderSelection.delete(e.target.dataset.order);renderOrders();}};
$('selectAll').onchange=e=>{shownOrders().forEach(o=>e.target.checked?orderSelection.add(o.id):orderSelection.delete(o.id));renderOrders();};
$('orderFilters').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(values.from>values.to)return toast('开始日期不能晚于结束日期',true);orderQuery=values;orderSelection.clear();renderOrders();};
$('createForm').onchange=updateCreate;$('createForm').onsubmit=e=>{e.preventDefault();createTask();};
$('confirmAction').onclick=()=>{const callback=pendingConfirm;pendingConfirm=null;$('confirmDialog').close();callback?.();};
$('notifications').onclick=()=>{const ready=tasks.filter(t=>t.creator===me&&['成功','失败'].includes(t.status)).slice(0,5);$('noticeList').innerHTML=ready.map(t=>`<button class="notice-item" data-action="detail" data-id="${esc(t.id)}"><i data-lucide="${t.status==='成功'?'circle-check':'circle-alert'}"></i><span>${esc(t.name)}<small>${t.status==='成功'?'导出已完成，可查看结果':'导出失败，请查看原因'}</small></span><i data-lucide="chevron-right"></i></button>`).join('')||'<p class="subtle">暂无任务通知</p>';document.querySelector('.unread').hidden=true;open('noticeDialog');};
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
window.addEventListener('hashchange',()=>route(location.hash==='#orders'?'orders':'tasks'));
route(location.hash==='#orders'?'orders':'tasks');setInterval(simulate,4000);icons();
