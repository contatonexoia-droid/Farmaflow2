const fs = require('fs');
let code = fs.readFileSync('components/AdminPrescriptions.tsx', 'utf8');

const importTarget = "import { toast } from 'react-hot-toast';";
code = code.replace(importTarget, importTarget + '\nimport { mutate } from "swr";');

fs.writeFileSync('components/AdminPrescriptions.tsx', code);
