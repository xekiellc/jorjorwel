(function(){
  var path = window.location.pathname;

  function isActive(href){
    if(href === '/'){
      return path === '/' || path === '/index.html';
    }
    if(href === '/canon.html'){
      return path === href || path.indexOf('/books/') === 0;
    }
    return path === href;
  }

  var links = [
    { href: '/', label: 'Essays' },
    { href: '/canon.html', label: 'The Canon' },
    { href: '/notes.html', label: 'Surveillance Notes' },
    { href: '/lists.html', label: 'Reading Lists' },
    { href: '/orwell.html', label: 'Orwell' },
    { href: '/about.html', label: 'About' }
  ];

  var navHtml = links.map(function(l){
    var cls = isActive(l.href) ? ' class="active"' : '';
    return '<a href="' + l.href + '"' + cls + '>' + l.label + '</a>';
  }).join('\n      ');

  var headerHtml =
    '<div class="wrap header-inner">' +
      '<a href="/" class="logo" style="color:inherit;">' +
        'JORJOR<span class="wel"> WEL</span>' +
        '<sub>Ministry of Reality // Est. 2026</sub>' +
      '</a>' +
      '<nav>' + navHtml + '</nav>' +
    '</div>';

  var target = document.getElementById('site-header');
  if(target){
    target.innerHTML = headerHtml;
  }
})();
