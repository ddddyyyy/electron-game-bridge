const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs');
const path=require('path');
const dataArg=process.argv.find(a=>a.indexOf('--user-data-dir=')===0);
if(!dataArg)throw Error('Fixture requires isolated userData');
const dataRoot=dataArg.slice(16);
fs.mkdirSync(dataRoot,{recursive:true});app.setPath('userData',dataRoot);
console.log('fixture-stage:main ready='+app.isReady());
ipcMain.on('fixture:data',event=>{event.returnValue={root:dataRoot,action:(process.argv.find(a=>a.indexOf('--fixture-action=')===0)||'').slice(17)};});
app.on('ready',()=>{
  console.log('fixture-stage:ready');
  const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,preload:path.join(__dirname,'preload.js')}});
  console.log('fixture-stage:window');
  const identity={appPath:app.getAppPath(),main:require.main.filename,name:app.getName(),version:app.getVersion(),argv:process.argv.slice(1),cwd:process.cwd(),userData:app.getPath('userData')};
  fs.writeFileSync(path.join(app.getPath('userData'),'fixture-main.json'),JSON.stringify(identity));
  window.loadFile(path.join(__dirname,'index.html'));
});
app.on('window-all-closed',()=>app.quit());
