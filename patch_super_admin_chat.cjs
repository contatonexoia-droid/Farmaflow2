const fs = require('fs');
let content = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');

content = content.replace(
  'isNetworkMaster: editData.isNetworkMaster || false,',
  'isChatEnabled: editData.isChatEnabled || false,\n          isNetworkMaster: editData.isNetworkMaster || false,'
);

fs.writeFileSync('components/SuperAdminManager.tsx', content);
