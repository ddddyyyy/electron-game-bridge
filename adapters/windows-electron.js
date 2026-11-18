const fs=require('fs');
const path=require('path');
const {failure,inside}=require('../core/config');
// Read the bundled PE runtime's own user-agent constant; never execute Windows code.
function inspectWindowsElectron(file) {
  const fd=fs.openSync(file,'r');
  try {
    const size=fs.fstatSync(fd).size;
    function read(offset,length){if(offset<0||offset+length>size)throw Error('PE bounds');const b=Buffer.alloc(length);if(fs.readSync(fd,b,0,length,offset)!==length)throw Error('PE truncated');return b;}
    const dos=read(0,64);if(dos.toString('ascii',0,2)!=='MZ')return null;
    const pe=dos.readUInt32LE(60),header=read(pe,24);
    if(header.toString('hex',0,4)!=='50450000')return null;
    const arch=({34404:'x64',43620:'arm64'})[header.readUInt16LE(4)],count=header.readUInt16LE(6);
    if(!arch||!count||count>96)return null;
    const table=read(pe+24+header.readUInt16LE(20),count*40),versions=new Set();
    for(let i=0;i<count;i++) {
      const s=table.slice(i*40,i*40+40);if(s.toString('ascii',0,8).replace(/\0/g,'')!=='.rdata')continue;
      const length=s.readUInt32LE(16),offset=s.readUInt32LE(20);
      if(length>64*1024*1024)throw Error('PE metadata exceeds 64 MiB');
      const data=read(offset,length).toString('latin1');
      const pattern=/\bElectron\/(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?![\d.])/g;let match;
      while((match=pattern.exec(data)))versions.add(match[1]);
    }
    if(versions.size>1)throw failure('GAME_RUNTIME_CONFLICT','随附程序包含冲突的 Electron 版本证据');
    return versions.size?{version:Array.from(versions)[0],arch,evidence:file+' · PE .rdata Electron/'+Array.from(versions)[0]}:null;
  }catch(error){if(error.code==='GAME_RUNTIME_CONFLICT')throw error;return null;}
  finally{fs.closeSync(fd);}
}
function packagedRuntimeEvidence(installPath) {
  if(!fs.existsSync(path.join(installPath,'resources/app.asar'))&&!fs.existsSync(path.join(installPath,'resources/app/package.json')))return [];
  const names=fs.readdirSync(installPath).filter(n=>n.toLowerCase().endsWith('.exe'));
  if(names.length>8)throw failure('GAME_RUNTIME_UNKNOWN','随附可执行文件过多，无法唯一识别运行环境');
  const result=[];
  for(const name of names){const file=path.join(installPath,name);if(!inside(installPath,file))throw failure('GAME_RUNTIME_UNKNOWN','版本证据不能指向游戏目录外');const value=inspectWindowsElectron(file);if(value)result.push(value);}
  return result;
}
module.exports={inspectWindowsElectron,packagedRuntimeEvidence};
