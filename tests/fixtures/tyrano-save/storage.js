// Original synthetic implementation deliberately reads the resource directory.
$.getExePath=function () {return require('path').join(__dirname,'resources');};
$.localFilePath=function () {return $.getExePath();};
$.getStorageFile=function (key) {
  const fs=require('fs'),file=require('path').join($.getExePath(),key+'.sav');
  return fs.existsSync(file)?unescape(fs.readFileSync(file,'utf8')):null;
};
$.setStorageFile=function (key,value) {
  require('fs').writeFileSync(require('path').join($.getExePath(),key+'.sav'),escape(JSON.stringify(value)));
};
$.removeStorageFile=function (key) {
  const fs=require('fs'),file=require('path').join($.getExePath(),key+'.sav');
  if(fs.existsSync(file))fs.unlinkSync(file);
};
window.fixtureClear=function (confirmed) {if(confirmed)$.removeStorageFile('fixture_save_sf');};
