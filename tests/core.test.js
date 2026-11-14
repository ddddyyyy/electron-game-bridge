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
    assert.throws(() => launch.parseArgs(['--library-smoke-test']), /测试|test/i);
    assert.throws(() => launch.parseArgs(['--unknown']), /参数/);
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
    assert.throws(() => config.decode(Buffer.from(JSON.stringify({ schemaVersion: 2 }))), /版本/);
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
    const env = launch.cleanEnv({ ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '-e bad', PATH: '/bin' });
    assert.strictEqual(env.ELECTRON_RUN_AS_NODE, undefined); assert.strictEqual(env.PATH, '/bin');
    const descriptor = adapters.describe(game, runtime, { root: tmp, dataRoot: path.join(tmp, 'data') });
    assert.strictEqual(descriptor.argv[descriptor.argv.length - 1], root);
    assert.deepStrictEqual(descriptor.argv,['--user-data-dir='+descriptor.userData,root]);
    assert.strictEqual(descriptor.cwd, root);
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
    await runner.start(game,runtime,runContext);assert(runner.busy);assert.strictEqual(spawned.options.shell,false);
    await assert.rejects(runner.start(game,runtime,runContext),e=>e.code==='ALREADY_RUNNING');
    child.emit('close',0,null);assert(!runner.busy);assert.deepStrictEqual(stages,['validating','starting','running','exited']);
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
