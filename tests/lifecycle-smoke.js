const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),assert=require('assert');
const launch=require('../core/launch'),adapters=require('../adapters');
const copy=require('./save-hook-smoke').copy;
async function until(predicate){for(let n=0;n<600;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Lifecycle test timed out');}
async function run(executable) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'launcher-lifecycle-'))),gameRoot=path.join(root,'owned game');copy(path.join(__dirname,'fixtures/electron-app'),gameRoot);
  const runtime=Object.assign(await launch.inspectRuntime(executable),{id:'runtime-test'}),pkg=path.join(gameRoot,'package.json');
  const metadata=JSON.parse(fs.readFileSync(pkg));metadata.devDependencies={electron:runtime.version};metadata.cpu=[runtime.arch];fs.writeFileSync(pkg,JSON.stringify(metadata));
  const baseline=path.join(root,'baseline');fs.mkdirSync(baseline);
  const flags=process.platform==='darwin'?['-ApplePersistenceIgnoreState','YES']:[];
  const child=cp.spawn(runtime.executablePath,['--user-data-dir='+baseline,gameRoot,'--fixture-close'].concat(flags),{env:launch.cleanEnv(process.env),cwd:gameRoot,stdio:'ignore'});
  const stopped=new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
  try {
    await until(()=>fs.existsSync(path.join(baseline,'window-closed.json')));
    await new Promise(resolve=>setTimeout(resolve,250));assert.strictEqual(child.exitCode,null,'Original macOS app remains resident after its window closes');assert.strictEqual(child.signalCode,null,'Baseline must remain alive, not crash');
    console.log('PASS: original macOS fixture reproduces the closed-window background process');
  }finally{if(child.exitCode===null)child.kill('SIGTERM');await stopped;}
  for(const mode of ['single','multiple','save-before-quit']) {
    const game={id:'game-'+mode,name:'owned lifecycle',adapterId:'electron-app',installPath:gameRoot,entry:'.',workingDirectory:'.',args:['--fixture-close'].concat(mode==='multiple'?['--fixture-multiple']:mode==='save-before-quit'?['--fixture-save-before-quit']:[]),capabilities:{},iconPath:null,window:null,runtimeId:runtime.id};
    const context={root,dataRoot:path.join(root,'library'),logRoot:path.join(root,'logs'),test:root},runner=new launch.Runner(),states=[];
    runner.on('state',value=>states.push(value));
    try {
      await runner.start(game,runtime,context);assert(runner.busy);
      await until(()=>!runner.busy);assert.strictEqual(states[states.length-1].phase,'exited',JSON.stringify(states));
      const data=adapters.describe(game,runtime,context).userData;
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data,'initialized.json'))).version,runtime.version);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data,'quit.json'))).remaining,0);
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data,'window-closed.json'))).remaining,mode==='multiple'?1:0);
      if(mode==='multiple')assert(fs.existsSync(path.join(data,'second-closed')),'Do not quit while another window is open');
      if(mode==='save-before-quit')assert(fs.existsSync(path.join(data,'save-completed')),'Honor original deferred before-quit saves');
      console.log('PASS: '+runtime.version+' / '+mode+' closes normally and releases Runner busy');
    }finally{if(runner.child)runner.child.kill('SIGTERM');}
  }
  console.log('Isolated lifecycle evidence: '+root);return {root};
}
module.exports={run};
if(require.main===module)run(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
