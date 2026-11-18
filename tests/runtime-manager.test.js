const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const launch=require('../core/launch'),manager=require('../core/runtime-manager'),remove=launch.removeTree;
const physicalFs=process.versions.electron?require('original-fs'):fs;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'launcher-runtime-install-'));
(async()=>{try {
  const requirement={version:'43.1.1',arch:'x64'},bytes=Buffer.from('owned archive fixture'),sha=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.strictEqual(manager.downloadTotal('HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nHTTP/2 302\r\nContent-Length: 90\r\n\r\n'),null);
  assert.strictEqual(manager.downloadTotal('HTTP/2 200\r\nContent-Length: 4\r\nContent-Length: 5\r\n\r\n'),null);
  assert.throws(()=>manager.artifact({version:'../../elsewhere',arch:'x64'}));
  const source=Buffer.from('// owned archive fixture'),header=Buffer.from(JSON.stringify({files:{'default_app.js':{size:source.length,offset:'0'}}})),headerSize=(8+header.length+3)&~3,asar=Buffer.alloc(8+headerSize+source.length);
  asar.writeUInt32LE(4,0);asar.writeUInt32LE(headerSize,4);asar.writeUInt32LE(headerSize-4,8);asar.writeUInt32LE(header.length,12);header.copy(asar,16);source.copy(asar,8+headerSize);
  for(const fault of [null,'checksum','path','probe','network','probe-cleanup','success-cleanup','cancel-probe']) {
    const context={dataRoot:path.join(root,fault||'success')};fs.mkdirSync(context.dataRoot);fs.writeFileSync(path.join(context.dataRoot,'keep'),'existing data');
    let downloads=0;
    const service=manager.create(context,{execute:async(file,args)=>{
      if(file==='/usr/bin/curl') {
        downloads++;assert(args.includes('=https'));if(fault==='network')throw Error('network unavailable');
        const output=args[args.indexOf('--output')+1];fs.writeFileSync(output,args[args.length-1].endsWith('SHASUMS256.txt')?(fault==='checksum'?'0'.repeat(64):sha)+'  '+manager.artifact(requirement).name+'\n':bytes);
      }else if(file==='/usr/bin/unzip')return fault==='path'?'../outside\n':'Electron.app/Contents/MacOS/Electron\n';
      else {assert.strictEqual(file,'/usr/bin/ditto');const exe=path.join(args[3],'Electron.app/Contents/MacOS/Electron');fs.mkdirSync(path.dirname(exe),{recursive:true});fs.writeFileSync(exe,'owned executable');const resources=path.join(args[3],'Electron.app/Contents/Resources');fs.mkdirSync(resources);physicalFs.writeFileSync(path.join(resources,'default_app.asar'),asar);}
    },probe:async(app,runProbe)=>{
      if(fault==='cancel-probe')await new Promise((resolve,reject)=>runProbe(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:5000},error=>error?reject(error):resolve()));
      return {executablePath:path.join(app,'Contents/MacOS/Electron'),version:(fault==='probe'||fault==='probe-cleanup')?'1.0.0':requirement.version,arch:'x64',platform:'darwin',fingerprint:crypto.createHash('sha256').update(fs.readFileSync(path.join(app,'Contents/MacOS/Electron'))).digest('hex')};
    }});
    if(fault==='cancel-probe'){await assert.rejects(service.install(requirement,phase=>{if(phase==='probing')setTimeout(()=>service.cancel(),100);}),error=>error.code==='RUNTIME_INSTALL_CANCELLED');}
    else if(fault==='probe-cleanup'||fault==='success-cleanup') {
      launch.removeTree=()=>{throw Error('injected cleanup failure');};
      try{await assert.rejects(service.install(requirement),error=>{
        if(fault==='probe-cleanup'){assert.strictEqual(error.code,'RUNTIME_INSTALL_FAILED');assert(error.message.includes('发行包实际版本或架构不匹配'),'Keep the original probe error');assert(error.message.includes('清理'));}
        else assert.strictEqual(error.code,'RUNTIME_CLEANUP_FAILED');return true;
      });}finally{launch.removeTree=remove;}
      assert.strictEqual(service.cancel(),false,'Release installer state even when cleanup fails');
      const cache=path.join(context.dataRoot,'runtimes');physicalFs.readdirSync(cache).filter(name=>name.startsWith('.install-')).forEach(name=>remove(path.join(cache,name)));
      if(fault==='success-cleanup'){const installed=await service.install(requirement);assert(physicalFs.existsSync(installed.executablePath));assert.strictEqual(downloads,2,'Reuse a completed install after a cleanup-only error');}
    }else if(fault)await assert.rejects(service.install(requirement),e=>e.code==='RUNTIME_INSTALL_FAILED');
    else {const phases=[];const installed=await service.install(requirement,p=>phases.push(p));assert(fs.existsSync(installed.executablePath));assert.deepStrictEqual(phases.filter((phase,index)=>phase!==phases[index-1]),['downloading','verifying','extracting','probing']);assert.strictEqual(service.cancel(),false);await service.install(requirement);assert.strictEqual(downloads,2,'Reuse installed versions without downloading again');fs.writeFileSync(installed.executablePath,'changed executable');await assert.rejects(service.install(requirement),e=>e.code==='RUNTIME_MISMATCH');assert.strictEqual(fs.readFileSync(installed.executablePath,'utf8'),'changed executable','Do not overwrite changed cached versions');}
    assert.strictEqual(fs.readFileSync(path.join(context.dataRoot,'keep'),'utf8'),'existing data');
    assert(!fs.readdirSync(path.join(context.dataRoot,'runtimes')).some(name=>name.startsWith('.install-')));
  }
  const cancelContext={dataRoot:path.join(root,'cancel')};fs.mkdirSync(cancelContext.dataRoot);fs.writeFileSync(path.join(cancelContext.dataRoot,'keep'),'keep');
  let child,headerFile,transferring,downloadsAfterCancel=0;const samples=[];
  const cancelService=manager.create(cancelContext,{execute:async(file,args,options,control)=>{
    assert.strictEqual(file,'/usr/bin/curl');const output=args[args.indexOf('--output')+1],headers=args[args.indexOf('--dump-header')+1];
    if(args[args.length-1].endsWith('SHASUMS256.txt')){fs.writeFileSync(output,sha+'  '+manager.artifact(requirement).name+'\n');return;}
    headerFile=headers;fs.writeFileSync(headers,'HTTP/1.1 302 Found\r\nContent-Length: 17\r\n\r\nHTTP/2 200\r\nContent-Length: 4096\r\n\r\n');
    const task=manager.execute(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],Buffer.alloc(512));setInterval(()=>{},1000)",output],{timeout:5000},control);child=control.child;transferring=true;return task;
  }});
  assert.strictEqual(typeof cancelService.cancel,'function','An active install must be cancellable');assert.strictEqual(cancelService.cancel(),false);
  const pending=cancelService.install(requirement,(phase,details)=>samples.push({phase,details}));
  async function until(predicate){for(let n=0;n<50;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Progress test timed out');}
  await until(()=>transferring&&samples.some(s=>s.details&&s.details.receivedBytes===512&&s.details.totalBytes===4096&&s.details.bytesPerSecond>0));
  await until(()=>samples.some(s=>s.details&&s.details.receivedBytes===512&&s.details.bytesPerSecond===0));
  fs.writeFileSync(headerFile,'HTTP/2 200\r\nTransfer-Encoding: chunked\r\n\r\n');
  await until(()=>samples.some(s=>s.details&&s.details.receivedBytes===512&&s.details.totalBytes===null));
  assert.strictEqual(cancelService.cancel(),true);await assert.rejects(pending,e=>e.code==='RUNTIME_INSTALL_CANCELLED');
  assert.strictEqual(child.signalCode,'SIGKILL','Force termination when a child ignores SIGTERM');assert.strictEqual(cancelService.cancel(),false);
  downloadsAfterCancel=samples.length;await new Promise(resolve=>setTimeout(resolve,600));assert.strictEqual(samples.length,downloadsAfterCancel,'No delayed progress after cancellation');
  assert.deepStrictEqual(fs.readdirSync(path.join(cancelContext.dataRoot,'runtimes')),[]);assert.strictEqual(fs.readFileSync(path.join(cancelContext.dataRoot,'keep'),'utf8'),'keep');
  const retry=cancelService.install(requirement);assert.strictEqual(cancelService.cancel(),true);await assert.rejects(retry,e=>e.code==='RUNTIME_INSTALL_CANCELLED');
  const cleanupRetry=cancelService.install(requirement);launch.removeTree=()=>{throw Error('injected cleanup failure');};
  try{cancelService.cancel();await assert.rejects(cleanupRetry,error=>error.code==='RUNTIME_CLEANUP_FAILED'&&error.message.includes('下载已取消'));}finally{launch.removeTree=remove;}
  assert.strictEqual(cancelService.cancel(),false);remove(path.join(cancelContext.dataRoot,'runtimes'));
  console.log('PASS: measured bytes/speed, redirects, unknown totals, stalled transfer and actual child cancellation/cleanup');
  console.log('PASS: official artifacts, checksum/path/probe/network failures, staged install and cached reuse');
}finally{remove(root);}})().catch(error=>{console.error(error);process.exitCode=1;});
