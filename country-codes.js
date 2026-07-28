// Datos de país/código de marcación para el selector de login por teléfono
// (auth-ui.js). Solo name/iso2/dial se mantienen a mano — la bandera se
// deriva de iso2 vía símbolos Unicode regional-indicator (flagEmoji), así
// no hay ~190 emoji tecleados a mano que puedan estar mal.
export const COUNTRY_CODES = [
  { name: 'México', iso2: 'MX', dial: '+52' },
  { name: 'Estados Unidos', iso2: 'US', dial: '+1' }
];

export function flagEmoji(iso2) {
  return String.fromCodePoint(...[...iso2.toUpperCase()].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

// Separa un E.164 completo en { dial, local } — usado para pre-llenar el
// select+input de país/número cuando ya existe un teléfono guardado (ver
// docs/superpowers/specs/2026-07-27-phone-input-country-split-design.md).
// Empareja el prefijo MÁS LARGO posible (ej. +1246 de Barbados antes que
// +1 de EE.UU./Canadá) para no cortar mal el número local.
export function splitE164(phone) {
  if (!phone) return { dial: '+52', local: '' };
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length);
  const match = sorted.find(c => phone.startsWith(c.dial));
  if (match) return { dial: match.dial, local: phone.slice(match.dial.length) };
  return { dial: '+52', local: phone.replace(/^\+/, '') };
}
