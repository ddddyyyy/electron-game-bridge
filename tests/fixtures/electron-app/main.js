const {app,BrowserWindow}=require('electron');
const fs=require('fs');
const path=require('path');
const data=process.argv.find(a=>a.startsWith('--user-data-dir='));
if(!data) throw new Error('Fixture requires explicit isolated userData');
const dir=data.slice(16); fs.mkdirSync(dir,{recursive:true}); app.setPath('userData',dir);
fs.writeFileSync(path.join(dir,'initialized.json'),JSON.stringify({initialized:true,version:process.versions.electron}));
app.on('ready',()=>{
  const w=new BrowserWindow({width:640,height:480,webPreferences:{nodeIntegration:false}});w.loadFile(path.join(__dirname,'index.html'));
  if(process.argv.includes('--fixture-exit'))setTimeout(()=>app.quit(),1500);
  if(process.argv.includes('--fixture-close')) {
    w.on('closed',()=>fs.writeFileSync(path.join(dir,'window-closed.json'),JSON.stringify({remaining:BrowserWindow.getAllWindows().length})));
    if(process.argv.includes('--fixture-multiple')){const second=new BrowserWindow({show:false});second.on('closed',()=>fs.writeFileSync(path.join(dir,'second-closed'),'closed'));setTimeout(()=>second.close(),2200);}
    setTimeout(()=>w.close(),1500);
  }
});
let saved=false;
app.on('before-quit',event=>{
  if(process.argv.includes('--fixture-save-before-quit')&&!saved){event.preventDefault();saved=true;setTimeout(()=>{fs.writeFileSync(path.join(dir,'save-completed'),'saved');app.quit();},250);return;}
  fs.writeFileSync(path.join(dir,'quit.json'),JSON.stringify({remaining:BrowserWindow.getAllWindows().length}));
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
