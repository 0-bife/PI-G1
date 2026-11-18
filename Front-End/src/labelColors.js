export const PRESET_COLORS = [
  '#abbeed', '#f4b8b0', '#f6d28b', '#b7dfb9',
  '#b8e0e6', '#d4bfe8', '#e8c1d9', '#d9d4c2',
];

const HEX = /^#[0-9a-f]{6}$/i;

export function safeColor(value) {
  return HEX.test(value ?? '') ? value : null;
}

// Texto escuro ou claro conforme o fundo, para manter legibilidade.
function textOn(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#20252d' : '#ffffff';
}

export function labelStyle(value) {
  const color = safeColor(value);
  return color ? { background: color, color: textOn(color) } : undefined;
}