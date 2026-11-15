const {app,session,ipcMain}=require('electron');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {pathToFileURL}=require('url');
let context,failed=false,generation=0;
function report(phase,details) {
  const value=Object.assign({type:'save-adapter',gameId:context&&context.gameId,nonce:context&&context.nonce,documentGeneration:generation,phase},details);
  fs.writeSync(3,JSON.stringify(value)+'\n');
}
function fatal(message) {
  if(failed)return;failed=true;
  try {report('failed',{code:'SAVE_HOOK_FAILED',message:String(message)});}catch(_){}
  // Exiting inside BrowserWindow construction crashes older Electron on macOS.
  setImmediate(()=>app.exit(1));
}
try {
  const file=process.env.LAUNCHER_SAVE_CONTEXT;
  if(!file||!path.isAbsolute(file)||fs.statSync(file).size>64*1024)throw Error('缺少有效存档启动描述');
  context=JSON.parse(fs.readFileSync(file,'utf8'));
  if(context.version!==1||!/^[a-f0-9]{32}$/.test(context.nonce)||!context.profile||!path.isAbsolute(context.selectedDirectory))throw Error('存档启动描述无效');
  const preload=path.join(__dirname,'preload.js');
  new vm.Script(fs.readFileSync(preload,'utf8'),{filename:preload});
  const expected=pathToFileURL(context.profile.page).href;
  let storage;
  if(context.game) {
    const adapters=require('../index');
    storage=require('../../core/save-policy').create(context.context,{inspect:adapters.inspectSaveProfile,validate:adapters.validateSaveBytes,encode:adapters.encodeSave}).openSession(context.game,context.library);
  }
  const owners=new Map();
  function owner(event) {
    if(failed)throw Error('存档保护已停止');
    const item=owners.get(event.sender.id);
    if(!item||event.sender.getURL()!==expected)throw Error('未识别的存档页面');
    return item;
  }
  ipcMain.on('launcher-save:init',(event)=>{
    try {const item=owner(event);event.returnValue=Object.assign({},context,{documentGeneration:item.generation});}
    catch(error){fatal(error.message);event.returnValue={error:true};}
  });
  ipcMain.on('launcher-save:failed',(event,message)=>{fatal(message);event.returnValue=false;});
  ipcMain.on('launcher-save:ready',(event,value)=>{
    try {const item=owner(event);if(value!==item.generation)throw Error('旧存档页面消息');if(storage)storage.validate();report('adapter-ready',{documentGeneration:item.generation});event.returnValue=true;}
    catch(error){fatal(error.message);event.returnValue=false;}
  });
  ipcMain.on('launcher-save:storage',(event,input)=>{
    try {
      const item=owner(event);
      if(!storage||!input||input.documentGeneration!==item.generation)throw Error('存档操作来源无效');
      let value;
      if(input.operation==='read')value=storage.read(input.key);
      else if(input.operation==='read-confirmed')value=storage.readConfirmed(input.key);
      else if(input.operation==='write')value=storage.write(input.key,input.value);
      else if(input.operation==='begin-clear'){const boundary=context.profile.clearBoundaries.find(b=>b.name===input.boundary);if(!boundary)throw Error('清档边界无效');value=storage.beginClear(boundary.keys);}
      else if(input.operation==='remove')value=storage.remove(input.key);
      else if(input.operation==='finish-clear')value=storage.finishClear();
      else throw Error('不支持的存档操作');
      event.returnValue={ok:true,value};
    }catch(error){event.returnValue={ok:false,message:error.message};fatal(error.message);}
  });
  app.on('web-contents-created',(_event,contents)=>{
    const preferences=contents.getLastWebPreferences();
    if(!preferences||!preferences.nodeIntegration||preferences.contextIsolation||preferences.sandbox||contents.session!==session.defaultSession){fatal('窗口权限或 Session 不受支持');return;}
    const item={generation:++generation};owners.set(contents.id,item);
    contents.on('did-start-navigation',(_e,url,inPlace,isMainFrame)=>{
      if(!isMainFrame||inPlace)return;
      if(url!==expected){fatal('未识别的存档页面导航');return;}
      item.generation=++generation;report('adapting');
    });
    contents.on('preload-error',(_e,_file,error)=>fatal(error.message));
    contents.on('crashed',()=>fatal('存档页面退出'));
    contents.on('render-process-gone',()=>fatal('存档页面退出'));
  });
  app.on('ready',()=>{
    const preloads=session.defaultSession.getPreloads();
    session.defaultSession.setPreloads(preloads.concat([preload]));
  });
}catch(error){fatal(error.message);}
