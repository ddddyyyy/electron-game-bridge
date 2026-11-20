const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const config=require('./config');
const {failure,sha,inside,canonical}=config;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const random=()=>crypto.randomBytes(16).toString('hex');
function create(context,options) {
  const io=options.io||fs,tokens=new Map();
  function identity(directory) {
    const realPath=io.realpathSync(directory),stat=io.statSync(realPath,{bigint:true});
    if(!stat.isDirectory())throw failure('SAVE_DIRECTORY_INVALID','存档目录不是目录');
    return {realPath,dev:String(stat.dev),ino:String(stat.ino)};
  }
  function readFile(file) {
    const stat=io.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024*1024)throw failure('SAVE_DIRECTORY_INVALID','存档文件类型、别名或大小无效');
    return io.readFileSync(file);
  }
  function profileFor(game) {
    const result=options.inspect(game);
    if(result.status!=='supported')throw failure('SAVE_UNSUPPORTED',result.message||'引擎尚未支持');
    return result.profile;
  }
  function scanDirectory(directory,profile) {
    if(!io.existsSync(directory))return {exists:false,files:[]};
    const dir=identity(directory),files=[];
    if(!inside(profile.installPath,dir.realPath))throw failure('SAVE_DIRECTORY_INVALID','存档目录越出安装目录');
    let total=0;
    for(const name of io.readdirSync(directory).sort()) {
      if(!profile.fileNames.includes(name)) {
        if(name.startsWith(profile.filePrefix)&&name.endsWith(profile.fileExtension))throw failure('SAVE_FORMAT_INVALID','发现未支持的存档文件');
        continue;
      }
      const file=path.join(directory,name),before=io.lstatSync(file),bytes=readFile(file);
      total+=bytes.length;
      if(total>256*1024*1024||files.length>=128)throw failure('SAVE_FORMAT_INVALID','存档集合超过支持上限');
      try{options.validate(bytes,name,profile);}catch(error){
        if(error.code==='SAVE_SLOT_VERSION_UNSUPPORTED')throw error;
        throw failure('SAVE_FORMAT_INVALID','存档内容无法安全识别，未修改文件');
      }
      const after=io.lstatSync(file);
      if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw failure('SAVE_SCAN_STALE','扫描期间存档已变化');
      files.push({name,size:bytes.length,mtime:after.mtimeMs,sha256:sha(bytes)});
    }
    return {exists:true,directoryIdentity:dir,files};
  }
  function scan(game) {
    const profile=Object.assign({},profileFor(game),{installPath:game.installPath});
    if(!io.existsSync(game.installPath))throw failure('SAVE_DIRECTORY_INVALID','安装目录不存在');
    const candidates=['install','resources'].map(location=>Object.assign({location},scanDirectory(location==='install'?game.installPath:path.join(game.installPath,'resources'),profile)));
    if(candidates[0].exists&&candidates[1].exists&&same(candidates[0].directoryIdentity,candidates[1].directoryIdentity))throw failure('SAVE_DIRECTORY_SHARED','两个候选指向同一目录');
    return {profile,candidates};
  }
  function binding(game,state,result) {
    const draft={};Object.keys(game).sort().forEach(key=>{if(key!=='savePolicy')draft[key]=game[key];});
    return sha(Buffer.from(JSON.stringify({game:draft,token:state.token,revision:state.library.revision,result})));
  }
  function inspect(game,state) {
    const result=scan(game),scanToken=random();tokens.clear();
    tokens.set(scanToken,{signature:binding(game,state,result),created:Date.now()});
    return {status:'supported',profileLabel:'文件存档兼容',scanToken,candidates:result.candidates.map(c=>({location:c.location,exists:c.exists,displayPath:c.exists?c.directoryIdentity.realPath:path.join(game.installPath,'resources'),files:c.files.map(f=>({name:f.name,size:f.size,mtime:f.mtime}))}))};
  }
  function ownership(game,directory,library) {
    for(const other of library.games) {
      if(!other||other.id===game.id||!other.savePolicy)continue;
      const selected=other.savePolicy.directoryIdentity;
      if(!selected||!path.isAbsolute(selected.realPath))throw failure('SAVE_DIRECTORY_SHARED','其他游戏的存档归属无法核对');
      if(canonical(selected.realPath)===directory.realPath)throw failure('SAVE_DIRECTORY_SHARED','另一款游戏已使用该存档目录');
    }
  }
  function syncDirectory(directory) {
    const fd=io.openSync(directory,'r');try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
  }
  function exclusive(file,bytes) {
    let fd;
    try{fd=io.openSync(file,'wx',0o600);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;}
    finally{if(fd!==undefined)io.closeSync(fd);}
  }
  function atomicJSON(file,value) {
    const temp=file+'.'+random()+'.tmp';exclusive(temp,Buffer.from(JSON.stringify(value)+'\n'));io.renameSync(temp,file);syncDirectory(path.dirname(file));
  }
  function gameDirectory(game) {
    if(!config.id(game.id))throw failure('GAME_INVALID','存档归属缺少稳定游戏身份');
    const target=path.join(context.dataRoot,'games',game.id);
    if(!inside(context.dataRoot,target))throw failure('SAVE_DIRECTORY_INVALID','存档备份目录越界');
    return target;
  }
  function privateDirectory(game,parts) {
    const target=path.join(gameDirectory(game),...parts);
    if(!inside(context.dataRoot,target))throw failure('SAVE_DIRECTORY_INVALID','私有存档资料目录越界');
    for(let dir=target;dir!==path.resolve(context.dataRoot);dir=path.dirname(dir)) {
      if(io.existsSync(dir)){const stat=io.lstatSync(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw failure('SAVE_DIRECTORY_INVALID','私有存档资料目录不能使用别名');}
    }
    return target;
  }
  function backup(game,selected,profile,purpose,operationId) {
    const parent=privateDirectory(game,['save-backups']);io.mkdirSync(parent,{recursive:true,mode:0o700});
    const backupId='backup-'+random(),temporary=path.join(parent,'.pending-'+random()),target=path.join(parent,backupId);
    io.mkdirSync(temporary,{mode:0o700});io.mkdirSync(path.join(temporary,'files'),{mode:0o700});
    for(const item of selected.files) {
      const bytes=readFile(path.join(selected.directoryIdentity.realPath,item.name));
      if(sha(bytes)!==item.sha256)throw failure('SAVE_SCAN_STALE','备份前存档已变化');
      const dest=path.join(temporary,'files',item.name);exclusive(dest,bytes);
      if(sha(io.readFileSync(dest))!==item.sha256)throw Error('备份校验失败');
    }
    const manifest={version:1,backupId,gameId:game.id,createdAt:new Date().toISOString(),profileId:profile.profileId,projectId:profile.projectId,purpose:purpose||'policy-change',operationId:operationId||null,sourceLocation:selected.location,sourceDirectoryIdentity:selected.directoryIdentity,files:selected.files,state:'complete'};
    exclusive(path.join(temporary,'manifest.json'),Buffer.from(JSON.stringify(manifest)+'\n'));syncDirectory(path.join(temporary,'files'));syncDirectory(temporary);
    const after=scanDirectory(selected.directoryIdentity.realPath,profile);
    if(!same(after.files,selected.files)||!same(after.directoryIdentity,selected.directoryIdentity))throw failure('SAVE_SCAN_STALE','备份期间源存档已变化');
    io.renameSync(temporary,target);syncDirectory(parent);
    return backupId;
  }
  function presencePath(game,backupId) {return path.join(privateDirectory(game,['save-state']),backupId+'.json');}
  function apply(game,choice,state) {
    if(choice&&choice.enabled===false)return null;
    if(!choice||!['install','resources'].includes(choice.location))throw failure('SAVE_CONFIRM_REQUIRED','请明确选择存档位置');
    const token=tokens.get(choice.scanToken),result=scan(game);
    if(!token||Date.now()-token.created>10*60*1000||token.signature!==binding(game,state,result))throw failure('SAVE_SCAN_STALE','存档或设置已变化，请重新检查');
    const selected=result.candidates.find(c=>c.location===choice.location),other=result.candidates.find(c=>c.location!==choice.location);
    if(!selected.exists||(!selected.files.length&&result.candidates.some(c=>c.files.length)))throw failure('SAVE_CONFIRM_REQUIRED','请选择已有存档的位置');
    if(!selected.files.length&&choice.location!=='install')throw failure('SAVE_CONFIRM_REQUIRED','新进度默认使用游戏目录');
    ownership(game,selected.directoryIdentity,state.library);
    let restoredPresence;
    if(game.savePolicy) {
      const original=presencePath(game,game.savePolicy.backupId);
      if(io.existsSync(original)) {
        let presence;
        try{presence=JSON.parse(readFile(original).toString());}catch(_){throw failure('SAVE_CONFIRM_REQUIRED','原存档存在记录损坏，请先核对恢复资料');}
        if(presence.pendingClear) {
          let recovery;
          try{recovery=verifyBackup(game,Object.assign({},game.savePolicy,{backupId:presence.pendingClear.backupId}));}
          catch(_){throw failure('SAVE_CONFIRM_REQUIRED','清档恢复备份无法核对');}
          const content=files=>files.map(f=>({name:f.name,size:f.size,sha256:f.sha256}));
          if(!same(content(selected.files),content(recovery.files)))throw failure('SAVE_CONFIRM_REQUIRED','清档尚未完成，请先还原操作前存档再重新确认');
          restoredPresence={file:original,value:presence};
        }
      }
    }
    try {
      const probe=path.join(selected.directoryIdentity.realPath,'.launcher-write-'+random()+'.tmp');
      exclusive(probe,Buffer.alloc(0));io.unlinkSync(probe);
      const backupId=backup(game,selected,result.profile);
      const stateFile=presencePath(game,backupId);io.mkdirSync(path.dirname(stateFile),{recursive:true,mode:0o700});
      const policy={version:1,profileId:result.profile.profileId,projectId:result.profile.projectId,evidenceHash:result.profile.evidenceHash,location:choice.location,directoryIdentity:selected.directoryIdentity,backupId,otherSnapshot:other,hadSaves:!!selected.files.length};
      atomicJSON(stateFile,{version:1,gameId:game.id,backupId,profileId:policy.profileId,evidenceHash:policy.evidenceHash,directoryIdentity:policy.directoryIdentity,seenKeys:selected.files.map(f=>f.name)});
      if(!same(scan(game).candidates,result.candidates))throw failure('SAVE_SCAN_STALE','提交前存档已变化');
      if(restoredPresence){restoredPresence.value.pendingClear.phase='restored';atomicJSON(restoredPresence.file,restoredPresence.value);}
      tokens.delete(choice.scanToken);return policy;
    }catch(error){if(error.code==='SAVE_SCAN_STALE')throw error;throw failure('SAVE_BACKUP_FAILED','备份未完成，未启用存档兼容：'+error.message);}
  }
  function verifyBackup(game,policy) {
    if(!config.id(policy.backupId))throw failure('SAVE_CONFIRM_REQUIRED','存档备份身份无效');
    const directory=privateDirectory(game,['save-backups',policy.backupId]);
    privateDirectory(game,['save-backups',policy.backupId,'files']);
    const manifest=JSON.parse(readFile(path.join(directory,'manifest.json')).toString());
    if(manifest.gameId!==game.id||manifest.backupId!==policy.backupId||manifest.state!=='complete'||!Array.isArray(manifest.files))throw Error('备份清单不完整');
    for(const item of manifest.files) {
      if(typeof item.name!=='string'||path.basename(item.name)!==item.name||sha(readFile(path.join(directory,'files',item.name)))!==item.sha256)throw Error('备份文件校验失败');
    }
    return manifest;
  }
  function validate(game,library) {
    if(!game.savePolicy)return null;
    const policy=game.savePolicy;
    if(config.savePolicyErrors(policy))throw failure('SAVE_CONFIRM_REQUIRED','存档策略无效，请重新确认');
    const result=scan(game),selected=result.candidates.find(c=>c.location===policy.location),other=result.candidates.find(c=>c.location!==policy.location);
    if(result.profile.evidenceHash!==policy.evidenceHash||result.profile.projectId!==policy.projectId||!selected.exists||!same(selected.directoryIdentity,policy.directoryIdentity)||!same(other,policy.otherSnapshot))throw failure('SAVE_CONFIRM_REQUIRED','存档目录、引擎或另一个候选已变化，请重新确认');
    ownership(game,selected.directoryIdentity,library);
    try {io.accessSync(selected.directoryIdentity.realPath,fs.constants.W_OK|fs.constants.X_OK);}
    catch (_) {throw failure('SAVE_DIRECTORY_UNWRITABLE','已选存档目录不可写，请检查目录权限后重试');}
    try {
      verifyBackup(game,policy);
      const presence=JSON.parse(readFile(presencePath(game,policy.backupId)).toString());
      if(presence.gameId!==game.id||presence.backupId!==policy.backupId||presence.evidenceHash!==policy.evidenceHash||!same(presence.directoryIdentity,policy.directoryIdentity)||!Array.isArray(presence.seenKeys)||presence.pendingClear)throw Error('存档存在记录无法核对');
      if(presence.seenKeys.some(name=>!selected.files.some(f=>f.name===name)))throw Error('曾有的存档异常消失');
    }catch(error){throw failure('SAVE_CONFIRM_REQUIRED','存档备份或存在记录需要核对：'+error.message);}
    return {profile:result.profile,selected};
  }
  function openSession(game,library) {
    const verified=validate(game,library),profile=verified.profile,policy=game.savePolicy;
    const record=presencePath(game,policy.backupId),directory=policy.directoryIdentity.realPath;
    let poisoned=false;
    function presence() {
      const value=JSON.parse(readFile(record).toString());
      if(value.gameId!==game.id||value.backupId!==policy.backupId||!same(value.directoryIdentity,policy.directoryIdentity)||!Array.isArray(value.seenKeys))throw Error('存档存在记录已变化');
      return value;
    }
    function nameFor(key) {
      const index=profile.keys.indexOf(key);
      if(index<0)throw Error('不支持的存档键');
      return profile.fileNames[index];
    }
    function run(action) {
      if(poisoned)throw failure('SAVE_WRITE_FAILED','本次会话存档保护已锁定');
      try {
        if(!same(identity(directory),policy.directoryIdentity))throw Error('存档目录已被替换');
        return action(presence());
      }catch(error){poisoned=true;throw failure(error.code||'SAVE_WRITE_FAILED',error.message);}
    }
    function read(key) {return run(state=>{
      const name=nameFor(key),file=path.join(directory,name);
      if(!io.existsSync(file)) {
        if(state.seenKeys.includes(name)&&!(state.pendingClear&&state.pendingClear.affectedKeys.includes(name)))throw Error('曾有的存档异常消失');
        return null;
      }
      return options.validate(readFile(file),name,profile);
    });}
    function readConfirmed(key) {return run(()=>{
      const name=nameFor(key),manifest=verifyBackup(game,policy);
      if(!manifest.files.some(item=>item.name===name))return null;
      return options.validate(readFile(path.join(privateDirectory(game,['save-backups',policy.backupId,'files']),name)),name,profile);
    });}
    function write(key,value) {return run(state=>{
      const name=nameFor(key),file=path.join(directory,name);
      if(state.pendingClear&&!state.pendingClear.affectedKeys.includes(name))throw Error('清档操作越出已确认范围');
      const previous=io.existsSync(file)?readFile(file):null;
      if(previous)options.validate(previous,name,profile);
      else if(state.seenKeys.includes(name)&&!state.pendingClear)throw Error('存档异常消失，不能覆盖为新进度');
      const bytes=options.encode(value,name,profile);
      if(bytes.length>64*1024*1024)throw Error('存档超过支持上限');
      if(!state.seenKeys.includes(name)){state.seenKeys.push(name);atomicJSON(record,state);}
      const temp=file+'.'+random()+'.tmp';exclusive(temp,bytes);
      if(!same(identity(directory),policy.directoryIdentity))throw Error('保存期间目录已变化');
      if(previous?(!io.existsSync(file)||sha(readFile(file))!==sha(previous)):io.existsSync(file))throw Error('保存期间存档被其他程序修改');
      io.renameSync(temp,file);syncDirectory(directory);
      return true;
    });}
    function beginClear(keys) {return run(state=>{
      if(state.pendingClear||!(profile.clearSets||[profile.clearKeys]).some(allowed=>same(keys,allowed)))throw Error('清档操作无法核对');
      const current=scan(game),selected=current.candidates.find(c=>c.location===policy.location),operationId=random();
      const backupId=backup(game,selected,profile,'pre-clear',operationId);
      state.pendingClear={operationId,backupId,affectedKeys:keys.map(nameFor),phase:'prepared'};
      atomicJSON(record,state);return true;
    });}
    function remove(key) {return run(state=>{
      const name=nameFor(key);
      if(!state.pendingClear||!state.pendingClear.affectedKeys.includes(name))throw Error('删除必须来自原游戏的已确认清档流程');
      const file=path.join(directory,name);
      if(io.existsSync(file)){readFile(file);io.unlinkSync(file);syncDirectory(directory);}
      return true;
    });}
    function finishClear() {return run(state=>{
      if(!state.pendingClear)throw Error('不存在可完成的清档操作');
      const current=scanDirectory(directory,profile);
      state.seenKeys=current.files.map(f=>f.name);delete state.pendingClear;atomicJSON(record,state);return true;
    });}
    return {read,readConfirmed,write,beginClear,remove,finishClear,validate:()=>run(state=>{if(state.pendingClear)throw Error('清档操作未完成');return validate(game,library);})};
  }
  return {inspect,apply,validate,openSession,clearTokens:()=>tokens.clear(),backup,atomicJSON,identity,scan,verifyBackup,presencePath};
}
module.exports={create};
