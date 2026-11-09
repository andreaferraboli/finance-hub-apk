/* Banca Demo IT: logica condivisa del portale finto. Nessun dato reale. */
(function () {
  var page = location.pathname.split('/').pop() || 'index.html';
  var publicPages = { 'index.html': 1, 'otp.html': 1, 'accesso-telefono.html': 1 };

  // Sessione finta in localStorage: login + OTP 123456.
  if (!publicPages[page] && localStorage.getItem('demo_auth') !== '1') {
    location.replace('index.html');
    return;
  }

  window.demoLogout = function () {
    localStorage.removeItem('demo_auth');
    localStorage.removeItem('demo_stage');
    location.href = 'index.html';
  };

  function renderMenu() {
    var nav = document.querySelector('nav.menu');
    if (!nav) return;
    var links = [
      ['dashboard.html', 'Conti'],
      ['movimenti.html', 'Movimenti'],
      ['portafoglio.html', 'Portafoglio'],
      ['carte.html', 'Carte'],
      ['estratti.html', 'Estratti conto'],
      ['profilo.html', 'Profilo'],
      ['bonifico.html', 'Bonifico'],
      ['#esci', 'Esci']
    ];
    nav.innerHTML = links.map(function (l) {
      var active = l[0] === page || (page === 'movimenti-carta.html' && l[0] === 'carte.html') ? ' class="active"' : '';
      return '<a href="' + l[0] + '"' + active + '>' + l[1] + '</a>';
    }).join('');
    var exit = nav.querySelector('a[href="#esci"]');
    exit.addEventListener('click', function (e) {
      e.preventDefault();
      window.demoLogout();
    });
  }

  document.addEventListener('DOMContentLoaded', renderMenu);
})();
