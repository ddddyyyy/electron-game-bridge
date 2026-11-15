const fs=require('fs');
const path=require('path');
const os=require('os');
const cp=require('child_process');
const assert=require('assert');
function copy(source,target) {
  if(fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target,{recursive:true});
    fs.readdirSync(source).forEach(name=>copy(path.join(source,name),path.join(target,name)));
  } else fs.copyFileSync(source,target);
}
function variant(game,projectId,legacy) {
  ['storage.js','game.js','data/system/Config.tjs','engine-layout.js'].forEach(name=>{
    const file=path.join(game,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/fixture_save/g,projectId));
  });
  if(legacy) {
    const storage=path.join(game,'storage.js');fs.writeFileSync(storage,fs.readFileSync(storage,'utf8').replace(/\$\.removeStorageFile=function[\s\S]*?\n\};/,''));
    const engine=path.join(game,'engine-layout.js');fs.writeFileSync(engine,fs.readFileSync(engine,'utf8').replace('version:520','version:500').replace(/  removeSaveData:function \(\) \{[\s\S]*?\n  \},\n/,'').replace('kag.removeSaveData()','kag.clearVariable()'));
  }
  const page=path.join(game,'index.html');fs.writeFileSync(page,fs.readFileSync(page,'utf8').replace('<script src="game.js">','<script src="engine-layout.js"></script><script src="game.js">'));
}
function execute(executable,args,options) {
  return new Promise((resolve,reject)=>{
    // macOS crash-history dialogs otherwise block ready during fault injection.
    if(process.platform==='darwin')args=args.concat(['-ApplePersistenceIgnoreState','YES']);
    const child=cp.spawn(executable,args,Object.assign({stdio:['ignore','pipe','pipe','pipe']},options));
    let stdout='',stderr='',status='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
    child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>128*1024)child.kill('SIGKILL');});
    child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>128*1024)child.kill('SIGKILL');});
    child.stdio[3].on('data',bytes=>{status+=bytes;if(status.length>64*1024)child.kill('SIGKILL');});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{clearTimeout(timer);if(code===0)resolve({stdout,stderr,status});else reject(Object.assign(Error('Fixture exited '+code+' / '+signal),{stdout,stderr,status,code,signal}));});
  });
}
async function run(executable,options) {
  options=options||{};
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'launcher-save-hook-')));
  const game=path.join(root,'game 日本語'),data=path.join(root,'userdata');
  copy(path.join(__dirname,'fixtures/tyrano-save'),game);
  const projectId=options.layout?'fixture_second':'fixture_save',saveName=projectId+'_sf.sav';
  if(options.layout)variant(game,projectId,options.layout==='legacy');
  fs.mkdirSync(data);fs.mkdirSync(path.join(game,'resources'));
  fs.writeFileSync(path.join(game,saveName),escape(JSON.stringify({progress:10})));
  fs.writeFileSync(path.join(game,'resources',saveName),escape(JSON.stringify({progress:1})));
  const env=require('../core/launch').cleanEnv(process.env);
  await execute(executable,['--user-data-dir='+data,game],{env,cwd:game});
  const result=JSON.parse(fs.readFileSync(path.join(data,'fixture-result.json')));
  const main=JSON.parse(fs.readFileSync(path.join(data,'fixture-main.json')));
  assert.deepStrictEqual(result,{preload:true,old:{progress:1},after:{progress:1}});
  assert.strictEqual(main.appPath,game);assert.strictEqual(main.main,path.join(game,'main.js'));
  assert.strictEqual(main.cwd,game);assert.strictEqual(main.userData,data);
  console.log('PASS: synthetic baseline uses original main/preload and resources save; root save remains separate');
  if(options.baseline)return {root,game,data};
  const profile=require('../adapters').inspectSaveProfile({installPath:game,entry:'.',adapterId:'electron-app'});
  assert.strictEqual(profile.status,'supported',profile.message);
  if(options.layout)assert.strictEqual(profile.profile.layout,'tyrano');
  const contextFile=path.join(root,'save-context.json');
  fs.writeFileSync(contextFile,JSON.stringify({version:1,gameId:'game-fixture',nonce:'a'.repeat(32),profile:profile.profile,selectedDirectory:game}),{mode:0o600});
  const hook=path.resolve(__dirname,'../adapters/tyrano-save/main-hook.js');
  async function adapted(action,overrideHook) {
    const output=path.join(data,'fixture-result.json');if(fs.existsSync(output))fs.unlinkSync(output);
    const flags=fs.existsSync(hook)?['--require',overrideHook||hook]:[];
    const execution=await execute(executable,['--user-data-dir='+data].concat(flags,[game],action?['--fixture-action='+action]:[]),{env:Object.assign({},env,{LAUNCHER_SAVE_CONTEXT:contextFile}),cwd:game});
    return {execution,result:fs.existsSync(output)?JSON.parse(fs.readFileSync(output)):null};
  }
  const adaptedRead=await adapted();
  assert.deepStrictEqual(adaptedRead.result.old,{progress:10},'First synchronous read must use the selected game directory');
  assert.strictEqual(adaptedRead.result.preload,true);
  const afterMain=JSON.parse(fs.readFileSync(path.join(data,'fixture-main.json')));
  ['appPath','main','name','version','cwd','userData'].forEach(key=>assert.strictEqual(afterMain[key],main[key],key));
  assert.strictEqual(unescape(fs.readFileSync(path.join(game,'resources',saveName),'utf8')),JSON.stringify({progress:1}));
  console.log('PASS: selected save is read before initialization, original main/preload identity is preserved');
  const reloaded=await adapted('reload');
  const messages=reloaded.execution.status.trim().split('\n').map(line=>JSON.parse(line));
  const ready=messages.filter(item=>item.phase==='adapter-ready');
  assert.strictEqual(ready.length,2);assert(ready[1].documentGeneration>ready[0].documentGeneration);
  assert.deepStrictEqual(reloaded.result.old,{progress:10});
  console.log('PASS: original reload rearms guard with a fresh document generation');
  async function rejected(action,overrideHook) {
    await assert.rejects(adapted(action,overrideHook),error=>{assert.strictEqual(error.signal,null,'Guard failures must exit cleanly, not crash');assert.strictEqual(error.code,1);return true;});
    assert(!fs.existsSync(path.join(data,'fixture-result.json')),'Game initialization must not continue after a fatal guard failure');
    assert.strictEqual(unescape(fs.readFileSync(path.join(game,'resources',saveName),'utf8')),JSON.stringify({progress:1}));
  }
  const rootSave=path.join(game,saveName),originalSave=fs.readFileSync(rootSave);
  fs.writeFileSync(rootSave,'%7Bbroken');await rejected();assert.strictEqual(fs.readFileSync(rootSave,'utf8'),'%7Bbroken');fs.writeFileSync(rootSave,originalSave);
  const mainFile=path.join(game,'main.js'),mainSource=fs.readFileSync(mainFile,'utf8');
  for(const source of [mainSource.replace('contextIsolation:false','contextIsolation:true'),mainSource.replace('sandbox:false','sandbox:true'),mainSource.replace('sandbox:false',"sandbox:false,partition:'persist:foreign'")]) {
    fs.writeFileSync(mainFile,source);await rejected();fs.writeFileSync(mainFile,mainSource);
  }
  const faultRoot=path.join(root,'fault-hook');fs.mkdirSync(faultRoot);
  fs.copyFileSync(hook,path.join(faultRoot,'main-hook.js'));
  const guardSource=fs.readFileSync(path.join(path.dirname(hook),'preload.js'),'utf8');
  fs.writeFileSync(path.join(faultRoot,'preload.js'),guardSource.replace("ipc=require('electron').ipcRenderer;","ipc=require('electron').ipcRenderer;throw Error('injected installation failure');"));
  await rejected(undefined,path.join(faultRoot,'main-hook.js'));
  fs.writeFileSync(path.join(faultRoot,'preload.js'),'invalid syntax @');await rejected(undefined,path.join(faultRoot,'main-hook.js'));
  const storageFile=path.join(game,'storage.js'),storageSource=fs.readFileSync(storageFile,'utf8');
  fs.writeFileSync(storageFile,storageSource.replace('$.getStorageFile=function','$.missingMethod=function'));await rejected();fs.writeFileSync(storageFile,storageSource);
  assert.deepStrictEqual(fs.readFileSync(rootSave),originalSave);
  console.log('PASS: malformed saves, missing definitions, unsupported preferences/session, guard installation/syntax faults stop before game initialization and preserve saves');
  const saveContext={dataRoot:path.join(root,'library')};
  const saveGame={id:'game-fixture',installPath:game,entry:'.',workingDirectory:'.',adapterId:'electron-app',args:[]};
  const library={schemaVersion:2,revision:0,games:[saveGame],runtimes:[]};
  const service=require('../core/save-policy').create(saveContext,{inspect:require('../adapters').inspectSaveProfile,validate:require('../adapters').validateSaveBytes});
  const slotFile=path.join(game,projectId+'_tyrano_data.sav');
  if(options.layout)fs.writeFileSync(slotFile,escape(JSON.stringify({kind:'save',hash:'confirmed-root-identity',data:[]})));
  const slotBytes=options.layout?fs.readFileSync(slotFile):null;
  const state={token:'fixture',library},scan=service.inspect(saveGame,state);
  saveGame.savePolicy=service.apply(saveGame,{enabled:true,location:'install',scanToken:scan.scanToken},state);
  const description=JSON.parse(fs.readFileSync(contextFile));Object.assign(description,{game:saveGame,library,context:saveContext});fs.writeFileSync(contextFile,JSON.stringify(description));
  const saved=await adapted('save');assert.deepStrictEqual(saved.result.after,{progress:2},'Protected save must persist new progress');
  const resumed=await adapted();assert.deepStrictEqual(resumed.result.old,{progress:2});
  if(options.layout) {
    assert.deepStrictEqual(fs.readFileSync(slotFile),slotBytes,'Origin binding must not rewrite confirmed save data');
    fs.writeFileSync(slotFile,escape(JSON.stringify({kind:'save',hash:'unconfirmed-external-identity',data:[]})));
    const unexpected=fs.readFileSync(slotFile);await rejected();assert.deepStrictEqual(fs.readFileSync(slotFile),unexpected,'Changed origin must not be silently trusted');
    fs.writeFileSync(slotFile,slotBytes);
    console.log('PASS: existing userData origin switches only to the confirmed backup; changed origin is rejected without rewriting saves');
  }
  await adapted('cancel-clear');assert(fs.existsSync(rootSave));
  await adapted('clear');assert.strictEqual(fs.existsSync(rootSave),options.layout==='legacy');
  const empty=await adapted('reload');assert.deepStrictEqual(empty.result.old,options.layout==='legacy'?{}:null);
  await adapted('save');assert.deepStrictEqual((await adapted()).result.old,{progress:2});
  if(options.layout){await adapted('reset');assert.deepStrictEqual((await adapted()).result.old,{});await adapted('save');}
  console.log('PASS: protected write/restart, original clear cancellation/success and reload/new progress ('+(options.layout||'fixture')+')');

  return {root,game,data};
}
module.exports={run,copy,execute,variant};
if(require.main===module)run(process.argv[2],{baseline:process.argv.includes('--baseline'),layout:process.argv.includes('--legacy-layout')?'legacy':process.argv.includes('--engine-layout')?'tyrano':undefined}).catch(error=>{console.error(error);process.exitCode=1;});
