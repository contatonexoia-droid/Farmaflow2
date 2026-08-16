const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

const regex = /const \[adminTab, setAdminTab\] = useState<(.+?)>\(\s*"dashboard"\s*\);/;
content = content.replace(regex, (match, p1) => {
  if (!p1.includes('"inboxes"')) {
    return match.replace(p1, p1 + ' | "inboxes"');
  }
  return match;
});

fs.writeFileSync('App.tsx', content);
