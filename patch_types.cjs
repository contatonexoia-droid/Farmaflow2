const fs = require('fs');
let code = fs.readFileSync('types.ts', 'utf8');

if (!code.includes('isAiCopilotEnabled')) {
  code = code.replace(
    'isAiAgentEnabled?: boolean;',
    'isAiAgentEnabled?: boolean;\n  isAiCopilotEnabled?: boolean;'
  );
  code = code.replace(
    'is_ai_agent_enabled?: boolean;',
    'is_ai_agent_enabled?: boolean;\n  is_ai_copilot_enabled?: boolean;\n  isAiCopilotEnabled?: boolean;'
  );
  fs.writeFileSync('types.ts', code);
  console.log('types.ts updated');
} else {
  console.log('Already in types.ts');
}
