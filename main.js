const path=require('path');
const {app}=require('electron');
const config=require('./core/config');
const launch=require('./core/launch');
const adapters=require('./adapters');
try {
  const options=launch.parseArgs(process.argv.slice(2));
  const root=__dirname;
  if(options.test) {
    const existing=config.createStore(path.join(root,'.launcher'),adapters.defaults,adapters.metadata).read();
    const protectedPaths=existing.library?existing.library.games.filter(g=>g&&typeof g.installPath==='string'&&path.isAbsolute(g.installPath)).map(g=>g.installPath):[];
    options.test=launch.testRoot(root,options.test,protectedPaths);
  }
  const context={root,test:options.test,dataRoot:options.test?path.join(options.test,'library'):path.join(root,'.launcher'),logRoot:options.test?path.join(options.test,'logs'):path.join(root,'logs/games')};
  require('./library-main').start(context,options);
} catch(error) {
  console.error((error.code||'LAUNCH_FAILED')+': '+error.message);app.exit(1);
}
