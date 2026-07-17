import { execSync } from 'child_process';
console.log(execSync('env | grep DATABASE').toString());
