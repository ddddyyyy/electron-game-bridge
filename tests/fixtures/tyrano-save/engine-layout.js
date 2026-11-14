// Owned alternate fixture: prototype-style engine methods and game confirmation.
var tyrano={plugin:{}};
tyrano.plugin.kag={
  version:520,
  config:{projectID:'fixture_save'},
  removeSaveData:function () {
    ['sf','tyrano_data','tyrano_quick_save','tyrano_auto_save'].forEach(kind=>$.removeStorageFile(this.config.projectID+'_'+kind));
  },
  clearVariable:function () {$.setStorageFile(this.config.projectID+'_sf',{});}
};
window.fixtureClear=function (confirmed) {if(confirmed)tyrano.plugin.kag.removeSaveData();};

window.fixtureReset=function () {tyrano.plugin.kag.clearVariable();};
