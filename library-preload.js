const { contextBridge, ipcRenderer } = require('electron');
function request(action,payload) {
  return ipcRenderer.invoke('launcher:request',{action,payload}).then(result=>{
    if(!result.ok) throw {message:result.message,code:result.code,fieldErrors:result.fieldErrors};
    return result.value;
  });
}
contextBridge.exposeInMainWorld('launcher', {
  readLibrary:()=>request('readLibrary'),
  choosePath:kind=>request('choosePath',kind),
  resolveGameRuntime:input=>request('resolveGameRuntime',input),
  inspectRuntime:input=>request('inspectRuntime',input),
  saveGame:input=>request('saveGame',input),
  saveRuntime:input=>request('saveRuntime',input),
  launchGame:id=>request('launchGame',id),
  restoreConfig:input=>request('restoreConfig',input),
  onLaunchState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('launcher:state',listener);return()=>ipcRenderer.removeListener('launcher:state',listener);}
});
