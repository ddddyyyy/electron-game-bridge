const {app,BrowserWindow}=require('electron');
const fs=require('fs');
const path=require('path');
const data=process.argv.find(a=>a.startsWith('--user-data-dir='));
if(!data) throw new Error('Fixture requires explicit isolated userData');
const dir=data.slice(16); fs.mkdirSync(dir,{recursive:true}); app.setPath('userData',dir);
fs.writeFileSync(path.join(dir,'initialized.json'),JSON.stringify({initialized:true,version:process.versions.electron}));
app.on('ready',()=>{const w=new BrowserWindow({width:640,height:480,webPreferences:{nodeIntegration:false}});w.loadFile(path.join(__dirname,'index.html'));if(process.argv.includes('--fixture-exit'))setTimeout(()=>app.quit(),1500);});
app.on('window-all-closed',()=>app.quit());
