/* ============================================================
   QVAC Story Image Generator — SVG art system

   Pure, deterministic illustration. Every scene is hand-drawn SVG
   generated in code; the child's photo is composited into the
   character's face via an SVG <clipPath>. There is no image model
   and no network: the picture is assembled locally, in the renderer,
   from the photo that never leaves this process.

   STORIES holds the three tales and their characters. The story text
   itself (the captions) is written on-device by the local Qwen3 model
   (see app.jsx / main.js); the captions here are the offline fallback.
   ============================================================ */

const STORIES = [
  { key:'lion', name:'The Brave Little Lion', teaser:'A little lion finds courage on the golden plains.',
    accent:'#E0992E', soft:'rgba(224,153,46,0.13)',
    chars:['The Lion Cub','The Wise Lion Guardian'],
    captions:[
      "You're born into the pride, high on Sunrise Rock.",
      "You explore the wild golden plains, brave and curious.",
      "A storm scatters the pride — now you must be strong.",
      "You grow into a proud, mighty lion.",
      "You return home and the whole pride cheers. The end!"]},
  { key:'castle', name:'The Enchanted Castle', teaser:'Kindness and a gentle creature break an old spell.',
    accent:'#9B86E0', soft:'rgba(155,134,224,0.13)',
    chars:['The Kind Wanderer','The Gentle Creature'],
    captions:[
      "You discover a grand castle hidden deep in the forest.",
      "A single magic rose glows softly under glass.",
      "You meet a large, gentle creature who seems lonely.",
      "You become friends and share a joyful dance.",
      "Your kindness lifts the spell — and the castle fills with light!"]},
  { key:'snow', name:'The Snow Queen', teaser:'A magical journey through a sparkling frozen world.',
    accent:'#6FA8D4', soft:'rgba(111,168,212,0.13)',
    chars:['The Winter Traveler','The Snow Queen'],
    captions:[
      "Snowflakes swirl as your winter adventure begins.",
      "You journey across a sparkling frozen lake.",
      "A glittering palace of ice rises before you.",
      "You meet the shimmering Snow Queen.",
      "Warmth melts the frost and you find your way home. The end!"]}
];

function star(cx,cy,s,fill,op){
  let p='';
  for(let k=0;k<5;k++){
    const a=-Math.PI/2+k*2*Math.PI/5, a2=a+Math.PI/5;
    p+=(cx+Math.cos(a)*s)+','+(cy+Math.sin(a)*s)+' '+(cx+Math.cos(a2)*s*0.45)+','+(cy+Math.sin(a2)*s*0.45)+' ';
  }
  return '<polygon points="'+p+'" fill="'+fill+'" opacity="'+(op==null?1:op)+'"/>';
}

function faceNode(uid, photo, x, y, r, tone, accent){
  if(photo){
    // Stylize the photo so it reads as ONE drawn character, not a photo in a
    // circle. The face is (1) posterized into flat colour bands to match the
    // flat-vector art, (2) tone-unified into the character's palette via a
    // soft-light flood, (3) cropped to a face-shaped oval (dropping the photo's
    // own hair/neck/background), (4) feathered into a character-tone backing,
    // and (5) cel-shaded with a soft directional crescent like the drawn bodies.
    const tn = tone || '#f0d2b4', ac = accent || '#16E3C1';
    // ---- tunable knobs ----
    const RX = r*0.82, RY = r*1.0;     // face-oval crop
    const oy = y - r*0.06;             // push oval up onto the face
    const featherStop = 50;            // feather hold % (lower = tighter crop)
    const featherBlur = r*0.10;        // rim softness
    const bands = 5;                   // posterize levels (floor 4)
    const sat = 1.25;                  // pre-posterize saturation boost
    const denoise = r*0.012;           // tiny blur to clean banding
    const toneStrength = 0.40;         // tone soft-light flood opacity
    const shadeStrength = 0.20;        // cel-shadow darkness
    let tbl=''; for(let k=0;k<bands;k++){ tbl += (k/(bands-1)).toFixed(3)+(k<bands-1?' ':''); }
    return '<defs>'
      +'<radialGradient id="fg'+uid+'" gradientUnits="userSpaceOnUse" cx="'+x+'" cy="'+oy+'" r="'+RY+'">'
        +'<stop offset="0%" stop-color="#fff"/><stop offset="'+featherStop+'%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/>'
      +'</radialGradient>'
      +'<filter id="fb'+uid+'" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="'+featherBlur+'"/></filter>'
      +'<mask id="fm'+uid+'" maskUnits="userSpaceOnUse" x="'+(x-r*1.3)+'" y="'+(oy-r*1.3)+'" width="'+(r*2.6)+'" height="'+(r*2.6)+'">'
        +'<ellipse cx="'+x+'" cy="'+oy+'" rx="'+RX+'" ry="'+RY+'" fill="url(#fg'+uid+')" filter="url(#fb'+uid+')"/>'
      +'</mask>'
      +'<filter id="fc'+uid+'" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">'
        +'<feGaussianBlur stdDeviation="'+denoise+'" result="dn"/>'
        +'<feColorMatrix in="dn" type="saturate" values="'+sat+'" result="st"/>'
        +'<feComponentTransfer in="st" result="ps">'
          +'<feFuncR type="discrete" tableValues="'+tbl+'"/><feFuncG type="discrete" tableValues="'+tbl+'"/><feFuncB type="discrete" tableValues="'+tbl+'"/>'
        +'</feComponentTransfer>'
        +'<feFlood flood-color="'+tn+'" flood-opacity="'+toneStrength+'" result="fl"/>'
        +'<feComposite in="fl" in2="ps" operator="in" result="flc"/>'
        +'<feBlend in="flc" in2="ps" mode="soft-light"/>'
      +'</filter>'
      +'</defs>'
      +'<ellipse cx="'+x+'" cy="'+oy+'" rx="'+(RX*1.08)+'" ry="'+(RY*1.06)+'" fill="'+tn+'"/>'
      +'<image href="'+photo+'" x="'+(x-r)+'" y="'+(oy-r)+'" width="'+(r*2)+'" height="'+(r*2)+'" preserveAspectRatio="xMidYMid slice" filter="url(#fc'+uid+')" mask="url(#fm'+uid+')"/>'
      +'<ellipse cx="'+(x-RX*0.28)+'" cy="'+(oy+RY*0.30)+'" rx="'+(RX*0.95)+'" ry="'+(RY*0.9)+'" fill="#1a1208" opacity="'+shadeStrength+'" mask="url(#fm'+uid+')"/>'
      +'<ellipse cx="'+x+'" cy="'+oy+'" rx="'+(RX*0.93)+'" ry="'+(RY*0.93)+'" fill="none" stroke="'+ac+'" stroke-width="'+(r*0.10)+'" opacity="0.16" mask="url(#fm'+uid+')"/>';
  }
  return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="#f0d2b4"/>'
    +'<circle cx="'+(x-r*0.34)+'" cy="'+(y-r*0.05)+'" r="'+(r*0.1)+'" fill="#2a2018"/><circle cx="'+(x+r*0.34)+'" cy="'+(y-r*0.05)+'" r="'+(r*0.1)+'" fill="#2a2018"/>'
    +'<path d="M'+(x-r*0.3)+' '+(y+r*0.32)+' Q'+x+' '+(y+r*0.6)+' '+(x+r*0.3)+' '+(y+r*0.32)+'" stroke="#b07a55" stroke-width="'+(r*0.09)+'" fill="none" stroke-linecap="round"/>';
}

// Draws the child transformed INTO the selected story character: a character
// body + story-specific features (mane, hood, fur, frost crown) framing the
// child's actual face. (x,y)=head centre, r=head radius. ci = chosen character.
function charFigure(uid, ci, photo, accent, x, y, r){
  const key = uid.indexOf('lion')===0 ? 'lion' : (uid.indexOf('cas')===0 ? 'castle' : 'snow');
  const glow='<circle cx="'+x+'" cy="'+y+'" r="'+(r+38)+'" fill="url(#hg'+uid+')"/>';
  let body='', back='', front='', tone='#f0d2b4';
  if(key==='lion'){
    const gold='#E6AE5A', dk='#c9923f', mane= ci? '#a9631f':'#d49a48', ringR= ci? r*1.5 : r*1.18;
    tone=mane;
    body='<path d="M'+(x+r*0.95)+' '+(y+r*1.5)+' q '+(r*0.95)+' '+(-r*0.1)+' '+(r*0.55)+' '+(r*0.9)+'" stroke="'+gold+'" stroke-width="'+(r*0.2)+'" fill="none" stroke-linecap="round"/><circle cx="'+(x+r*1.5)+'" cy="'+(y+r*2.35)+'" r="'+(r*0.24)+'" fill="'+mane+'"/>'
      +'<ellipse cx="'+x+'" cy="'+(y+r*1.75)+'" rx="'+(r*1.15)+'" ry="'+(r*0.98)+'" fill="'+gold+'"/>'
      +'<rect x="'+(x-r*0.72)+'" y="'+(y+r*2.15)+'" width="'+(r*0.5)+'" height="'+(r*0.72)+'" rx="'+(r*0.25)+'" fill="'+gold+'"/><rect x="'+(x+r*0.22)+'" y="'+(y+r*2.15)+'" width="'+(r*0.5)+'" height="'+(r*0.72)+'" rx="'+(r*0.25)+'" fill="'+gold+'"/>'
      +'<ellipse cx="'+x+'" cy="'+(y+r*1.95)+'" rx="'+(r*0.55)+'" ry="'+(r*0.45)+'" fill="#f5d8a3"/>';
    back='<circle cx="'+x+'" cy="'+y+'" r="'+ringR+'" fill="'+mane+'"/>';
    front='<circle cx="'+(x-r*0.72)+'" cy="'+(y-r*0.74)+'" r="'+(r*0.34)+'" fill="'+gold+'"/><circle cx="'+(x+r*0.72)+'" cy="'+(y-r*0.74)+'" r="'+(r*0.34)+'" fill="'+gold+'"/><circle cx="'+(x-r*0.72)+'" cy="'+(y-r*0.74)+'" r="'+(r*0.17)+'" fill="'+dk+'"/><circle cx="'+(x+r*0.72)+'" cy="'+(y-r*0.74)+'" r="'+(r*0.17)+'" fill="'+dk+'"/>'
      + (ci? '' : '<path d="M'+(x-r*0.16)+' '+(y-r*1.12)+' q '+(r*0.16)+' '+(-r*0.32)+' '+(r*0.32)+' 0 z" fill="'+mane+'"/>');
  } else if(key==='castle' && ci===1){
    const fur='#6b5743', fur2='#7d6750';
    tone=fur;
    body='<ellipse cx="'+x+'" cy="'+(y+r*1.95)+'" rx="'+(r*1.32)+'" ry="'+(r*1.2)+'" fill="'+fur+'"/><ellipse cx="'+x+'" cy="'+(y+r*2.05)+'" rx="'+(r*0.7)+'" ry="'+(r*0.85)+'" fill="'+fur2+'"/>'
      +'<rect x="'+(x-r*0.85)+'" y="'+(y+r*2.7)+'" width="'+(r*0.55)+'" height="'+(r*0.45)+'" rx="'+(r*0.2)+'" fill="'+fur+'"/><rect x="'+(x+r*0.3)+'" y="'+(y+r*2.7)+'" width="'+(r*0.55)+'" height="'+(r*0.45)+'" rx="'+(r*0.2)+'" fill="'+fur+'"/>';
    back='<circle cx="'+x+'" cy="'+y+'" r="'+(r*1.28)+'" fill="'+fur+'"/>';
    front='<circle cx="'+(x-r*0.82)+'" cy="'+(y-r*0.8)+'" r="'+(r*0.4)+'" fill="'+fur+'"/><circle cx="'+(x+r*0.82)+'" cy="'+(y-r*0.8)+'" r="'+(r*0.4)+'" fill="'+fur+'"/><circle cx="'+(x-r*0.82)+'" cy="'+(y-r*0.8)+'" r="'+(r*0.2)+'" fill="'+fur2+'"/><circle cx="'+(x+r*0.82)+'" cy="'+(y-r*0.8)+'" r="'+(r*0.2)+'" fill="'+fur2+'"/>';
  } else if(key==='castle'){
    const cloak='#5a4d86', cloak2='#6b5ca0';
    tone=cloak2;
    body='<path d="M'+(x-r*1.35)+' '+(y+r*2.9)+' Q'+x+' '+(y+r*0.1)+' '+(x+r*1.35)+' '+(y+r*2.9)+' Z" fill="'+cloak+'"/><path d="M'+(x-r*0.5)+' '+(y+r*1.2)+' Q'+x+' '+(y+r*2.2)+' '+(x+r*0.5)+' '+(y+r*1.2)+'" stroke="'+cloak2+'" stroke-width="'+(r*0.12)+'" fill="none"/>';
    back='<circle cx="'+x+'" cy="'+y+'" r="'+(r*1.24)+'" fill="'+cloak2+'"/>';
    front='<path d="M'+(x-r*0.22)+' '+(y-r*1.42)+' Q'+x+' '+(y-r*1.92)+' '+(x+r*0.22)+' '+(y-r*1.42)+' Z" fill="'+cloak2+'"/>';
  } else if(key==='snow' && ci===1){
    const gownC='#cfe8fa', gown2='#aed4ee', crown='#eaf6ff';
    tone=gownC;
    body='<path d="M'+(x-r*1.15)+' '+(y+r*3.1)+' L'+(x-r*0.42)+' '+(y+r*0.55)+' L'+(x+r*0.42)+' '+(y+r*0.55)+' L'+(x+r*1.15)+' '+(y+r*3.1)+' Z" fill="'+gownC+'"/><path d="M'+(x-r*0.55)+' '+(y+r*1.4)+' L'+x+' '+(y+r*3.1)+' L'+(x+r*0.55)+' '+(y+r*1.4)+' Z" fill="'+gown2+'" opacity="0.6"/>';
    front='<path d="M'+(x-r*0.85)+' '+(y-r*0.78)+' l '+(r*0.2)+' '+(-r*0.66)+' '+(r*0.26)+' '+(r*0.44)+' '+(r*0.22)+' '+(-r*0.7)+' '+(r*0.22)+' '+(r*0.7)+' '+(r*0.26)+' '+(-r*0.44)+' '+(r*0.2)+' '+(r*0.66)+' z" fill="'+crown+'" stroke="#9cc7e6" stroke-width="1"/><path d="M'+(x-r*0.7)+' '+(y+r*0.7)+' Q'+x+' '+(y+r*1.1)+' '+(x+r*0.7)+' '+(y+r*0.7)+'" stroke="'+gown2+'" stroke-width="'+(r*0.16)+'" fill="none" stroke-linecap="round"/>';
  } else {
    const coat='#3f7bb0', coat2='#2f5f86', trim='#eaf3fb';
    tone=coat;
    body='<path d="M'+(x-r*1.25)+' '+(y+r*2.9)+' Q'+x+' '+(y+r*0.3)+' '+(x+r*1.25)+' '+(y+r*2.9)+' Z" fill="'+coat+'"/>'
      +'<circle cx="'+(x-r*1.0)+'" cy="'+(y+r*2.0)+'" r="'+(r*0.32)+'" fill="'+coat2+'"/><circle cx="'+(x+r*1.0)+'" cy="'+(y+r*2.0)+'" r="'+(r*0.32)+'" fill="'+coat2+'"/>';
    back='<circle cx="'+x+'" cy="'+y+'" r="'+(r*1.3)+'" fill="'+coat+'"/>';
    front='<circle cx="'+x+'" cy="'+y+'" r="'+(r*1.18)+'" fill="none" stroke="'+trim+'" stroke-width="'+(r*0.26)+'"/><path d="M'+(x-r*0.7)+' '+(y+r*1.0)+' L'+(x+r*0.7)+' '+(y+r*1.0)+' L'+(x+r*0.5)+' '+(y+r*1.55)+' L'+(x-r*0.5)+' '+(y+r*1.55)+' Z" fill="#d65b5b"/>';
  }
  return glow+body+back+faceNode(uid, photo, x, y, r, tone, accent)+front;
}

function wrap(uid, skyStops, accent, body, extraDefs){
  return '<svg viewBox="0 0 800 520" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style="display:block">'
    +'<defs><linearGradient id="sky'+uid+'" x1="0" y1="0" x2="0" y2="1">'+skyStops+'</linearGradient>'
    +'<radialGradient id="hg'+uid+'" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="'+accent+'" stop-opacity="0.55"/><stop offset="60%" stop-color="'+accent+'" stop-opacity="0.12"/><stop offset="100%" stop-color="'+accent+'" stop-opacity="0"/></radialGradient>'
    +(extraDefs||'')+'</defs>'
    +'<rect width="800" height="520" fill="url(#sky'+uid+')"/>'+body+'</svg>';
}

function lionScene(i, photo, ci){
  const uid='lion'+i, acc='#E0992E';
  const sky='<stop offset="0%" stop-color="#231708"/><stop offset="52%" stop-color="#7c4d1b"/><stop offset="100%" stop-color="#e3a23f"/>';
  const sd='<radialGradient id="sun'+uid+'" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffe8b8"/><stop offset="55%" stop-color="#ffcf7a" stop-opacity="0.65"/><stop offset="100%" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>';
  const sun=(cx,cy,r)=>'<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*2.6)+'" fill="url(#sun'+uid+')"/><circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="#ffe6ad"/>';
  const acacia=(x,y,s)=>'<g transform="translate('+x+','+y+') scale('+s+')"><rect x="-3.5" y="-30" width="7" height="32" fill="#1a1207"/><path d="M-40 -30 Q0 -48 40 -30 Q20 -34 0 -33 Q-20 -34 -40 -30Z" fill="#1a1207"/></g>';
  const lsil=(x,y,s)=>'<g transform="translate('+x+','+y+') scale('+s+')"><ellipse cx="0" cy="0" rx="30" ry="14" fill="#1d1408"/><circle cx="26" cy="-9" r="11" fill="#1d1408"/><path d="M22 -18 l-3 -8 6 3 z" fill="#1d1408"/></g>';
  let body='';
  if(i===0){
    body=sun(580,150,46)
      +'<path d="M250 520 L300 250 L342 244 L388 520 Z" fill="#221808"/>'
      +'<path d="M300 250 L342 244 L356 300 L312 308 Z" fill="#2c2010"/>'
      +'<path d="M0 470 Q400 432 800 470 L800 520 L0 520Z" fill="#3a2710"/>'
      +charFigure(uid,ci,photo,acc,330,222,40);
  } else if(i===1){
    body=sun(662,168,40)
      +'<path d="M0 360 Q400 332 800 360 L800 520 L0 520Z" fill="#caa24f"/>'
      +'<path d="M0 410 Q400 386 800 410 L800 520 L0 520Z" fill="#a9823a"/>'
      +acacia(120,372,1)+acacia(700,366,1.25)+acacia(520,360,0.8)
      +charFigure(uid,ci,photo,acc,380,372,44);
  } else if(i===2){
    body='<ellipse cx="240" cy="118" rx="200" ry="64" fill="#1c150c"/><ellipse cx="540" cy="88" rx="220" ry="70" fill="#211913"/><ellipse cx="430" cy="148" rx="260" ry="60" fill="#171009"/>'
      +'<g stroke="#d9b877" stroke-width="2" opacity="0.45"><line x1="120" y1="60" x2="80" y2="150"/><line x1="300" y1="40" x2="250" y2="130"/><line x1="640" y1="60" x2="600" y2="150"/></g>'
      +'<rect width="800" height="520" fill="#0c0805" opacity="0.3"/>'
      +'<path d="M0 400 Q400 374 800 400 L800 520 L0 520Z" fill="#7a5d2e"/>'
      +charFigure(uid,ci,photo,acc,400,372,46);
  } else if(i===3){
    body=sun(400,250,92)
      +'<path d="M0 380 Q400 300 800 380 L800 520 L0 520Z" fill="#8c6a30"/>'
      +'<path d="M0 430 Q400 374 800 430 L800 520 L0 520Z" fill="#5e451f"/>'
      +charFigure(uid,ci,photo,acc,400,300,56);
  } else {
    body=sun(400,180,80)
      +'<path d="M120 520 L210 300 L420 296 L470 520 Z" fill="#241808"/>'
      +'<path d="M0 440 Q400 402 800 440 L800 520 L0 520Z" fill="#3c2911"/>'
      +lsil(180,470,1)+lsil(560,476,1.1)+lsil(650,452,0.8)+lsil(110,452,0.7)
      +charFigure(uid,ci,photo,acc,320,288,42);
  }
  return wrap(uid, sky, acc, body, sd);
}

function castleScene(i, photo, ci){
  const uid='cas'+i, acc='#9B86E0';
  const sky='<stop offset="0%" stop-color="#100a22"/><stop offset="55%" stop-color="#2a2150"/><stop offset="100%" stop-color="#4a3c78"/>';
  const cd='<radialGradient id="cand'+uid+'" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffe0a0"/><stop offset="55%" stop-color="#ffcf7a" stop-opacity="0.45"/><stop offset="100%" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>';
  const w=(x,y)=>'<circle cx="'+x+'" cy="'+y+'" r="16" fill="url(#cand'+uid+')"/><rect x="'+(x-6)+'" y="'+(y-10)+'" width="12" height="22" rx="6" fill="#ffd690"/>';
  let body='';
  if(i===0){
    body='<g opacity="0.55">'+star(120,70,2,'#cdbff5')+star(300,46,2.4,'#cdbff5')+star(660,64,2,'#cdbff5')+star(520,36,1.6,'#cdbff5')+star(420,80,1.5,'#cdbff5')+'</g>'
      +'<rect x="300" y="200" width="200" height="270" fill="#1c1638"/><polygon points="300,200 400,150 500,200" fill="#15102a"/>'
      +'<rect x="230" y="250" width="64" height="220" fill="#181230"/><polygon points="230,250 262,210 294,250" fill="#120d24"/>'
      +'<rect x="506" y="250" width="64" height="220" fill="#181230"/><polygon points="506,250 538,210 570,250" fill="#120d24"/>'
      +w(400,250)+w(262,290)+w(538,290)+w(360,312)+w(440,312)
      +'<path d="M372 470 v-70 a28 28 0 0 1 56 0 v70 z" fill="#100b22"/><path d="M380 470 v-64 a20 20 0 0 1 40 0 v64 z" fill="url(#cand'+uid+')"/>'
      +'<path d="M0 440 Q160 414 330 440 Q520 470 800 438 L800 520 L0 520Z" fill="#0c0820"/>'
      +charFigure(uid,ci,photo,acc,400,452,30);
  } else if(i===1){
    body='<rect y="382" width="800" height="138" fill="#1a1335"/>'
      +'<circle cx="120" cy="200" r="20" fill="url(#cand'+uid+')"/><circle cx="690" cy="220" r="20" fill="url(#cand'+uid+')"/>'
      +'<rect x="466" y="300" width="68" height="110" fill="#241a44"/><rect x="452" y="292" width="96" height="14" rx="4" fill="#2e2452"/>'
      +'<path d="M460 300 Q500 210 540 300 Z" fill="#bcd0ff" opacity="0.1"/><path d="M460 300 Q500 210 540 300" fill="none" stroke="#cdbff5" stroke-width="1.5" opacity="0.6"/><circle cx="500" cy="206" r="4" fill="#cdbff5"/>'
      +'<circle cx="500" cy="268" r="30" fill="url(#cand'+uid+')"/>'
      +'<path d="M500 250 q-12 8 -12 20 q12 -6 12 -6 q0 0 12 6 q0 -12 -12 -20z" fill="#d9637f"/><circle cx="500" cy="268" r="7" fill="#e87f97"/><rect x="498" y="274" width="4" height="22" fill="#4a7a52"/>'
      +star(470,240,3,'#ffe0a0')+star(534,250,2.5,'#ffe0a0')+star(512,302,2,'#ffe0a0')
      +charFigure(uid,ci,photo,acc,250,330,40);
  } else if(i===2){
    body='<rect x="60" y="120" width="40" height="360" fill="#181230"/><rect x="700" y="120" width="40" height="360" fill="#181230"/>'
      +'<path d="M60 120 Q400 30 740 120 L740 150 Q400 70 60 150 Z" fill="#1c1638"/>'
      +'<rect y="400" width="800" height="120" fill="#15102e"/>'
      +'<circle cx="150" cy="220" r="22" fill="url(#cand'+uid+')"/><circle cx="650" cy="220" r="22" fill="url(#cand'+uid+')"/>'
      +'<g transform="translate(545,300)"><circle cx="-86" cy="-104" r="20" fill="#6b5743"/><circle cx="86" cy="-104" r="20" fill="#6b5743"/><circle cx="0" cy="-40" r="64" fill="#6b5743"/><circle cx="0" cy="-120" r="48" fill="#6b5743"/><ellipse cx="0" cy="-22" rx="34" ry="26" fill="#8a7660"/><circle cx="-18" cy="-130" r="11" fill="#fff"/><circle cx="18" cy="-130" r="11" fill="#fff"/><circle cx="-16" cy="-128" r="5.5" fill="#2a2018"/><circle cx="20" cy="-128" r="5.5" fill="#2a2018"/><path d="M-12 -16 q12 9 24 0" stroke="#4a3a2c" stroke-width="3" fill="none" stroke-linecap="round"/></g>'
      +charFigure(uid,ci,photo,acc,250,360,46);
  } else if(i===3){
    body='<rect y="380" width="800" height="140" fill="#3a2c14"/><rect y="380" width="800" height="6" fill="#ffd690" opacity="0.25"/>'
      +'<circle cx="200" cy="120" r="22" fill="url(#cand'+uid+')"/><circle cx="600" cy="120" r="22" fill="url(#cand'+uid+')"/><circle cx="400" cy="90" r="26" fill="url(#cand'+uid+')"/>'
      +'<g stroke="#6b5ca0" stroke-width="2" opacity="0.6"><line x1="200" y1="0" x2="200" y2="98"/><line x1="600" y1="0" x2="600" y2="98"/><line x1="400" y1="0" x2="400" y2="64"/></g>'
      +'<g transform="translate(500,330)"><circle cx="0" cy="-30" r="46" fill="#6b5743"/><circle cx="0" cy="-78" r="34" fill="#6b5743"/><ellipse cx="0" cy="-16" rx="24" ry="18" fill="#8a7660"/><circle cx="-12" cy="-84" r="7" fill="#fff"/><circle cx="12" cy="-84" r="7" fill="#fff"/><circle cx="-11" cy="-83" r="3.5" fill="#2a2018"/><circle cx="13" cy="-83" r="3.5" fill="#2a2018"/></g>'
      +star(300,180,3,'#ffe6b0')+star(520,160,2.6,'#ffe6b0')+star(360,260,2.2,'#ffe6b0')+star(620,240,2.6,'#ffe6b0')+star(180,260,2,'#ffe6b0')
      +charFigure(uid,ci,photo,acc,320,330,40);
  } else {
    body='<circle cx="400" cy="250" r="300" fill="url(#cand'+uid+')"/>'
      +'<rect y="400" width="800" height="120" fill="#3a2c14"/>'
      +'<path d="M120 400 L120 180 Q120 150 160 150 L160 400 Z" fill="#6b5ca0" opacity="0.5"/><path d="M680 400 L680 180 Q680 150 640 150 L640 400 Z" fill="#6b5ca0" opacity="0.5"/>'
      +'<g stroke="#ffe6b0" stroke-width="2" opacity="0.4"><line x1="400" y1="60" x2="400" y2="160"/><line x1="280" y1="90" x2="320" y2="170"/><line x1="520" y1="90" x2="480" y2="170"/></g>'
      +star(220,160,3,'#fff')+star(580,150,3,'#fff')+star(330,120,2.4,'#fff')+star(470,120,2.4,'#fff')
      +charFigure(uid,ci,photo,acc,400,300,56);
  }
  return wrap(uid, sky, acc, body, cd);
}

function snowScene(i, photo, ci){
  const uid='snw'+i, acc='#6FA8D4';
  const sky='<stop offset="0%" stop-color="#0c1a2c"/><stop offset="55%" stop-color="#244c6e"/><stop offset="100%" stop-color="#69a0c9"/>';
  const ig='<radialGradient id="ice'+uid+'" cx="50%" cy="42%" r="60%"><stop offset="0%" stop-color="#eaf6ff"/><stop offset="55%" stop-color="#bcdcf5" stop-opacity="0.45"/><stop offset="100%" stop-color="#bcdcf5" stop-opacity="0"/></radialGradient><radialGradient id="warm'+uid+'" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffe6b0" stop-opacity="0.8"/><stop offset="100%" stop-color="#ffe6b0" stop-opacity="0"/></radialGradient>';
  const flakes=(n)=>{let s='';for(let k=0;k<n;k++){const x=(k*113+17)%800,y=(k*71+33)%430,r=((k%3)+1)*1.05;s+='<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="#eaf5ff" opacity="'+(0.22+(k%4)*0.12).toFixed(2)+'"/>';}return s;};
  const mtn='<polygon points="-20,360 180,180 380,360" fill="#1c3550"/><polygon points="220,360 440,150 660,360" fill="#22405f"/><polygon points="520,360 720,190 860,360" fill="#1c3550"/><polygon points="380,206 440,150 500,206" fill="#dfeefb"/><polygon points="660,250 720,190 780,250" fill="#dfeefb"/><polygon points="120,236 180,180 240,236" fill="#dfeefb"/>';
  let body='';
  if(i===0){
    const house=(x,y,wd,h)=>'<rect x="'+x+'" y="'+y+'" width="'+wd+'" height="'+h+'" fill="#2a3b52"/><polygon points="'+(x-6)+','+y+' '+(x+wd/2)+','+(y-h*0.6)+' '+(x+wd+6)+','+y+'" fill="#1d2c40"/><polygon points="'+(x-6)+','+y+' '+(x+wd/2)+','+(y-h*0.6)+' '+(x+wd+6)+','+y+'" fill="#eaf5ff" opacity="0.16"/><rect x="'+(x+wd/2-7)+'" y="'+(y+12)+'" width="14" height="18" rx="2" fill="#ffd58a"/>';
    body='<path d="M0 400 Q400 380 800 400 L800 520 L0 520Z" fill="#dbe9f6"/>'
      +house(110,360,70,70)+house(620,366,70,64)
      +'<rect x="392" y="330" width="6" height="80" fill="#3a4d63"/><circle cx="395" cy="326" r="14" fill="url(#warm'+uid+')"/><circle cx="395" cy="326" r="6" fill="#ffd58a"/>'
      +charFigure(uid,ci,photo,acc,395,372,40)+flakes(48);
  } else if(i===1){
    body=mtn+'<rect y="372" width="800" height="148" fill="#bcdcf2"/>'
      +'<g opacity="0.5"><rect y="376" width="800" height="2" fill="#fff"/><rect y="402" width="800" height="2" fill="#fff"/><rect y="436" width="800" height="2" fill="#fff"/></g>'
      +star(150,410,3,'#fff')+star(620,400,3,'#fff')+star(470,440,2.4,'#fff')+star(260,460,2.4,'#fff')
      +charFigure(uid,ci,photo,acc,400,360,42)+flakes(40);
  } else if(i===2){
    const spire=(cx,base,top,wd,c)=>'<polygon points="'+(cx-wd)+','+base+' '+(cx-wd)+','+(top+34)+' '+cx+','+top+' '+(cx+wd)+','+(top+34)+' '+(cx+wd)+','+base+'" fill="'+c+'"/>';
    body='<circle cx="400" cy="240" r="210" fill="url(#ice'+uid+')"/>'
      +spire(280,420,200,44,'#7fb0d6')+spire(520,420,200,44,'#7fb0d6')+spire(400,420,120,60,'#a6cfec')
      +'<g stroke="#eaf6ff" stroke-width="1.5" opacity="0.5"><line x1="400" y1="120" x2="370" y2="420"/><line x1="400" y1="120" x2="430" y2="420"/><line x1="280" y1="200" x2="262" y2="420"/><line x1="520" y1="200" x2="538" y2="420"/></g>'
      +'<path d="M0 420 Q400 400 800 420 L800 520 L0 520Z" fill="#dbe9f6"/>'
      +star(250,150,3,'#fff')+star(560,160,3,'#fff')+star(400,90,2.6,'#fff')
      +charFigure(uid,ci,photo,acc,400,432,32)+flakes(38);
  } else if(i===3){
    body='<path d="M0 410 Q400 392 800 410 L800 520 L0 520Z" fill="#dbe9f6"/>'
      +'<g transform="translate(520,300)"><polygon points="-44,160 44,160 22,-30 -22,-30" fill="url(#ice'+uid+')"/><polygon points="-44,160 44,160 16,30 -16,30" fill="#cfe8fa" opacity="0.6"/><circle cx="0" cy="-52" r="24" fill="#eaf3fb"/><path d="M-22 -66 l5 -18 6 12 5 -20 5 20 6 -12 5 18 z" fill="#dff0ff" stroke="#9cc7e6" stroke-width="1"/><circle cx="-8" cy="-52" r="3" fill="#5a7a92"/><circle cx="8" cy="-52" r="3" fill="#5a7a92"/><path d="M-7 -42 q7 5 14 0" stroke="#5a7a92" stroke-width="2" fill="none" stroke-linecap="round"/></g>'
      +'<g opacity="0.6"><path d="M120 120 q40 30 0 60 q-40 -30 0 -60" fill="none" stroke="#eaf6ff" stroke-width="2"/><path d="M680 160 q40 30 0 60 q-40 -30 0 -60" fill="none" stroke="#eaf6ff" stroke-width="2"/></g>'
      +charFigure(uid,ci,photo,acc,270,392,44)+flakes(54);
  } else {
    body='<circle cx="660" cy="110" r="170" fill="url(#warm'+uid+')"/>'
      +'<g opacity="0.32"><polygon points="280,400 360,250 440,400" fill="#a6cfec"/><polygon points="400,400 470,280 540,400" fill="#a6cfec"/></g>'
      +'<path d="M0 380 Q400 356 800 380 L800 520 L0 520Z" fill="#5ea36c"/>'
      +'<path d="M0 430 Q400 408 800 430 L800 520 L0 520Z" fill="#4a8a59"/>'
      +'<g><circle cx="180" cy="430" r="5" fill="#f5d35a"/><circle cx="250" cy="450" r="4" fill="#e87fa0"/><circle cx="600" cy="440" r="5" fill="#f5d35a"/><circle cx="680" cy="458" r="4" fill="#e87fa0"/></g>'
      +charFigure(uid,ci,photo,acc,400,360,44)+flakes(10);
  }
  return wrap(uid, sky, acc, body, ig);
}

function sceneSVG(key,i,photo,ci){
  ci = ci||0;
  if(key==='lion') return lionScene(i,photo,ci);
  if(key==='castle') return castleScene(i,photo,ci);
  return snowScene(i,photo,ci);
}

function lionFace(big){
  const mane = big ? '<circle cx="60" cy="62" r="46" fill="#b9772e"/>' : '';
  const sprout = big ? '' : '<path d="M52 28 q8 -10 16 0" fill="#b9772e"/>';
  return mane+'<circle cx="60" cy="64" r="33" fill="#E6AE5A"/>'+sprout
    +'<circle cx="40" cy="42" r="9" fill="#d49a48"/><circle cx="80" cy="42" r="9" fill="#d49a48"/>'
    +'<ellipse cx="60" cy="78" rx="17" ry="13" fill="#f5d8a3"/>'
    +'<circle cx="49" cy="60" r="4.5" fill="#2a2018"/><circle cx="71" cy="60" r="4.5" fill="#2a2018"/>'
    +'<path d="M54 74 q6 6 12 0" stroke="#2a2018" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
    +'<path d="M56 70 l4 4 4 -4 z" fill="#7a4a2a"/>';
}
function wandererFace(){
  return '<path d="M26 104 q34 -58 68 0 z" fill="#5a4d86"/>'
    +'<circle cx="60" cy="60" r="22" fill="#f0d2b4"/>'
    +'<path d="M34 64 a26 26 0 0 1 52 0 q-8 -34 -26 -34 q-18 0 -26 34 z" fill="#6b5ca0"/>'
    +'<circle cx="52" cy="60" r="3" fill="#2a2018"/><circle cx="68" cy="60" r="3" fill="#2a2018"/>'
    +'<path d="M54 70 q6 5 12 0" stroke="#2a2018" stroke-width="2" fill="none" stroke-linecap="round"/>';
}
function creatureFace(){
  return '<circle cx="34" cy="38" r="13" fill="#6b5743"/><circle cx="86" cy="38" r="13" fill="#6b5743"/>'
    +'<circle cx="60" cy="66" r="40" fill="#6b5743"/>'
    +'<ellipse cx="60" cy="80" rx="20" ry="15" fill="#8a7660"/>'
    +'<circle cx="47" cy="58" r="8" fill="#fff"/><circle cx="73" cy="58" r="8" fill="#fff"/>'
    +'<circle cx="48" cy="59" r="4" fill="#2a2018"/><circle cx="72" cy="59" r="4" fill="#2a2018"/>'
    +'<path d="M52 80 q8 7 16 0" stroke="#4a3a2c" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
    +'<path d="M58 72 l4 4 4 -4z" fill="#4a3a2c"/>';
}
function travelerFace(){
  return '<path d="M24 104 q36 -54 72 0 z" fill="#2f5f86"/>'
    +'<path d="M30 58 a30 30 0 0 1 60 0 l-6 10 a24 24 0 0 0 -48 0 z" fill="#3f7bb0"/>'
    +'<circle cx="60" cy="64" r="21" fill="#f3d3b6"/>'
    +'<circle cx="48" cy="78" r="6" fill="#e89a8a" opacity="0.5"/><circle cx="72" cy="78" r="6" fill="#e89a8a" opacity="0.5"/>'
    +'<circle cx="52" cy="62" r="3" fill="#2a2018"/><circle cx="68" cy="62" r="3" fill="#2a2018"/>'
    +'<path d="M54 72 q6 5 12 0" stroke="#2a2018" stroke-width="2" fill="none" stroke-linecap="round"/>'
    +'<rect x="38" y="86" width="44" height="10" rx="5" fill="#d65b5b"/>';
}
function queenFace(){
  return '<path d="M30 110 q30 -40 60 0 z" fill="#bcdcf5"/>'
    +'<circle cx="60" cy="60" r="24" fill="#eaf3fb"/>'
    +'<path d="M40 44 l5 -16 6 11 9 -18 9 18 6 -11 5 16 z" fill="#dff0ff" stroke="#9cc7e6" stroke-width="1"/>'
    +'<circle cx="52" cy="60" r="3" fill="#5a7a92"/><circle cx="68" cy="60" r="3" fill="#5a7a92"/>'
    +'<path d="M54 69 q6 5 12 0" stroke="#5a7a92" stroke-width="2" fill="none" stroke-linecap="round"/>'
    +'<circle cx="92" cy="40" r="2" fill="#fff"/><circle cx="28" cy="48" r="1.6" fill="#fff"/><circle cx="86" cy="80" r="1.6" fill="#fff"/>';
}
function charAvatar(key,ci){
  let inner='';
  if(key==='lion') inner = ci===0 ? lionFace(false) : lionFace(true);
  else if(key==='castle') inner = ci===0 ? wandererFace() : creatureFace();
  else inner = ci===0 ? travelerFace() : queenFace();
  return '<svg viewBox="0 0 120 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="60" fill="#0e1413"/>'+inner+'</svg>';
}

function welcomeArt(){
  const emblem=(cx,cy,acc,icon)=>'<circle cx="'+cx+'" cy="'+cy+'" r="38" fill="#0c0e0d"/><circle cx="'+cx+'" cy="'+cy+'" r="38" fill="none" stroke="'+acc+'" stroke-width="1.5"/>'+icon;
  const sunI=(cx,cy)=>{let r='';for(let k=0;k<8;k++){const a=k*Math.PI/4;r+='<line x1="'+(cx+Math.cos(a)*16)+'" y1="'+(cy+Math.sin(a)*16)+'" x2="'+(cx+Math.cos(a)*23)+'" y2="'+(cy+Math.sin(a)*23)+'" stroke="#E0992E" stroke-width="2.5" stroke-linecap="round"/>';}return '<circle cx="'+cx+'" cy="'+cy+'" r="12" fill="#E0992E"/>'+r;};
  const castleI=(cx,cy)=>'<g transform="translate('+(cx-18)+','+(cy-14)+')"><rect x="0" y="8" width="9" height="20" fill="#9B86E0"/><rect x="27" y="8" width="9" height="20" fill="#9B86E0"/><rect x="11" y="0" width="14" height="28" fill="#9B86E0"/><polygon points="0,8 4.5,0 9,8" fill="#9B86E0"/><polygon points="27,8 31.5,0 36,8" fill="#9B86E0"/><polygon points="11,0 18,-8 25,0" fill="#9B86E0"/></g>';
  const snowI=(cx,cy)=>{let s='';for(let k=0;k<6;k++){const a=k*Math.PI/3;s+='<line x1="'+cx+'" y1="'+cy+'" x2="'+(cx+Math.cos(a)*20)+'" y2="'+(cy+Math.sin(a)*20)+'" stroke="#6FA8D4" stroke-width="2.5" stroke-linecap="round"/>';}return s;};
  return '<svg viewBox="0 0 520 360" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">'
    +'<defs><radialGradient id="cgw" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#16E3C1" stop-opacity="0.5"/><stop offset="70%" stop-color="#16E3C1" stop-opacity="0.08"/><stop offset="100%" stop-color="#16E3C1" stop-opacity="0"/></radialGradient></defs>'
    +'<g stroke="#16E3C1" stroke-width="1" stroke-dasharray="3 5" opacity="0.4"><line x1="260" y1="178" x2="110" y2="104"/><line x1="260" y1="178" x2="410" y2="104"/><line x1="260" y1="178" x2="260" y2="290"/></g>'
    +'<circle cx="260" cy="178" r="78" fill="url(#cgw)"/>'
    +'<circle cx="260" cy="178" r="50" fill="#0e1413" stroke="#16E3C1" stroke-width="2"/>'
    +'<circle cx="260" cy="172" r="17" fill="#26312e"/><ellipse cx="260" cy="202" rx="27" ry="18" fill="#26312e"/>'
    +star(260,114,11,'#16E3C1')
    +emblem(110,104,'#E0992E',sunI(110,104))
    +emblem(410,104,'#9B86E0',castleI(410,104))
    +emblem(260,290,'#6FA8D4',snowI(260,290))
    +'</svg>';
}
