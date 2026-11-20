const fs=require('fs');
const path=require('path');
const config=require('../../core/config');
const MAX_TEXT=5*1024*1024;
function readText(file) {
  if(!fs.statSync(file).isFile()||fs.statSync(file).size>MAX_TEXT)throw Error('引擎文本缺失或超过 5 MiB');
  return fs.readFileSync(file,'utf8');
}
function declaration(source,key) {
  const values=[];
  source.split(/\r?\n/).forEach(line=>{
    if(new RegExp('^\\s*;?\\s*'+key+'\\s*=').test(line)) {
      const match=line.match(new RegExp('^\\s*;?\\s*'+key+'\\s*=\\s*([A-Za-z0-9_-]+)\\s*;?\\s*$'));
      if(!match)throw Error('不支持动态或不明确的 '+key);
      values.push(match[1]);
    }
  });
  if(values.length!==1)throw Error('缺少唯一的 '+key);
  return values[0];
}
function functionText(source,pattern) {
  const match=pattern.exec(source);if(!match)return null;
  const start=source.indexOf('function',match.index),brace=source.indexOf('{',start);
  let depth=1,quote=null;
  for(let i=brace+1;i<source.length;i++) {
    const c=source[i];
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(source.slice(i,i+2)==='//'){const end=source.indexOf('\n',i+2);if(end<0)return null;i=end;continue;}
    if(source.slice(i,i+2)==='/*'){const end=source.indexOf('*/',i+2);if(end<0)return null;i=end+1;continue;}
    if(c==='{')depth++;
    if(c==='}'&&!--depth)return source.slice(start,i+1).replace(/\r\n/g,'\n').trim();
  }
  return null;
}
function functionHash(text) {return text&&config.sha(Buffer.from(text.replace(/\r\n/g,'\n').trim()));}
const VERSIONED_SLOT_INIT='86ac5f4fb9e49be4a479d57c185c26071965a34951a24340b562351467b1a83d';
// Verified storage implementations; hashes keep game source out of this repo.
const signatures={
  init_game:['4e5bb476813b07e72061980fede75b78edf10707fb2fee3f7fe9cb29cd08963a','68500a19c285d6438f7000111b9509e908d165eb13f2fd289892ce48a9568b9d','b5cbb1018c50a75aa1ec81293a1de598988783bba08883759258c56f7449aa1d',VERSIONED_SLOT_INIT],
  getExePath:['073958f9f6cc2d794872850211a687b2a289c4b1a9d497e38c56aa699ed88a4f','7c227a81f990d15d6398dea7d7f758ea5059500a8874de73e8004b1c1be4af14','4a92c5e664fb3fec005a5641e6e6724319d9bd6158886b23931c840004c990f8'],
  localFilePath:['9a079961b29c984eab8374ddec638fc84153839e7f28a3885b24af0aef21bd5d','edb58227c642dd0d186de49f9057e632f74de6244157d5befe7f087b94d22cc8'],
  getStorageFile:['703b0f35b7b5a77cb6b388e07ff5966fa54645e79dae6e1f35081dd5d1bea576','9e752131dbce12e383f07e4c2be5ebd41182341b1ed41185a0ade038940f8d0a','73a2d9f5f4f25df7a650abb4f7bba6ee2268eaadf28fb0f6a2c4cba24accbff5'],
  setStorageFile:['eefc6ce12b4fedd8d97e852e80312a606c5935822df3e4372f0c8d248645eaca','702df7f7402ec9def6c1161bcaa344c449140218753eea2f7f8cbd6fc61c7f3b'],
  removeStorageFile:['c367158485a575bc119550c13c8994e216b3eb8a1cd0bbfb1783c1029d0fa0cb','e3abdd619f1108bcf961e01f8a1ad5160eb5967ad09f449c5db1ed478c22d187'],
  fixtureClear:['94e30a909eac1b6337909a895f9d6eb94ebba4450cb0c89b391842cb13b343ea'],
  removeSaveData:['62f3bc3bc6613b8080a23119840cf942ec8b9787e132cf93c239712a74f0e742','501b7419b514bb1441aceb953aaeb062fbe987068f3ab48b39552cf0ed20c96e','056d3a228e8dcfce9a738387eb63a0048fe693e8f75ec80660fa53b276de75f2'],
  clearVariable:['7ddc2c6b6c106cce8e73e656641c958612432cf75e8d2cbebd7dc9231fb07d41','a21a479fb1c2c939831ca28cb3ee062c2e006f5d1d8341eeef3a85f9c1c306ba','2e3eda1c62bdf27f058c1aba2503e0a08be423521b8cfecf010a84da43525fb8']
};
function verifiedHash(name,text) {
  const hash=functionHash(text);
  if(!hash||!signatures[name].includes(hash))throw Error('存储或清档方法尚未验证：'+name);
  return hash;
}
function inspect(game) {
  try {
    if(!game||game.adapterId!=='electron-app'||!path.isAbsolute(game.installPath))throw Error('无效游戏入口');
    const entry=require('../index').applicationEntry(game);
    function local(relative) {
      if(typeof relative!=='string'||path.isAbsolute(relative))throw Error('引擎路径无效');
      const file=path.resolve(entry,relative);
      if(!config.inside(entry,file))throw Error('引擎文件越界');
      return file;
    }
    const pkg=JSON.parse(readText(local('package.json')));
    const main=local(pkg.main||'index.js'),page=local('index.html');
    const mainSource=readText(main),html=readText(page),settings=readText(local('data/system/Config.tjs'));
    const projectId=declaration(settings,'projectID');
    if(declaration(settings,'configSave')!=='file')throw Error('仅支持引擎文件存档');
    if(!/nodeIntegration\s*:\s*true/.test(mainSource)||!/BrowserWindow/.test(mainSource)||!/index\.html/.test(mainSource))throw Error('未识别的窗口或入口布局');
    const scripts=[];let match;
    const pattern=/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script\s*>/gi;
    while((match=pattern.exec(html)))scripts.push(local(match[1]));
    if(!scripts.length||scripts.length>128)throw Error('未识别的脚本顺序');
    const sources=scripts.map(readText);
    const storageIndex=sources.findIndex(s=>/\$\.getStorageFile\s*=\s*function/.test(s)&&/\$\.setStorageFile\s*=\s*function/.test(s));
    if(storageIndex<1)throw Error('未识别的存储方法赋值顺序');
    const storage=sources[storageIndex];
    if(!/\$\.localFilePath\s*=\s*function/.test(storage)||!/\.sav/.test(storage)||!/JSON\.stringify/.test(storage))throw Error('不支持的存储编码');
    const keys=['_sf','_tyrano_data','_tyrano_auto_save','_tyrano_quick_save'].map(suffix=>projectId+suffix);
    const methodHashes={};
    ['localFilePath','getStorageFile','setStorageFile','removeStorageFile'].forEach(name=>{
      const body=functionText(storage,new RegExp('\\$\\.'+name+'\\s*=\\s*function'));
      if(body||name!=='removeStorageFile')methodHashes[name]=verifiedHash(name,body);
    });
    const engineSource=sources.find(text=>/tyrano\.plugin\.kag\s*=/.test(text));
    const boundaries=[];let layout='fixture',saveIdentity=null;
    if(engineSource) {
      layout='tyrano';
      saveIdentity={initMethodHash:verifiedHash('init_game',functionText(engineSource,/\binit_game\s*:\s*function/)),pathMethodHash:verifiedHash('getExePath',functionText(storage,/\$\.getExePath\s*=\s*function/))};
      if(!/version\s*:\s*(?:500|520)\b/.test(engineSource))throw Error('引擎版本尚未验证');
      ['removeSaveData','clearVariable'].forEach(name=>{
        const body=functionText(engineSource,new RegExp('\\b'+name+'\\s*:\\s*function'));
        if(body)boundaries.push({name,methodHash:verifiedHash(name,body),keys:name==='clearVariable'?[projectId+'_sf']:keys,confirmationBoolean:false});
      });
      if(!boundaries.length)throw Error('未找到已验证的原清档边界');
    } else {
      const body=functionText(storage,/window\.fixtureClear\s*=\s*function/);
      boundaries.push({name:'fixtureClear',methodHash:verifiedHash('fixtureClear',body),keys:[projectId+'_sf'],confirmationBoolean:true});
    }
    const evidence=[mainSource,html,settings].concat(sources);
    // This layout tries to create a separate .bk save and convert unversioned slots.
    const slotVersion=saveIdentity&&saveIdentity.initMethodHash===VERSIONED_SLOT_INIT?'2':null;
    return {status:'supported',profile:{profileId:'tyrano-file-v1',projectId,entry,page,storageFile:scripts[storageIndex],evidenceHash:config.sha(Buffer.from(evidence.join('\0'))),keys,fileNames:keys.map(key=>key+'.sav'),filePrefix:projectId+'_',fileExtension:'.sav',requiredMethods:Object.keys(methodHashes),methodHashes,layout,saveIdentity,slotVersion,clearBoundaries:boundaries,clearKeys:boundaries[0].keys,clearSets:boundaries.map(b=>b.keys)}};
  }catch(error){return {status:'unsupported',code:'SAVE_UNSUPPORTED',message:error.message};}
}
function validateSaveBytes(bytes,name,profile) {
  const value=unescape(bytes.toString('utf8'));
  const parsed=JSON.parse(value);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('存档顶层不是对象');
  if(name&&/_tyrano_data\.sav$/.test(name)) {
    if(!Array.isArray(parsed.data)||parsed.kind!=='save'||parsed.data.some(slot=>!slot||typeof slot!=='object'||Array.isArray(slot)))throw Error('存档槽集合格式无效');
    if(profile&&profile.slotVersion&&parsed.version!==profile.slotVersion)throw config.failure('SAVE_SLOT_VERSION_UNSUPPORTED','此引擎的指定存档位置仅支持版本 '+profile.slotVersion+' 的存档槽，原存档未转换');
  }
  if(name&&/_tyrano_(?:auto|quick)_save\.sav$/.test(name)&&(!parsed.stat||!parsed.layer||!Number.isInteger(parsed.current_order_index)))throw Error('快捷存档格式无效');
  return value;
}
function encodeSave(value,name,profile) {const bytes=Buffer.from(escape(JSON.stringify(value)));validateSaveBytes(bytes,name,profile);return bytes;}
module.exports={inspect,readText,declaration,validateSaveBytes,encodeSave,functionText,functionHash};
