const fs = require('fs');
const path = require('path');
const metadata = {
  'electron-app': { label: 'Electron 应用自身入口', window: false, args: true, capabilities: {} }
};
function defaults() {
  return { schemaVersion: 1, revision: 0, runtimes: [], games: [] };
}
module.exports = { metadata, defaults };
module.exports.inspectSaveProfile=game=>require('./tyrano-save/profile').inspect(game);
module.exports.validateSaveBytes=(bytes,name)=>require('./tyrano-save/profile').validateSaveBytes(bytes,name);
module.exports.encodeSave=(value,name)=>require('./tyrano-save/profile').encodeSave(value,name);
function describe(game,runtime,context) {
  const entry = applicationEntry(game);
  const cwd = path.resolve(game.installPath,game.workingDirectory);
  const userData=path.join(context.dataRoot,'games',game.id,'userdata');
  if(game.adapterId!=='electron-app')throw new Error('不支持的启动方式');
  const argv=['--user-data-dir='+userData,'--require',path.join(__dirname,'electron-lifecycle.js'),entry].concat(game.args);
  if(game.savePolicy)argv.splice(1,0,'--require',path.join(__dirname,'tyrano-save/main-hook.js'));
  if(context.test&&process.platform==='darwin')argv.push('-ApplePersistenceIgnoreState','YES');
  return {executablePath:runtime.executablePath,argv,cwd,userData,entry,env:Object.assign({},process.env)};
}
module.exports.describe=describe;
// Only shipped metadata is read; this never executes a game's main module.
function runtimeRequirement(game) {
  const {failure,inside}=require('../core/config');
  if(game.adapterId!=='electron-app')throw failure('GAME_INVALID','不支持的启动方式');
  if(typeof game.installPath!=='string'||!path.isAbsolute(game.installPath)||typeof game.entry!=='string'||!inside(game.installPath,path.resolve(game.installPath,game.entry)))throw failure('GAME_INVALID','请选择有效安装目录和内部入口');
  const entry=applicationEntry(game);
  const candidates=entry.endsWith('.app')?[path.join(entry,'Contents/Resources/app.asar/package.json'),path.join(entry,'Contents/Resources/app/package.json')]:[path.join(entry,'package.json')];
  const versions=[], evidence=[],arches=[];let arch;
  for(const file of candidates) {
    if(!fs.existsSync(file))continue;
    let pkg;try{if(fs.statSync(file).size>1024*1024)throw Error('元数据过大');pkg=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){throw failure('GAME_RUNTIME_UNKNOWN','无法读取游戏版本证据：'+e.message);}
    if(!pkg||typeof pkg!=='object'||Array.isArray(pkg))throw failure('GAME_RUNTIME_UNKNOWN','游戏 package.json 顶层必须为对象');
    for(const key of ['dependencies','devDependencies']) {
      const value=pkg[key]&&pkg[key].electron;
      if(typeof value==='string'&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)){versions.push(value);evidence.push(file+' · '+key+'.electron = '+value);}
    }
    if(pkg.cpu!==undefined) {
      if(!Array.isArray(pkg.cpu)||!pkg.cpu.length||pkg.cpu.some(a=>!['x64','arm64'].includes(a)))throw failure('GAME_RUNTIME_UNKNOWN','cpu 架构声明不支持；需要明确的 x64/arm64');
      arch=pkg.cpu.includes(process.arch)?process.arch:pkg.cpu[0];arches.push(arch);
    }
  }
  const runtimeRoot=path.basename(path.dirname(entry))==='resources'?path.dirname(path.dirname(entry)):game.installPath;
  for(const bundled of require('./windows-electron').packagedRuntimeEvidence(runtimeRoot)){versions.push(bundled.version);arches.push(bundled.arch);evidence.push(bundled.evidence);if(arch&&arch!==bundled.arch)throw failure('GAME_RUNTIME_CONFLICT','游戏架构声明与随附程序冲突');arch=bundled.arch;}
  if(new Set(arches).size>1)throw failure('GAME_RUNTIME_CONFLICT','游戏架构声明冲突，未启动或修改配置');
  if(new Set(versions).size>1)throw failure('GAME_RUNTIME_CONFLICT','游戏的精确 Electron 版本证据冲突，未启动或修改配置');
  if(!versions.length)throw failure('GAME_RUNTIME_UNKNOWN','无法确定这款游戏所需的精确 Electron 版本：未发现可核对的版本信息，仅版本范围或游戏自身版本号不足以判断。请保留原有启动方式，等待补充游戏适配');
  return {version:versions[0],arch:arch||process.arch,evidence:evidence.concat(arch?[]:['未声明 cpu，限定当前管理运行时架构 '+process.arch])};
}
module.exports.runtimeRequirement=runtimeRequirement;
function applicationEntry(game) {
  const {inside,failure}=require('../core/config'),declared=path.resolve(game.installPath,game.entry);
  function packaged(directory) {
    for(const name of ['app.asar','app']){const file=path.join(directory,'resources',name);if(fs.existsSync(file)&&inside(game.installPath,file))return file;}
    return null;
  }
  let entry=packaged(declared)||declared;
  if(entry===declared&&game.entry==='.'&&!declared.endsWith('.app')&&!fs.existsSync(path.join(declared,'package.json'))&&fs.existsSync(declared)) {
    const names=fs.readdirSync(declared);if(names.length>128)throw failure('GAME_RUNTIME_UNKNOWN','安装目录项目过多，请选择实际 Electron 应用目录');
    const candidates=names.filter(name=>{const file=path.join(declared,name);return inside(game.installPath,file)&&fs.statSync(file).isDirectory();}).map(name=>packaged(path.join(declared,name))).filter(Boolean);
    if(candidates.length>1)throw failure('GAME_RUNTIME_UNKNOWN','找到多个 Electron 应用，请选择实际游戏子目录');
    if(candidates.length===1)entry=candidates[0];
  }
  if(!inside(game.installPath,entry))throw failure('GAME_INVALID','应用入口不能指向游戏目录外');
  return entry;
}
module.exports.applicationEntry=applicationEntry;
