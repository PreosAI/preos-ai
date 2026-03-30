document.addEventListener('DOMContentLoaded', function() {
  const logos = document.querySelectorAll('img.site-logo');
  const isLocal = window.location.protocol === 'file:';
  logos.forEach(logo => {
    logo.src = isLocal ? 'Images/logo.png' : '/Images/logo.png';
  });
});
