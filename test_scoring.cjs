const text = "sh niely gold";
const regex = new RegExp(`(?:^|\\s|-|\\+|\\/)${"sh"}(?:\\s|-|\\+|\\/|$)`, "i");
console.log(regex.test(text)); // true

const text2 = "blush";
console.log(regex.test(text2)); // false
