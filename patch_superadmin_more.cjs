const fs = require('fs');
let content = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

// Ensure isChatEnabled is mapped in editData from existing tenant
content = content.replace(
  'isNetworkMaster: tenant.isNetworkMaster || false,',
  'isChatEnabled: tenant.isChatEnabled || false,\n      isNetworkMaster: tenant.isNetworkMaster || false,'
);

fs.writeFileSync('components/SuperAdminManager.tsx', content);
