(function () {
  // A fatal installation error must not return control to the game's scripts.
  let ipc;
  function fatal(error) {
    try {if(ipc)ipc.sendSync('launcher-save:failed',String(error.message||error));}finally {process.exit(1);}
  }
  try {
    ipc=require('electron').ipcRenderer;
    if(!process.isMainFrame)return;
    const fs=require('fs'),path=require('path'),crypto=require('crypto');
    const context=ipc.sendSync('launcher-save:init');
    if(!context||context.error)throw Error('无法验证存档启动描述');
    const methods=context.profile.requiredMethods,assigned=new Set();
    let installed=false,poisoned=false;const clearAssigned=new Set();
    function fail(error){poisoned=true;fatal(error);}
    function filename(key) {
      if(poisoned||!installed)throw Error('存档保护未就绪');
      if(!context.profile.keys.includes(key))throw Error('不支持的存档键');
      return path.join(context.selectedDirectory,key+'.sav');
    }
    function read(key) {
      try {
        if(context.game)return invoke('read',{key});
        const file=filename(key);
        if(!fs.existsSync(file))return null;
        const stat=fs.lstatSync(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>64*1024*1024)throw Error('存档文件不安全');
        const value=unescape(fs.readFileSync(file,'utf8'));JSON.parse(value);return value;
      }catch(error){fail(error);}
    }
    function invoke(operation,details) {
      if(poisoned||!installed)throw Error('存档保护未就绪');
      const result=ipc.sendSync('launcher-save:storage',Object.assign({operation,documentGeneration:context.documentGeneration},details));
      if(!result||!result.ok)throw Error(result&&result.message||'存档操作失败');
      return result.value;
    }
    function protectedCall(operation,details){try{return invoke(operation,details);}catch(error){fail(error);}}
    function ready() {
      if(installed||assigned.size!==methods.length||(context.game&&clearAssigned.size!==context.profile.clearBoundaries.length))return;
      installed=true;context.profile.keys.forEach(key=>read(key));
      if(!ipc.sendSync('launcher-save:ready',context.documentGeneration))fail(Error('存档就绪报告失败'));
    }
    function hashFunction(value) {return crypto.createHash('sha256').update(Function.prototype.toString.call(value).replace(/\r\n/g,'\n').trim()).digest('hex');}
    function observe(target,name,transform) {
      const initial=target[name];let current;
      Object.defineProperty(target,name,{configurable:false,enumerable:true,get:()=>current,set:value=>{
        try{current=transform(value);}catch(error){fail(error);}
      }});
      if(initial!==undefined)target[name]=initial;
    }
    function clearMethods(target) {
      context.profile.clearBoundaries.forEach(boundary=>observe(target,boundary.name,value=>{
        if(typeof value!=='function'||clearAssigned.has(boundary.name)||hashFunction(value)!==boundary.methodHash)throw Error('清档方法定义无法核对');
        clearAssigned.add(boundary.name);
        const wrapped=function(confirmed) {
          if(boundary.confirmationBoolean&&!confirmed)return value.apply(this,arguments);
          protectedCall('begin-clear',{boundary:boundary.name});
          let result;try{result=value.apply(this,arguments);}catch(error){return fail(error);}
          protectedCall('finish-clear');return result;
        };
        ready();return wrapped;
      }));
      return target;
    }
    if(context.game) {
      if(context.profile.layout==='fixture')clearMethods(window);
      else observe(window,'tyrano',engine=>{
        if(!engine||typeof engine!=='object')throw Error('未知引擎对象');
        observe(engine,'plugin',plugins=>{
          if(!plugins||typeof plugins!=='object')throw Error('未知引擎插件对象');
          observe(plugins,'kag',clearMethods);return plugins;
        });return engine;
      });
    }
    const replacements={localFilePath:()=>context.selectedDirectory,getStorageFile:read,setStorageFile:(key,value)=>protectedCall('write',{key,value}),removeStorageFile:key=>protectedCall('remove',{key})};
    function attach(target) {
      if(typeof target!=='function')throw Error('未知引擎初始化对象');
      methods.forEach(name=>Object.defineProperty(target,name,{configurable:false,enumerable:true,get:()=>replacements[name],set:value=>{
        if(typeof value!=='function'||assigned.has(name)||hashFunction(value)!==context.profile.methodHashes[name])return fail(Error('未知存档方法定义'));
        assigned.add(name);
        ready();
      }}));
      return target;
    }
    let jquery;
    Object.defineProperty(window,'$',{configurable:false,enumerable:true,get:()=>jquery,set:value=>{
      try{if(jquery&&jquery!==value)throw Error('引擎对象被替换');if(!jquery)jquery=attach(value);}catch(error){fail(error);}
    }});
  }catch(error){fatal(error);}
})();
