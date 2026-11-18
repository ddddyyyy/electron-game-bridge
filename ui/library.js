const $=id=>document.getElementById(id);
let state,selected=null,editingId=null,busy=false,saving=false,registering=false,returnFocus=null,runtimeFocus=null,resolutionSequence=0;
let runtimeDownloading=false;
let savePreview=null,saveDirty=false,saveBase=null,saveSequence=0;
function message(text,error){$('message').textContent=text||'';$('message').classList.toggle('error',!!error);}
function fail(error){message(error.message,true);$('fields-error').textContent=error.fieldErrors?Object.keys(error.fieldErrors).map(k=>k+'：'+error.fieldErrors[k]).join('\n'):error.message;}
function current(){return state&&state.library&&state.library.games.find(g=>g&&g.id===selected);}
function art(host,game,index){
  host.textContent='';
  if(state.previews&&state.previews[index]){const img=document.createElement('img');img.src=state.previews[index];img.alt='';host.append(img);}
  else {const box=document.createElement('div');box.className='placeholder-art';const symbol=document.createElement('span');symbol.className='placeholder-symbol';symbol.textContent='✣';symbol.setAttribute('aria-hidden','true');const hint=document.createElement('small');hint.textContent='你的下一段旅程';box.append(symbol,hint);host.append(box);}
}
function render(){
  if(!state)return;
  $('recovery').hidden=!state.error;$('workspace').hidden=!!state.error;
  if(state.error){$('recovery-text').textContent=state.error.message+'；配置位置：'+state.configPath;message('原配置已保留，未重置任何游戏数据。',true);setBusy(busy);return;}
  $('games').textContent='';
  state.library.games.forEach((g,index)=>{
    if(!g||typeof g!=='object'){const p=document.createElement('p');p.textContent='无效记录 '+(index+1)+'，原始内容已保留';$('games').append(p);return;}
    const button=document.createElement('button');button.type='button';button.className='game'+(g.id===selected?' selected':'');button.setAttribute('aria-pressed',String(g.id===selected));
    const picture=document.createElement('div');picture.className='art';art(picture,g,index);
    const info=document.createElement('span');info.className='info';const name=document.createElement('strong');name.textContent=g.name||'名称待修复';
    const install=document.createElement('small');install.textContent=g.installPath||'安装位置待修复';info.append(name,install);
    if(state.errors.some(e=>e.index===index)){const warning=document.createElement('small');warning.className='unavailable';warning.textContent='配置需要修复';info.append(warning);}
    button.append(picture,info);button.onclick=()=>{selected=g.id;render();};$('games').append(button);
  });
  if(!state.library.games.length)$('games').textContent='还没有游戏，点击“添加游戏”开始。';
  const game=current();$('selected-detail').hidden=!game;
  if(game){
    art($('detail-art'),game,state.library.games.indexOf(game));$('detail-title').textContent=game.name||'名称待修复';$('detail-path').textContent=game.installPath||'安装位置待修复';
    const runtime=state.library.runtimes.find(r=>r&&r.id===game.runtimeId);
    $('detail-runtime').textContent=runtime?'Electron '+runtime.version+' · '+runtime.arch:'运行环境需修复';
    const storedSave=state.saveStatus&&state.saveStatus.find(s=>s.gameId===game.id);$('detail-save').textContent=storedSave&&storedSave.enabled?'存档位置：'+storedSave.directory:'存档兼容：未启用';
    $('game-status').textContent=busy?'游戏进程处理中':state.errors.some(e=>e.gameId===game.id)?'配置待修复':'本地配置已登记';
  }
  renderRuntimes();setBusy(busy);
}
function renderRuntimes(){
  $('runtime-list').textContent='';
  if(!state||!state.library)return;
  const groups=new Map();
  state.library.runtimes.forEach(r=>{if(!r||!r.id)return;const key=[r.version,r.arch,r.platform,r.fingerprint,r.executablePath].join('\0');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});
  groups.forEach(records=>{
    const r=records[0],ids=records.map(record=>record.id),names=state.library.games.filter(g=>g&&ids.includes(g.runtimeId)).map(g=>g.name);
    const box=document.createElement('div');box.className='runtime-record';const title=document.createElement('strong');title.textContent='Electron '+(r.version||'?')+' · '+(r.arch||'?');
    const usage=document.createElement('small');usage.textContent=names.length?'用于：'+names.join('、'):'已安装，尚未被游戏使用';
    const details=document.createElement('details'),summary=document.createElement('summary'),loc=document.createElement('small');summary.textContent='查看安装位置';loc.textContent=r.executablePath||'路径无效';details.append(summary,loc);box.append(title,usage,details);$('runtime-list').append(box);
  });
}
function accept(next,preferred){
  state=next;
  if(!state.error){const g=state.library.games.find(g=>g&&g.id===(preferred||selected))||state.library.games.find(g=>g&&g.id);selected=g?g.id:null;}
  render();
}
function setBusy(value){
  busy=value;const locked=busy||saving||registering,bad=!state||!!state.error;
  ['add','settings','nav-runtime'].forEach(id=>$(id).disabled=locked||bad||(id==='settings'&&!current()));
  $('launch').disabled=locked||bad||!selected;
  $('game-fields').disabled=locked;$('runtime-fields').disabled=locked;
  ['save','inspect','open-runtime','inspect-saves','download-runtime'].forEach(id=>$(id).disabled=locked||bad);
  $('restore').disabled=locked;$('close-settings').disabled=saving||registering;$('cancel').disabled=saving||registering;$('close-runtime').disabled=registering;
}
function formGame(){
  return {id:editingId||undefined,name:$('name').value.trim(),iconPath:$('icon').value.trim()||null,installPath:$('install').value.trim(),adapterId:'electron-app',entry:$('entry').value.trim(),workingDirectory:$('cwd').value.trim(),args:$('args').value.split('\n').filter(a=>a!==''),window:null,capabilities:{}};
}
async function resolve(){
  const seq=++resolutionSequence;if($('settings-panel').hidden)return;
  $('download-runtime').hidden=true;$('runtime-result').textContent='正在识别…';
  try{const result=await window.launcher.resolveGameRuntime(formGame());if(seq!==resolutionSequence)return;
    $('download-runtime').hidden=result.status!=='missing'||!result.requiredVersion;
    $('runtime-result').textContent=result.status==='matched'?'Electron '+result.requiredVersion+' / '+result.arch+' · 已自动匹配\n'+result.evidence.join('\n'):result.message;
  }catch(error){if(seq===resolutionSequence)$('runtime-result').textContent=error.message;}
}
function openSettings(game,trigger){
  if(busy||saving||registering){message('请先停止游戏再修改设置。',true);return;}
  returnFocus=trigger||document.activeElement;editingId=game?game.id:null;
  $('settings-title').textContent=game?'游戏设置':'添加游戏';$('name').value=game?game.name:'';
  $('install').value=game?game.installPath:'';$('icon').value=game?game.iconPath||'':'';$('entry').value=game?game.entry:'.';$('cwd').value=game?game.workingDirectory:'.';$('args').value=game&&Array.isArray(game.args)?game.args.join('\n'):'';
  resetSaveForm(game);$('fields-error').textContent='';$('settings-panel').hidden=false;setBusy(busy);$('name').focus();resolve();
}
function closeSettings(){if(saving||registering)return;resolutionSequence++;saveSequence++;$('settings-panel').hidden=true;editingId=null;if(returnFocus&&document.contains(returnFocus))returnFocus.focus();}
function openRuntime(){if(busy||saving)return;runtimeFocus=document.activeElement;$('runtime-panel').hidden=false;renderRuntimes();$('runtime-path').focus();}
function closeRuntime(){if(registering)return;$('runtime-panel').hidden=true;if(runtimeFocus)runtimeFocus.focus();if(!$('settings-panel').hidden)resolve();}
async function reload(){try{accept(await window.launcher.readLibrary());}catch(error){fail(error);}}
$('add').onclick=()=>openSettings(null,$('add'));$('settings').onclick=()=>openSettings(current(),$('settings'));
$('cancel').onclick=closeSettings;$('close-settings').onclick=closeSettings;
$('nav-library').onclick=()=>{if(!saving&&!registering){closeRuntime();closeSettings();$('recovery').hidden=!state.error;}};
$('nav-runtime').onclick=openRuntime;$('open-runtime').onclick=openRuntime;$('close-runtime').onclick=closeRuntime;
$('nav-settings').onclick=()=>{$('recovery').hidden=false;$('recovery-text').textContent=state.error?state.error.message:'配置位置：'+state.configPath+'。恢复会保留当前原件，并使用最后有效备份。';};
$('reload').onclick=reload;
$('restore').onclick=async()=>{if(busy)return;try{accept(await window.launcher.restoreConfig({token:state.token}));message('已恢复配置，故障原件已另存。');}catch(error){fail(error);}};
['install','entry'].forEach(id=>$(id).onchange=resolve);$('resolve-runtime').onclick=resolve;
document.querySelectorAll('[data-pick]').forEach(button=>button.onclick=async()=>{
  if(busy)return;
  try{const chosen=await window.launcher.choosePath(button.dataset.pick);if(!chosen)return;const target=button.dataset.target;
    if(target==='entry'||target==='cwd'){
      const base=$('install').value;if(!base){message('请先选择安装目录。',true);return;}
      if(chosen!==base&&!chosen.startsWith(base+'/')){message('入口和工作目录必须位于安装目录内。',true);return;}
      $(target).value=chosen===base?'.':chosen.slice(base.length+1);
    }else $(target).value=chosen;
    invalidateSavePreview();resolve();
  }catch(error){fail(error);}
});
$('choose-runtime').onclick=async()=>{try{const p=await window.launcher.choosePath('runtime');if(p)$('runtime-path').value=p;}catch(error){fail(error);}};
$('runtime-form').onsubmit=async event=>{
  event.preventDefault();if(busy||registering)return;registering=true;setBusy(busy);$('runtime-status').textContent='正在检测 Electron 版本…';
  try{const runtime=await window.launcher.inspectRuntime($('runtime-path').value.trim());runtime.source=$('runtime-source').value.trim()||runtime.source;
    const next=await window.launcher.saveRuntime({revision:state.library.revision,token:state.token,runtime});
    // Refresh our own revision without replacing any unsaved game inputs.
    invalidateSavePreview();state=next;render();$('runtime-status').textContent='Electron '+runtime.version+' / '+runtime.arch+' 已独立登记。';message('运行环境已登记，游戏设置仍需单独保存。');
  }catch(error){$('runtime-status').textContent=error.message;fail(error);}finally{registering=false;setBusy(busy);}
};
$('download-runtime').onclick=async()=>{
  if(busy||saving||registering)return;registering=true;runtimeDownloading=true;setBusy(busy);
  $('runtime-download').hidden=false;$('cancel-runtime-download').hidden=false;$('cancel-runtime-download').disabled=false;$('cancel-runtime-download').textContent='取消下载';
  $('runtime-download-phase').textContent='正在连接 Electron 官方下载…';$('fields-error').textContent='';$('runtime-download-stats').textContent='';$('runtime-download-stats').hidden=false;$('runtime-download-progress').hidden=false;$('runtime-download-progress').removeAttribute('value');$('runtime-download').scrollIntoView({block:'nearest'});$('cancel-runtime-download').focus();
  try {
    const next=await window.launcher.installGameRuntime({revision:state.library.revision,token:state.token,game:formGame()});
    invalidateSavePreview();state=next;render();await resolve();message('Electron 已安装，游戏设置仍需保存。');
  }catch(error){
    if(error.code==='RUNTIME_INSTALL_CANCELLED'){message('下载已取消，已有版本和游戏数据保持不变。');$('fields-error').textContent='';$('runtime-result').textContent='下载已取消，可以重新下载或添加已有的 Electron。';}
    else{fail(error);$('runtime-result').textContent=error.message;}
  }finally{runtimeDownloading=false;registering=false;$('runtime-download').hidden=true;setBusy(busy);(!$('download-runtime').hidden?$('download-runtime'):$('resolve-runtime')).focus();}
};
$('cancel-runtime-download').onclick=async()=>{
  if(!runtimeDownloading)return;$('cancel-runtime-download').disabled=true;$('cancel-runtime-download').textContent='正在取消…';$('runtime-download-phase').textContent='正在取消并清理临时文件…';
  try{await window.launcher.cancelRuntimeInstall();}catch(error){$('runtime-download-phase').textContent=error.message;$('cancel-runtime-download').disabled=false;$('cancel-runtime-download').textContent='重试取消';}
};
function transferSize(bytes){
  if(bytes>=1000000000)return (bytes/1000000000).toFixed(1)+' GB';
  if(bytes>=1000000)return (bytes/1000000).toFixed(1)+' MB';
  if(bytes>=1000)return (bytes/1000).toFixed(1)+' KB';
  return Math.round(bytes)+' B';
}
window.launcher.onRuntimeProgress(value=>{
  if(!runtimeDownloading||$('cancel-runtime-download').disabled)return;
  $('runtime-download-phase').textContent=value.phase==='downloading'?(value.fileName==='SHASUMS256.txt'?'正在下载官方校验信息…':'正在下载 Electron '+value.version+' / '+value.arch+'…'):({checking:'正在检查已安装的 Electron…',verifying:'正在核对官方 SHA-256 校验值…',extracting:'正在安装 Electron…',probing:'正在验证实际版本与架构…'})[value.phase]||'';
  const downloading=value.phase==='downloading';$('cancel-runtime-download').hidden=false;$('cancel-runtime-download').textContent=downloading?'取消下载':'取消安装';$('runtime-download-progress').hidden=!downloading;$('runtime-download-stats').hidden=!downloading;
  if(!downloading)return;
  const received=Number.isFinite(value.receivedBytes)?Math.max(0,value.receivedBytes):0,total=Number.isFinite(value.totalBytes)&&value.totalBytes>0?value.totalBytes:null,speed=Number.isFinite(value.bytesPerSecond)?Math.max(0,value.bytesPerSecond):0;
  const percent=total?Math.min(100,Math.floor(received/total*100)):null;
  if(percent===null)$('runtime-download-progress').removeAttribute('value');else $('runtime-download-progress').value=percent;
  $('runtime-download-stats').textContent=(total?percent+'% · '+transferSize(received)+' / '+transferSize(total):'已下载 '+transferSize(received)+'（总大小未知）')+' · '+transferSize(speed)+'/s';
});
$('game-form').onsubmit=async event=>{
  event.preventDefault();if(busy||saving||registering)return;saving=true;setBusy(busy);
  try{const next=await window.launcher.saveGame({revision:state.library.revision,token:state.token,game:formGame(),saveChoice:saveChoice()});saving=false;closeSettings();accept(next,next.savedGameId);message('设置已保存。');}
  catch(error){fail(error);}finally{saving=false;setBusy(busy);}
};
$('launch').onclick=async()=>{if(busy||!selected)return;setBusy(true);try{await window.launcher.launchGame(selected);}catch(error){setBusy(false);fail(error);}};
window.launcher.onLaunchState(value=>{setBusy(['validating','starting','adapting','running'].includes(value.phase));if(current())$('game-status').textContent=busy?'游戏进程处理中':'游戏已停止';message(value.message||({validating:'正在检查游戏与运行环境…',starting:'正在启动…',exited:'游戏已退出。'}[value.phase]||value.phase),value.phase==='failed');});
function showSaveLocation(){
  $('save-current-path').textContent=saveBase?saveBase.directoryIdentity.realPath:'由游戏自行决定（未指定位置）';
  const chosen=savePreview&&document.querySelector('input[name="save-location"]:checked');
  const candidate=chosen&&savePreview.candidates.find(c=>c.location===chosen.value);
  $('save-next-path').textContent=!$('save-enabled').checked?'由游戏自行决定（不使用指定位置）':
    !saveDirty&&saveBase?saveBase.directoryIdentity.realPath:
    candidate?candidate.displayPath:'尚未选择，请检查存档位置并选择一个文件夹。';
}
function resetSaveForm(game){
  saveSequence++;savePreview=null;saveDirty=false;saveBase=game&&game.savePolicy;
  $('save-enabled').checked=!!saveBase;$('save-enabled').disabled=!saveBase;$('save-candidates').textContent='';$('save-status').textContent='';
  $('save-inspection').textContent=saveBase?'已启用指定位置，可重新检查并更换。':'先检查游戏是否支持指定存档位置。';
  showSaveLocation();
}
function invalidateSavePreview(){
  if(!savePreview)return;savePreview=null;saveSequence++;
  if($('save-enabled').checked)saveDirty=true;
  $('save-candidates').textContent='';$('save-inspection').textContent='设置已变化，请重新检查存档位置。';showSaveLocation();
}
['name','install','icon','entry','cwd','args'].forEach(id=>$(id).addEventListener('input',invalidateSavePreview));
$('save-enabled').onchange=()=>{saveDirty=true;showSaveLocation();};
$('inspect-saves').onclick=async()=>{
  if(busy||saving||registering)return;const sequence=++saveSequence;
  $('save-inspection').textContent='正在检查存档位置…';$('inspect-saves').disabled=true;
  try {
    const preview=await window.launcher.inspectSavePolicy({revision:state.library.revision,token:state.token,game:formGame()});
    if(sequence!==saveSequence||$('settings-panel').hidden)return;
    savePreview=preview;editingId=preview.gameId;$('save-enabled').disabled=false;
    $('save-inspection').textContent='这款游戏支持指定存档位置，请选择要读取和保存进度的文件夹。';$('save-candidates').textContent='';
    const empty=preview.candidates.every(c=>!c.files.length);
    preview.candidates.forEach(candidate=>{
      const label=document.createElement('label');label.className='save-choice';
      const radio=document.createElement('input');radio.type='radio';radio.name='save-location';radio.value=candidate.location;radio.disabled=!candidate.exists;radio.checked=empty&&candidate.location==='install';radio.onchange=()=>{saveDirty=true;showSaveLocation();};
      const text=document.createElement('span');text.textContent=(candidate.location==='install'?'游戏目录':'资源目录')+'：'+candidate.displayPath;
      const files=document.createElement('small');files.textContent=candidate.files.length?candidate.files.map(f=>f.name+' · '+new Date(f.mtime).toLocaleString()).join('\n'):'没有旧存档'+(candidate.exists?'':'（目录不存在）');text.append(files);label.append(radio,text);$('save-candidates').append(label);
    });
  }catch(error){if(sequence===saveSequence){savePreview=null;$('save-enabled').disabled=!saveBase;$('save-inspection').textContent=error.message;}}
  finally{if(sequence===saveSequence){showSaveLocation();setBusy(busy);}}
};
function saveChoice(){
  if(!saveDirty)return undefined;
  if(!$('save-enabled').checked)return {enabled:false};
  const chosen=document.querySelector('input[name="save-location"]:checked');
  if(!savePreview||!chosen)throw {message:'请重新检查并明确选择存档位置。'};
  return {enabled:true,location:chosen.value,scanToken:savePreview.scanToken};
}
window.launcher.onSaveProgress(value=>{if(saving)$('save-status').textContent=({checking:'正在检查游戏与存档…','backing-up':'正在备份存档…',saving:'正在保存设置…'})[value.phase]||'';});
document.addEventListener('keydown',event=>{
  const panel=!$('runtime-panel').hidden?$('runtime-panel'):!$('settings-panel').hidden?$('settings-panel'):null;if(!panel)return;
  if(event.key==='Escape'){event.preventDefault();if(panel===$('runtime-panel'))closeRuntime();else closeSettings();}
  if(event.key==='Tab'){
    const items=Array.from(panel.querySelectorAll('button,input,select,textarea')).filter(el=>!el.matches(':disabled')&&el.offsetParent!==null);const first=items[0],last=items[items.length-1];
    if(items.length&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}
  }
});
reload();
