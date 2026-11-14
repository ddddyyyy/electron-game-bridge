const fs = require('fs');
const path = require('path');
const { failure, inside, canonical } = require('./config');
function parseArgs(args) {
  const result={library:true,librarySmoke:false};
  const seen=new Set();
  args.forEach(arg=>{
    const key=arg.split('=')[0];
    if(seen.has(key))throw failure('ARGS_INVALID','重复参数：'+key);
    seen.add(key);
    if(arg==='--library')return;
    if(arg==='--library-smoke-test')result.librarySmoke=true;
    else if(arg.startsWith('--test-root=')&&arg.slice(12))result.test=path.resolve(arg.slice(12));
    else throw failure('ARGS_INVALID','不支持的参数：'+arg);
  });
  if(result.librarySmoke!==!!result.test)throw failure('ARGS_INVALID','测试模式必须同时提供专用测试目录');
  return result;
}
function testRoot(root, target, protectedPaths) {
  const p = canonical(target);
  const safeDefault = canonical(path.join(root, '.test-saves'));
  const denied = [path.join(root, '.userdata'), path.join(root, '.launcher')].concat(protectedPaths || []);
  if (p === canonical(root) || p === path.parse(p).root || inside(p, root) || denied.some(d => inside(d, p) || inside(p, d)) || (inside(root, p) && p !== safeDefault && !inside(path.join(root, '.test-launcher'), p))) throw failure('TEST_ROOT_INVALID', '测试目录与正式数据重叠或不安全');
  return p;
}
module.exports = { parseArgs, testRoot };
function cleanEnv(source) {
  const env = Object.assign({}, source);
  ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','ELECTRON_FORCE_IS_PACKAGED'].forEach(k => delete env[k]);
  return env;
}
function removeTree(p) {
  if (!fs.existsSync(p)) return;
  if (fs.lstatSync(p).isDirectory() && !fs.lstatSync(p).isSymbolicLink()) {
    fs.readdirSync(p).forEach(n => removeTree(path.join(p,n))); fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}
async function inspectRuntime(input, execute) {
  const os = require('os');
  const config = require('./config');
  let executablePath = input;
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw failure('RUNTIME_UNAVAILABLE','请选择本地运行环境绝对路径');
  if (input.endsWith('.app')) executablePath = path.join(input, 'Contents/MacOS/Electron');
  try { executablePath = fs.realpathSync(executablePath); fs.accessSync(executablePath,fs.constants.X_OK); if (!fs.statSync(executablePath).isFile()) throw Error('不是文件'); }
  catch (error) { throw failure('RUNTIME_UNAVAILABLE','运行环境不可执行：'+error.message); }
  const fingerprint = config.sha(fs.readFileSync(executablePath));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'launcher-probe-'));
  try {
    const stdout = await new Promise((resolve,reject) => {
      (execute || require('child_process').execFile)(executablePath,
        ['--user-data-dir='+temp, path.join(__dirname,'runtime-probe'), '--probe-data='+temp],
        { env:cleanEnv(process.env), timeout:10000, maxBuffer:64*1024, killSignal:'SIGKILL' },
        (error,out) => error ? reject(failure(error.killed ? 'RUNTIME_PROBE_TIMEOUT' : 'RUNTIME_UNAVAILABLE',error.killed ? '运行环境探测超时' : '运行环境探测失败：'+error.message)) : resolve(out));
    });
    const line = stdout.split(/\r?\n/).find(l=>l.startsWith('LAUNCHER_RUNTIME:'));
    if (!line) throw failure('RUNTIME_UNAVAILABLE','无法识别 Electron 运行环境；请选择原始 Electron 发行包');
    let info;
    try { info = JSON.parse(line.slice(17)); } catch (_) { throw failure('RUNTIME_UNAVAILABLE','运行环境探针结果无效'); }
    const runtime = Object.assign({},info,{executablePath,fingerprint,source:input});
    if (Object.keys(config.runtimeErrors(Object.assign({id:'probe'},runtime))).length) throw failure('RUNTIME_UNAVAILABLE','运行环境版本或平台不支持');
    return runtime;
  } finally { try { removeTree(temp); } catch (_) { /* 已退出探针的临时目录可能暂被系统占用。 */ } }
}
class Runner extends require('events') {
  constructor(probe, spawn) { super(); this.probe=probe || inspectRuntime; this.spawn=spawn || require('child_process').spawn; this.busy=false; }
  state(game, phase, details) { this.emit('state',Object.assign({gameId:game.id,phase},details)); }
  async start(game,runtime,context) {
    if (this.busy) throw failure('ALREADY_RUNNING','已有游戏启动中或运行中');
    this.busy=true; this.state(game,'validating');
    try {
      const { validateGame } = require('./config');
      const adapters = require('../adapters');
      const fields=validateGame(game,{games:[game],runtimes:[runtime]},adapters.metadata);
      if(Object.keys(fields).length) throw failure('GAME_INVALID','游戏配置无效',fields);
      const actual=await this.probe(runtime.executablePath);
      if(['version','arch','platform','fingerprint'].some(k=>actual[k]!==runtime[k])) throw failure('RUNTIME_MISMATCH','运行环境文件/版本已变化，请登记新记录');
      const resolved=resolveRuntime(game,{runtimes:[runtime]});
      checkDataRuntime(game,actual,context);
      const descriptor=adapters.describe(game,runtime,context);
      if(!fs.existsSync(descriptor.entry)) throw failure('ENTRY_UNAVAILABLE','游戏入口不存在：'+descriptor.entry);
      fs.accessSync(descriptor.cwd,fs.constants.R_OK);
      fs.mkdirSync(descriptor.userData,{recursive:true});
      fs.accessSync(descriptor.userData,fs.constants.W_OK);
      const binding=bindingPath(game,context);
      const identity=Object.assign(runtimeIdentity(actual),{runtimeId:runtime.id,dataPath:canonical(descriptor.userData),evidence:resolved.requirement.evidence});
      fs.mkdirSync(path.dirname(binding),{recursive:true});
      if(!fs.existsSync(binding)) {
        let fd;
        try {fd=fs.openSync(binding,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(identity));fs.fsyncSync(fd);}
        finally {if(fd!==undefined)fs.closeSync(fd);}
      }
      const logPath=path.join(context.logRoot,game.id+'.log'); fs.mkdirSync(context.logRoot,{recursive:true});
      const log=fs.openSync(logPath,'a',0o600);
      fs.writeSync(log,JSON.stringify({gameId:game.id,runtimeId:runtime.id,version:actual.version,arch:actual.arch,phase:'starting',time:new Date().toISOString()})+'\n');
      this.state(game,'starting');
      let child;
      try { child=this.spawn(descriptor.executablePath,descriptor.argv,{cwd:descriptor.cwd,env:cleanEnv(descriptor.env||process.env),shell:false,stdio:['ignore',log,log]}); }
      finally { fs.closeSync(log); }
      this.child=child;
      let finished=false;
      const done=(phase,details)=>{if(finished)return;finished=true;this.busy=false;this.child=null;this.state(game,phase,details);};
      child.once('error',e=>done('failed',{code:'LAUNCH_FAILED',message:e.message}));
      child.once('close',(code,signal)=>done(code===0?'exited':'failed',{code:code===0?'GAME_EXITED':'LAUNCH_FAILED',exitCode:code,signal,message:code===0?'游戏已退出':'游戏退出，代码 '+code+'；请查看 '+logPath}));
      if(child.pid) this.state(game,'running',{pid:child.pid,message:'进程已启动（不代表完整游戏已验证）',version:actual.version,arch:actual.arch});
      return {gameId:game.id,phase:'starting',pid:child.pid,logPath};
    } catch(error) { this.busy=false;this.state(game,'failed',{code:error.code||'LAUNCH_FAILED',message:error.message});throw error; }
  }
}
Object.assign(module.exports,{ cleanEnv, inspectRuntime, Runner, removeTree });

function resolveRuntime(game,library) {
  const config=require('./config');
  const requirement=require('../adapters').runtimeRequirement(game);
  const candidates=library.runtimes.filter(r=>config.object(r)&&!Object.keys(config.runtimeErrors(r)).length&&r.version===requirement.version&&r.arch===requirement.arch&&r.platform===process.platform);
  candidates.sort((a,b)=>a.id===game.runtimeId?-1:b.id===game.runtimeId?1:a.id<b.id?-1:a.id>b.id?1:0);
  if(!candidates.length)throw failure('RUNTIME_MISSING','需要 Electron '+requirement.version+' / '+requirement.arch+'，请在运行环境入口独立登记本地文件后重试自动匹配');
  return {requirement,runtime:candidates[0]};
}
function runtimeIdentity(runtime) {return {version:runtime.version,arch:runtime.arch,platform:runtime.platform,fingerprint:runtime.fingerprint};}
function bindingPath(game,context) {return path.join(context.dataRoot,'games',game.id,'runtime.json');}
function checkDataRuntime(game,runtime,context) {
  const adapters=require('../adapters');
  const descriptor=adapters.describe(game,runtime,context);
  const binding=bindingPath(game,context),identity=runtimeIdentity(runtime);
  if(fs.existsSync(binding)) {
    let old;try{old=JSON.parse(fs.readFileSync(binding,'utf8'));}catch(_){throw failure('RUNTIME_DATA_INCOMPATIBLE','运行数据的版本记录损坏，原数据已保留');}
    if(!old||Object.keys(identity).some(k=>old[k]!==identity[k])||old.dataPath!==canonical(descriptor.userData))throw failure('RUNTIME_DATA_INCOMPATIBLE','已有数据绑定与运行环境或数据目录不兼容，原配置与数据已保留');
  } else if(fs.existsSync(descriptor.userData)&&fs.readdirSync(descriptor.userData).length) {
    throw failure('RUNTIME_DATA_INCOMPATIBLE','已有数据缺少可验证运行环境绑定，不能猜测或重置');
  }
}
Object.assign(module.exports,{resolveRuntime,checkDataRuntime,runtimeIdentity});
