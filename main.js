const path=require('path');
const {app}=require('electron');
const config=require('./core/config');
const launch=require('./core/launch');
const adapters=require('./adapters');
try {
  const root=__dirname;
  const packaged=app.isPackaged;
  const dataRoot=packaged?path.join(app.getPath('appData'),'Electron Game Bridge'):path.join(root,'.launcher');
  const options=launch.parseArgs(process.argv.slice(packaged?1:2));
  if(options.test) {
    const existing=config.createStore(dataRoot,adapters.defaults,adapters.metadata).read();
    const protectedPaths=existing.library?existing.library.games.filter(g=>g&&typeof g.installPath==='string'&&path.isAbsolute(g.installPath)).map(g=>g.installPath):[];
    options.test=launch.testRoot(root,options.test,protectedPaths.concat(dataRoot));
  }
  const logRoot=packaged?path.join(dataRoot,'logs/games'):path.join(root,'logs/games');
  const context={root,test:options.test,dataRoot:options.test?path.join(options.test,'library'):dataRoot,logRoot:options.test?path.join(options.test,'logs'):logRoot};
  require('./library-main').start(context,options);
} catch(error) {
  console.error((error.code||'LAUNCH_FAILED')+': '+error.message);app.exit(1);
}
