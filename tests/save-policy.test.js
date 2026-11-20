const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'launcher-save-policy-')));
const config=require('../core/config');
const adapters=require('../adapters');
const copy=require('./save-hook-smoke').copy;
function scenario(name,io,inspect=adapters.inspectSaveProfile) {
  const install=path.join(root,name,'game 中文');copy(path.join(__dirname,'fixtures/tyrano-save'),install);
  fs.mkdirSync(path.join(install,'resources'));
  const game={id:'game-a',installPath:install,entry:'.',workingDirectory:'.',adapterId:'electron-app',args:[],name:'fixture'};
  const state={token:'test-token',library:{schemaVersion:1,revision:0,games:[game],runtimes:[]}};
  const context={dataRoot:path.join(root,name,'library')};
  const service=fs.existsSync(path.resolve(__dirname,'../core/save-policy.js'))?require('../core/save-policy').create(context,{inspect,validate:adapters.validateSaveBytes,encode:adapters.encodeSave,io}):{inspect:()=>({candidates:[]})};
  return {game,state,context,service};
}
function write(game,location,value) {const dir=location==='install'?game.installPath:path.join(game.installPath,'resources');fs.writeFileSync(path.join(dir,'fixture_save_sf.sav'),escape(JSON.stringify(value)));}
function apply(s,location) {const preview=s.service.inspect(s.game,s.state);return s.service.apply(s.game,{enabled:true,location,scanToken:preview.scanToken},s.state);}
try {
  const s=scenario('normal');write(s.game,'install',{progress:10});write(s.game,'resources',{progress:1});
  const preview=s.service.inspect(s.game,s.state);
  assert.strictEqual(preview.candidates.length,2,'Both save locations must be inspected');
  assert.strictEqual(preview.candidates[0].files[0].name,'fixture_save_sf.sav');
  assert(!JSON.stringify(preview).includes('progress'),'Preview must not expose save contents');
  assert.throws(()=>s.service.apply(s.game,{enabled:true,scanToken:preview.scanToken},s.state),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  const policy=s.service.apply(s.game,{enabled:true,location:'install',scanToken:preview.scanToken},s.state);
  const enabled=Object.assign({},s.game,{savePolicy:policy});s.state.library.games=[enabled];
  assert.strictEqual(policy.location,'install');assert(s.service.validate(enabled,s.state.library));
  assert.strictEqual(unescape(fs.readFileSync(path.join(s.game.installPath,'resources/fixture_save_sf.sav'),'utf8')),JSON.stringify({progress:1}));
  write(s.game,'install',{progress:11});assert(s.service.validate(enabled,s.state.library),'Normal progress updates must remain valid');
  write(s.game,'resources',{progress:2});assert.throws(()=>s.service.validate(enabled,s.state.library),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  const stale=scenario('stale');write(stale.game,'install',{progress:1});
  const scan=stale.service.inspect(stale.game,stale.state);const file=path.join(stale.game.installPath,'fixture_save_sf.sav');const stat=fs.statSync(file);
  write(stale.game,'install',{progress:2});fs.utimesSync(file,stat.atime,stat.mtime);
  assert.throws(()=>stale.service.apply(stale.game,{enabled:true,location:'install',scanToken:scan.scanToken},stale.state),e=>e.code==='SAVE_SCAN_STALE');
  const damaged=scenario('damaged');fs.writeFileSync(path.join(damaged.game.installPath,'fixture_save_sf.sav'),'%7Bbroken');
  assert.throws(()=>damaged.service.inspect(damaged.game,damaged.state),e=>e.code==='SAVE_FORMAT_INVALID');
  const linked=scenario('linked');write(linked.game,'resources',{progress:1});fs.symlinkSync(path.join(linked.game.installPath,'resources/fixture_save_sf.sav'),path.join(linked.game.installPath,'fixture_save_sf.sav'));
  assert.throws(()=>linked.service.inspect(linked.game,linked.state),e=>e.code==='SAVE_DIRECTORY_INVALID');
  const hard=scenario('hard');write(hard.game,'resources',{progress:1});fs.linkSync(path.join(hard.game.installPath,'resources/fixture_save_sf.sav'),path.join(hard.game.installPath,'fixture_save_sf.sav'));
  assert.throws(()=>hard.service.inspect(hard.game,hard.state),e=>e.code==='SAVE_DIRECTORY_INVALID');
  const privateLink=scenario('private-link');write(privateLink.game,'install',{progress:1});
  const outside=path.join(root,'outside-backups');fs.mkdirSync(outside);
  const privateGame=path.join(privateLink.context.dataRoot,'games',privateLink.game.id);fs.mkdirSync(privateGame,{recursive:true});fs.symlinkSync(outside,path.join(privateGame,'save-backups'));
  assert.throws(()=>apply(privateLink,'install'),e=>e.code==='SAVE_BACKUP_FAILED');assert.deepStrictEqual(fs.readdirSync(outside),[]);
  const badShape=scenario('invalid-shape');fs.writeFileSync(path.join(badShape.game.installPath,'fixture_save_tyrano_data.sav'),escape(JSON.stringify({data:'invalid'})));
  assert.throws(()=>badShape.service.inspect(badShape.game,badShape.state),e=>e.code==='SAVE_FORMAT_INVALID');
  const versioned=scenario('versioned-slots',undefined,game=>{
    const result=adapters.inspectSaveProfile(game);result.profile.slotVersion='2';return result;
  });
  const versionedFile=path.join(versioned.game.installPath,'fixture_save_tyrano_data.sav');
  const legacySlot={kind:'save',hash:'fixture-origin',data:[]};
  const legacyBytes=escape(JSON.stringify(legacySlot));
  fs.writeFileSync(versionedFile,legacyBytes);
  const unsupportedVersion=e=>e.code==='SAVE_SLOT_VERSION_UNSUPPORTED';
  assert.throws(()=>versioned.service.inspect(versioned.game,versioned.state),unsupportedVersion);
  assert.strictEqual(fs.readFileSync(versionedFile,'utf8'),legacyBytes);
  const currentBytes=escape(JSON.stringify(Object.assign({version:'2'},legacySlot)));
  fs.writeFileSync(versionedFile,currentBytes);
  versioned.game.savePolicy=apply(versioned,'install');
  const versionedSession=versioned.service.openSession(versioned.game,versioned.state.library);
  assert.strictEqual(JSON.parse(versionedSession.read('fixture_save_tyrano_data')).version,'2');
  assert.throws(()=>versionedSession.write('fixture_save_tyrano_data',legacySlot),unsupportedVersion);
  assert.strictEqual(fs.readFileSync(versionedFile,'utf8'),currentBytes);
  fs.writeFileSync(versionedFile,legacyBytes);
  assert.throws(()=>versioned.service.validate(versioned.game,versioned.state.library),unsupportedVersion);
  assert.strictEqual(fs.readFileSync(versionedFile,'utf8'),legacyBytes);
  const operations=['openSync','writeFileSync','closeSync','fsyncSync','renameSync'];
  let counting=false;const counts={},countIO=Object.assign({},fs);
  operations.forEach(operation=>{counts[operation]=0;countIO[operation]=function(){if(counting)counts[operation]++;return fs[operation].apply(fs,arguments);};});
  const counted=scenario('counted',countIO);write(counted.game,'install',{progress:1});counting=true;apply(counted,'install');counting=false;
  for(const operation of operations)for(let at=1;at<=counts[operation];at++) {
    let armed=false,count=0;const io=Object.assign({},fs);
    io[operation]=function(){if(armed&&++count===at)throw Error('injected '+operation);return fs[operation].apply(fs,arguments);};
    const fault=scenario('fault-'+operation+'-'+at,io);write(fault.game,'install',{progress:1});
    const before=fs.readFileSync(path.join(fault.game.installPath,'fixture_save_sf.sav'));
    const scan=fault.service.inspect(fault.game,fault.state);armed=true;
    assert.throws(()=>fault.service.apply(fault.game,{enabled:true,location:'install',scanToken:scan.scanToken},fault.state),e=>e.code==='SAVE_BACKUP_FAILED');
    assert.deepStrictEqual(fs.readFileSync(path.join(fault.game.installPath,'fixture_save_sf.sav')),before);
  }
  const empty=scenario('empty');const emptyPolicy=apply(empty,'install');assert.strictEqual(emptyPolicy.hadSaves,false);
  const expired=scenario('expired'),expiredScan=expired.service.inspect(expired.game,expired.state),clock=Date.now;
  try {Date.now=()=>clock()+11*60*1000;assert.throws(()=>expired.service.apply(expired.game,{enabled:true,location:'install',scanToken:expiredScan.scanToken},expired.state),e=>e.code==='SAVE_SCAN_STALE');}finally{Date.now=clock;}
  const shared=scenario('shared');write(shared.game,'install',{progress:1});
  shared.state.library.games.push({id:'game-b',savePolicy:{directoryIdentity:{realPath:shared.game.installPath}}});
  assert.throws(()=>apply(shared,'install'),e=>e.code==='SAVE_DIRECTORY_SHARED');
  const unknown=scenario('unknown');fs.writeFileSync(path.join(unknown.game.installPath,'fixture_save_plugin.sav'),'{}');
  assert.throws(()=>unknown.service.inspect(unknown.game,unknown.state),e=>e.code==='SAVE_FORMAT_INVALID');
  const large=scenario('large');const largeFile=path.join(large.game.installPath,'fixture_save_sf.sav');fs.writeFileSync(largeFile,'');fs.truncateSync(largeFile,64*1024*1024+1);
  assert.throws(()=>large.service.inspect(large.game,large.state),e=>e.code==='SAVE_DIRECTORY_INVALID');
  function checkSetLimit(name,count,largeFiles) {
    const names=Array.from({length:count},(_,index)=>'fixture_save_'+String(index).padStart(3,'0')+'.sav');
    const small=Buffer.from('{}'),large=largeFiles?Buffer.alloc(64*1024*1024,32):null;
    if(large)large.write('{}');
    const bytesFor=target=>{
      const index=names.indexOf(path.basename(target));
      return index<0?null:index<largeFiles?large:small;
    };
    const io=Object.assign({},fs,{
      readdirSync:directory=>directory===fixture.game.installPath?names:fs.readdirSync(directory),
      readFileSync:(target,...args)=>bytesFor(target)||fs.readFileSync(target,...args),
      lstatSync:(target,...args)=>{
        const bytes=bytesFor(target);
        return bytes?{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:bytes.length,ino:1,mtimeMs:0}:fs.lstatSync(target,...args);
      }
    });
    const fixture=scenario(name,io,game=>{
      const result=adapters.inspectSaveProfile(game);result.profile.fileNames=names;return result;
    });
    const before=JSON.stringify(fixture.state);
    assert.throws(()=>fixture.service.inspect(fixture.game,fixture.state),e=>e.code==='SAVE_FORMAT_INVALID'&&e.message.includes('集合超过'));
    assert.strictEqual(JSON.stringify(fixture.state),before);
    assert(!fs.existsSync(fixture.context.dataRoot));
  }
  checkSetLimit('too-many-files',129,0);
  checkSetLimit('too-many-bytes',5,4);

  const replaced=scenario('replaced-directory');write(replaced.game,'resources',{progress:3});
  replaced.game.savePolicy=apply(replaced,'resources');
  const oldDirectory=path.join(replaced.game.installPath,'resources'),movedDirectory=oldDirectory+'.old';
  const replacedName='fixture_save_sf.sav',oldData=fs.readFileSync(path.join(oldDirectory,replacedName));
  const beforeReplacement=JSON.stringify(replaced.state);
  fs.renameSync(oldDirectory,movedDirectory);fs.mkdirSync(oldDirectory);write(replaced.game,'resources',{progress:4});
  const newData=fs.readFileSync(path.join(oldDirectory,replacedName));
  assert.throws(()=>replaced.service.validate(replaced.game,replaced.state.library),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  assert.deepStrictEqual(fs.readFileSync(path.join(movedDirectory,replacedName)),oldData);
  assert.deepStrictEqual(fs.readFileSync(path.join(oldDirectory,replacedName)),newData);
  assert.strictEqual(JSON.stringify(replaced.state),beforeReplacement);
  const changed=scenario('changed');write(changed.game,'install',{progress:1});const changedScan=changed.service.inspect(changed.game,changed.state);
  assert.throws(()=>changed.service.apply(changed.game,{enabled:true,location:'install',scanToken:changedScan.scanToken},Object.assign({},changed.state,{token:'new-token'})),e=>e.code==='SAVE_SCAN_STALE');
  const disappeared=scenario('disappeared');write(disappeared.game,'install',{progress:1});const missingPolicy=apply(disappeared,'install');fs.unlinkSync(path.join(disappeared.game.installPath,'fixture_save_sf.sav'));
  assert.throws(()=>disappeared.service.validate(Object.assign({},disappeared.game,{savePolicy:missingPolicy}),disappeared.state.library),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  const sessionCase=scenario('session');write(sessionCase.game,'install',{progress:10});
  sessionCase.game.savePolicy=apply(sessionCase,'install');
  const session=sessionCase.service.openSession(sessionCase.game,sessionCase.state.library);
  assert.deepStrictEqual(JSON.parse(session.read('fixture_save_sf')),{progress:10});
  assert.deepStrictEqual(JSON.parse(session.readConfirmed('fixture_save_sf')),{progress:10});
  session.write('fixture_save_sf',{progress:11});assert.deepStrictEqual(JSON.parse(session.read('fixture_save_sf')),{progress:11});
  assert.deepStrictEqual(JSON.parse(session.readConfirmed('fixture_save_sf')),{progress:10},'Confirmation reads the completed backup, not mutable current saves');
  assert.strictEqual(session.readConfirmed('fixture_save_tyrano_data'),null);
  assert.throws(()=>sessionCase.service.openSession(sessionCase.game,sessionCase.state.library).readConfirmed('../outside'),/不支持/);
  session.beginClear(['fixture_save_sf']);session.remove('fixture_save_sf');session.finishClear();
  assert.strictEqual(session.read('fixture_save_sf'),null);assert(sessionCase.service.validate(sessionCase.game,sessionCase.state.library));
  session.write('fixture_save_sf',{progress:12});assert.deepStrictEqual(JSON.parse(session.read('fixture_save_sf')),{progress:12});
  session.beginClear(['fixture_save_sf']);
  const recordPath=sessionCase.service.presencePath(sessionCase.game,sessionCase.game.savePolicy.backupId);
  const pending=JSON.parse(fs.readFileSync(recordPath)).pendingClear;
  session.remove('fixture_save_sf');
  assert.throws(()=>sessionCase.service.validate(sessionCase.game,sessionCase.state.library),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  assert.throws(()=>apply(sessionCase,'install'),e=>e.code==='SAVE_CONFIRM_REQUIRED','Reconfirmation cannot discard an unfinished clear');
  const recovery=path.join(sessionCase.context.dataRoot,'games',sessionCase.game.id,'save-backups',pending.backupId,'files/fixture_save_sf.sav');
  fs.copyFileSync(recovery,path.join(sessionCase.game.installPath,'fixture_save_sf.sav'));
  sessionCase.game.savePolicy=apply(sessionCase,'install');assert(sessionCase.service.validate(sessionCase.game,sessionCase.state.library));
  const recovered=sessionCase.service.openSession(sessionCase.game,sessionCase.state.library);assert.deepStrictEqual(JSON.parse(recovered.read('fixture_save_sf')),{progress:12});
  assert.throws(()=>recovered.remove('fixture_save_sf'),/清档流程/);assert(fs.existsSync(path.join(sessionCase.game.installPath,'fixture_save_sf.sav')));
  let failWrite=false,writeCount=0;const writeIO=Object.assign({},fs,{writeFileSync:function(){if(failWrite&&++writeCount===2)throw Error('injected file write failure');return fs.writeFileSync.apply(fs,arguments);}});
  const writeFault=scenario('session-write-fault',writeIO);write(writeFault.game,'install',{progress:1});writeFault.game.savePolicy=apply(writeFault,'install');
  const blockedWrite=writeFault.service.openSession(writeFault.game,writeFault.state.library);failWrite=true;
  assert.throws(()=>blockedWrite.write('fixture_save_tyrano_data',{kind:'save',data:[]}),/injected/);
  assert(!fs.existsSync(path.join(writeFault.game.installPath,'fixture_save_tyrano_data.sav')));
  assert.throws(()=>writeFault.service.validate(writeFault.game,writeFault.state.library),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  const manual=scenario('manual-restore');write(manual.game,'install',{progress:1});manual.game.savePolicy=apply(manual,'install');
  const originalBackup=manual.game.savePolicy.backupId;
  const manualSession=manual.service.openSession(manual.game,manual.state.library);manualSession.write('fixture_save_sf',{progress:2});manualSession.write('fixture_save_tyrano_data',{kind:'save',data:[]});
  const keepExtra=path.join(root,'retained-restoration-extra.sav');fs.renameSync(path.join(manual.game.installPath,'fixture_save_tyrano_data.sav'),keepExtra);
  fs.copyFileSync(path.join(manual.context.dataRoot,'games',manual.game.id,'save-backups',originalBackup,'files/fixture_save_sf.sav'),path.join(manual.game.installPath,'fixture_save_sf.sav'));
  assert.throws(()=>manual.service.validate(manual.game,manual.state.library),e=>e.code==='SAVE_CONFIRM_REQUIRED');
  manual.game.savePolicy=apply(manual,'install');assert(manual.service.validate(manual.game,manual.state.library));assert(fs.existsSync(keepExtra));
  assert.deepStrictEqual(JSON.parse(manual.service.openSession(manual.game,manual.state.library).read('fixture_save_sf')),{progress:1});
  console.log('PASS: atomic session writes, explicit clear/legitimate empty state, interrupted clear recovery and unauthorized delete rejection');
  console.log('PASS: explicit candidates, complete backups, stale scans, file validation/aliases, normal updates, nonselected conflicts and backup faults');
}finally {
  // Keep failed-test evidence isolated; never walk a caller-supplied directory.
  console.log('Synthetic evidence retained in test-created temporary directory');
}
