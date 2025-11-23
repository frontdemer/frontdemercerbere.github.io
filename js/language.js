function showLang(lang) {
  const sections = document.querySelectorAll('.lang-section');
  sections.forEach(sec => sec.classList.add('hidden'));

  const visibleSections = document.querySelectorAll(`.lang-${lang}`);
  visibleSections.forEach(sec => sec.classList.remove('hidden'));
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if(section) section.scrollIntoView({ behavior: 'smooth' });
}