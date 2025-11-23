const galleryRoot = {
  nl: 'images/gallery/',
  fr: 'images/gallery/',
  en: 'images/gallery/'
};

function loadGallery(lang) {
  const container = document.getElementById(`gallery-container${lang==='nl'?'':''}-${lang}`);
  container.innerHTML='';
  // Define categories and images (can also be dynamically read if using Python push)
  const categories = ['interieur','exterieur','zeezicht'];
  categories.forEach(cat=>{
    const catDiv = document.createElement('div');
    catDiv.innerHTML=`<h3>${cat}</h3>`;
    const grid = document.createElement('div');
    grid.style.display='grid';
    grid.style.gridTemplateColumns='repeat(auto-fit,minmax(250px,1fr))';
    grid.style.gap='1rem';
    // Example images
    for(let i=1;i<=5;i++){
      const img=document.createElement('img');
      img.src=`${galleryRoot[lang]}${cat}/${cat}${i}.jpg`;
      img.alt=`${cat} ${i}`;
      grid.appendChild(img);
    }
    catDiv.appendChild(grid);
    container.appendChild(catDiv);
  });
}
['nl','fr','en'].forEach(loadGallery);