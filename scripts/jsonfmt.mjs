/**
 * JSON-Ausgabe im Stil der Fragendateien: zwei Leerzeichen Einrückung, kurze
 * Listen aus Zeichenketten und Zahlen bleiben in einer Zeile.
 */
export function stringify(value, indent = 0) {
  const pad = '  '.repeat(indent), padIn = '  '.repeat(indent + 1);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const flat = value.every(v => v === null || typeof v !== 'object');
    if (flat) {
      const one = '[' + value.map(v => JSON.stringify(v)).join(', ') + ']';
      if (pad.length + one.length <= 116) return one;
    }
    return '[\n' + value.map(v => padIn + stringify(v, indent + 1)).join(',\n') + '\n' + pad + ']';
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  const one = '{ ' + keys.map(k => JSON.stringify(k) + ': ' + stringify(value[k], indent + 1)).join(', ') + ' }';
  if (keys.every(k => value[k] === null || typeof value[k] !== 'object') && pad.length + one.length <= 116) return one;
  return '{\n' + keys.map(k => padIn + JSON.stringify(k) + ': ' + stringify(value[k], indent + 1)).join(',\n') + '\n' + pad + '}';
}
