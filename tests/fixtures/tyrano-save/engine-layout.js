// Owned alternate fixture: prototype-style engine methods and game confirmation.
var tyrano={plugin:{}};
tyrano.plugin.kag={
  version:520,
  config:{projectID:'fixture_save'},
  init_game:function () {
    const key=process.execPath.indexOf('var/folders')!==-1?this.config.projectID+'_save_key':$.getExePath()+'_'+this.config.projectID;
    const saved=JSON.parse($.getStorageFile(this.config.projectID+'_tyrano_data')||'null');
    let identity=localStorage.getItem(key);
    if(!identity){identity='fixture-generated';localStorage.setItem(key,identity);if(saved){saved.hash=identity;$.setStorageFile(this.config.projectID+'_tyrano_data',saved);}}
    if(saved&&saved.hash!==identity)throw Error('Save identity mismatch stops engine initialization');
  },
  removeSaveData:function () {
    ['sf','tyrano_data','tyrano_quick_save','tyrano_auto_save'].forEach(kind=>$.removeStorageFile(this.config.projectID+'_'+kind));
  },
  clearVariable:function () {$.setStorageFile(this.config.projectID+'_sf',{});}
};
window.fixtureClear=function (confirmed) {if(confirmed)tyrano.plugin.kag.removeSaveData();};

window.fixtureReset=function () {tyrano.plugin.kag.clearVariable();};
