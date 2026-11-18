const fs = require('fs');
const path = require('path');
const { failure, inside, canonical } = require('./config');
function parseArgs(args) {
  args=args.slice();
  if(args.includes('--library-smoke-test')) {
    const preference=args.indexOf('-ApplePersistenceIgnoreState');
    if(preference>=0&&args[preference+1]==='YES')args.splice(preference,2);
  }
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
  ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','ELECTRON_FORCE_IS_PACKAGED','LAUNCHER_SAVE_CONTEXT'].forEach(k => delete env[k]);
  return env;
}
function removeTree(p) {
  // Cleanup must see physical ASAR files, not Electron's virtual directories.
  const physicalFs=process.versions.electron?require('original-fs'):fs;
  let stat;try{stat=physicalFs.lstatSync(p);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    physicalFs.readdirSync(p).forEach(n => removeTree(path.join(p,n))); physicalFs.rmdirSync(p);
  } else physicalFs.unlinkSync(p);
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
    // A first macOS launch of a recent Electron build can exceed 20 seconds.
    const stdout = await new Promise((resolve,reject) => {
      (execute || require('child_process').execFile)(executablePath,
        ['--user-data-dir='+temp, path.join(__dirname,'runtime-probe'), '--probe-data='+temp],
        { env:cleanEnv(process.env), timeout:60000, maxBuffer:64*1024, killSignal:'SIGKILL' },
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
    let contextFile;
    try {
      const { validateGame } = require('./config');
      const adapters = require('../adapters');
      const library=context.library||{schemaVersion:game.savePolicy?2:1,games:[game],runtimes:[runtime]};
      const fields=validateGame(game,library,adapters.metadata);
      if(Object.keys(fields).length) throw failure('GAME_INVALID','游戏配置无效',fields);
      const actual=await this.probe(runtime.executablePath);
      if(['version','arch','platform','fingerprint'].some(k=>actual[k]!==runtime[k])) throw failure('RUNTIME_MISMATCH','运行环境文件/版本已变化，请登记新记录');
      const resolved=resolveRuntime(game,{runtimes:[runtime]});
      checkDataRuntime(game,actual,context);
      const descriptor=adapters.describe(game,runtime,context);
      let nonce;
      if(game.savePolicy) {
        const policies=require('./save-policy').create(context,{inspect:adapters.inspectSaveProfile,validate:adapters.validateSaveBytes});
        const verified=policies.validate(game,library);
        nonce=require('crypto').randomBytes(16).toString('hex');
        contextFile=path.join(context.dataRoot,'games',game.id,'launch-'+nonce+'.json');
        fs.mkdirSync(path.dirname(contextFile),{recursive:true,mode:0o700});
        const ownedGame={id:game.id,installPath:game.installPath,entry:game.entry,adapterId:game.adapterId,savePolicy:game.savePolicy};
        const ownership={games:library.games.map(g=>({id:g&&g.id,savePolicy:g&&g.savePolicy?{directoryIdentity:g.savePolicy.directoryIdentity}:null}))};
        const value={version:1,gameId:game.id,nonce,profile:verified.profile,selectedDirectory:game.savePolicy.directoryIdentity.realPath,game:ownedGame,library:ownership,context:{dataRoot:context.dataRoot}};
        const fd=fs.openSync(contextFile,'wx',0o600);
        try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      }
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
      const env=cleanEnv(descriptor.env||process.env);if(contextFile)env.LAUNCHER_SAVE_CONTEXT=contextFile;
      try { child=this.spawn(descriptor.executablePath,descriptor.argv,{cwd:descriptor.cwd,env,shell:false,stdio:contextFile?['ignore',log,log,'pipe']:['ignore',log,log]}); }
      finally { fs.closeSync(log); }
      this.child=child;
      let finished=false,timer,failureDetails,ready=false,generation=0,pageBytes=0;
      const cleanup=()=>{clearTimeout(timer);if(contextFile&&fs.existsSync(contextFile))fs.unlinkSync(contextFile);};
      const done=(phase,details)=>{if(finished)return;finished=true;cleanup();this.busy=false;this.child=null;this.state(game,phase,details);};
      const stop=(code,message)=>{
        if(failureDetails||finished)return;failureDetails={code,message};clearTimeout(timer);
        child.kill('SIGTERM');timer=setTimeout(()=>{if(!finished)child.kill('SIGKILL');},1000);
      };
      const deadline=()=>{clearTimeout(timer);timer=setTimeout(()=>stop('SAVE_HOOK_TIMEOUT','存档适配未就绪，已停止游戏'),10000);};
      child.once('error',e=>{if(contextFile&&child.pid)stop('SAVE_HOOK_FAILED',e.message);else done('failed',{code:'LAUNCH_FAILED',message:e.message});});
      child.once('close',(code,signal)=>{
        if(contextFile&&!ready&&!failureDetails)failureDetails={code:'SAVE_HOOK_FAILED',message:'游戏退出前存档适配未完成'};
        done(failureDetails?'failed':code===0?'exited':'failed',failureDetails||{code:code===0?'GAME_EXITED':'LAUNCH_FAILED',exitCode:code,signal,message:code===0?'游戏已退出':'游戏退出，代码 '+code+'；请查看 '+logPath});
      });
      if(contextFile) {
        this.state(game,'adapting',{pid:child.pid,message:'正在建立存档保护…'});deadline();
        const pipe=child.stdio&&child.stdio[3];let buffer='';const decoder=new (require('string_decoder').StringDecoder)('utf8');
        if(!pipe)stop('SAVE_HOOK_FAILED','存档状态管道不可用');
        else {
          pipe.on('data',bytes=>{
            if(failureDetails||finished)return;
            buffer+=decoder.write(bytes);
            try {
              let newline;
              while((newline=buffer.indexOf('\n'))!==-1) {
                const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
                if(Buffer.byteLength(line)>8192)throw Error('存档状态消息超限');
                const value=JSON.parse(line);
                if(value.type!=='save-adapter'||value.gameId!==game.id||value.nonce!==nonce||!Number.isSafeInteger(value.documentGeneration)||value.documentGeneration<0)throw Error('存档状态来源无效');
                if(value.documentGeneration<generation)continue;
                if(value.phase==='adapting') {
                  if(value.documentGeneration<=generation)throw Error('页面接入顺序无效');
                  generation=value.documentGeneration;pageBytes=0;ready=false;deadline();this.state(game,'adapting',{message:'正在重新建立存档保护…'});
                }
                pageBytes+=Buffer.byteLength(line)+1;if(pageBytes>65536)throw Error('页面存档状态消息总量超限');
                if(value.phase==='adapter-ready') {
                  if(generation===0||value.documentGeneration!==generation||ready)throw Error('存档就绪状态顺序无效');
                  ready=true;clearTimeout(timer);this.state(game,'running',{pid:child.pid,message:'存档适配已就绪（不代表完整游戏已验证）',version:actual.version,arch:actual.arch});
                }else if(value.phase==='failed')stop(value.code||'SAVE_HOOK_FAILED',value.message||'存档适配失败');
                else if(value.phase!=='adapting')throw Error('未知存档状态');
              }
              if(Buffer.byteLength(buffer)>8192)throw Error('存档状态消息超限');
            }catch(error){stop('SAVE_HOOK_FAILED',error.message);}
          });
          pipe.once('end',()=>{if(!ready)stop('SAVE_HOOK_FAILED','存档状态通道提前关闭');});
          pipe.once('error',error=>stop('SAVE_HOOK_FAILED',error.message));
        }
      }else if(child.pid)this.state(game,'running',{pid:child.pid,message:'进程已启动（不代表完整游戏已验证）',version:actual.version,arch:actual.arch});
      return {gameId:game.id,phase:'starting',pid:child.pid,logPath};
    } catch(error) { if(contextFile&&fs.existsSync(contextFile))fs.unlinkSync(contextFile);this.busy=false;this.state(game,'failed',{code:error.code||'LAUNCH_FAILED',message:error.message});throw error; }
  }
}
Object.assign(module.exports,{ cleanEnv, inspectRuntime, Runner, removeTree });

function resolveRuntime(game,library) {
  const config=require('./config');
  const requirement=require('../adapters').runtimeRequirement(game);
  const candidates=library.runtimes.filter(r=>config.object(r)&&!Object.keys(config.runtimeErrors(r)).length&&r.version===requirement.version&&r.arch===requirement.arch&&r.platform===process.platform);
  candidates.sort((a,b)=>a.id===game.runtimeId?-1:b.id===game.runtimeId?1:a.id<b.id?-1:a.id>b.id?1:0);
  if(!candidates.length)throw Object.assign(failure('RUNTIME_MISSING','需要 Electron '+requirement.version+' / '+requirement.arch+'，请从官网安装匹配版本，或添加已有的 Electron'),{requirement});
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
