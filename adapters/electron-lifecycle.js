const {app,BrowserWindow}=require('electron');
app.on('window-all-closed',()=>{
  // Let the game's own close handlers finish, then request its normal quit path.
  setImmediate(()=>{if(BrowserWindow.getAllWindows().length===0)app.quit();});
});
