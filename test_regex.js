const pNames = ["shampoo adulto", "sh niely gold", "kit s/line sh+cr", "fresh", "splashers", "blush"];
const token = "sh";

const regex = new RegExp(`(?:^|\\s|-|\\+|\\/)${token}(?:\\s|-|\\+|\\/|$)`, "i");

pNames.forEach(p => {
  console.log(p, regex.test(p));
});
