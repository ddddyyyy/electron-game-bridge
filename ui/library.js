const $=id=>document.getElementById(id);
let state,selected=null,editingId=null,busy=false,saving=false,registering=false,returnFocus=null,runtimeFocus=null,resolutionSequence=0;
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
    $('detail-runtime').textContent=runtime?'Electron '+runtime.version+' · '+runtime.arch:'运行时需修复';
    $('game-status').textContent=busy?'游戏进程处理中':state.errors.some(e=>e.gameId===game.id)?'配置待修复':'本地配置已登记';
  }
  renderRuntimes();setBusy(busy);
}
function renderRuntimes(){
  $('runtime-list').textContent='';
  if(!state||!state.library)return;
  state.library.runtimes.forEach(r=>{if(!r||!r.id)return;const box=document.createElement('div');box.className='runtime-record';const title=document.createElement('strong');title.textContent='Electron '+(r.version||'?')+' · '+(r.arch||'?');const loc=document.createElement('small');loc.textContent=r.executablePath||'路径无效';box.append(title,loc);$('runtime-list').append(box);});
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
  ['save','inspect','open-runtime'].forEach(id=>$(id).disabled=locked||bad);
  $('restore').disabled=locked;$('close-settings').disabled=saving||registering;$('cancel').disabled=saving||registering;$('close-runtime').disabled=registering;
}
function formGame(){
  return {id:editingId||undefined,name:$('name').value.trim(),iconPath:$('icon').value.trim()||null,installPath:$('install').value.trim(),adapterId:'electron-app',entry:$('entry').value.trim(),workingDirectory:$('cwd').value.trim(),args:$('args').value.split('\n').filter(a=>a!==''),window:null,capabilities:{}};
}
async function resolve(){
  const seq=++resolutionSequence;if($('settings-panel').hidden)return;
  $('runtime-result').textContent='正在识别…';
  try{const result=await window.launcher.resolveGameRuntime(formGame());if(seq!==resolutionSequence)return;
    $('runtime-result').textContent=result.status==='matched'?'Electron '+result.requiredVersion+' / '+result.arch+' · 已自动匹配\n'+result.evidence.join('\n'):result.message;
  }catch(error){if(seq===resolutionSequence)$('runtime-result').textContent=error.message;}
}
function openSettings(game,trigger){
  if(busy||saving||registering){message('请先停止游戏再修改设置。',true);return;}
  returnFocus=trigger||document.activeElement;editingId=game?game.id:null;
  $('settings-title').textContent=game?'游戏设置':'添加游戏';$('name').value=game?game.name:'';
  $('install').value=game?game.installPath:'';$('icon').value=game?game.iconPath||'':'';$('entry').value=game?game.entry:'.';$('cwd').value=game?game.workingDirectory:'.';$('args').value=game&&Array.isArray(game.args)?game.args.join('\n'):'';
  $('fields-error').textContent='';$('settings-panel').hidden=false;setBusy(busy);$('name').focus();resolve();
}
function closeSettings(){if(saving||registering)return;resolutionSequence++;$('settings-panel').hidden=true;editingId=null;if(returnFocus&&document.contains(returnFocus))returnFocus.focus();}
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
    resolve();
  }catch(error){fail(error);}
});
$('choose-runtime').onclick=async()=>{try{const p=await window.launcher.choosePath('runtime');if(p)$('runtime-path').value=p;}catch(error){fail(error);}};
$('runtime-form').onsubmit=async event=>{
  event.preventDefault();if(busy||registering)return;registering=true;setBusy(busy);$('runtime-status').textContent='正在探测本地运行时…';
  try{const runtime=await window.launcher.inspectRuntime($('runtime-path').value.trim());runtime.source=$('runtime-source').value.trim()||runtime.source;
    const next=await window.launcher.saveRuntime({revision:state.library.revision,token:state.token,runtime});
    // Refresh our own revision without replacing any unsaved game inputs.
    state=next;render();$('runtime-status').textContent='Electron '+runtime.version+' / '+runtime.arch+' 已独立登记。';message('运行时已登记，游戏设置仍需单独保存。');
  }catch(error){$('runtime-status').textContent=error.message;fail(error);}finally{registering=false;setBusy(busy);}
};
$('game-form').onsubmit=async event=>{
  event.preventDefault();if(busy||saving||registering)return;saving=true;setBusy(busy);
  try{const next=await window.launcher.saveGame({revision:state.library.revision,token:state.token,game:formGame()});saving=false;closeSettings();accept(next,next.savedGameId);message('设置已保存。');}
  catch(error){fail(error);}finally{saving=false;setBusy(busy);}
};
$('launch').onclick=async()=>{if(busy||!selected)return;setBusy(true);try{await window.launcher.launchGame(selected);}catch(error){setBusy(false);fail(error);}};
window.launcher.onLaunchState(value=>{setBusy(['validating','starting','running'].includes(value.phase));if(current())$('game-status').textContent=busy?'游戏进程处理中':'游戏已停止';message(value.message||({validating:'正在检查游戏与运行时…',starting:'正在启动…',exited:'游戏已退出。'}[value.phase]||value.phase),value.phase==='failed');});
document.addEventListener('keydown',event=>{
  const panel=!$('runtime-panel').hidden?$('runtime-panel'):!$('settings-panel').hidden?$('settings-panel'):null;if(!panel)return;
  if(event.key==='Escape'){event.preventDefault();if(panel===$('runtime-panel'))closeRuntime();else closeSettings();}
  if(event.key==='Tab'){
    const items=Array.from(panel.querySelectorAll('button,input,select,textarea')).filter(el=>!el.disabled&&el.offsetParent!==null);const first=items[0],last=items[items.length-1];
    if(items.length&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}
  }
});
reload();
