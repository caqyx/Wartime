/* Bootstrap: sprawdza dane, uruchamia renderer i UI, pokazuje ekran startowy. */
(function () {
  'use strict';
  var WT = window.WT = window.WT || {};

  function missingData() {
    var miss = [];
    if (!window.MAP_DATA || !window.MAP_DATA.provinces || !window.MAP_DATA.provinces.length) miss.push('data/map.js (window.MAP_DATA)');
    if (!window.COUNTRY_DATA) miss.push('data/countries.js (window.COUNTRY_DATA)');
    if (!WT.render) miss.push('js/ui/render.js');
    if (!WT.ui) miss.push('js/ui/ui.js');
    return miss;
  }

  function boot() {
    var miss = missingData();
    if (miss.length) {
      var f = document.getElementById('fatal');
      f.textContent = 'Nie można uruchomić gry — brakujące pliki:\n' + miss.join('\n');
      f.classList.remove('hidden');
      return;
    }
    if (!WT.state || typeof WT.state.newGame !== 'function') console.warn('[main] Brak WT.state.newGame — logika gry nie jest załadowana.');
    WT.render.init(document.getElementById('map'));
    WT.ui.init();
    WT.ui.showStart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
