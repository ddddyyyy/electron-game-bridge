const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cleanupFs=process.versions.electron?require('original-fs'):fs;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-core-'));
function remove(p) {
  if (cleanupFs.lstatSync(p).isDirectory() && !cleanupFs.lstatSync(p).isSymbolicLink()) {
    cleanupFs.readdirSync(p).forEach(n => remove(path.join(p, n)));
    cleanupFs.rmdirSync(p);
  } else cleanupFs.unlinkSync(p);
}
(async () => {
  try {
    const config = require('../core/config');
    const pe=require('../adapters/windows-electron');
    function peFixture(version) {
      const bytes=Buffer.alloc(1024);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\0\0',128);bytes.writeUInt16LE(0x8664,132);bytes.writeUInt16LE(1,134);bytes.writeUInt16LE(0,148);bytes.write('.rdata',152);bytes.writeUInt32LE(512,168);bytes.writeUInt32LE(512,172);bytes.write(' Electron/'+version+' ',512);return bytes;
    }
    const binary=path.join(tmp,'runtime.exe');fs.writeFileSync(binary,peFixture('26.6.10'));assert.strictEqual(pe.inspectWindowsElectron(binary).version,'26.6.10');
    fs.writeFileSync(binary,Buffer.from('Electron/26.6.10'));assert.strictEqual(pe.inspectWindowsElectron(binary),null);
    const conflicted=peFixture('26.6.10');conflicted.write(' Electron/25.0.0 ',600);fs.writeFileSync(binary,conflicted);assert.throws(()=>pe.inspectWindowsElectron(binary),e=>e.code==='GAME_RUNTIME_CONFLICT');

    assert.deepStrictEqual(require('../adapters').defaults(),{schemaVersion:1,revision:0,games:[],runtimes:[]});
    const launch = require('../core/launch');
    const adapters = require('../adapters');
    const profileRoot=path.join(tmp,'profile 日本語');
    require('./save-hook-smoke').copy(path.join(__dirname,'fixtures/tyrano-save'),profileRoot);
    const recognitionGame={installPath:profileRoot,entry:'.',adapterId:'electron-app'};
    const inspectProfile=()=>adapters.inspectSaveProfile?adapters.inspectSaveProfile(recognitionGame):{status:'unsupported'};
    assert.strictEqual(inspectProfile().status,'supported','Known file-storage fixture must be recognized');
    assert.strictEqual(inspectProfile().profile.projectId,'fixture_save');
    const configFile=path.join(profileRoot,'data/system/Config.tjs'),originalConfig=fs.readFileSync(configFile);
    for(const invalid of [';projectID=../escape\n;configSave=file',';projectID=a\n;projectID=b\n;configSave=file',';projectID=fixture_save\n;configSave=webstorage',';projectID=getDynamic()\n;configSave=file']) {
      fs.writeFileSync(configFile,invalid);assert.strictEqual(inspectProfile().status,'unsupported');
    }
    fs.writeFileSync(configFile,originalConfig);
    const storageFile=path.join(profileRoot,'storage.js'),originalStorage=fs.readFileSync(storageFile);
    fs.writeFileSync(storageFile,'// .sav only');assert.strictEqual(inspectProfile().status,'unsupported');
    fs.writeFileSync(storageFile,Buffer.alloc(5*1024*1024+1));assert.strictEqual(inspectProfile().status,'unsupported');
    fs.writeFileSync(storageFile,originalStorage);
    assert.strictEqual(inspectProfile().status,'supported');
    const secondRoot=path.join(tmp,'profile second');require('./save-hook-smoke').copy(path.join(__dirname,'fixtures/tyrano-save'),secondRoot);require('./save-hook-smoke').variant(secondRoot,'fixture_second');
    const secondProfile=adapters.inspectSaveProfile?adapters.inspectSaveProfile(Object.assign({},recognitionGame,{installPath:secondRoot})):{status:'unsupported'};
    assert.strictEqual(secondProfile.status,'supported');assert.strictEqual(secondProfile.profile.layout,'tyrano','Prototype-style clear boundary must be recognized');
    assert(secondProfile.profile.saveIdentity.initMethodHash);assert(secondProfile.profile.saveIdentity.pathMethodHash);
    for(const [name,from,to]of [['engine-layout.js','Save identity mismatch','Changed identity check'],['storage.js',"join(__dirname,'resources')","join(__dirname,'elsewhere')"]]) {
      const file=path.join(secondRoot,name),source=fs.readFileSync(file,'utf8');fs.writeFileSync(file,source.replace(from,to));
      assert.strictEqual(adapters.inspectSaveProfile(Object.assign({},recognitionGame,{installPath:secondRoot})).status,'unsupported','Unknown identity methods must not be trusted');fs.writeFileSync(file,source);
    }
    console.log('PASS: bounded engine profile recognition, declarations and source evidence');
    assert.throws(() => launch.parseArgs(['--library-smoke-test']), /测试|test/i);
    assert.throws(() => launch.parseArgs(['--unknown']), /参数/);
    assert(launch.parseArgs(['--library-smoke-test','--test-root=/tmp/synthetic','-ApplePersistenceIgnoreState','YES']).librarySmoke);
    assert.throws(()=>launch.parseArgs(['--library','-ApplePersistenceIgnoreState','YES']),/参数/);
    assert.throws(() => launch.testRoot(path.resolve(__dirname, '..'), path.resolve(__dirname, '..', '.userdata')), /测试/);
    const root = path.join(tmp, 'game 中文'); fs.mkdirSync(root);
    const runtime = { id: 'runtime-a', executablePath: '/test/electron', version: '26.6.10', platform: 'darwin', arch: 'x64', fingerprint: 'a'.repeat(64), source: 'test' };
    const game = { id: 'game-a', name: '同名', iconPath: null, installPath: root, adapterId: 'electron-app', runtimeId: runtime.id, entry: '.', workingDirectory: '.', args: [], window: null, capabilities: {} };
    const lib = { schemaVersion: 1, revision: 0, games: [game], runtimes: [runtime] };
    assert.deepStrictEqual(config.validateGame(game, lib, adapters.metadata), {});
    assert(config.validateGame(Object.assign({}, game, { name: '' }), lib, adapters.metadata).name);
    assert(config.validateGame(Object.assign({}, game, { entry: '../escape' }), lib, adapters.metadata).entry);
    assert(config.validateGame(Object.assign({}, game, { args: ['--user-data-dir=/other'] }), lib, adapters.metadata).args);
    const alias = path.join(tmp, 'alias'); fs.symlinkSync(root, alias);
    assert(config.validateGame(Object.assign({}, game, { id: 'game-b', installPath: alias }), lib, adapters.metadata).installPath);
    assert(config.validateGame(Object.assign({}, game, { capabilities: { skipPatchCheck: true } }), lib, adapters.metadata).capabilities);
    assert.throws(() => config.decode(Buffer.from('{')), /配置/);
    assert.throws(() => config.decode(Buffer.from(JSON.stringify({ schemaVersion: 3 }))), /版本/);
    const policy={version:1,profileId:'tyrano-file-v1',projectId:'fixture_save',evidenceHash:'a'.repeat(64),location:'install',directoryIdentity:{realPath:root,dev:'1',ino:'2'},backupId:'backup-test',otherSnapshot:{exists:false},hadSaves:true};
    const policyStore=config.createStore(path.join(tmp,'policy-store'),()=>JSON.parse(JSON.stringify(lib)),adapters.metadata);
    const policyFirst=policyStore.read(true),beforePolicy=fs.readFileSync(policyStore.file);
    policyStore.read();assert.deepStrictEqual(fs.readFileSync(policyStore.file),beforePolicy);
    const enabled=policyStore.saveGame({revision:policyFirst.library.revision,token:policyFirst.token,game:Object.assign({},game,{savePolicy:policy})});
    assert.strictEqual(enabled.library.schemaVersion,2);
    assert.deepStrictEqual(fs.readFileSync(policyStore.file+'.v1-original'),beforePolicy);
    assert.deepStrictEqual(enabled.library.games[0].savePolicy,policy);
    const edited=policyStore.saveGame({revision:enabled.library.revision,token:enabled.token,game:Object.assign({},enabled.library.games[0],{name:'edited'})});
    assert.deepStrictEqual(edited.library.games[0].savePolicy,policy);
    const missingPolicy=Object.assign({},edited.library.games[0]);delete missingPolicy.savePolicy;
    const keptPolicy=policyStore.saveGame({revision:edited.library.revision,token:edited.token,game:missingPolicy});
    assert.deepStrictEqual(keptPolicy.library.games[0].savePolicy,policy,'Ordinary editing must not drop save policy');
    const beforeRollback=fs.readFileSync(policyStore.file);fs.writeFileSync(policyStore.file+'.bak',beforePolicy);
    const rolledBack=policyStore.restore(keptPolicy.token);assert.strictEqual(rolledBack.library.schemaVersion,1);assert(!rolledBack.library.games[0].savePolicy);
    assert.deepStrictEqual(fs.readFileSync(policyStore.file),beforePolicy);
    assert(fs.readdirSync(path.dirname(policyStore.file)).filter(n=>n.startsWith('library.json.failed-')).some(n=>fs.readFileSync(path.join(path.dirname(policyStore.file),n)).equals(beforeRollback)));


    assert(config.validateGame(Object.assign({},game,{savePolicy:{version:100}}),Object.assign({},lib,{schemaVersion:2}),adapters.metadata).savePolicy);
    assert.throws(()=>config.decode(Buffer.from(JSON.stringify(Object.assign({},lib,{schemaVersion:3})))),e=>e.code==='CONFIG_VERSION_UNSUPPORTED');
    console.log('PASS: save policy v1/v2 upgrade, original retention and invalid policy rejection');
    assert.throws(() => launch.parseArgs(['--library', '--game=/tmp/game']), e=>e.code==='ARGS_INVALID');
    assert.throws(() => launch.testRoot(path.resolve(__dirname, '..'), root, [root]), /测试/);
    assert(config.validateGame(Object.assign({}, game, { adapterId: 'unknown' }), lib, adapters.metadata).adapterId);
    console.log('PASS: foundational boundaries');
    const store = config.createStore(path.join(tmp, 'store'), () => JSON.parse(JSON.stringify(lib)), adapters.metadata);
    const first = store.read(true); assert.strictEqual(first.library.games.length, 1);
    assert.strictEqual(store.read(true).library.games.length, 1);
    const changed = store.saveGame({ revision: first.library.revision, token: first.token, game: Object.assign({}, game, { name: '新名称' }) });
    assert.strictEqual(store.read().library.games[0].name, '新名称');
    assert.throws(() => store.saveGame({ revision: 0, token: first.token, game }), /配置已变化/);
    const goodBackup = fs.readFileSync(store.file + '.bak');
    fs.writeFileSync(store.file, '{broken');
    const broken = store.read(); assert(broken.error);
    store.restore(broken.token);
    assert.strictEqual(fs.readFileSync(store.file + '.bak').toString(), goodBackup.toString());
    assert(fs.readdirSync(path.dirname(store.file)).some(n => n.startsWith('library.json.failed-')));
    const restored = store.read();
    const immutable = Object.assign({}, runtime, { version: '8.0.0' });
    assert.throws(() => store.saveRuntime({ revision: restored.library.revision, token: restored.token, runtime: immutable }), /不可原位/);
    for(const operation of ['openSync','writeFileSync','fsyncSync','closeSync','renameSync']) {
      for(const at of [1,2]) {
        const directory=path.join(tmp,'fault-'+operation+'-'+at);
        const baseline=config.createStore(directory,()=>JSON.parse(JSON.stringify(lib)),adapters.metadata);
        const original=baseline.read(true),bytes=fs.readFileSync(baseline.file);
        let count=0;const io=Object.assign({},fs);
        io[operation]=function(){if(++count===at)throw Error('injected '+operation);return fs[operation].apply(fs,arguments);};
        const fault=config.createStore(directory,()=>lib,adapters.metadata,io);
        assert.throws(()=>fault.saveGame({revision:original.library.revision,token:original.token,game:Object.assign({},game,{name:'must not persist'})}),e=>e.code==='CONFIG_WRITE_FAILED');
        assert.strictEqual(fs.readFileSync(baseline.file).toString(),bytes.toString());
        config.decode(fs.readFileSync(baseline.file+'.bak'));
      }
    }
    const badRecord={id:'broken',unknown:'preserve'};
    const mixed=JSON.parse(JSON.stringify(lib));mixed.games.push(badRecord);
    fs.writeFileSync(store.file,JSON.stringify(mixed));const withBad=store.read();
    store.saveGame({revision:withBad.library.revision,token:withBad.token,game:Object.assign({},game,{name:'valid remains usable'})});
    assert.deepStrictEqual(store.read().library.games[1],badRecord);
    const many=JSON.parse(JSON.stringify(lib));many.games=Array.from({length:100},(_,i)=>Object.assign({},game,{id:'game-'+i,installPath:path.join(tmp,'bulk',String(i))}));
    assert(many.games.every(g=>Object.keys(config.validateGame(g,many,adapters.metadata)).length===0));
    console.log('PASS: write/backup/fsync/close/rename faults, raw record retention, 100 records');
    console.log('PASS: recoverable configuration');
    assert(config.validateGame(Object.assign({}, game, { adapterId: 'constructor' }), lib, adapters.metadata).adapterId);
    const env = launch.cleanEnv({ ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '-e bad', PATH: '/bin', LAUNCHER_SAVE_CONTEXT:'/untrusted' });
    assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined); assert.strictEqual(env.PATH, '/bin');assert.strictEqual(env.LAUNCHER_SAVE_CONTEXT,undefined);
    const descriptor = adapters.describe(game, runtime, { root: tmp, dataRoot: path.join(tmp, 'data') });
    assert.strictEqual(descriptor.argv[descriptor.argv.length - 1], root);
    assert.deepStrictEqual(descriptor.argv,['--user-data-dir='+descriptor.userData,root]);
    assert.strictEqual(descriptor.cwd, root);
    assert.deepStrictEqual(adapters.describe(Object.assign({},game,{savePolicy:null}),runtime,{root:tmp,dataRoot:path.join(tmp,'data')}),descriptor,'Explicit disable must retain ordinary argv/cwd/userData');
    const fakeProbe = (exe, args, options, cb) => cb(null, 'LAUNCHER_RUNTIME:' + JSON.stringify({ version: '26.6.10', arch: 'x64', platform: 'darwin' }), '');
    const probed = await launch.inspectRuntime(process.execPath, fakeProbe);
    assert.strictEqual(probed.version, '26.6.10');
    await assert.rejects(launch.inspectRuntime(process.execPath, (a,b,c,cb) => cb(Object.assign(new Error('timeout'), { killed:true }))), /超时/);
    // Requirement evidence is separate from probing an executable's version.
    const pkg = path.join(root, 'package.json');
    fs.writeFileSync(pkg, JSON.stringify({name:'fixture',version:'99.0.0',main:'main.js',cpu:['x64'],devDependencies:{electron:'26.6.10'}}));
    const requirement = adapters.runtimeRequirement(game);
    assert.strictEqual(requirement.version, '26.6.10');
    assert.strictEqual(requirement.arch, 'x64');
    assert.strictEqual(launch.resolveRuntime(game, lib).runtime.id, runtime.id);
    fs.writeFileSync(pkg, JSON.stringify({version:'26.6.10',devDependencies:{electron:'^7.0.0'}}));
    assert.throws(() => adapters.runtimeRequirement(game), e => e.code === 'GAME_RUNTIME_UNKNOWN');
    fs.writeFileSync(pkg, JSON.stringify({cpu:['x64'],devDependencies:{electron:'26.6.10'},dependencies:{electron:'8.0.0'}}));
    assert.throws(() => adapters.runtimeRequirement(game), e => e.code === 'GAME_RUNTIME_CONFLICT');
    fs.writeFileSync(pkg, JSON.stringify({main:'main.js',cpu:['x64'],devDependencies:{electron:'26.6.10'}}));
    assert.throws(() => launch.resolveRuntime(game, Object.assign({},lib,{runtimes:[]})), e => e.code === 'RUNTIME_MISSING');
    const profileContext={root:tmp,dataRoot:path.join(tmp,'profiles')};
    const profileGame=Object.assign({},game,{runtimeId:runtime.id});
    launch.checkDataRuntime(profileGame,runtime,profileContext);
    const profile=adapters.describe(profileGame,runtime,profileContext).userData;
    fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'save'),'keep');
    assert.throws(() => launch.checkDataRuntime(profileGame,runtime,profileContext),e=>e.code==='RUNTIME_DATA_INCOMPATIBLE');
    const binding=path.join(profileContext.dataRoot,'games',game.id,'runtime.json');
    fs.writeFileSync(binding,JSON.stringify({version:runtime.version,arch:runtime.arch,platform:runtime.platform,fingerprint:runtime.fingerprint,dataPath:config.canonical(profile)}));
    launch.checkDataRuntime(profileGame,runtime,profileContext);
    assert.throws(()=>launch.checkDataRuntime(profileGame,Object.assign({},runtime,{version:'8.0.0'}),profileContext),e=>e.code==='RUNTIME_DATA_INCOMPATIBLE');
    assert.strictEqual(fs.readFileSync(path.join(profile,'save'),'utf8'),'keep');
    const bundle=path.join(root,'packaged.app');
    for(const [folder,cpu] of [['app.asar','x64'],['app','arm64']]) {
      const directory=path.join(bundle,'Contents/Resources',folder);fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({cpu:[cpu],devDependencies:{electron:'26.6.10'}}));
    }
    assert.throws(()=>adapters.runtimeRequirement(Object.assign({},game,{entry:'packaged.app'})),e=>e.code==='GAME_RUNTIME_CONFLICT');
    const other=Object.assign({},runtime,{id:'runtime-b'});
    assert.strictEqual(launch.resolveRuntime(Object.assign({},game,{runtimeId:'none'}),{runtimes:[other,runtime]}).runtime.id,runtime.id);
    assert.strictEqual(launch.resolveRuntime(Object.assign({},game,{runtimeId:other.id}),{runtimes:[runtime,other]}).runtime.id,other.id);
    const child=new (require('events'))();child.pid=123;
    let spawned;
    const runner=new launch.Runner(async()=>runtime,(exe,argv,options)=>{spawned={exe,argv,options};return child;});
    const stages=[];runner.on('state',s=>stages.push(s.phase));
    const runContext={root:tmp,dataRoot:path.join(tmp,'runner'),logRoot:path.join(tmp,'logs')};
    await runner.start(game,runtime,runContext);assert(runner.busy);assert.strictEqual(spawned.options.shell,false);assert.strictEqual(spawned.options.stdio.length,3);assert.strictEqual(spawned.options.stdio[0],'ignore');assert.strictEqual(typeof spawned.options.stdio[1],'number');assert.strictEqual(spawned.options.stdio[2],spawned.options.stdio[1]);assert.strictEqual(spawned.options.env.LAUNCHER_SAVE_CONTEXT,undefined);
    await assert.rejects(runner.start(game,runtime,runContext),e=>e.code==='ALREADY_RUNNING');
    child.emit('close',0,null);assert(!runner.busy);assert.deepStrictEqual(stages,['validating','starting','running','exited']);
    const adaptedContext={root:tmp,dataRoot:path.join(tmp,'adapted-runner'),logRoot:path.join(tmp,'adapted-logs')};
    const fixturePkg=path.join(profileRoot,'package.json');const fixturePackage=JSON.parse(fs.readFileSync(fixturePkg));fixturePackage.devDependencies.electron=runtime.version;fixturePackage.cpu=['x64'];fs.writeFileSync(fixturePkg,JSON.stringify(fixturePackage));fs.mkdirSync(path.join(profileRoot,'resources'));
    const adaptedGame=Object.assign({},game,{id:'game-adapted',installPath:profileRoot});
    const adaptedLibrary={schemaVersion:2,revision:0,games:[adaptedGame],runtimes:[runtime]};
    const saveService=require('../core/save-policy').create(adaptedContext,{inspect:adapters.inspectSaveProfile,validate:adapters.validateSaveBytes});
    const saveState={token:'unit',library:adaptedLibrary},saveScan=saveService.inspect(adaptedGame,saveState);
    adaptedGame.savePolicy=saveService.apply(adaptedGame,{enabled:true,location:'install',scanToken:saveScan.scanToken},saveState);adaptedContext.library=adaptedLibrary;
    const adaptedChild=new (require('events'))();adaptedChild.pid=456;adaptedChild.stdio=[null,null,null,new (require('stream').PassThrough)()];adaptedChild.kill=()=>{adaptedChild.killed=true;return true;};
    let adaptedSpawn;const adaptedRunner=new launch.Runner(async()=>runtime,(exe,argv,options)=>{adaptedSpawn={exe,argv,options};return adaptedChild;});
    const adaptedStages=[];adaptedRunner.on('state',v=>adaptedStages.push(v.phase));
    await adaptedRunner.start(adaptedGame,runtime,adaptedContext);
    assert.strictEqual(adaptedSpawn.options.stdio[3],'pipe');assert(adaptedSpawn.argv.includes('--require'));assert(!adaptedStages.includes('running'),'PID is not adapter-ready');
    const launchDescription=JSON.parse(fs.readFileSync(adaptedSpawn.options.env.LAUNCHER_SAVE_CONTEXT));
    const frame=(phase,generation)=>JSON.stringify({type:'save-adapter',gameId:adaptedGame.id,nonce:launchDescription.nonce,documentGeneration:generation,phase})+'\n';
    const adapting=frame('adapting',1);adaptedChild.stdio[3].write(adapting.slice(0,12));adaptedChild.stdio[3].write(adapting.slice(12));
    adaptedChild.stdio[3].write(frame('adapter-ready',0));assert(!adaptedStages.includes('running'),'Old document cannot release new document');
    adaptedChild.stdio[3].write(frame('adapter-ready',1));assert.strictEqual(adaptedStages[adaptedStages.length-1],'running');
    adaptedChild.stdio[3].write('x'.repeat(8193));assert(adaptedChild.killed);assert(adaptedRunner.busy,'Do not release busy before child exit');
    adaptedChild.emit('close',1,null);assert(!adaptedRunner.busy);assert.strictEqual(adaptedStages[adaptedStages.length-1],'failed');
    assert(!fs.existsSync(adaptedSpawn.options.env.LAUNCHER_SAVE_CONTEXT));
    for(const fault of ['json','nonce','early-ready','eof','timeout']) {
      const eventChild=new (require('events'))();eventChild.pid=789;eventChild.stdio=[null,null,null,new (require('stream').PassThrough)()];eventChild.kill=()=>{eventChild.killed=true;return true;};
      let eventOptions;const eventRunner=new launch.Runner(async()=>runtime,(_exe,_argv,options)=>{eventOptions=options;return eventChild;});
      const schedule=global.setTimeout;let expired;
      try {
        if(fault==='timeout')global.setTimeout=(fn,ms)=>{if(ms===10000){expired=fn;return schedule(()=>{},60000);}return schedule(fn,ms);};
        await eventRunner.start(adaptedGame,runtime,adaptedContext);
      }finally{global.setTimeout=schedule;}
      if(fault==='json')eventChild.stdio[3].write('{invalid}\n');
      if(fault==='nonce')eventChild.stdio[3].write(JSON.stringify({type:'save-adapter',gameId:adaptedGame.id,nonce:'bad',documentGeneration:1,phase:'adapting'})+'\n');
      if(fault==='early-ready'){const launchContext=JSON.parse(fs.readFileSync(eventOptions.env.LAUNCHER_SAVE_CONTEXT));eventChild.stdio[3].write(JSON.stringify({type:'save-adapter',gameId:adaptedGame.id,nonce:launchContext.nonce,documentGeneration:0,phase:'adapter-ready'})+'\n');}
      if(fault==='eof'){eventChild.stdio[3].end();await new Promise(resolve=>setImmediate(resolve));}
      if(fault==='timeout')expired();
      assert(eventChild.killed,fault);assert(eventRunner.busy,fault+' must await actual exit');eventChild.emit('close',1,null);assert(!eventRunner.busy);
      assert(!fs.existsSync(eventOptions.env.LAUNCHER_SAVE_CONTEXT));
    }
    assert.strictEqual(launch.cleanEnv({LAUNCHER_SAVE_CONTEXT:'/synthetic/stale'}).LAUNCHER_SAVE_CONTEXT,undefined);
    assert(config.validateGame(Object.assign({},game,{args:['--require=untrusted']}),lib,adapters.metadata).args);
    console.log('PASS: adapted entry, bounded status pipe, generations and exit-held busy state');
    const changedProbe=new launch.Runner(async()=>Object.assign({},runtime,{version:'8.0.0'}));
    await assert.rejects(changedProbe.start(game,runtime,runContext),e=>e.code==='RUNTIME_MISMATCH');assert(!changedProbe.busy);
    const failedSpawn=new launch.Runner(async()=>runtime,()=>{throw Error('cannot spawn');});
    await assert.rejects(failedSpawn.start(game,runtime,runContext),/cannot spawn/);assert(!failedSpawn.busy);
    const missingProbe=(a,b,c,cb)=>cb(null,'not a probe');
    await assert.rejects(launch.inspectRuntime(process.execPath,missingProbe),e=>e.code==='RUNTIME_UNAVAILABLE');
    const recoveryDir=path.join(tmp,'recovery-fault');
    const recoveryStore=config.createStore(recoveryDir,()=>JSON.parse(JSON.stringify(lib)),adapters.metadata);recoveryStore.read(true);
    fs.writeFileSync(recoveryStore.file,'{broken');const originalFault=fs.readFileSync(recoveryStore.file),originalBak=fs.readFileSync(recoveryStore.file+'.bak');
    const failIO=Object.assign({},fs,{openSync:()=>{throw Error('cannot preserve original');}});
    const failRestore=config.createStore(recoveryDir,()=>lib,adapters.metadata,failIO);
    assert.throws(()=>failRestore.restore(recoveryStore.read().token),e=>e.code==='RESTORE_FAILED');
    assert.strictEqual(fs.readFileSync(recoveryStore.file).toString(),originalFault.toString());assert.strictEqual(fs.readFileSync(recoveryStore.file+'.bak').toString(),originalBak.toString());
    console.log('PASS: deterministic matching, runner lifecycle/failures, restore protection');
    const packaged=path.join(tmp,'windows-game');fs.mkdirSync(path.join(packaged,'resources'),{recursive:true});const json=Buffer.from(JSON.stringify({files:{'package.json':{size:2,offset:'0'}}}));const headerSize=(8+json.length+3)&~3;const archive=Buffer.alloc(8+headerSize+2);archive.writeUInt32LE(4,0);archive.writeUInt32LE(headerSize,4);archive.writeUInt32LE(headerSize-4,8);archive.writeUInt32LE(json.length,12);json.copy(archive,16);archive.write('{}',8+headerSize);(process.versions.electron?require('original-fs'):fs).writeFileSync(path.join(packaged,'resources/app.asar'),archive);fs.writeFileSync(path.join(packaged,'Game.exe'),peFixture('26.6.10'));
    const nativeGame=Object.assign({},game,{installPath:packaged});
    assert.strictEqual(adapters.applicationEntry(nativeGame),path.join(packaged,'resources/app.asar'));
    assert.strictEqual(adapters.runtimeRequirement(nativeGame).version,'26.6.10');
    assert.strictEqual(adapters.runtimeRequirement(nativeGame).arch,'x64');
    console.log('PASS: evidence, automatic runtime matching and data compatibility');
    console.log('PASS: runtime selection and descriptors');
  } finally { remove(tmp); }
})().catch(error => { console.error(error); process.exitCode = 1; });
