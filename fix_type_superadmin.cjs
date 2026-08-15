const fs = require('fs');
let types = fs.readFileSync('types.ts', 'utf8');
if (!types.includes('is_ai_copilot_enabled?: boolean;')) {
  types = types.replace(
    'isAiCopilotEnabled?: boolean;',
    'isAiCopilotEnabled?: boolean;\n  is_ai_copilot_enabled?: boolean;'
  );
  fs.writeFileSync('types.ts', types);
}

let sa = fs.readFileSync('components/SuperAdminManager.tsx', 'utf8');
sa = sa.replace(
  '{(t.isAiCopilotEnabled || t.is_ai_copilot_enabled) && (',
  '{(t.isAiCopilotEnabled || (t as any).is_ai_copilot_enabled) && ('
);
fs.writeFileSync('components/SuperAdminManager.tsx', sa);
console.log('Fixed type in SuperAdminManager');
