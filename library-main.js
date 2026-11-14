const {app,BrowserWindow,ipcMain,dialog,nativeImage}=require('electron');
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');
const config=require('./core/config');
const {Runner,inspectRuntime,resolveRuntime,checkDataRuntime}=require('./core/launch');
const adapters=require('./adapters');
function iconPreview(filename) {
  try {
    if(!filename || fs.statSync(filename).size>4*1024*1024) return null;
    const fd=fs.openSync(filename,'r'),header=Buffer.alloc(24);
    try { if(fs.readSync(fd,header,0,24,0)!==24) return null; } finally { fs.closeSync(fd); }
    if(header.slice(0,8).toString('hex')!=='89504e470d0a1a0a' || header.toString('ascii',12,16)!=='IHDR') return null;
    const w=header.readUInt32BE(16),h=header.readUInt32BE(20);
    if(!w||!h||w>4096||h>4096) return null;
    const image=nativeImage.createFromPath(filename);
    if(image.isEmpty())return null;
    const size=image.getSize(),scale=Math.min(800/size.width,600/size.height,1);
    if(!size.width||!size.height||size.width>4096||size.height>4096)return null;
    return image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))}).toDataURL();
  } catch(_){return null;}
}
function start(context,options) {
  const userData=path.join(context.dataRoot,'ui-data'); fs.mkdirSync(userData,{recursive:true}); app.setPath('userData',userData);
  if(!app.requestSingleInstanceLock()){console.error('ALREADY_RUNNING: 游戏库已打开');app.exit(2);return;}
  const seed=adapters.defaults;
  const store=config.createStore(context.dataRoot,seed,adapters.metadata);
  const runner=new Runner(); let window;
  const expected=pathToFileURL(path.join(context.root,'ui/index.html')).href;
  function snapshot() {
    const state=store.read(true);
    if(state.library) state.previews=state.library.games.map(g=>config.object(g)?iconPreview(g.iconPath):null);
    state.metadata=adapters.metadata;state.configPath=store.file;
    return state;
  }
  app.on('second-instance',()=>{if(window){window.show();window.focus();}});
  app.on('ready',()=>{
    window=new BrowserWindow({width:1280,height:840,minWidth:660,minHeight:560,title:'游戏库',webPreferences:{nodeIntegration:false,contextIsolation:true,enableRemoteModule:false,preload:path.join(context.root,'library-preload.js')}});
    window.webContents.on('will-navigate',(event,url)=>{if(url!==expected)event.preventDefault();});
    window.webContents.on('new-window',e=>e.preventDefault());
    window.on('close',event=>{if(runner.busy){event.preventDefault();dialog.showMessageBox(window,{type:'info',message:'请先退出正在运行的游戏，再关闭游戏库。',buttons:['返回游戏库']});}});
    runner.on('state',value=>{if(!window.isDestroyed())window.webContents.send('launcher:state',value);});
    const actions={
      readLibrary:snapshot,
      choosePath:async kind=>{
        const properties={gameDirectory:['openDirectory'],workingDirectory:['openDirectory'],appEntry:['openFile','openDirectory','treatPackageAsDirectory'],runtime:['openFile','openDirectory'],icon:['openFile']};
        if(!Object.prototype.hasOwnProperty.call(properties,kind))throw config.failure('INPUT_INVALID','不支持的文件选择类型');
        const result=await dialog.showOpenDialog(window,{properties:properties[kind],filters:kind==='icon'?[{name:'PNG 图标（最大 4 MiB / 4096×4096）',extensions:['png']}]:undefined});
        return result.canceled?null:result.filePaths[0];
      },
      inspectRuntime:input=>inspectRuntime(input),
      resolveGameRuntime:input=>{
        try {
          const state=store.read();if(state.error)throw config.failure(state.error.code,state.error.message);
          const existing=state.library.games.find(g=>g&&g.id===input.id);
          const resolved=resolveRuntime(Object.assign({},input,{runtimeId:existing&&existing.runtimeId}),state.library);
          return {status:'matched',requiredVersion:resolved.requirement.version,arch:resolved.requirement.arch,evidence:resolved.requirement.evidence,matchedRuntimeId:resolved.runtime.id};
        }catch(error){return {status:({GAME_RUNTIME_UNKNOWN:'unknown',GAME_RUNTIME_CONFLICT:'conflict',RUNTIME_MISSING:'missing'})[error.code]||'incompatible',code:error.code,message:error.message};}
      },
      saveGame:async input=>{
        if(!config.object(input)||!config.object(input.game))throw config.failure('INPUT_INVALID','缺少游戏记录');
        if(Object.prototype.hasOwnProperty.call(input.game,'runtimeId'))throw config.failure('INPUT_INVALID','运行时由程序自动匹配，不接受手选版本');
        const state=store.read();if(state.error)throw config.failure(state.error.code,state.error.message);
        const game=Object.assign({},input.game);
        if(!game.id)game.id='game-'+require('crypto').randomBytes(8).toString('hex');
        const existing=state.library.games.find(g=>g&&g.id===game.id);
        if(existing)game.runtimeId=existing.runtimeId;
        const resolved=resolveRuntime(game,state.library);
        const actual=await inspectRuntime(resolved.runtime.executablePath);
        if(['version','arch','platform','fingerprint'].some(k=>actual[k]!==resolved.runtime[k]))throw config.failure('RUNTIME_MISMATCH','运行时文件已改变，请独立登记新记录');
        game.runtimeId=resolved.runtime.id;
        const fields=config.validateGame(game,state.library,adapters.metadata);
        if(Object.keys(fields).length)throw config.failure('GAME_INVALID','请修正游戏设置',fields);
        checkDataRuntime(game,actual,context);
        const descriptor=adapters.describe(game,actual,context);
        if(!fs.existsSync(descriptor.entry))throw config.failure('ENTRY_UNAVAILABLE','游戏入口不存在：'+descriptor.entry);
        if(runner.busy)throw config.failure('ALREADY_RUNNING','请先停止游戏，不能保存配置');
        store.saveGame(Object.assign({},input,{game}));return Object.assign(snapshot(),{savedGameId:game.id});
      },
      saveRuntime:async input=>{
        if(!config.object(input)||!config.object(input.runtime))throw config.failure('INPUT_INVALID','缺少运行时记录');
        if(input.runtime.id!==undefined)throw config.failure('RUNTIME_IMMUTABLE','运行时身份不可修改，新登记由程序生成新身份');
        const runtime=Object.assign({},await inspectRuntime(input.runtime.executablePath),{id:input.runtime.id,source:input.runtime.source||input.runtime.executablePath});
        if(runner.busy)throw config.failure('ALREADY_RUNNING','游戏运行中不能保存');
        const state=store.saveRuntime(Object.assign({},input,{runtime}));return Object.assign(snapshot(),{savedRuntimeId:state.library.runtimes[state.library.runtimes.length-1].id});
      },
      launchGame:async id=>{
        if(typeof id!=='string')throw config.failure('GAME_INVALID','请选择游戏');
        const state=store.read();if(state.error)throw config.failure(state.error.code,state.error.message);
        const game=state.library.games.find(g=>config.object(g)&&g.id===id);
        if(!game||state.errors.some(e=>e.gameId===id))throw config.failure('GAME_INVALID','游戏配置无效，请编辑修正');
        const resolved=resolveRuntime(game,state.library);
        return runner.start(Object.assign({},game,{runtimeId:resolved.runtime.id}),resolved.runtime,context);
      },
      restoreConfig:input=>{if(!config.object(input))throw config.failure('INPUT_INVALID','缺少恢复请求');store.restore(input.token);return snapshot();}
    };
    ipcMain.handle('launcher:request',async(event,request)=>{
      try {
        if(event.sender!==window.webContents || event.sender.getURL()!==expected) throw config.failure('FORBIDDEN','只允许游戏库页面调用');
        if(!config.object(request)||typeof request.action!=='string'||!Object.prototype.hasOwnProperty.call(actions,request.action))throw config.failure('INPUT_INVALID','不支持的操作');
        if(runner.busy && ['saveGame','saveRuntime','restoreConfig'].includes(request.action))throw config.failure('ALREADY_RUNNING','游戏启动/运行中不能保存或恢复配置');
        return {ok:true,value:await actions[request.action](request.payload)};
      }catch(error){console.error('[library]',error.code||'FAILED',error.message);return {ok:false,code:error.code||'FAILED',message:error.message,fieldErrors:error.fieldErrors};}
    });
    window.loadFile(path.join(context.root,'ui/index.html'));
    if(options.librarySmoke)require('./tests/library-smoke').runUI(window,{store,context,runner}).then(()=>app.exit(0),error=>{console.error(error);if(runner.child)runner.child.kill();app.exit(1);});
  });
  app.on('window-all-closed',()=>app.quit());
}
module.exports={start,iconPreview};
