const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

// Absolute/Relative Paths
const agentDir = __dirname;
const rootDir = path.join(agentDir, '..');
const buildDir = path.join(agentDir, 'build');
const installersDir = path.join(rootDir, 'public', 'installers');

// Create required directories if they don't exist
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
}
if (!fs.existsSync(installersDir)) {
    fs.mkdirSync(installersDir, { recursive: true });
}

async function run() {
    try {
        console.log('📦 Iniciando processo de compilação dos Agentes Desktop com "pkg"...');
        
        // Step 1: Install agent-sync dependencies first
        console.log('Installing agent dependencies...');
        execSync('npm install', { cwd: agentDir, stdio: 'inherit' });

        // Step 2: Compile Siagold
        console.log('\n🔨 Compilando Agente Siagold (Windows x64)...');
        execSync('npx pkg src/entry-siagold.js -t node18-win-x64 -o build/farmaflow-siagold.exe', { cwd: agentDir, stdio: 'inherit' });

        // Step 3: Compile Softpharma
        console.log('\n🔨 Compilando Agente Softpharma (Windows x64)...');
        execSync('npx pkg src/entry-softpharma.js -t node18-win-x64 -o build/farmaflow-softpharma.exe', { cwd: agentDir, stdio: 'inherit' });

        // Step 4: Compile InovaFarma
        console.log('\n🔨 Compilando Agente InovaFarma (Windows x64)...');
        execSync('npx pkg src/entry-inovafarma.js -t node18-win-x64 -o build/farmaflow-inovafarma.exe', { cwd: agentDir, stdio: 'inherit' });

        console.log('\n🤐 Compactando os executáveis para ZIP...');

        // Step 5: Zip Siagold
        const siagoldExe = path.join(buildDir, 'farmaflow-siagold.exe');
        const siagoldZip = path.join(installersDir, 'farmaflow-siagold.zip');
        const zipSiagold = new AdmZip();
        zipSiagold.addLocalFile(siagoldExe);
        zipSiagold.writeZip(siagoldZip);
        console.log(`✅ Gerado: ${path.basename(siagoldZip)}`);

        // Step 6: Zip Softpharma
        const softpharmaExe = path.join(buildDir, 'farmaflow-softpharma.exe');
        const softpharmaZip = path.join(installersDir, 'farmaflow-softpharma.zip');
        const zipSoftpharma = new AdmZip();
        zipSoftpharma.addLocalFile(softpharmaExe);
        zipSoftpharma.writeZip(softpharmaZip);
        console.log(`✅ Gerado: ${path.basename(softpharmaZip)}`);

        // Step 7: Zip InovaFarma
        const inovafarmaExe = path.join(buildDir, 'farmaflow-inovafarma.exe');
        const inovafarmaZip = path.join(installersDir, 'farmaflow-inovafarma.zip');
        const zipInovafarma = new AdmZip();
        zipInovafarma.addLocalFile(inovafarmaExe);
        zipInovafarma.writeZip(inovafarmaZip);
        console.log(`✅ Gerado: ${path.basename(inovafarmaZip)}`);

        console.log('\n🎉 Sincronização e compilação do Agente Desktop concluída com sucesso!');
    } catch (error) {
        console.error('\n❌ Erro durante a compilação/compactação:', error.message);
        process.exit(1);
    }
}

run();
