const fs = require('fs');
let code = fs.readFileSync('components/AdminPrescriptions.tsx', 'utf8');

const importTarget = 'import { Check, X, Loader2, FileText, CheckCircle, AlertTriangle, User } from "lucide-react";';
code = code.replace(importTarget, importTarget + '\nimport { mutate } from "swr";');

const updateStatusTarget = 'fetchPrescriptions();';
// there are 2 occurrences of fetchPrescriptions(), one in useEffect, one in updateStatus.
const newCode = code.replace(
  'fetchPrescriptions();\n      } else {',
  `fetchPrescriptions();
        // Invalidate global orders state using SWR
        mutate(\`orders-trigger-\${tenantId}\`);
      } else {`
);

fs.writeFileSync('components/AdminPrescriptions.tsx', newCode);
