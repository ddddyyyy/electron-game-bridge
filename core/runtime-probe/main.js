const { app } = require('electron');
const fs = require('fs');
const arg = process.argv.find(a => a.startsWith('--probe-data='));
if (!arg) app.exit(1);
else {
  fs.mkdirSync(arg.slice(13), { recursive: true });
  app.setPath('userData', arg.slice(13));
  console.log('LAUNCHER_RUNTIME:' + JSON.stringify({ version: process.versions.electron, platform: process.platform, arch: process.arch }));
  app.exit(0);
}
