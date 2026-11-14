const assert=require('assert');
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const root=path.resolve(__dirname,'..');
module.exports.runUI = async function (window, services) {
  const {BrowserWindow,dialog}=require('electron');
  const contents=window.webContents;
  const run=expression=>contents.executeJavaScript(expression);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function wait(expression) {for(let i=0;i<300;i++){if(await run(expression))return;await sleep(100);}throw Error('UI timeout: '+expression);}
  async function api(name,value) {const result=await run('window.launcher.'+name+'('+JSON.stringify(value)+').then(value=>({ok:true,value}),error=>({ok:false,message:error.message,code:error.code}))');if(!result.ok)throw Object.assign(Error(result.message),{code:result.code});return result.value;}
  function editable(g){const value=Object.assign({},g);delete value.runtimeId;return value;}
  async function screenshot(name){await sleep(200);fs.writeFileSync(path.join(services.context.test,name+'.png'),(await contents.capturePage()).toPNG());}
  try {
    await new Promise(resolve=>contents.once('did-finish-load',resolve));
    await wait("document.getElementById('games').textContent.includes('还没有游戏')");
    assert.strictEqual(await run("document.querySelectorAll('.game').length"),0);
    assert.strictEqual(await run('typeof require'),'undefined');
    assert.strictEqual(await run('typeof window.launcher.readFile'),'undefined');
    assert.strictEqual(await run("document.getElementById('settings-panel').hidden"),true);
    assert.strictEqual(await run("document.querySelector('select#runtime')===null"),true);
    let state=await api('readLibrary');
    assert(state.configPath.startsWith(services.context.test));
    assert.deepStrictEqual(state.library.games,[]);assert.deepStrictEqual(state.library.runtimes,[]);
    let original;
    await new Promise((resolve,reject)=>cp.execFile(process.execPath,[root,'--library','--library-smoke-test','--test-root='+services.context.test],{env:require('../core/launch').cleanEnv(process.env),timeout:10000},(error,out,err)=>{try{assert(error&&error.code===2,String(error)+out+err);assert((out+err).includes('ALREADY_RUNNING'));resolve();}catch(e){reject(e);}}));

    const originalDialog=dialog.showOpenDialog;
    dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
    try{assert.strictEqual(await api('choosePath','gameDirectory'),null);}finally{dialog.showOpenDialog=originalDialog;}
    await assert.rejects(api('choosePath','arbitrary'),/不支持/);
    const foreign=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
    try{await foreign.loadURL('about:blank');const response=await foreign.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('launcher:request',{action:'readLibrary'})");assert.strictEqual(response.code,'FORBIDDEN');}finally{foreign.destroy();}
    const fixture=path.join(services.context.test,'app 中文');fs.mkdirSync(fixture);
    ['package.json','main.js','index.html'].forEach(n=>fs.copyFileSync(path.join(root,'tests/fixtures/electron-app',n),path.join(fixture,n)));
    const pkgValue=JSON.parse(fs.readFileSync(path.join(fixture,'package.json')));pkgValue.devDependencies.electron=process.versions.electron;pkgValue.cpu=[process.arch];fs.writeFileSync(path.join(fixture,'package.json'),JSON.stringify(pkgValue));
    await run("document.getElementById('add').click()");
    await run("document.getElementById('name').value='<b>应用夹具</b>';document.getElementById('install').value="+JSON.stringify(fixture)+";document.getElementById('args').value='--fixture-exit';document.getElementById('resolve-runtime').click()");
    await wait("document.getElementById('runtime-result').textContent.includes('登记')");
    const beforeCancel=fs.readFileSync(services.store.file).toString();
    await run("document.getElementById('cancel').click()");
    assert.strictEqual(fs.readFileSync(services.store.file).toString(),beforeCancel);
    assert.strictEqual(await run("document.activeElement.id"),'add');
    await run("document.getElementById('add').click();document.getElementById('name').value='未保存输入';document.getElementById('install').value="+JSON.stringify(fixture)+";document.getElementById('args').value='--fixture-exit';document.getElementById('open-runtime').click()");
    await run("document.getElementById('runtime-path').value="+JSON.stringify(process.execPath)+";document.getElementById('inspect').click()");
    await wait("document.getElementById('runtime-status').textContent.includes('已独立登记')");
    await run("document.getElementById('close-runtime').click()");
    assert.strictEqual(await run("document.getElementById('name').value"),'未保存输入');
    // Game cancellation never rolls back an explicitly saved runtime registration.
    await run("document.getElementById('cancel').click()");
    state=await api('readLibrary');assert.strictEqual(state.library.runtimes.length,1);
    await assert.rejects(api('saveRuntime',{revision:state.library.revision,token:state.token,runtime:state.library.runtimes[0]}),e=>e.code==='RUNTIME_IMMUTABLE');
    const companion=path.join(services.context.test,'companion');fs.mkdirSync(companion);
    ['package.json','main.js','index.html'].forEach(n=>fs.copyFileSync(path.join(fixture,n),path.join(companion,n)));
    const seed=await api('saveGame',{revision:state.library.revision,token:state.token,game:{name:'示例应用 B',iconPath:null,installPath:companion,adapterId:'electron-app',entry:'.',workingDirectory:'.',args:['--fixture-exit'],window:null,capabilities:{}}});
    original=JSON.stringify(seed.library.games[0]);await run('reload()');await wait("document.querySelectorAll('.game').length===1");

    await run("document.getElementById('add').click();document.getElementById('name').value='<b>应用夹具</b>';document.getElementById('install').value="+JSON.stringify(fixture)+";document.getElementById('args').value='--fixture-exit';document.getElementById('save').click()");
    await wait("document.querySelectorAll('.game').length===2 && document.getElementById('settings-panel').hidden");
    assert.strictEqual(await run("document.querySelector('#games b')===null"),true);
    state=await api('readLibrary');const game=state.library.games.find(g=>g.id!==state.library.games[0].id);
    assert.strictEqual(JSON.stringify(state.library.games[0]),original);
    assert.strictEqual(await run("document.getElementById('detail-title').textContent"),game.name);
    assert.strictEqual(state.previews[1],null);
    const preview=require('../library-main').iconPreview;
    const tinyImage=path.join(services.context.test,'valid.png');fs.writeFileSync(tinyImage,(await contents.capturePage()).toPNG());assert(preview(tinyImage));

    const badImage=path.join(services.context.test,'corrupt.png');fs.writeFileSync(badImage,'broken');assert.strictEqual(preview(badImage),null);
    const hugeImage=path.join(services.context.test,'huge.png');const header=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(5000,16);header.writeUInt32BE(5000,20);fs.writeFileSync(hugeImage,header);assert.strictEqual(preview(hugeImage),null);
    const bigFile=path.join(services.context.test,'large.png');fs.writeFileSync(bigFile,Buffer.alloc(4*1024*1024+1));assert.strictEqual(preview(bigFile),null);

    await assert.rejects(api('saveGame',{revision:state.library.revision,token:'stale',game:editable(game)}),/配置已变化/);
    await assert.rejects(api('saveGame',{revision:state.library.revision,token:state.token,game}),/自动匹配/);
    await run("document.getElementById('settings').click();document.getElementById('entry').value='missing-entry';document.getElementById('save').click()");
    await wait("document.getElementById('fields-error').textContent.length>0 && !document.getElementById('save').disabled");
    assert.strictEqual(await run("document.getElementById('settings-panel').hidden"),false);
    assert.strictEqual(await run("(()=>{const r=document.querySelector('#settings-panel .panel').getBoundingClientRect();return r.top>=0&&r.top<innerHeight&&r.right<=innerWidth;})()"),true);
    assert.strictEqual(await run("document.getElementById('entry').value"),'missing-entry');
    await screenshot('settings');await run("document.getElementById('cancel').click()");
    const savedBytes=fs.readFileSync(services.store.file).toString();
    const pkg=path.join(fixture,'package.json'),pkgBytes=fs.readFileSync(pkg);
    fs.writeFileSync(pkg,JSON.stringify({main:'main.js',devDependencies:{electron:'^7.0.0'}}));
    const unresolved=await api('resolveGameRuntime',editable(game));assert.strictEqual(unresolved.status,'unknown');
    await assert.rejects(api('saveGame',{revision:state.library.revision,token:state.token,game:editable(game)}),e=>e.code==='GAME_RUNTIME_UNKNOWN');
    assert.strictEqual(fs.readFileSync(services.store.file).toString(),savedBytes);fs.writeFileSync(pkg,pkgBytes);
    await api('launchGame',game.id);
    await assert.rejects(api('launchGame',game.id),/启动中|运行中/);
    await assert.rejects(api('saveGame',{revision:state.library.revision,token:state.token,game:editable(game)}),/不能保存/);
    await assert.rejects(api('restoreConfig',{token:state.token}),/不能保存/);
    assert.strictEqual(await run("document.getElementById('settings').disabled"),true);
    const originalMessageBox=dialog.showMessageBox;dialog.showMessageBox=async()=>({response:0});
    try{window.close();assert.strictEqual(window.isDestroyed(),false);}finally{dialog.showMessageBox=originalMessageBox;}

    const marker=path.join(services.context.dataRoot,'games',game.id,'userdata/initialized.json');
    for(let i=0;i<200&&!fs.existsSync(marker);i++)await sleep(100);
    assert(fs.existsSync(marker),'应用自身初始化未执行');assert.strictEqual(JSON.parse(fs.readFileSync(marker)).version,process.versions.electron);
    for(let i=0;i<200&&services.runner.busy;i++)await sleep(100);assert.strictEqual(services.runner.busy,false);
    const binding=path.join(services.context.dataRoot,'games',game.id,'runtime.json'),bindingBytes=fs.readFileSync(binding);
    const badBinding=JSON.parse(bindingBytes);badBinding.version='8.0.0';fs.writeFileSync(binding,JSON.stringify(badBinding));
    await assert.rejects(api('saveGame',{revision:state.library.revision,token:state.token,game:Object.assign(editable(game),{name:'不应保存'})}),e=>e.code==='RUNTIME_DATA_INCOMPATIBLE');
    assert.strictEqual(fs.readFileSync(services.store.file).toString(),savedBytes);fs.writeFileSync(binding,bindingBytes);
    await api('launchGame',game.id);for(let i=0;i<200&&services.runner.busy;i++)await sleep(100);assert.strictEqual(services.runner.busy,false);

    const changed=Object.assign(editable(game),{name:'夹具 已编辑',iconPath:path.join(services.context.test,'missing.png')});
    const edited=await api('saveGame',{revision:state.library.revision,token:state.token,game:changed});assert.strictEqual(edited.previews[1],null);
    await run('reload()');await wait("document.getElementById('detail-title').textContent==='夹具 已编辑'");
    await screenshot('ui');
    window.setSize(700,760);await sleep(200);assert.strictEqual(await run('document.documentElement.scrollWidth<=innerWidth'),true);await screenshot('narrow');window.setSize(1280,840);
    const backup=fs.readFileSync(services.store.file+'.bak');fs.writeFileSync(services.store.file,'{broken');
    await run('reload()');await wait("!document.getElementById('recovery').hidden");await run("document.getElementById('restore').click()");
    await wait("document.getElementById('recovery').hidden && document.querySelectorAll('.game').length===2");assert.strictEqual(fs.readFileSync(services.store.file+'.bak').toString(),backup.toString());
    assert(fs.readdirSync(path.dirname(services.store.file)).some(n=>n.startsWith('library.json.failed-')));
    console.log('PASS UI: C cards/detail/panels, automatic matching, standalone registration, token/cancel, save compatibility, no image, secure IPC, initialization, busy, recovery; evidence '+services.context.test);
  }catch(error){await screenshot('failure');throw error;}
};
