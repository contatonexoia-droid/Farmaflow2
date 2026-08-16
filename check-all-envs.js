import { execSync } from 'child_process';
const envKeys = execSync('env').toString().split('\n').filter(line => line.includes('DB') || line.includes('POSTGRES') || line.includes('DATABASE') || line.includes('SUPABASE'));
console.log(envKeys.join('\n'));
