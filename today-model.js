import {validateProfile} from './tutor-profile.js';
export const TODAY_MODES={usual:'Come al solito',short:'Passaggi più brevi',quiet:'Un ritmo più tranquillo',autonomy:'Più spazio per ragionare da solo'};
export function effectiveProfile(profile,today,day){const p=validateProfile(profile);if(!today||today.day!==day||!Object.hasOwn(TODAY_MODES,today.mode))return p;if(today.mode==='short')return {...p,pace:'short'};if(today.mode==='quiet')return {...p,tone:'calm',interaction:'quiet'};if(today.mode==='autonomy')return {...p,interaction:'quiet'};return p;}
