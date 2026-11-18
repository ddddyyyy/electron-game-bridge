const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const cp=require('child_process');
const config=require('./config');
const launch=require('./launch');
function cancelled() {return config.failure('RUNTIME_INSTALL_CANCELLED','下载已取消');}
function execute(file,args,options,control) {
  if(control&&control.cancelled)return Promise.reject(cancelled());
  return new Promise((resolve,reject)=>{
    const child=cp.execFile(file,args,Object.assign({timeout:120000,maxBuffer:8*1024*1024},options),(error,stdout)=>{
      if(control){clearTimeout(control.killTimer);if(control.child===child)control.child=null;}
      if(control&&control.cancelled)reject(cancelled());else if(error)reject(error);else resolve(stdout);
    });
    if(control)control.child=child;
  });
}
function artifact(requirement) {
  if(!requirement||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(requirement.version)||!['x64','arm64'].includes(requirement.arch))throw config.failure('RUNTIME_INVALID','缺少可靠的 Electron 精确版本与架构');
  const name='electron-v'+requirement.version+'-darwin-'+requirement.arch+'.zip';
  return {name,base:'https://github.com/electron/electron/releases/download/v'+requirement.version+'/'};
}
function downloadTotal(headers) {
  const blocks=headers.trim().split(/\r?\n\r?\n/),last=blocks[blocks.length-1]||'';
  if(!/^HTTP\/\S+ 200\b/.test(last))return null;
  const lengths=last.split(/\r?\n/).filter(line=>/^content-length:/i.test(line));
  if(lengths.length!==1||!/^content-length:\s*\d+\s*$/i.test(lengths[0]))return null;
  const value=Number(lengths[0].split(':')[1]);return Number.isSafeInteger(value)&&value>=0?value:null;
}
function create(context,options) {
  options=options||{};let active=null;
  const executor=options.execute||execute,probe=options.probe||launch.inspectRuntime;
  return {cancel:function(){
    if(!active)return false;active.cancelled=true;
    const control=active,child=control.child;
    if(child){child.kill('SIGTERM');if(!control.killTimer)control.killTimer=setTimeout(()=>{if(control.child===child)child.kill('SIGKILL');},1000);}
    return true;
  },install:async function(requirement,progress) {
    if(active)throw config.failure('OPERATION_BUSY','已有运行环境正在安装');
    const control={cancelled:false,child:null};active=control;let stage,installError;
    const check=()=>{if(control.cancelled)throw cancelled();};
    const notify=(phase,details)=>{if(!control.cancelled&&progress)progress(phase,details);};
    const run=async(file,args,settings)=>{check();const result=await executor(file,args,settings,control);check();return result;};
    const inspect=app=>probe(app,(file,args,settings,callback)=>{execute(file,args,settings,control).then(stdout=>callback(null,stdout,''),error=>callback(error,'',''));});
    try {
      const item=artifact(requirement),parent=path.join(context.dataRoot,'runtimes'),target=path.join(parent,'electron-'+requirement.version+'-darwin-'+requirement.arch);
      if(!config.inside(context.dataRoot,target))throw config.failure('RUNTIME_INVALID','运行环境缓存目录越界');
      fs.mkdirSync(parent,{recursive:true,mode:0o700});
      if(fs.lstatSync(parent).isSymbolicLink())throw config.failure('RUNTIME_INVALID','运行环境缓存目录不能使用链接');
      if(fs.existsSync(target)) {
        notify('checking');
        if(fs.lstatSync(target).isSymbolicLink())throw config.failure('RUNTIME_INVALID','运行环境安装目录不能使用链接');
        if(!config.inside(target,path.join(target,'Electron.app/Contents/MacOS/Electron')))throw config.failure('RUNTIME_INVALID','已安装程序路径越界');
        const manifest=JSON.parse(fs.readFileSync(path.join(target,'installation.json'),'utf8'));
        const actual=await inspect(path.join(target,'Electron.app'));check();
        if(manifest.version!==requirement.version||manifest.arch!==requirement.arch||manifest.fingerprint!==actual.fingerprint||actual.version!==requirement.version||actual.arch!==requirement.arch||actual.platform!=='darwin')throw config.failure('RUNTIME_MISMATCH','已安装的运行环境发生变化，原目录保留');
        return Object.assign(actual,{source:item.base+item.name});
      }
      stage=fs.mkdtempSync(path.join(parent,'.install-'));
      async function download(name,file,limit) {
        const headers=file+'.headers';let previousBytes=0,previousTime=Date.now(),speed=0;
        function report() {
          let received=0,total=null;
          try{received=fs.statSync(file).size;}catch(_){}
          try{if(fs.statSync(headers).size<=128*1024)total=downloadTotal(fs.readFileSync(headers,'utf8'));}catch(_){}
          const now=Date.now(),elapsed=now-previousTime;
          if(elapsed>=250){speed=Math.max(0,received-previousBytes)*1000/elapsed;previousBytes=received;previousTime=now;}
          notify('downloading',{fileName:name,receivedBytes:received,totalBytes:total,bytesPerSecond:speed});
        }
        report();const timer=setInterval(report,500);
        try {
          await run('/usr/bin/curl',['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','600','--retry','1','--max-filesize',String(limit),'--dump-header',headers,'--output',file,item.base+name],{timeout:650000});
          report();if(fs.statSync(file).size>limit)throw Error('官方发行文件超过下载上限');
        }catch(error){check();throw Error(error.code===22?'官方发行包无法访问，请核对该版本是否提供对应的 macOS 包':'官方下载连接失败或超时，请检查网络或代理后重试');}
        finally{clearInterval(timer);}
      }
      const sums=path.join(stage,'SHASUMS256.txt'),archive=path.join(stage,'electron.zip');
      await download('SHASUMS256.txt',sums,1024*1024);
      const expected=fs.readFileSync(sums,'utf8').split(/\r?\n/).map(line=>line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)).filter(match=>match&&match[2]===item.name);
      if(expected.length!==1)throw Error('官方清单未包含唯一的目标发行包');
      await download(item.name,archive,1024*1024*1024);notify('verifying');
      const hash=crypto.createHash('sha256');await new Promise((resolve,reject)=>{const stream=fs.createReadStream(archive);stream.on('data',bytes=>{if(control.cancelled)stream.destroy(cancelled());else hash.update(bytes);});stream.on('error',reject);stream.on('end',resolve);});check();
      if(hash.digest('hex')!==expected[0][1].toLowerCase())throw Error('官方发行包 SHA-256 校验失败');
      const names=String(await run('/usr/bin/unzip',['-Z1',archive])).split(/\r?\n/).filter(Boolean);
      if(!names.length||names.some(name=>path.isAbsolute(name)||name.split('/').includes('..')||name.includes('\\')))throw Error('发行包包含不安全路径');
      notify('extracting');const unpack=path.join(stage,'unpacked');fs.mkdirSync(unpack);
      await run('/usr/bin/ditto',['-x','-k',archive,unpack]);notify('probing');
      if(!config.inside(unpack,path.join(unpack,'Electron.app/Contents/MacOS/Electron')))throw Error('发行包程序路径越界');
      const actual=await inspect(path.join(unpack,'Electron.app'));check();
      if(actual.version!==requirement.version||actual.arch!==requirement.arch||actual.platform!=='darwin')throw Error('发行包实际版本或架构不匹配');
      fs.writeFileSync(path.join(unpack,'installation.json'),JSON.stringify({version:actual.version,arch:actual.arch,fingerprint:actual.fingerprint,sha256:expected[0][1].toLowerCase(),source:item.base+item.name}),{flag:'wx',mode:0o600});
      fs.renameSync(unpack,target);
      return Object.assign(actual,{executablePath:path.join(target,'Electron.app/Contents/MacOS/Electron'),source:item.base+item.name});
    }catch(error){
      if(control.cancelled)error=cancelled();
      else if(error.code!=='RUNTIME_MISMATCH'&&error.code!=='RUNTIME_INVALID')error=config.failure('RUNTIME_INSTALL_FAILED','安装 Electron 失败，已有运行环境和游戏数据未改动：'+error.message);
      installError=error;throw error;
    }finally{
      try{if(stage)launch.removeTree(stage);}
      catch(error){
        if(installError&&installError.code!=='RUNTIME_INSTALL_CANCELLED')installError.message+='；临时文件清理未完成，已有数据已保留。';
        else throw config.failure('RUNTIME_CLEANUP_FAILED',installError?'下载已取消，但临时文件清理失败；已有版本和游戏数据已保留。':'运行环境已安装，但临时文件清理失败；请重试登记，已安装文件会被复用。');
      }finally{clearTimeout(control.killTimer);active=null;}
    }
  }};
}
module.exports={create,artifact,execute,downloadTotal};
