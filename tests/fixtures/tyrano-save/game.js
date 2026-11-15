const fixtureFS=require('fs');
const fixturePath=require('path');
const fixtureAction=window.fixtureOptions.action;
const fixtureRoot=window.fixtureOptions.root;
if(window.tyrano){localStorage.setItem('fixture-unrelated','keep');tyrano.plugin.kag.init_game();if(localStorage.getItem('fixture-unrelated')!=='keep')throw Error('Unrelated userData changed');}
const fixtureResult={preload:window.fixtureOriginalPreload,old:JSON.parse($.getStorageFile('fixture_save_sf')||'null')};
if(fixtureAction==='save')$.setStorageFile('fixture_save_sf',{progress:2});
if(fixtureAction==='clear')window.fixtureClear(true);
if(fixtureAction==='reset')window.fixtureReset();
if(fixtureAction==='cancel-clear')window.fixtureClear(false);
if(fixtureAction==='reload'&&!sessionStorage.fixtureReloaded){sessionStorage.fixtureReloaded='1';location.reload();}
else {
  fixtureResult.after=JSON.parse($.getStorageFile('fixture_save_sf')||'null');
  fixtureFS.writeFileSync(fixturePath.join(fixtureRoot,'fixture-result.json'),JSON.stringify(fixtureResult));
  setTimeout(()=>window.close(),100);
}
