function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;

  let str = String(value).trim().replace(/[R$\s]/g, '');
  if (!str) return null;

  if (str.includes('.') && str.includes(',')) {
    const lastDotIndex = str.lastIndexOf('.');
    const lastCommaIndex = str.lastIndexOf(',');
    if (lastCommaIndex > lastDotIndex) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Verifica caso como 1,200 (só milhar com vírgula). Se tiver 3 dígitos dps da vírgula...
    // Num sistema misto, "6,99" -> "6.99".
    str = str.replace(',', '.');
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}
console.log("6,99 ->", parsePrice("6,99"));
console.log("6.99 ->", parsePrice("6.99"));
console.log("1.200,99 ->", parsePrice("1.200,99"));
console.log("1,200.99 ->", parsePrice("1,200.99"));
console.log("1200,99 ->", parsePrice("1200,99"));
console.log("R$ 6,99 ->", parsePrice("R$ 6,99"));
console.log("invalid ->", parsePrice("invalid"));
